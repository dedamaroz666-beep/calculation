import os
import sqlite3
import datetime
from typing import Dict, List, Any, Optional
import psycopg
from psycopg.rows import dict_row
import pandas as pd
import numpy as np

from config import DB_CONFIG, DATABASE_URL, CACHE_DB_PATH

# In-memory cache for fast reuse within the session
_DB_CACHE = {}
_CACHE_EXPIRY = {}


# ============================================================
# LOCAL SQLITE CACHE INITIALIZATION
# ============================================================

def init_cache_db():
    """Initializes local SQLite tables for dividends, reports, and company profiles."""
    os.makedirs(os.path.dirname(CACHE_DB_PATH), exist_ok=True)
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dividends (
                ticker TEXT,
                ex_date TEXT,
                amount REAL,
                pay_date TEXT,
                record_date TEXT,
                declaration_date TEXT,
                yield REAL,
                frequency TEXT,
                PRIMARY KEY (ticker, ex_date)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reports_extra (
                ticker TEXT,
                date TEXT,
                eps_actual REAL,
                eps_estimate REAL,
                eps_surprise_pct REAL,
                revenue_actual REAL,
                revenue_estimate REAL,
                time TEXT,
                PRIMARY KEY (ticker, date)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS company_profiles (
                ticker TEXT PRIMARY KEY,
                company_name TEXT,
                description_ru TEXT,
                sector TEXT,
                industry TEXT,
                ceo TEXT,
                website TEXT,
                image TEXT,
                mkt_cap REAL,
                price REAL,
                beta REAL,
                peers TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_bars (
                ticker TEXT,
                date TEXT,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,
                prev_close REAL,
                gap REAL,
                cls2cls REAL,
                PRIMARY KEY(ticker, date)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS intraday_bars (
                ticker TEXT,
                datetime_et TEXT,
                date TEXT,
                time_str TEXT,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,
                minute_from_open INTEGER,
                session_type TEXT,
                PRIMARY KEY(ticker, datetime_et)
            )
        """)


init_cache_db()


# ============================================================
# DATABASE CONNECTION / STATUS
# ============================================================

def is_postgres_configured() -> bool:
    """Checks if PostgreSQL credentials or URL are defined in environment."""
    if DATABASE_URL:
        return True
    return bool(DB_CONFIG.get("dbname") and DB_CONFIG.get("user"))


def get_postgres_connection():
    """Connects to PostgreSQL (helion_db) with timeout and sslmode=disable."""
    if DATABASE_URL:
        url = DATABASE_URL
        if "sslmode=" not in url:
            url += ("&" if "?" in url else "?") + "sslmode=disable"
        return psycopg.connect(url, connect_timeout=5)
    
    cfg = dict(DB_CONFIG)
    cfg["sslmode"] = "disable"
    return psycopg.connect(**cfg, connect_timeout=5)


def check_postgres_health() -> bool:
    """Returns True if PostgreSQL is reachable."""
    if not is_postgres_configured():
        return False
    try:
        with get_postgres_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                return True
    except Exception as e:
        print("[PostgreSQL] Health check error:", e)
        return False


def get_database_status() -> Dict[str, Any]:
    """Returns structured status information for the frontend."""
    pg_ok = check_postgres_health()
    if pg_ok:
        try:
            tickers = get_available_tickers()
            return {
                "online": True,
                "source": "PostgreSQL (helion_db)",
                "message": f"Connected to PostgreSQL (helion_db: {len(tickers)} tickers)",
                "ticker_count": len(tickers)
            }
        except Exception as e:
            return {
                "online": False,
                "source": "PostgreSQL",
                "message": f"PostgreSQL error: {e}",
                "ticker_count": 0
            }

    return {
        "online": False,
        "source": "Local Cache",
        "message": "PostgreSQL disconnected. Operating on local cache.",
        "ticker_count": 0
    }


# ============================================================
# AVAILABLE TICKERS (FROM public.ticker)
# ============================================================

def get_available_tickers() -> List[str]:
    """Queries active tickers exclusively from PostgreSQL 'public.ticker' table."""
    cache_key = "all_tickers"
    now = datetime.datetime.now()
    if cache_key in _DB_CACHE and _CACHE_EXPIRY.get(cache_key, datetime.datetime.min) > now:
        return _DB_CACHE[cache_key]

    sql = """
        SELECT DISTINCT UPPER(t.ticker) AS ticker
        FROM ticker t
        WHERE t.active = TRUE AND t.ticker IS NOT NULL
        ORDER BY ticker;
    """
    try:
        if check_postgres_health():
            with get_postgres_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
                    rows = cur.fetchall()
                    tickers = [r[0].upper().strip() for r in rows if r[0]]
                    _DB_CACHE[cache_key] = tickers
                    _CACHE_EXPIRY[cache_key] = now + datetime.timedelta(minutes=30)
                    return tickers
    except Exception as e:
        print("[PostgreSQL] get_available_tickers error:", e)

    # Fallback popular tickers list
    fallback = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "SPY", "QQQ", "SOXX", "IGV", "AMD", "AVGO", "QCOM", "INTC"]
    return sorted(fallback)


def ticker_exists(ticker: str) -> bool:
    """Checks if ticker exists."""
    if not ticker:
        return False
    ticker = str(ticker).strip().upper()
    return ticker in get_available_tickers()


# ============================================================
# DAILY DATA RETRIEVAL (FROM public.daily)
# ============================================================

def get_stock_data(*tickers) -> pd.DataFrame:
    """
    Retrieves OHLC, volume, prev_close, gap, and cls2cls exclusively from PostgreSQL 'public.daily'.
    """
    if not tickers:
        return pd.DataFrame()

    cleaned_tickers = []
    for t in tickers:
        if t is None:
            continue
        t = str(t).upper().strip()
        if t and t not in cleaned_tickers:
            cleaned_tickers.append(t)

    if not cleaned_tickers:
        return pd.DataFrame()

    sql = """
        WITH selected_tickers AS (
            SELECT t.id, UPPER(t.ticker) AS ticker
            FROM ticker t
            WHERE UPPER(t.ticker) = ANY(%s)
        ),
        max_date AS (
            SELECT MAX(d.date) AS last_date
            FROM daily d
            JOIN selected_tickers st ON st.id = d.id_ticker
        )
        SELECT
            st.ticker,
            d.date::text as date,
            d.open::float as open,
            d.high::float as high,
            d.low::float as low,
            d.close::float as close,
            d.volume::float as volume,
            d.prev_close::float as prev_close,
            d.gap::float as gap,
            d.cls2cls::float as cls2cls
        FROM daily d
        JOIN selected_tickers st ON st.id = d.id_ticker
        CROSS JOIN max_date md
        WHERE d.date >= md.last_date - INTERVAL '5 years'
          AND d.date <= md.last_date
        ORDER BY d.date ASC, st.ticker ASC;
    """
    try:
        if check_postgres_health():
            with get_postgres_connection() as conn:
                with conn.cursor(row_factory=dict_row) as cur:
                    cur.execute(sql, (list(cleaned_tickers),))
                    rows = cur.fetchall()

            if rows:
                df = pd.DataFrame(rows)
                df["date"] = pd.to_datetime(df["date"])
                for col in ["open", "high", "low", "close", "volume", "prev_close", "gap", "cls2cls"]:
                    if col in df.columns:
                        df[col] = pd.to_numeric(df[col], errors="coerce")

                df = df.dropna(subset=["ticker", "date", "close"])
                df["ticker"] = df["ticker"].astype(str).str.upper().str.strip()
                return df
    except Exception as e:
        print(f"[PostgreSQL] get_stock_data error for {cleaned_tickers}:", e)

    return pd.DataFrame()


# ============================================================
# INTRADAY DATA RETRIEVAL (FROM public.intraday_chart)
# ============================================================

def get_intraday_chart_data(
    ticker: str,
    days_back: int = 365,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> pd.DataFrame:
    """
    Retrieves full 1-minute or 5-minute resolution bars (04:00 to 20:00 ET) from PostgreSQL 'public.intraday_chart'.
    """
    ticker = str(ticker).strip().upper()
    if not start_date:
        start_date = (datetime.date.today() - datetime.timedelta(days=days_back + 15)).isoformat()

    date_filter = "i.date >= %s"
    params = [ticker, start_date]

    if end_date:
        date_filter += " AND i.date <= %s"
        params.append(end_date)

    sql = f"""
        SELECT 
            UPPER(t.ticker) as ticker,
            (i.date::text || ' ' || to_char(i.time, 'HH24:MI:SS')) as datetime_et,
            i.date::text as date,
            to_char(i.time, 'HH24:MI') as time_str,
            to_char(i.time, 'HH24:MI:SS') as time,
            i.open::float as open,
            i.high::float as high,
            i.low::float as low,
            i.close::float as close,
            i.volume::float as volume,
            ((EXTRACT(HOUR FROM i.time) - 9) * 60 + (EXTRACT(MINUTE FROM i.time) - 30))::int as minute_from_open
        FROM intraday_chart i
        JOIN ticker t ON t.id = i.id_ticker
        WHERE UPPER(t.ticker) = %s
          AND {date_filter}
        ORDER BY i.date ASC, i.time ASC;
    """
    try:
        if check_postgres_health():
            with get_postgres_connection() as conn:
                with conn.cursor(row_factory=dict_row) as cur:
                    cur.execute(sql, params)
                    rows = cur.fetchall()

            if rows:
                df = pd.DataFrame(rows)
                # Classify session type
                def classify_session(t_str):
                    if not t_str:
                        return "regular"
                    if "04:00" <= t_str < "09:30":
                        return "premarket"
                    elif "09:30" <= t_str < "16:00":
                        return "regular"
                    elif "16:00" <= t_str <= "20:00":
                        return "postmarket"
                    return "other"

                df["session_type"] = df["time_str"].apply(classify_session)
                return df
    except Exception as e:
        print(f"[PostgreSQL] intraday_chart query error for {ticker}:", e)

    return pd.DataFrame()


# ============================================================
# REPORTS (FROM public.reports & cache)
# ============================================================

def get_ticker_reports(ticker: str) -> pd.DataFrame:
    """Retrieves earnings reports dates and times from public.reports."""
    ticker = str(ticker).strip().upper()
    sql = """
        SELECT 
            UPPER(t.ticker) as ticker,
            r.date::text as date,
            r.fiscal_period,
            r.fiscal_year,
            r.time,
            r.move_date::text as move_date,
            r.benzinga_id
        FROM reports r
        JOIN ticker t ON t.id = r.id_ticker
        WHERE UPPER(t.ticker) = %s
        ORDER BY r.date DESC;
    """
    try:
        if check_postgres_health():
            with get_postgres_connection() as conn:
                with conn.cursor(row_factory=dict_row) as cur:
                    cur.execute(sql, (ticker,))
                    rows = cur.fetchall()
                    if rows:
                        return pd.DataFrame(rows)
    except Exception as e:
        print(f"[PostgreSQL] reports query error for {ticker}:", e)

    return pd.DataFrame()


# ============================================================
# DIVIDENDS (FROM cache / PostgreSQL)
# ============================================================

def get_ticker_dividends_db(ticker: str) -> List[Dict[str, Any]]:
    """Retrieves stored dividends from SQLite cache or PostgreSQL."""
    ticker = str(ticker).strip().upper()
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT ticker, ex_date, amount, pay_date, record_date, declaration_date, yield, frequency
            FROM dividends
            WHERE ticker = ?
            ORDER BY ex_date DESC
        """, (ticker,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]


def save_ticker_dividends_db(ticker: str, dividends: List[Dict[str, Any]]):
    """Saves dividends to SQLite cache."""
    ticker = str(ticker).strip().upper()
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        for d in dividends:
            conn.execute("""
                INSERT INTO dividends (ticker, ex_date, amount, pay_date, record_date, declaration_date, yield, frequency)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(ticker, ex_date) DO UPDATE SET
                    amount = excluded.amount,
                    pay_date = excluded.pay_date,
                    record_date = excluded.record_date,
                    declaration_date = excluded.declaration_date,
                    yield = excluded.yield,
                    frequency = excluded.frequency
            """, (
                ticker,
                d.get("ex_date") or d.get("date"),
                float(d.get("amount") or d.get("dividend") or 0.0),
                d.get("pay_date") or d.get("paymentDate"),
                d.get("record_date") or d.get("recordDate"),
                d.get("declaration_date") or d.get("declarationDate"),
                float(d.get("yield")) if d.get("yield") is not None else None,
                d.get("frequency", "Quarterly")
            ))
        conn.commit()


# ============================================================
# COMPANY PROFILE (FROM cache / PostgreSQL)
# ============================================================

def get_company_profile_db(ticker: str) -> Optional[Dict[str, Any]]:
    """Retrieves cached company profile."""
    ticker = str(ticker).strip().upper()
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT * FROM company_profiles WHERE ticker = ?", (ticker,))
        row = cur.fetchone()
        if row:
            d = dict(row)
            if d.get("peers"):
                d["peers"] = [p.strip() for p in d["peers"].split(",") if p.strip()]
            return d
    return None


def save_company_profile_db(ticker: str, profile: Dict[str, Any]):
    """Saves company profile to SQLite cache."""
    ticker = str(ticker).strip().upper()
    peers_str = ",".join(profile.get("peers", [])) if isinstance(profile.get("peers"), list) else str(profile.get("peers", ""))
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute("""
            INSERT INTO company_profiles 
            (ticker, company_name, description_ru, sector, industry, ceo, website, image, mkt_cap, price, beta, peers, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ticker) DO UPDATE SET
                company_name = excluded.company_name,
                description_ru = excluded.description_ru,
                sector = excluded.sector,
                industry = excluded.industry,
                ceo = excluded.ceo,
                website = excluded.website,
                image = excluded.image,
                mkt_cap = excluded.mkt_cap,
                price = excluded.price,
                beta = excluded.beta,
                peers = excluded.peers,
                updated_at = excluded.updated_at
        """, (
            ticker,
            profile.get("companyName") or profile.get("company_name", ticker),
            profile.get("description_ru", ""),
            profile.get("sector", ""),
            profile.get("industry", ""),
            profile.get("ceo", ""),
            profile.get("website", ""),
            profile.get("image", ""),
            profile.get("marketCap") or profile.get("mkt_cap"),
            profile.get("price"),
            profile.get("beta"),
            peers_str,
            datetime.datetime.now().isoformat()
        ))
        conn.commit()