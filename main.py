import os
from datetime import date, timedelta
from typing import List

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Copy .env.example to .env and configure it.")

app = FastAPI(title="Correlation & Beta Analytics")

app.mount("/static", StaticFiles(directory="static"), name="static")


PERIODS = {
    "3D": 3,
    "7D": 7,
    "14D": 14,
    "30D": 30,
    "40D": 40,
    "60D": 60,
    "90D": 90,
}


def get_conn():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def normalize_tickers(tickers: List[str]) -> List[str]:
    out = []
    seen = set()
    for t in tickers:
        t = t.strip().upper()
        if t and t not in seen:
            out.append(t)
            seen.add(t)
    return out


class AnalyzeRequest(BaseModel):
    tickers: List[str] = Field(min_length=2)
    period: str = "60D"
    start_date: date | None = None
    end_date: date | None = None
    benchmark: str | None = None


@app.get("/")
def index():
    return FileResponse("static/index.html")


@app.get("/api/tickers")
def search_tickers(q: str = Query("", max_length=50), limit: int = Query(30, ge=1, le=100)):
    q = q.strip().upper()
    with get_conn() as conn:
        with conn.cursor() as cur:
            if q:
                cur.execute(
                    """
                    SELECT ticker, name
                    FROM ticker
                    WHERE active = TRUE
                      AND ticker ILIKE %s
                    ORDER BY ticker
                    LIMIT %s
                    """,
                    (q + "%", limit),
                )
            else:
                cur.execute(
                    """
                    SELECT ticker, name
                    FROM ticker
                    WHERE active = TRUE
                    ORDER BY ticker
                    LIMIT %s
                    """,
                    (limit,),
                )
            return cur.fetchall()


@app.get("/api/health")
def health():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database() AS database, NOW() AS server_time")
            return cur.fetchone()


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    dx = [x - mx for x in xs]
    dy = [y - my for y in ys]
    vx = sum(v * v for v in dx)
    vy = sum(v * v for v in dy)
    if vx == 0 or vy == 0:
        return None
    return sum(a * b for a, b in zip(dx, dy)) / (vx * vy) ** 0.5


