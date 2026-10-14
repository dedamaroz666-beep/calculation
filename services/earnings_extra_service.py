import os
import datetime
import sqlite3
from typing import Dict, Any, Optional
import pandas as pd
import requests

from config import CACHE_DB_PATH, POLYGON_API_KEY
from services.fmp_service import fmp_client


def get_ticker_earnings_extra_map(ticker: str) -> Dict[str, Dict[str, Any]]:
    """
    Retrieves historical EPS (actual, estimated, surprise %) and revenue
    for a given ticker. First checks SQLite cache, then falls back to FMP,
    yfinance, and Polygon.
    """
    ticker = str(ticker).strip().upper()
    result: Dict[str, Dict[str, Any]] = {}

    # 1. Check SQLite reports_extra cache
    try:
        with sqlite3.connect(CACHE_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM reports_extra WHERE ticker = ?", (ticker,))
            rows = cur.fetchall()
            for r in rows:
                d = dict(r)
                result[d["date"]] = d
        if result and len(result) >= 4:
            return result
    except Exception as e:
        print(f"[EarningsExtra] SQLite read error for {ticker}: {e}")

    # 2. Try FMP (works for AAPL)
    try:
        fmp_reports = fmp_client.get_earnings_history(ticker, limit=30)
        for earn in fmp_reports:
            d_str = earn.get("date")
            if d_str:
                result[d_str] = {
                    "ticker": ticker,
                    "date": d_str,
                    "eps_actual": earn.get("eps_actual"),
                    "eps_estimate": earn.get("eps_estimate"),
                    "eps_surprise_pct": earn.get("eps_surprise_pct"),
                    "revenue_actual": earn.get("revenue_actual"),
                    "revenue_estimate": earn.get("revenue_estimate"),
                    "time": str(earn.get("time", "AMC")).upper()
                }
    except Exception as e:
        print(f"[EarningsExtra] FMP error for {ticker}: {e}")

    # 3. If FMP had no data (e.g. non-AAPL tickers blocked on free tier), use yfinance
    if not result:
        try:
            import yfinance as yf
            t = yf.Ticker(ticker)
            ed = t.earnings_dates
            if ed is not None and not ed.empty:
                for dt_idx, row in ed.iterrows():
                    d_str = dt_idx.strftime("%Y-%m-%d")
                    eps_act = row.get("Reported EPS")
                    eps_est = row.get("EPS Estimate")
                    surp = row.get("Surprise(%)")
                    result[d_str] = {
                        "ticker": ticker,
                        "date": d_str,
                        "eps_actual": float(eps_act) if pd.notnull(eps_act) else None,
                        "eps_estimate": float(eps_est) if pd.notnull(eps_est) else None,
                        "eps_surprise_pct": float(surp) if pd.notnull(surp) else None,
                        "revenue_actual": None,
                        "revenue_estimate": None,
                        "time": "AMC"
                    }
        except Exception as e:
            print(f"[EarningsExtra] yfinance error for {ticker}: {e}")

        # 4. Fill revenues from Polygon quarterly financials
        try:
            url = f"https://api.polygon.io/vX/reference/financials?ticker={ticker}&timeframe=quarterly&limit=16&apiKey={POLYGON_API_KEY}"
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                for item in resp.json().get("results", []):
                    inc = item.get("financials", {}).get("income_statement", {})
                    rev = inc.get("revenues", {}).get("value")
                    end_d = item.get("end_date")
                    if rev and result and end_d:
                        for e_date in sorted(result.keys()):
                            if e_date > end_d and result[e_date]["revenue_actual"] is None:
                                result[e_date]["revenue_actual"] = float(rev)
                                break
        except Exception as e:
            print(f"[EarningsExtra] Polygon revenue error for {ticker}: {e}")

    # 5. Save to SQLite cache
    if result:
        try:
            with sqlite3.connect(CACHE_DB_PATH) as conn:
                for d_str, val in result.items():
                    conn.execute("""
                        INSERT INTO reports_extra 
                        (ticker, date, eps_actual, eps_estimate, eps_surprise_pct, revenue_actual, revenue_estimate, time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(ticker, date) DO UPDATE SET
                            eps_actual = excluded.eps_actual,
                            eps_estimate = excluded.eps_estimate,
                            eps_surprise_pct = excluded.eps_surprise_pct,
                            revenue_actual = excluded.revenue_actual,
                            revenue_estimate = excluded.revenue_estimate,
                            time = excluded.time
                    """, (
                        ticker,
                        d_str,
                        val.get("eps_actual"),
                        val.get("eps_estimate"),
                        val.get("eps_surprise_pct"),
                        val.get("revenue_actual"),
                        val.get("revenue_estimate"),
                        val.get("time", "AMC")
                    ))
                conn.commit()
        except Exception as e:
            print(f"[EarningsExtra] SQLite write error for {ticker}: {e}")

    return result


def find_matching_earnings_extra(
    extra_map: Dict[str, Dict[str, Any]],
    target_date: str,
    max_days_diff: int = 4
) -> Optional[Dict[str, Any]]:
    """
    Finds matching earnings extra details for a date, handling slight calendar offsets.
    """
    if not extra_map or not target_date:
        return None
    if target_date in extra_map:
        return extra_map[target_date]

    try:
        d_target = datetime.date.fromisoformat(target_date)
        best_match = None
        min_diff = 999
        for ex_date, ex_val in extra_map.items():
            try:
                d_ex = datetime.date.fromisoformat(ex_date)
                diff = abs((d_ex - d_target).days)
                if diff <= max_days_diff and diff < min_diff:
                    min_diff = diff
                    best_match = ex_val
            except Exception:
                continue
        return best_match
    except Exception:
        return None
