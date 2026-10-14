import os
import datetime
from typing import Dict, List, Any, Optional
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import io
import re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from config import BASE_DIR, BENCHMARKS
from database import (
    get_available_tickers,
    get_database_status,
    get_stock_data,
    get_intraday_chart_data,
    get_ticker_reports,
    get_ticker_dividends_db,
    save_ticker_dividends_db,
    get_company_profile_db,
    save_company_profile_db,
    get_postgres_connection
)
from calculations import (
    calculate_all_periods,
    calculate_groups_analysis
)
from services.polygon_service import polygon_client
from services.fmp_service import fmp_client
from services.earnings_reaction_service import earnings_reaction_client, is_report_already_released, parse_earnings_session
from services.quant_service import quant_client
from services.earnings_extra_service import get_ticker_earnings_extra_map, find_matching_earnings_extra
from services.datalens_service import calculate_hold_move_dates

app = FastAPI(
    title="Helion Financial Analysis Platform",
    description="Quantitative ticker analytics, dual TradingView charts, earnings moves, dividends, and correlation matrix.",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files directory
STATIC_DIR = BASE_DIR / "static"
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ============================================================
# ROOT PAGE
# ============================================================

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return HTMLResponse("<h1>Helion Quant Analysis Platform API Running</h1><p>Visit /docs for Swagger API</p>")


# ============================================================
# SYSTEM STATUS & TICKERS
# ============================================================

@app.get("/api/status")
async def api_status():
    db_stat = get_database_status()
    return {
        "status": "online",
        "database": db_stat,
        "timestamp": datetime.datetime.now().isoformat(),
        "benchmarks": BENCHMARKS
    }


@app.get("/api/tickers")
async def api_tickers(q: Optional[str] = None):
    all_tickers = get_available_tickers()
    if q:
        query = q.strip().upper()
        filtered = [t for t in all_tickers if query in t]
        return {"tickers": filtered[:50], "total": len(filtered)}
    return {"tickers": all_tickers, "total": len(all_tickers)}


# ============================================================
# COMPANY PROFILE & PEERS
# ============================================================

def compute_stock_volatility(ticker: str) -> Optional[float]:
    try:
        df_daily = get_stock_data(ticker)
        if df_daily.empty:
            poly_bars = polygon_client.fetch_daily_bars(ticker, start_date="2023-01-01")
            if poly_bars:
                df_daily = pd.DataFrame(poly_bars)
        if not df_daily.empty and len(df_daily) >= 15:
            df_sorted = df_daily.sort_values("date").tail(252)
            rets = df_sorted["close"].pct_change().dropna()
            if len(rets) >= 10:
                ann_vol = float(rets.std() * np.sqrt(252) * 100.0)
                return round(ann_vol, 1)
    except Exception as e:
        print(f"Error computing volatility for {ticker}:", e)
    return None


@app.get("/api/ticker/{ticker}/profile")
async def api_company_profile(ticker: str):
    ticker = ticker.strip().upper()
    cached = get_company_profile_db(ticker)
    vol = compute_stock_volatility(ticker)
    
    peers_list = fmp_client.get_stock_peers(ticker)
    business_peers = [
        {
            "symbol": p["symbol"].strip().upper(),
            "companyName": p.get("companyName", p["symbol"]),
            "price": p.get("price")
        }
        for p in peers_list if p.get("symbol") and p.get("symbol").strip().upper() != ticker
    ]
    peer_symbols = [p["symbol"] for p in business_peers]

    if cached and cached.get("description_ru"):
        raw_db_peers = cached.get("peers", [])
        if isinstance(raw_db_peers, str):
            raw_db_peers = [p.strip() for p in raw_db_peers.split(",") if p.strip()]
        cached["peers"] = peer_symbols or raw_db_peers
        cached["business_peers"] = business_peers
        cached["volatility"] = vol or cached.get("volatility")
        cached["description"] = cached.get("description_ru")
        return cached

    profile = fmp_client.get_company_profile(ticker)
    profile["peers"] = peer_symbols
    profile["business_peers"] = business_peers
    profile["volatility"] = vol
    profile["description"] = profile.get("description") or profile.get("description_ru")

    save_company_profile_db(ticker, profile)
    return profile


# ============================================================
# DUAL CHARTS DATA
# ============================================================

@app.get("/api/ticker/{ticker}/chart/daily")
async def api_daily_chart(ticker: str):
    """
    Returns daily OHLCV candlestick series + Earnings 'E' and Dividends 'D' event markers.
    """
    ticker = ticker.strip().upper()

    # 1. Fetch daily candles from DB or Polygon
    df = get_stock_data(ticker)
    candles = []

    if not df.empty:
        df["date_str"] = df["date"].dt.strftime("%Y-%m-%d")
        df = df.sort_values("date_str")
        for _, r in df.iterrows():
            candles.append({
                "time": r["date_str"],
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": float(r["volume"]) if pd.notnull(r["volume"]) else 0.0
            })
    else:
        poly_bars = polygon_client.fetch_daily_bars(ticker, start_date="2020-01-01")
        for b in poly_bars:
            candles.append({
                "time": b["date"],
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b["volume"]
            })

    # 2. Build Event Markers
    markers = []
    marker_details = {}

    candle_dates = {c["time"] for c in candles}
    sorted_candle_dates = sorted(list(candle_dates))

    def find_nearest_candle_date(target_date: str) -> Optional[str]:
        if target_date in candle_dates:
            return target_date
        if not sorted_candle_dates or target_date < sorted_candle_dates[0] or target_date > sorted_candle_dates[-1]:
            return None
        import bisect
        idx = bisect.bisect_left(sorted_candle_dates, target_date)
        if idx < len(sorted_candle_dates):
            cand = sorted_candle_dates[idx]
            try:
                d_target = datetime.date.fromisoformat(target_date)
                d_cand = datetime.date.fromisoformat(cand)
                if abs((d_cand - d_target).days) <= 4:
                    return cand
            except Exception:
                pass
        return None

    # A. Earnings Markers ('E')
    seen_earnings_dates = set()
    seen_candle_dates_list = []
    extra_map = get_ticker_earnings_extra_map(ticker)
    db_reports_df = get_ticker_reports(ticker)

    # 1. Primary source: PostgreSQL reports (Benzinga)
    if not db_reports_df.empty:
        for _, r in db_reports_df.iterrows():
            raw_date = str(r["date"])
            extra_info = find_matching_earnings_extra(extra_map, raw_date)
            if not extra_info and r.get("move_date"):
                extra_info = find_matching_earnings_extra(extra_map, str(r["move_date"]))
            session_name = parse_earnings_session(r.get("time")).upper()
            check_dict = {
                "date": raw_date,
                "time": session_name.lower(),
                "eps_actual": extra_info.get("eps_actual") if extra_info else None,
                "revenue_actual": extra_info.get("revenue_actual") if extra_info else None
            }
            if not is_report_already_released(check_dict):
                continue

            c_date = find_nearest_candle_date(raw_date)
            if not c_date and r.get("move_date"):
                c_date = find_nearest_candle_date(str(r["move_date"]))
            if not c_date:
                continue

            try:
                d_c = datetime.date.fromisoformat(c_date)
                if any(abs((d_c - prev_d).days) < 45 for prev_d in seen_candle_dates_list):
                    continue
                seen_candle_dates_list.append(d_c)
            except Exception:
                if c_date in seen_earnings_dates:
                    continue

            seen_earnings_dates.add(c_date)
            m_id = f"e_{c_date}"
            quarter_name = f"{r.get('fiscal_period', '')} {r.get('fiscal_year', '')}".strip()

            markers.append({
                "time": c_date,
                "position": "belowBar",
                "color": "#10b981",
                "shape": "square",
                "text": "E",
                "id": m_id
            })
            marker_details[m_id] = {
                "type": "Earnings",
                "date": c_date,
                "session": session_name,
                "quarter": quarter_name,
                "eps_actual": extra_info.get("eps_actual") if extra_info else None,
                "eps_estimate": extra_info.get("eps_estimate") if extra_info else None,
                "eps_surprise_pct": extra_info.get("eps_surprise_pct") if extra_info else None,
                "revenue_actual": extra_info.get("revenue_actual") if extra_info else None,
                "revenue_estimate": extra_info.get("revenue_estimate") if extra_info else None
            }

    # 2. Fallback or supplementary: FMP reports (for missing tickers or unreleased future announcements)
    earnings_list = fmp_client.get_earnings_history(ticker, limit=30)
    for earn in earnings_list:
        raw_date = earn.get("date")
        if not raw_date:
            continue
        c_date = find_nearest_candle_date(raw_date)
        if not c_date:
            continue
        try:
            d_c = datetime.date.fromisoformat(c_date)
            if any(abs((d_c - prev_d).days) < 45 for prev_d in seen_candle_dates_list):
                continue
            seen_candle_dates_list.append(d_c)
        except Exception:
            if c_date in seen_earnings_dates:
                continue

        extra_info = find_matching_earnings_extra(extra_map, raw_date)
        session_name = parse_earnings_session(earn.get("time")).upper()
        check_dict = {
            "date": raw_date,
            "time": session_name.lower(),
            "eps_actual": earn.get("eps_actual") if earn.get("eps_actual") is not None else (extra_info.get("eps_actual") if extra_info else None),
            "revenue_actual": earn.get("revenue_actual") if earn.get("revenue_actual") is not None else (extra_info.get("revenue_actual") if extra_info else None)
        }
        if not is_report_already_released(check_dict):
            continue

        seen_earnings_dates.add(c_date)
        m_id = f"e_{c_date}"
        markers.append({
            "time": c_date,
            "position": "belowBar",
            "color": "#10b981",
            "shape": "square",
            "text": "E",
            "id": m_id
        })
        marker_details[m_id] = {
            "type": "Earnings",
            "date": c_date,
            "session": session_name,
            "eps_actual": check_dict["eps_actual"],
            "eps_estimate": earn.get("eps_estimate") if earn.get("eps_estimate") is not None else (extra_info.get("eps_estimate") if extra_info else None),
            "eps_surprise_pct": earn.get("eps_surprise_pct") if earn.get("eps_surprise_pct") is not None else (extra_info.get("eps_surprise_pct") if extra_info else None),
            "revenue_actual": check_dict["revenue_actual"],
            "revenue_estimate": earn.get("revenue_estimate") if earn.get("revenue_estimate") is not None else (extra_info.get("revenue_estimate") if extra_info else None)
        }

    # B. Dividends Markers ('D')
    seen_dividend_dates = set()
    div_list = fmp_client.get_dividends_history(ticker, limit=30)
    if not div_list:
        div_list = polygon_client.fetch_dividends(ticker)
    for div in div_list:
        raw_date = div.get("ex_date") or div.get("date")
        if not raw_date:
            continue
        c_date = find_nearest_candle_date(raw_date)
        if not c_date or c_date in seen_dividend_dates:
            continue
        seen_dividend_dates.add(c_date)
        m_id = f"d_{c_date}"
        markers.append({
            "time": c_date,
            "position": "belowBar",
            "color": "#d97706",
            "shape": "circle",
            "text": "D",
            "id": m_id
        })
        marker_details[m_id] = {
            "type": "Dividend",
            "ex_date": c_date,
            "amount": div.get("amount") or div.get("dividend"),
            "pay_date": div.get("pay_date") or div.get("paymentDate"),
            "yield": div.get("yield"),
            "frequency": div.get("frequency", "Quarterly")
        }

    return {
        "ticker": ticker,
        "candles": candles,
        "markers": markers,
        "marker_details": marker_details
    }


@app.get("/api/ticker/{ticker}/chart/intraday")
async def api_intraday_chart(
    ticker: str,
    date: Optional[str] = None,
    multiplier: int = Query(1, ge=1, le=60),
    days_back: int = Query(30, ge=1, le=90)
):
    """
    Returns continuous multi-day 1m (or custom multiplier) intraday candlestick series around the requested date,
    allowing full scrolling to yesterday, day before, today, and future days.
    """
    ticker = ticker.strip().upper()
    today_dt = datetime.date.today()
    if date:
        try:
            req_dt = datetime.date.fromisoformat(date)
        except Exception:
            req_dt = today_dt
    else:
        req_dt = today_dt

    # 30 days window around requested date so user can freely scroll backwards & forwards
    start_date = (req_dt - datetime.timedelta(days=days_back)).isoformat()
    end_date = min(today_dt, req_dt + datetime.timedelta(days=10)).isoformat()

    # 1. Try DB
    df = get_intraday_chart_data(ticker, start_date=start_date, end_date=end_date)
    candles = []

    if not df.empty:
        # Sort chronologically by date and time
        df = df.sort_values(["date", "time"])
        if multiplier > 1:
            try:
                df["_dt"] = pd.to_datetime(df["datetime_et"])
                df = df.set_index("_dt")
                agg_dict = {
                    "open": "first",
                    "high": "max",
                    "low": "min",
                    "close": "last",
                    "volume": "sum",
                    "session_type": "first",
                    "date": "first",
                    "ticker": "first"
                }
                resampled = df.resample(f"{multiplier}min").agg(agg_dict).dropna(subset=["close"]).reset_index()
                resampled["time_str"] = resampled["_dt"].dt.strftime("%H:%M")
                resampled["time"] = resampled["_dt"].dt.strftime("%H:%M:%S")
                resampled["datetime_et"] = resampled["_dt"]
                df = resampled
            except Exception as ex:
                print(f"[Intraday] Resample error for {ticker}: {ex}")
                if "_dt" in df.columns:
                    df = df.reset_index(drop=True)

        df["dt_str"] = df["date"].astype(str) + " " + df["time"].astype(str)
        try:
            dt_series = pd.to_datetime(df["datetime_et"])
            unit = getattr(dt_series.dtype, "unit", "us")
            divisor = 10**9 if unit == "ns" else (10**6 if unit == "us" else (10**3 if unit == "ms" else 1))
            ts_series = (dt_series.astype("int64") // divisor).astype(int)
        except Exception:
            dt_series = pd.to_datetime(df["dt_str"])
            unit = getattr(dt_series.dtype, "unit", "us")
            divisor = 10**9 if unit == "ns" else (10**6 if unit == "us" else (10**3 if unit == "ms" else 1))
            ts_series = (dt_series.astype("int64") // divisor).astype(int)
        df["timestamp"] = ts_series
        df["open"] = df["open"].astype(float)
        df["high"] = df["high"].astype(float)
        df["low"] = df["low"].astype(float)
        df["close"] = df["close"].astype(float)
        df["volume"] = df["volume"].astype(float)
        df["date"] = df["date"].astype(str)
        if "session_type" not in df.columns:
            df["session_type"] = "regular"

        candles = df[[
            "dt_str", "timestamp", "date", "time_str",
            "open", "high", "low", "close", "volume", "session_type"
        ]].rename(columns={"dt_str": "time"}).to_dict("records")
    else:
        # Fallback to Polygon
        poly_bars = polygon_client.fetch_intraday_bars(
            ticker,
            start_date=start_date,
            end_date=end_date,
            multiplier=multiplier,
            timespan="minute"
        )
        for b in poly_bars:
            candles.append({
                "time": b["datetime_et"],
                "timestamp": b.get("timestamp"),
                "date": b.get("date"),
                "time_str": b["time_str"],
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b["volume"],
                "session_type": b["session_type"]
            })

    return {
        "ticker": ticker,
        "date": req_dt.isoformat(),
        "start_date": start_date,
        "end_date": end_date,
        "multiplier": multiplier,
        "candles": candles,
        "count": len(candles)
    }


# ============================================================
# EARNINGS REACTION MATRIX (8 QUARTERS)
# ============================================================

@app.get("/api/ticker/{ticker}/earnings-moves")
async def api_earnings_moves(
    ticker: str,
    window: str = Query("04:00_09:30", pattern="^(04:00_07:00|04:00_09:00|04:00_09:30)$"),
    limit: int = Query(8, ge=1, le=16)
):
    """
    Returns the 8-quarter Earnings Reaction Matrix with 1-D postmarket %, 0-D premarket % (interval filtered), and intraday metrics.
    """
    ticker = ticker.strip().upper()
    matrix = earnings_reaction_client.get_earnings_reaction_matrix(
        ticker=ticker,
        limit=limit,
        premarket_window=window
    )
    return {
        "ticker": ticker,
        "premarket_window": window,
        "reports_count": len(matrix),
        "matrix": matrix
    }


# ============================================================
# EARNINGS REACTION MATRIX EXPORT & CORRELATIONS
# ============================================================

METRIC_LABELS = {
    "close_to_close": "Весь день (Close-to-Close %)",
    "premarket": "Премаркет %",
    "intraday": "Интрадей (Open → Close %)",
    "postmarket": "Постмаркет %"
}

@app.get("/api/ticker/{ticker}/earnings-moves/export")
async def export_earnings_moves(
    ticker: str,
    r_minus_1_metric: str = Query("close_to_close"),
    r_0_metric: str = Query("close_to_close"),
    r_plus_1_metric: str = Query("close_to_close"),
    r_plus_2_metric: str = Query("close_to_close")
):
    """
    Exports the 8-quarter Earnings Reaction Matrix to a styled Excel spreadsheet with selected metrics.
    """
    ticker = ticker.strip().upper()
    matrix = earnings_reaction_client.get_earnings_reaction_matrix(ticker=ticker, limit=8)
    if not matrix:
        raise HTTPException(status_code=400, detail="Нет данных по отчетам для экспорта.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{ticker} Earnings Matrix"

    # Title row
    ws.merge_cells("A1:L1")
    title_cell = ws["A1"]
    title_cell.value = f"CHEPUH / FinWhale • Матрица движений на отчетности: {ticker} (Последние 8 кварталов)"
    title_cell.font = Font(name="Calibri", size=13, bold=True, color="1E293B")
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 28

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border_thin = Side(border_style="thin", color="CBD5E1")
    cell_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    pos_fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
    pos_font = Font(name="Calibri", size=10, color="1B5E20", bold=True)
    neg_fill = PatternFill(start_color="FFEBEE", end_color="FFEBEE", fill_type="solid")
    neg_font = Font(name="Calibri", size=10, color="B71C1C", bold=True)

    col_metrics = {
        "R-1": r_minus_1_metric,
        "R": r_0_metric,
        "R+1": r_plus_1_metric,
        "R+2": r_plus_2_metric
    }

    headers = [
        "Квартал",
        "Дата отчета",
        "Сессия",
        "EPS Факт ($)",
        "EPS Ожид. ($)",
        "Сюрприз EPS (%)",
        "Выручка Факт",
        "Выручка Ожид.",
        f"R-1 ({METRIC_LABELS.get(r_minus_1_metric, r_minus_1_metric)})",
        f"R ({METRIC_LABELS.get(r_0_metric, r_0_metric)})",
        f"R+1 ({METRIC_LABELS.get(r_plus_1_metric, r_plus_1_metric)})",
        f"R+2 ({METRIC_LABELS.get(r_plus_2_metric, r_plus_2_metric)})"
    ]

    ws.append(headers)
    ws.row_dimensions[2].height = 26

    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=2, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment
        cell.border = cell_border

    # Day metric values collector for summary stats
    day_values = {"R-1": [], "R": [], "R+1": [], "R+2": []}

    for row_idx, r in enumerate(matrix, start=3):
        days_dict = r.get("days", {})
        row_cells = [
            r.get("quarter", "—"),
            r.get("date", "—"),
            r.get("session", "—"),
            r.get("eps_actual"),
            r.get("eps_estimate"),
            (f"{r.get('eps_surprise_pct'):+.2f}%" if r.get("eps_surprise_pct") is not None else "—"),
            r.get("revenue_actual"),
            r.get("revenue_estimate")
        ]

        for d_key in ["R-1", "R", "R+1", "R+2"]:
            m_name = col_metrics[d_key]
            d_info = days_dict.get(d_key, {})
            val = d_info.get(m_name)
            if val is not None and isinstance(val, (int, float)):
                day_values[d_key].append(float(val))
                row_cells.append(f"{val:+.2f}%")
            else:
                row_cells.append("—")

        ws.append(row_cells)
        ws.row_dimensions[row_idx].height = 20

        # Style data row
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.border = cell_border
            cell.alignment = Alignment(horizontal="center", vertical="center")
            if col_idx in [9, 10, 11, 12]:
                val_str = str(cell.value or "")
                if val_str.startswith("+"):
                    cell.fill = pos_fill
                    cell.font = pos_font
                elif val_str.startswith("-"):
                    cell.fill = neg_fill
                    cell.font = neg_font

    # Summary Statistics rows (Mean, Median, Max, Min, Win Rate)
    def calc_stats(vals):
        if not vals:
            return "—", "—", "—", "—", "—"
        mean_v = np.mean(vals)
        med_v = np.median(vals)
        max_v = np.max(vals)
        min_v = np.min(vals)
        win_rate = (sum(1 for v in vals if v > 0) / len(vals)) * 100
        return f"{mean_v:+.2f}%", f"{med_v:+.2f}%", f"{max_v:+.2f}%", f"{min_v:+.2f}%", f"{win_rate:.1f}%"

    stat_rows = [
        ("Среднее (Mean)", 0),
        ("Медиана (Median)", 1),
        ("Максимум (Max)", 2),
        ("Минимум (Min)", 3),
        ("% Положительных (Win Rate)", 4)
    ]

    stat_start = len(matrix) + 4
    for s_idx, (stat_name, stat_pos) in enumerate(stat_rows, start=stat_start):
        s_row = [stat_name, "", "", "", "", "", "", ""]
        for d_key in ["R-1", "R", "R+1", "R+2"]:
            stats_tuple = calc_stats(day_values[d_key])
            s_row.append(stats_tuple[stat_pos])
        ws.append(s_row)
        ws.merge_cells(start_row=s_idx, start_column=1, end_row=s_idx, end_column=8)
        c_label = ws.cell(row=s_idx, column=1)
        c_label.font = Font(name="Calibri", size=9.5, bold=True, color="475569")
        c_label.alignment = Alignment(horizontal="right", vertical="center")
        c_label.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
        for c_i in range(1, 13):
            ws.cell(row=s_idx, column=c_i).border = cell_border
            if c_i >= 9:
                ws.cell(row=s_idx, column=c_i).alignment = Alignment(horizontal="center", vertical="center")
                ws.cell(row=s_idx, column=c_i).font = Font(name="Calibri", size=9.5, bold=True)

    # Column dimensions
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 13)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    filename = f"{ticker}_Earnings_Moves_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ============================================================
# QUANT CORRELATIONS & BETA MATRIX
# ============================================================

@app.get("/api/ticker/{ticker}/correlations")
async def api_correlations(
    ticker: str,
    period: str = Query("1y", pattern="^(2w|1m|3m|6m|ytd|1y|earnings_8q)$"),
    peers: Optional[str] = None,
    benchmarks: Optional[str] = None
):
    """
    Calculates Pearson correlation and Beta coefficients against SPY, QQQ, SOXX, IGV, DRAM, and stock peers.
    Supports period="earnings_8q" for calculations restricted to earnings dates.
    """
    ticker = ticker.strip().upper()
    peer_list = [p.strip().upper() for p in peers.split(",") if p.strip()] if peers is not None else None
    bm_list = [b.strip().upper() for b in benchmarks.split(",") if b.strip()] if benchmarks is not None else None
    result = quant_client.calculate_ticker_correlations(
        ticker=ticker,
        period=period,
        peers=peer_list,
        benchmarks=bm_list
    )
    return result


@app.post("/api/ticker/{ticker}/correlations/export")
async def export_correlations_matrix(ticker: str, request: Request):
    """
    Exports the Correlation and Beta Matrix table to a styled Excel spreadsheet (.xlsx).
    """
    ticker = ticker.strip().upper()
    data = await request.json() or {}
    rows = data.get("rows", [])
    period = str(data.get("period", "1y"))
    target_move = data.get("target_move", 2.0)

    if not rows:
        raise HTTPException(status_code=400, detail="Нет данных для экспорта.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{ticker} Correlations"

    # Title row
    ws.merge_cells("A1:K1")
    title_cell = ws["A1"]
    title_cell.value = f"CHEPUH / FinWhale • Матрица корреляций и коэффициентов Beta: {ticker} (Горизонт: {period})"
    title_cell.font = Font(name="Calibri", size=12, bold=True, color="1E293B")
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 26

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border_thin = Side(border_style="thin", color="CBD5E1")
    cell_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    pos_fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
    pos_font = Font(name="Calibri", size=10, color="1B5E20", bold=True)
    neg_fill = PatternFill(start_color="FFEBEE", end_color="FFEBEE", fill_type="solid")
    neg_font = Font(name="Calibri", size=10, color="B71C1C", bold=True)
    regular_font = Font(name="Calibri", size=10, color="000000")
    bold_font = Font(name="Calibri", size=10, bold=True, color="000000")

    headers = [
        "Тикер",
        "Тип",
        "Корреляция",
        "Beta",
        "Ход аналога (Move %)",
        f"Где должен стоять {ticker} (%)",
        f"Ход {ticker} (%)",
        "Разница (Diff %)",
        "Normalized (σ)",
        "Наблюдений (дн.)",
        "Статус истории"
    ]

    ws.append(headers)
    ws.row_dimensions[2].height = 24

    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=2, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = header_alignment
        c.border = cell_border

    # Beta fills matching Photo 1 palette
    beta_neg_fill = PatternFill(start_color="FECACA", end_color="FECACA", fill_type="solid")
    beta_neg_font = Font(name="Calibri", size=10, color="991B1B", bold=True)
    beta_low_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    beta_low_font = Font(name="Calibri", size=10, color="78350F", bold=False)
    beta_neutral_fill = PatternFill(start_color="BFDBFE", end_color="BFDBFE", fill_type="solid")
    beta_neutral_font = Font(name="Calibri", size=10, color="1E3A8A", bold=True)
    beta_high_fill = PatternFill(start_color="BBF7D0", end_color="BBF7D0", fill_type="solid")
    beta_high_font = Font(name="Calibri", size=10, color="14532D", bold=True)

    # Correlation fills matching light-to-grey gradient
    corr_high_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    corr_high_font = Font(name="Calibri", size=10, color="166534", bold=True)
    corr_med_fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
    corr_med_font = Font(name="Calibri", size=10, color="2E7D32")
    corr_slate_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    corr_slate_font = Font(name="Calibri", size=10, color="475569")
    corr_grey_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
    corr_grey_font = Font(name="Calibri", size=10, color="64748B")

    current_row = 3
    for r in rows:
        sym = str(r.get("symbol", "")).strip().upper()
        t_type = str(r.get("type", "Peer"))
        corr = r.get("correlation")
        beta = r.get("beta")
        peer_move = r.get("_peerMove", r.get("peer_move", 1.0))
        exp_move = r.get("_expMove", r.get("expected_move"))
        t_move = r.get("_targetMove", r.get("target_move", target_move))
        diff = r.get("_diff", r.get("diff"))
        norm_diff = r.get("_normDiff", r.get("normalized"))
        obs = r.get("observations")
        is_partial = bool(r.get("is_partial", False))
        part_reason = r.get("partial_reason") or ("Меньше горизонта" if is_partial else "Полная история")

        ws.append([
            sym,
            t_type,
            round(float(corr), 4) if (corr is not None and not (isinstance(corr, float) and np.isnan(corr))) else None,
            round(float(beta), 4) if (beta is not None and not (isinstance(beta, float) and np.isnan(beta))) else None,
            round(float(peer_move), 2) if (peer_move is not None and not (isinstance(peer_move, float) and np.isnan(peer_move))) else None,
            round(float(exp_move), 2) if (exp_move is not None and not (isinstance(exp_move, float) and np.isnan(exp_move))) else None,
            round(float(t_move), 2) if (t_move is not None and not (isinstance(t_move, float) and np.isnan(t_move))) else None,
            round(float(diff), 2) if (diff is not None and not (isinstance(diff, float) and np.isnan(diff))) else None,
            round(float(norm_diff), 2) if (norm_diff is not None and not (isinstance(norm_diff, float) and np.isnan(norm_diff))) else None,
            int(obs) if (obs is not None and not (isinstance(obs, float) and np.isnan(obs))) else None,
            part_reason
        ])

        ws.row_dimensions[current_row].height = 20

        # Style cells
        for c_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=current_row, column=c_idx)
            cell.border = cell_border
            cell.font = regular_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        # Symbol bold
        ws.cell(row=current_row, column=1).font = bold_font

        # Correlation formatting with gradient-fill (higher = lighter, lower = grey)
        c_cell = ws.cell(row=current_row, column=3)
        if corr is not None and not (isinstance(corr, float) and np.isnan(corr)):
            c_val = float(corr)
            c_cell.number_format = "+0.000;-0.000;0.000"
            if c_val >= 0.70:
                c_cell.fill = corr_high_fill
                c_cell.font = corr_high_font
            elif c_val >= 0.40:
                c_cell.fill = corr_med_fill
                c_cell.font = corr_med_font
            elif c_val >= 0.10:
                c_cell.fill = corr_slate_fill
                c_cell.font = corr_slate_font
            elif c_val >= -0.10:
                c_cell.fill = corr_grey_fill
                c_cell.font = corr_grey_font
            else:
                c_cell.fill = neg_fill
                c_cell.font = neg_font

        # Beta formatting with conditional fill matching Photo 1
        b_cell = ws.cell(row=current_row, column=4)
        if beta is not None and not (isinstance(beta, float) and np.isnan(beta)):
            b_val = float(beta)
            b_cell.number_format = "0.000"
            if b_val < 0:
                b_cell.fill = beta_neg_fill
                b_cell.font = beta_neg_font
            elif b_val < 0.85:
                b_cell.fill = beta_low_fill
                b_cell.font = beta_low_font
            elif b_val <= 1.15:
                b_cell.fill = beta_neutral_fill
                b_cell.font = beta_neutral_font
            else:
                b_cell.fill = beta_high_fill
                b_cell.font = beta_high_font

        # Diff formatting with fill
        d_cell = ws.cell(row=current_row, column=8)
        if diff is not None and not (isinstance(diff, float) and np.isnan(diff)):
            d_val = float(diff)
            d_cell.number_format = "+0.00;-0.00;0.00"
            if d_val > 0.001:
                d_cell.fill = pos_fill
                d_cell.font = pos_font
            elif d_val < -0.001:
                d_cell.fill = neg_fill
                d_cell.font = neg_font

        # Partial row warning in Excel
        if is_partial:
            part_cell = ws.cell(row=current_row, column=11)
            part_cell.font = Font(name="Calibri", size=9, color="B45309", bold=True)
            part_cell.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

        current_row += 1

    # Auto column width
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            val_str = str(cell.value or "")
            if cell.row == 1:
                continue
            max_len = max(max_len, len(val_str))
        ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    filename = f"{ticker}_correlation_matrix_{period}.xlsx"
    headers_resp = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers_resp
    )


@app.post("/api/matrix/export")
async def export_general_matrix(request: Request):
    """
    Exports Matrix Correlation Pearson or Matrix Beta (formul Slope) to styled Excel (.xlsx).
    """
    data = await request.json() or {}
    m_type = str(data.get("type", "correlation")).lower()
    title = str(data.get("title", "Matrix Export"))
    period = str(data.get("period", "1y"))
    symbols = data.get("symbols", [])
    matrix = data.get("matrix", {})

    if not symbols:
        raise HTTPException(status_code=400, detail="Нет данных для экспорта.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Beta Matrix" if m_type == "beta" else "Correlation Matrix"

    # Title row
    last_col_letter = get_column_letter(len(symbols) + 1)
    ws.merge_cells(f"A1:{last_col_letter}1")
    title_cell = ws["A1"]
    title_cell.value = f"CHEPUH / FinWhale • {title} (Горизонт: {period})"
    title_cell.font = Font(name="Calibri", size=12, bold=True, color="1E293B")
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 26

    # Headers
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    header_alignment = Alignment(horizontal="center", vertical="center")
    border_thin = Side(border_style="thin", color="CBD5E1")
    cell_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    headers = ["Тикер"] + [str(s).upper() for s in symbols]
    ws.append(headers)
    ws.row_dimensions[2].height = 24

    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=2, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = header_alignment
        c.border = cell_border

    # Palette definitions
    # Beta palette (matching user photo)
    beta_neg_fill = PatternFill(start_color="FECACA", end_color="FECACA", fill_type="solid")
    beta_neg_font = Font(name="Calibri", size=10, color="991B1B", bold=True)
    beta_low_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    beta_low_font = Font(name="Calibri", size=10, color="78350F", bold=False)
    beta_neutral_fill = PatternFill(start_color="BFDBFE", end_color="BFDBFE", fill_type="solid")
    beta_neutral_font = Font(name="Calibri", size=10, color="1E3A8A", bold=True)
    beta_high_fill = PatternFill(start_color="BBF7D0", end_color="BBF7D0", fill_type="solid")
    beta_high_font = Font(name="Calibri", size=10, color="14532D", bold=True)

    # Correlation palette (lighter for high, grey for low)
    corr_high_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    corr_high_font = Font(name="Calibri", size=10, color="166534", bold=True)
    corr_med_fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
    corr_med_font = Font(name="Calibri", size=10, color="2E7D32")
    corr_slate_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    corr_slate_font = Font(name="Calibri", size=10, color="475569")
    corr_grey_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
    corr_grey_font = Font(name="Calibri", size=10, color="64748B")
    corr_neg_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    corr_neg_font = Font(name="Calibri", size=10, color="991B1B", bold=True)

    regular_font = Font(name="Calibri", size=10, color="000000")
    ticker_font = Font(name="Calibri", size=10, bold=True, color="1E293B")

    current_row = 3
    for row_sym in symbols:
        row_vals = [row_sym]
        for col_sym in symbols:
            if row_sym == col_sym:
                diag_val = matrix.get(row_sym, {}).get(col_sym) if matrix else 1.0
                if diag_val is not None and not (isinstance(diag_val, float) and np.isnan(diag_val)):
                    row_vals.append(round(float(diag_val), 3))
                elif not matrix:
                    row_vals.append(1.0)
                else:
                    row_vals.append(None)
            else:
                v = matrix.get(row_sym, {}).get(col_sym)
                if v is not None and not (isinstance(v, float) and np.isnan(v)):
                    row_vals.append(round(float(v), 3))
                else:
                    row_vals.append(None)
        ws.append(row_vals)
        ws.row_dimensions[current_row].height = 20

        # Style row
        for c_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=current_row, column=c_idx)
            cell.border = cell_border
            cell.alignment = Alignment(horizontal="center", vertical="center")

            if c_idx == 1:
                cell.font = ticker_font
                continue

            val = cell.value
            if val is None:
                cell.font = Font(name="Calibri", size=10, color="94A3B8")
                cell.value = "—"
                continue

            cell.number_format = "0.000" if m_type == "beta" else "+0.000;-0.000;0.000"

            if row_sym == symbols[c_idx - 2]:
                if m_type == "beta":
                    cell.fill = beta_neutral_fill
                    cell.font = beta_neutral_font
                else:
                    cell.fill = corr_high_fill
                    cell.font = corr_high_font
                continue

            num = float(val)
            if m_type == "beta":
                if num < 0:
                    cell.fill = beta_neg_fill
                    cell.font = beta_neg_font
                elif num < 0.85:
                    cell.fill = beta_low_fill
                    cell.font = beta_low_font
                elif num <= 1.15:
                    cell.fill = beta_neutral_fill
                    cell.font = beta_neutral_font
                else:
                    cell.fill = beta_high_fill
                    cell.font = beta_high_font
            else:
                if num >= 0.70:
                    cell.fill = corr_high_fill
                    cell.font = corr_high_font
                elif num >= 0.40:
                    cell.fill = corr_med_fill
                    cell.font = corr_med_font
                elif num >= 0.10:
                    cell.fill = corr_slate_fill
                    cell.font = corr_slate_font
                elif num >= -0.10:
                    cell.fill = corr_grey_fill
                    cell.font = corr_grey_font
                else:
                    cell.fill = corr_neg_fill
                    cell.font = corr_neg_font

        current_row += 1

    # Widths
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.row == 1:
                continue
            max_len = max(max_len, len(str(cell.value or "")))
        ws.column_dimensions[col_letter].width = max(max_len + 4, 11)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    clean_title = re.sub(r'[^a-zA-Z0-9_-]', '_', title).strip('_')
    filename = f"{clean_title}_{period}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ============================================================
# DIVIDENDS HISTORY
# ============================================================

@app.get("/api/ticker/{ticker}/dividends")
async def api_dividends(ticker: str):
    ticker = ticker.strip().upper()
    db_divs = get_ticker_dividends_db(ticker)
    if not db_divs:
        # 1. Try FMP
        fmp_divs = fmp_client.get_dividends_history(ticker, limit=24)
        if not fmp_divs:
            # 2. Try Polygon fallback
            fmp_divs = polygon_client.fetch_dividends(ticker, limit=24)
        if fmp_divs:
            save_ticker_dividends_db(ticker, fmp_divs)
            db_divs = fmp_divs

    return {
        "ticker": ticker,
        "count": len(db_divs),
        "dividends": db_divs
    }


# ============================================================
# ON-DEMAND SYNC
# ============================================================

@app.post("/api/ticker/{ticker}/sync")
async def api_sync_ticker(ticker: str):
    ticker = ticker.strip().upper()
    # 1. Sync Profile & Peers
    prof = fmp_client.get_company_profile(ticker)
    peers = fmp_client.get_stock_peers(ticker)
    prof["peers"] = [p["symbol"] for p in peers if p.get("symbol")]
    save_company_profile_db(ticker, prof)

    # 2. Sync Dividends
    divs = fmp_client.get_dividends_history(ticker, limit=24)
    if divs:
        save_ticker_dividends_db(ticker, divs)

    # 3. Fetch latest Daily bars
    daily_bars = polygon_client.fetch_daily_bars(ticker, start_date="2023-01-01")

    return {
        "ticker": ticker,
        "synced": True,
        "daily_bars": len(daily_bars),
        "dividends": len(divs),
        "peers": prof["peers"]
    }


# ============================================================
# DATALENS ENDPOINTS
# ============================================================

@app.get("/api/datalens/data")
async def api_datalens_data(
    tickers: str = Query("SPY,QQQ,MU"),
    period: str = Query("1y"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    """
    Returns daily percentage changes (cls2cls, intra, gap) and event markers
    (Earnings, Ex-Div, Pay Date) for the requested tickers over the chosen period.
    """
    try:
        if not isinstance(start_date, str):
            start_date = None
        if not isinstance(end_date, str):
            end_date = None
        if not isinstance(tickers, str):
            tickers = "SPY,QQQ,MU"
        if not isinstance(period, str):
            period = "1y"

        raw_list = [t.strip().upper() for t in re.split(r"[\s,;]+", tickers) if t.strip()]
        clean_tickers = list(dict.fromkeys(raw_list))
        if not clean_tickers:
            clean_tickers = ["SPY", "QQQ", "MU"]

        df = get_stock_data(*clean_tickers)
        if df is None or df.empty:
            return {
                "status": "ok",
                "as_of": datetime.date.today().isoformat(),
                "tickers": clean_tickers,
                "dates": [],
                "data": {}
            }

        df["date_str"] = df["date"].dt.strftime("%Y-%m-%d")

        # Calculate Intra% = (close - open) / open * 100
        df["intra"] = np.where(df["open"] > 0, (df["close"] - df["open"]) / df["open"] * 100.0, 0.0)

        # Date filtering
        all_dates = sorted(df["date_str"].unique())
        if not all_dates:
            return {"status": "ok", "as_of": "", "tickers": clean_tickers, "dates": [], "data": {}}

        latest_date_str = all_dates[-1]
        latest_date = pd.to_datetime(latest_date_str)

        if start_date and end_date:
            df = df[(df["date_str"] >= start_date) & (df["date_str"] <= end_date)]
        elif start_date:
            df = df[df["date_str"] >= start_date]
        else:
            p = period.lower().strip()
            if p == "1w":
                cutoff = latest_date - pd.Timedelta(days=7)
            elif p == "1m":
                cutoff = latest_date - pd.Timedelta(days=30)
            elif p == "3m":
                cutoff = latest_date - pd.Timedelta(days=91)
            elif p == "6m":
                cutoff = latest_date - pd.Timedelta(days=182)
            elif p == "ytd":
                cutoff = pd.Timestamp(year=latest_date.year, month=1, day=1)
            elif p == "1y":
                cutoff = latest_date - pd.Timedelta(days=365)
            elif p == "2y":
                cutoff = latest_date - pd.Timedelta(days=730)
            elif p == "5y":
                cutoff = latest_date - pd.Timedelta(days=1825)
            elif p == "max":
                cutoff = None
            else:
                cutoff = latest_date - pd.Timedelta(days=365)

            if cutoff is not None:
                cutoff_str = cutoff.strftime("%Y-%m-%d")
                df = df[df["date_str"] >= cutoff_str]

        # Build ticker trading dates mapping (unsliced for boundary lookups)
        ticker_trading_dates = {}
        for sym in clean_tickers:
            sym_df = df[df["ticker"] == sym]
            if not sym_df.empty:
                ticker_trading_dates[sym] = sorted(sym_df["date_str"].unique())

        # Fetch earnings events with R-1, R, R+1, R+2 offsets
        earnings_offsets_map = {}
        earnings_r_set = set()
        try:
            conn = get_postgres_connection()
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT UPPER(t.ticker), r.date::text, r.move_date::text, r.time::text
                    FROM reports r
                    JOIN ticker t ON t.id = r.id_ticker
                    WHERE UPPER(t.ticker) = ANY(%s)
                    ORDER BY r.date ASC;
                """, (clean_tickers,))
                for row in cur.fetchall():
                    sym, r_d, m_d, r_time = row
                    dates = ticker_trading_dates.get(sym, [])
                    if not dates:
                        continue

                    R = m_d or r_d
                    time_str = str(r_time or "").lower()
                    is_amc = any(x in time_str for x in ["16:", "17:", "18:", "19:", "20:", "pm", "amc", "after"])

                    if R in dates:
                        r_idx = dates.index(R)
                        earnings_offsets_map.setdefault((sym, dates[r_idx]), set()).add("R")
                        earnings_r_set.add((sym, dates[r_idx]))
                        if r_idx > 0:
                            earnings_offsets_map.setdefault((sym, dates[r_idx - 1]), set()).add("R-1")
                        if r_idx + 1 < len(dates):
                            earnings_offsets_map.setdefault((sym, dates[r_idx + 1]), set()).add("R+1")
                        if r_idx + 2 < len(dates):
                            earnings_offsets_map.setdefault((sym, dates[r_idx + 2]), set()).add("R+2")
                    elif r_d in dates:
                        r_d_idx = dates.index(r_d)
                        if is_amc:
                            earnings_offsets_map.setdefault((sym, dates[r_d_idx]), set()).add("R-1")
                            if r_d_idx + 1 < len(dates):
                                earnings_offsets_map.setdefault((sym, dates[r_d_idx + 1]), set()).add("R")
                                earnings_r_set.add((sym, dates[r_d_idx + 1]))
                        else:
                            earnings_offsets_map.setdefault((sym, dates[r_d_idx]), set()).add("R")
                            earnings_r_set.add((sym, dates[r_d_idx]))
                            if r_d_idx > 0:
                                earnings_offsets_map.setdefault((sym, dates[r_d_idx - 1]), set()).add("R-1")
                            if r_d_idx + 1 < len(dates):
                                earnings_offsets_map.setdefault((sym, dates[r_d_idx + 1]), set()).add("R+1")
                            if r_d_idx + 2 < len(dates):
                                earnings_offsets_map.setdefault((sym, dates[r_d_idx + 2]), set()).add("R+2")
        except Exception as e:
            print("[DataLens] Earnings fetch error:", e)

        # Fetch dividend events (ex-date, pay-date)
        ex_div_set = set()
        pay_date_set = set()
        try:
            import sqlite3
            from config import CACHE_DB_PATH
            if os.path.exists(CACHE_DB_PATH):
                with sqlite3.connect(CACHE_DB_PATH) as s_conn:
                    s_cur = s_conn.cursor()
                    q_marks = ",".join(["?"] * len(clean_tickers))
                    s_cur.execute(f"SELECT UPPER(ticker), ex_date, pay_date FROM dividends WHERE UPPER(ticker) IN ({q_marks})", clean_tickers)
                    for row in s_cur.fetchall():
                        t_sym, ex_d, pay_d = row
                        if ex_d: ex_div_set.add((t_sym, ex_d))
                        if pay_d: pay_date_set.add((t_sym, pay_d))
        except Exception as e:
            print("[DataLens] Dividends fetch error:", e)

        # Build data dictionary by date
        data_by_date = {}
        for _, r in df.iterrows():
            d_str = r["date_str"]
            sym = r["ticker"]
            if d_str not in data_by_date:
                data_by_date[d_str] = {}

            cls2cls_val = round(float(r["cls2cls"]), 2) if pd.notnull(r["cls2cls"]) else None
            intra_val = round(float(r["intra"]), 2) if pd.notnull(r["intra"]) else None
            gap_val = round(float(r["gap"]), 2) if pd.notnull(r["gap"]) else None
            close_val = round(float(r["close"]), 2) if pd.notnull(r["close"]) else None
            prev_close_val = round(float(r["prev_close"]), 2) if pd.notnull(r["prev_close"]) else None

            data_by_date[d_str][sym] = {
                "close": close_val,
                "prev_close": prev_close_val,
                "cls2cls": cls2cls_val,
                "intra": intra_val,
                "gap": gap_val,
                "is_earnings": (sym, d_str) in earnings_r_set,
                "earnings_offsets": sorted(list(earnings_offsets_map.get((sym, d_str), set()))),
                "is_ex_div": (sym, d_str) in ex_div_set,
                "is_pay_date": (sym, d_str) in pay_date_set
            }

        dates_sorted = sorted(list(data_by_date.keys()), reverse=True)

        return {
            "status": "ok",
            "as_of": latest_date_str,
            "tickers": clean_tickers,
            "dates": dates_sorted,
            "data": data_by_date
        }
    except Exception as e:
        print("[DataLens] api_datalens_data error:", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/datalens/filter/hold-move")
async def api_datalens_hold_move_filter(
    ticker: str = Query("MU"),
    period: str = Query("1y"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    threshold_pct: float = Query(1.0, ge=0.01, le=50.0),
    min_hold_pct: float = Query(0.90, ge=0.0, le=50.0),
    direction: str = Query("both"),
    window: str = Query("any"),
    hold_until: str = Query("09:30")
):
    """
    Calculates and returns trading dates where the specified ticker achieved at least
    `threshold_pct` move from prev_close during `window`, and held at least `min_hold_pct`
    until `hold_until` (09:30 OPG or 16:30).
    """
    try:
        matching_dates = calculate_hold_move_dates(
            ticker=ticker,
            period=period,
            start_date=start_date,
            end_date=end_date,
            threshold_pct=threshold_pct,
            min_hold_pct=min_hold_pct,
            direction=direction,
            window=window,
            hold_until=hold_until
        )
        return {
            "status": "ok",
            "ticker": ticker.upper().strip(),
            "matching_dates": matching_dates,
            "count": len(matching_dates),
            "params": {
                "period": period,
                "start_date": start_date,
                "end_date": end_date,
                "threshold_pct": threshold_pct,
                "min_hold_pct": min_hold_pct,
                "direction": direction,
                "window": window,
                "hold_until": hold_until
            }
        }
    except Exception as e:
        print(f"[DataLens] api_datalens_hold_move_filter error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# ============================================================
# CORRELATION & BETA CALCULATOR ENDPOINTS
# ============================================================

def clean_value(value):
    if value is None:
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        if np.isnan(value) or not np.isfinite(value):
            return None
        return float(value)
    return value


def clean_dict(data):
    if isinstance(data, dict):
        return {str(k): clean_dict(v) for k, v in data.items()}
    if isinstance(data, list):
        return [clean_dict(v) for v in data]
    return clean_value(data)


@app.post("/api/calculate")
async def api_calculate_single(request: Request):
    try:
        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail="Пустой запрос.")

        stock = str(data.get("stock", "")).strip().upper()
        benchmark = str(data.get("benchmark", "")).strip().upper()
        benchmark_move = float(data.get("benchmark_move", 0.01))
        asset_move = data.get("asset_move")
        if asset_move is not None:
            asset_move = float(asset_move)

        if not stock or not benchmark:
            raise HTTPException(status_code=400, detail="Не указан тикер или benchmark.")
        if stock == benchmark:
            raise HTTPException(status_code=400, detail="Акции должны быть разными.")

        df = get_stock_data(stock, benchmark)
        if df is None or df.empty:
            raise HTTPException(status_code=404, detail="Данные не найдены.")

        results, _ = calculate_all_periods(
            df,
            stock,
            benchmark,
            benchmark_move=benchmark_move,
            asset_move=asset_move
        )

        return {
            "stock": stock,
            "benchmark": benchmark,
            "benchmark_move": benchmark_move,
            "asset_move": asset_move,
            "results": clean_dict(results),
            "chart": []
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calculate-groups")
@app.post("/api/calculate_groups")
async def api_calculate_groups(request: Request):
    try:
        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail="Пустой запрос.")

        groups = data.get("groups")
        benchmark_raw = data.get("benchmarks") or data.get("benchmark") or data.get("reference")
        period = data.get("period") or "1y"
        benchmark_move = float(data.get("benchmark_move", 0.01))
        benchmark_moves = data.get("benchmark_moves", {})
        asset_moves = data.get("asset_moves", {})

        if not groups or not isinstance(groups, dict):
            raise HTTPException(status_code=400, detail="Добавьте хотя бы одну группу с тикерами.")
        if not benchmark_raw:
            raise HTTPException(status_code=400, detail="Не указан Market Asset (Benchmark).")

        benchmarks_list = []
        if isinstance(benchmark_raw, (list, tuple, set)):
            benchmarks_list = [str(b).strip().upper() for b in benchmark_raw if str(b).strip()]
        elif isinstance(benchmark_raw, str):
            benchmarks_list = [b.strip().upper() for b in re.split(r"[\s,;]+", benchmark_raw) if b.strip()]

        clean_benchmarks = []
        for bm in benchmarks_list:
            if bm and bm not in clean_benchmarks:
                clean_benchmarks.append(bm)

        if not clean_benchmarks:
            raise HTTPException(status_code=400, detail="Не указан валидный Market Asset (Benchmark).")

        cleaned_groups = {}
        all_requested_tickers = []
        for group_name, tickers in groups.items():
            if not isinstance(tickers, list):
                continue
            clean_tickers = []
            for ticker in tickers:
                if not isinstance(ticker, str):
                    continue
                ticker = ticker.strip().upper()
                if ticker and ticker not in clean_benchmarks and ticker not in clean_tickers:
                    clean_tickers.append(ticker)
                    if ticker not in all_requested_tickers:
                        all_requested_tickers.append(ticker)
            if clean_tickers:
                cleaned_groups[str(group_name).strip() or "Group"] = clean_tickers

        if not cleaned_groups or not all_requested_tickers:
            raise HTTPException(status_code=400, detail="Нет валидных тикеров для анализа.")

        all_symbols = list(dict.fromkeys(all_requested_tickers + clean_benchmarks))
        df = get_stock_data(*all_symbols)
        if df is None or df.empty:
            raise HTTPException(status_code=404, detail="Данные для указанных тикеров не найдены в базе данных.")

        available_tickers = set(df["ticker"].astype(str).str.strip().str.upper().unique())
        missing_benchmarks = [bm for bm in clean_benchmarks if bm not in available_tickers]
        if missing_benchmarks:
            raise HTTPException(status_code=404, detail=f"Market Asset '{', '.join(missing_benchmarks)}' не найден в базе данных.")

        missing_tickers = [t for t in all_requested_tickers if t not in available_tickers]
        active_groups = {}
        for g_name, t_list in cleaned_groups.items():
            valid_t = [t for t in t_list if t in available_tickers]
            if valid_t:
                active_groups[g_name] = valid_t

        if not active_groups:
            raise HTTPException(status_code=404, detail="Ни один из указанных тикеров не найден в базе данных.")

        cleaned_asset_moves = {}
        if isinstance(asset_moves, dict):
            for t, m in asset_moves.items():
                try:
                    m = float(m)
                    if np.isfinite(m):
                        cleaned_asset_moves[str(t).strip().upper()] = m
                except (TypeError, ValueError):
                    continue

        analysis = calculate_groups_analysis(
            df=df,
            groups=active_groups,
            benchmarks=clean_benchmarks,
            period=period,
            benchmark_move=benchmark_move,
            benchmark_moves=benchmark_moves if isinstance(benchmark_moves, dict) else None,
            asset_moves=cleaned_asset_moves
        )

        ignored_tickers = analysis.get("ignored_tickers", {})
        partial_tickers = analysis.get("partial_tickers", {})
        warning_parts = []
        if missing_tickers:
            warning_parts.append(
                f"Пропущено {len(missing_tickers)} тикеров (нет в БД): {', '.join(missing_tickers[:8])}"
                + (f" и ещё {len(missing_tickers) - 8}..." if len(missing_tickers) > 8 else "")
            )
        if ignored_tickers:
            ignored_list = list(ignored_tickers.keys()) if isinstance(ignored_tickers, dict) else list(ignored_tickers)
            warning_parts.append(
                f"Не удалось рассчитать {len(ignored_list)} тикеров (< 2 наблюдений): {', '.join(ignored_list[:8])}"
                + (f" и ещё {len(ignored_list) - 8}..." if len(ignored_list) > 8 else "")
            )
        if partial_tickers:
            partial_list = list(partial_tickers.keys())
            warning_parts.append(
                f"{len(partial_list)} тикеров имеют историю меньше периода {period}: {', '.join(partial_list[:6])}"
                + (f" и ещё {len(partial_list) - 6}..." if len(partial_list) > 6 else "")
            )

        warning_message = " | ".join(warning_parts) if warning_parts else None

        return {
            "groups": active_groups,
            "benchmarks": clean_benchmarks,
            "primary_benchmark": clean_benchmarks[0],
            "benchmark": clean_benchmarks[0],
            "reference": clean_benchmarks[0],
            "benchmark_moves": clean_dict(analysis.get("benchmark_moves", {})),
            "benchmark_move": benchmark_move,
            "asset_moves": cleaned_asset_moves,
            "tickers": analysis.get("tickers", []),
            "all_symbols": analysis.get("all_symbols", []),
            "period": analysis.get("period", period),
            "period_start": analysis.get("period_start"),
            "period_end": analysis.get("period_end"),
            "correlation": clean_dict(analysis.get("correlation", {})),
            "beta": clean_dict(analysis.get("beta", {})),
            "benchmark_beta": clean_dict(analysis.get("benchmark_beta", {})),
            "expected_range": clean_dict(analysis.get("expected_range", {})),
            "benchmarks_data": clean_dict(analysis.get("benchmarks_data", {})),
            "group_summary": clean_dict(analysis.get("group_summary", {})),
            "missing_tickers": missing_tickers,
            "ignored_tickers": clean_dict(ignored_tickers),
            "partial_tickers": clean_dict(partial_tickers),
            "warning": warning_message,
            "total_requested": len(all_requested_tickers),
            "total_analyzed": len(analysis.get("tickers", []))
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/export-excel")
async def api_export_excel(request: Request):
    try:
        from fastapi.responses import Response
        data = await request.json() or {}

        rows = data.get("rows", [])
        benchmarks = data.get("benchmarks", [])
        benchmark = str(data.get("benchmark", "")).strip().upper() or "BENCHMARK"
        period = str(data.get("period", "1y"))
        is_multi = bool(data.get("is_multi_benchmark", False) or (isinstance(benchmarks, list) and len(benchmarks) > 1))

        if not rows:
            raise HTTPException(status_code=400, detail="Нет данных для экспорта.")

        if not benchmarks:
            benchmarks = [benchmark]

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Analysis Results"

        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        border_thin = Side(border_style="thin", color="E2E8F0")
        cell_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

        if is_multi and len(benchmarks) > 1:
            headers = ["Ticker"]
            for bm in benchmarks:
                headers.extend([f"Corr ({bm})", f"Beta ({bm})", f"Exp Move ({bm})"])
            headers.extend(["Actual Move", "Daily Vol", "Observations", "Period"])
            ws.append(headers)

            for r in rows:
                ticker = str(r.get("ticker", "")).strip().upper()
                row_data = [ticker]
                for bm in benchmarks:
                    row_data.append(clean_value(r.get(f"correlation_{bm}") or r.get("benchmarks_metrics", {}).get(bm, {}).get("correlation")))
                    row_data.append(clean_value(r.get(f"beta_{bm}") or r.get("benchmarks_metrics", {}).get(bm, {}).get("beta")))
                    row_data.append(clean_value(r.get(f"expected_move_{bm}") or r.get("benchmarks_metrics", {}).get(bm, {}).get("expected_move")))
                row_data.extend([clean_value(r.get("actual_move")), clean_value(r.get("volatility")), clean_value(r.get("observations")), period])
                ws.append(row_data)
        else:
            headers = ["Ticker", f"Corr ({benchmark})", f"Beta ({benchmark})", f"Exp Move ({benchmark})", "Actual Move", "Difference", "Normalized", "Daily Vol", "Residual Vol", "Observations"]
            ws.append(headers)
            for r in rows:
                ws.append([
                    str(r.get("ticker", "")).strip().upper(),
                    clean_value(r.get("correlation")),
                    clean_value(r.get("beta")),
                    clean_value(r.get("expected_move")),
                    clean_value(r.get("actual_move")),
                    clean_value(r.get("difference")),
                    clean_value(r.get("normalized")),
                    clean_value(r.get("volatility")),
                    clean_value(r.get("residual_volatility")),
                    clean_value(r.get("observations"))
                ])

        ws.row_dimensions[1].height = 24
        for col in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment
            cell.border = cell_border

        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"Quant_Analysis_{period}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



if __name__ == "__main__":
    import uvicorn
    import socket

    def find_free_port(preferred_port=8000):
        for port in [preferred_port, 8080, 8001, 8002, 5000, 5050]:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("127.0.0.1", port))
                    return port
                except OSError:
                    continue
        return preferred_port

    target_port = int(os.getenv("PORT", find_free_port(8000)))
    print("\n" + "=" * 55)
    print(f">> Helion Quant Platform: http://127.0.0.1:{target_port}")
    print(f">> Swagger API Docs:      http://127.0.0.1:{target_port}/docs")
    print("=" * 55 + "\n")
    uvicorn.run("app_fastapi:app", host="127.0.0.1", port=target_port, reload=True)