def beta(asset, benchmark):
    n = len(asset)
    if n < 2:
        return None
    ma = sum(asset) / n
    mb = sum(benchmark) / n
    cov = sum((a - ma) * (b - mb) for a, b in zip(asset, benchmark)) / (n - 1)
    var = sum((b - mb) ** 2 for b in benchmark) / (n - 1)
    if var == 0:
        return None
    return cov / var


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    tickers = normalize_tickers(req.tickers)
    if len(tickers) < 2:
        raise HTTPException(400, "Select at least two tickers.")

    period = req.period.upper()
    if period not in PERIODS and period not in {"YTD", "CUSTOM"}:
        raise HTTPException(400, "Unsupported period.")

    benchmark = (req.benchmark or tickers[0]).strip().upper()
    if benchmark not in tickers:
        # Benchmark can be outside the displayed matrix, but it must exist in DB.
        benchmark_in_matrix = False
    else:
        benchmark_in_matrix = True

    end = req.end_date or date.today()

    if period == "CUSTOM":
        if not req.start_date:
            raise HTTPException(400, "start_date is required for CUSTOM.")
        start = req.start_date
        if start > end:
            raise HTTPException(400, "start_date cannot be after end_date.")
        required_returns = None
    elif period == "YTD":
        start = date(end.year, 1, 1)
        required_returns = None
    else:
        required_returns = PERIODS[period]
        # We fetch more history than needed so weekends/holidays/missing rows do not
        # accidentally reduce the requested number of return observations.
        start = end - timedelta(days=max(required_returns * 4, 30))

    # We calculate returns in Python after retrieving aligned daily closes.
    # The first close before the requested start is included so YTD/custom periods
    # can correctly calculate the first return.
    placeholders = ",".join(["%s"] * len(tickers))
    sql = f"""
        SELECT t.ticker, d.date, d.close
        FROM ticker t
        JOIN daily d ON d.id_ticker = t.id
        WHERE t.ticker IN ({placeholders})
          AND d.date <= %s
          AND d.date >= %s
          AND d.close IS NOT NULL
        ORDER BY d.date ASC, t.ticker ASC
    """

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (*tickers, end, start - timedelta(days=10)))
            rows = cur.fetchall()

    if not rows:
        raise HTTPException(404, "No price data found for the selected tickers.")

    prices = {t: {} for t in tickers}
    for r in rows:
        prices[r["ticker"]][r["date"]] = float(r["close"])

    # Build daily returns independently per ticker.
    returns = {t: {} for t in tickers}
    for t in tickers:
        dates = sorted(prices[t])
        for i in range(1, len(dates)):
            prev_d, cur_d = dates[i - 1], dates[i]
            prev_p, cur_p = prices[t][prev_d], prices[t][cur_d]
            if prev_p and prev_p != 0:
                returns[t][cur_d] = cur_p / prev_p - 1.0

    # Requested observation window: common dates are used pairwise.
    if period == "CUSTOM":
        window_start = req.start_date
    elif period == "YTD":
        window_start = start
    else:
        # Determine the latest N common trading dates across all selected tickers.
        common = None
        for t in tickers:
            ds = set(returns[t].keys())
            common = ds if common is None else common & ds
        common = sorted(d for d in common if d <= end)
        selected_common = common[-required_returns:]
        window_start = selected_common[0] if selected_common else start

    # Pairwise correlation matrix uses pairwise common observations.
    corr_matrix = []
    for a in tickers:
        row = []
        for b in tickers:
            dates = sorted(set(returns[a]) & set(returns[b]))
            if period != "CUSTOM":
                dates = [d for d in dates if d >= window_start and d <= end]
            else:
                dates = [d for d in dates if req.start_date <= d <= end]
            if period not in {"CUSTOM", "YTD"} and len(dates) > required_returns:
                dates = dates[-required_returns:]
            xs = [returns[a][d] for d in dates]
            ys = [returns[b][d] for d in dates]
            row.append({
                "value": pearson(xs, ys),
                "observations": len(dates),
            })
        corr_matrix.append(row)

    # Benchmark can be outside matrix, so verify it exists.
    if benchmark not in returns:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT EXISTS(
                        SELECT 1
                        FROM ticker
                        WHERE active = TRUE AND ticker = %s
                    ) AS exists
                    """,
                    (benchmark,),
                )
                if not cur.fetchone()["exists"]:
                    raise HTTPException(404, f"Benchmark {benchmark} not found.")

        # Fetch benchmark data with the same base window.
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT d.date, d.close
                    FROM ticker t
                    JOIN daily d ON d.id_ticker = t.id
                    WHERE t.ticker = %s
                      AND d.date <= %s
                      AND d.date >= %s
                      AND d.close IS NOT NULL
                    ORDER BY d.date ASC
                    """,
                    (benchmark, end, start - timedelta(days=10)),
                )
                b_rows = cur.fetchall()
        prices[benchmark] = {r["date"]: float(r["close"]) for r in b_rows}
        returns[benchmark] = {}
        ds = sorted(prices[benchmark])
        for i in range(1, len(ds)):
            p0, p1 = prices[benchmark][ds[i-1]], prices[benchmark][ds[i]]
            if p0:
                returns[benchmark][ds[i]] = p1 / p0 - 1.0

    beta_rows = []
    for t in tickers:
        dates = sorted(set(returns[t]) & set(returns[benchmark]))
        if period == "CUSTOM":
            dates = [d for d in dates if req.start_date <= d <= end]
        else:
            dates = [d for d in dates if d >= window_start and d <= end]
        if period not in {"CUSTOM", "YTD"} and len(dates) > required_returns:
            dates = dates[-required_returns:]
        xs = [returns[t][d] for d in dates]
        ys = [returns[benchmark][d] for d in dates]
        beta_rows.append({
            "ticker": t,
            "benchmark": benchmark,
            "beta": beta(xs, ys),
            "correlation": pearson(xs, ys),
            "observations": len(dates),
        })

    return {
        "tickers": tickers,
        "benchmark": benchmark,
        "period": period,
        "start_date": window_start.isoformat(),
        "end_date": end.isoformat(),
        "correlation_matrix": corr_matrix,
        "beta_rows": beta_rows,
    }
