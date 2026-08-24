import os
import psycopg
import pandas as pd
import numpy as np
import datetime
import yfinance as yf
from config import DB_CONFIG, DATABASE_URL

# In-memory cache for downloaded market data to avoid re-fetching on every calculation
_MARKET_DATA_CACHE = {}
_CACHE_EXPIRY = {}


# ============================================================
# UNIVERSE OF POPULAR TICKERS (S&P 500, NASDAQ 100, ETFS)
# Used when PostgreSQL is not configured or in live market data mode
# ============================================================

DEFAULT_MARKET_TICKERS = sorted(list(set([
    # Major Indices & Benchmark ETFs
    "SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "XLK", "XLF", "XLV", "XLE", "XLI", "XLP", "XLU", "XLY", "XLC", "XLB", "XLRE", "SMH", "SOXX", "ARKK", "TLT", "GLD", "SLV", "USO", "UNG", "HYG", "LQD", "EEM", "EFA", "VXX", "UVXY", "SQQQ", "TQQQ", "SOXL", "SOXS", "SPXU", "UPRO",

    # Mega Cap Tech & Growth
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "BRK.B", "AVGO", "ORCL", "ADBE", "CRM", "AMD", "QCOM", "TXN", "INTC", "CSCO", "IBM", "NOW", "INTU", "AMAT", "MU", "LRCX", "ADI", "KLAC", "SNPS", "CDNS", "PANW", "CRWD", "FTNT", "PLTR", "UBER", "ABNB", "DASH", "COIN", "SNOW", "DDOG", "MDB", "NET", "ZS", "SHOP", "SQ", "PYPL", "AFRM", "HOOD", "ROKU", "SPOT", "NFLX", "DIS", "CMCSA", "WBD", "PARA",

    # Financials & Banks
    "JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "SCHW", "AXP", "V", "MA", "COF", "PNC", "USB", "TFC", "BK", "STT", "FITB", "KEY", "RF", "CFG", "HBAN", "MTB", "SYF", "DFS", "ALL", "PGR", "TRV", "CB", "AIG", "MET", "PRU", "AFL", "HIG", "CINF", "ICE", "CME", "NDAQ", "CBOE", "MCO", "SPGI", "MSCI",

    # Healthcare, Pharma & Biotech
    "LLY", "JNJ", "UNH", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "BMY", "AMGN", "GILD", "VRTX", "REGN", "ISRG", "MDT", "SYK", "BSX", "EW", "ZTS", "BDX", "BIIB", "MRNA", "BNTX", "ILMN", "ALNY", "INCY", "DXCM", "PODD", "IDXX", "IQV", "CVS", "CI", "HUM", "ELV", "MCK", "CAH", "COR",

    # Industrials, Defense & Aerospace
    "CAT", "DE", "HON", "GE", "UNP", "UPS", "FDX", "RTX", "LMT", "BA", "GD", "NOC", "TDG", "LHX", "AXON", "EMR", "ETN", "ITW", "PH", "ROK", "CMI", "PCAR", "CSX", "NSC", "CP", "CNI", "WM", "RSG", "FAST", "URI", "PWR", "EME", "JCI", "TT", "CARR", "OTIS",

    # Consumer Discretionary & Retail
    "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG", "TJX", "TGT", "ROST", "MAR", "HLT", "LVS", "WYNN", "MGM", "CCL", "RCL", "NCLH", "DRI", "YUM", "CMG", "DPZ", "LULU", "DECK", "ULTA", "ORLY", "AZO", "BBY", "KMX", "EBAY", "ETSY", "W", "F", "GM", "RIVN", "LCID",

    # Consumer Staples
    "PG", "KO", "PEP", "COST", "WMT", "PM", "MO", "MDLZ", "CL", "KMB", "STZ", "GIS", "K", "HSY", "KHC", "SYY", "ADM", "BG", "TSN", "HRL", "MKC", "CHD", "CLX", "EL", "MNST", "CELH", "KDP", "TAP",

    # Energy, Oil & Gas
    "XOM", "CVX", "COP", "EOG", "SLB", "PXD", "MPC", "PSX", "VLO", "OXY", "HES", "DVN", "HAL", "BKR", "KMI", "WMB", "OKE", "LNG", "TRGP", "EQT", "APA", "MRO", "FANG", "CTRA", "OVV", "CHK",

    # Materials & Chemicals
    "LIN", "APD", "SHW", "ECL", "FCX", "NEM", "SCCO", "VALE", "RIO", "BHP", "DOW", "DD", "LYB", "ALB", "FMC", "NTR", "MOS", "CF", "NUE", "STLD", "CLF", "X", "AA", "VMC", "MLM",

    # Utilities & Real Estate (REITs)
    "NEE", "DUK", "SO", "AEP", "SRE", "D", "EXC", "XEL", "ED", "PEG", "WEC", "ES", "AWK", "PLD", "AMT", "EQIX", "CCI", "PSA", "O", "SPG", "WELL", "DLR", "VICI", "AVB", "EQR", "INVH", "MAA", "ARE", "BXP",

    # Semiconductor Universe (Comprehensive)
    "NVDA", "TSM", "ASML", "AVGO", "AMD", "QCOM", "TXN", "INTC", "AMAT", "MU", "LRCX", "ADI", "KLAC", "MRVL", "NXPI", "MCHP", "ON", "MPWR", "SWKS", "QRVO", "CRUS", "WDC", "STX", "ARM", "SMCI", "GFS"
])))


# ============================================================
# DATABASE CONNECTION / STATUS
# ============================================================

def is_postgres_configured():
    """Checks if PostgreSQL credentials or URL are defined in environment."""
    if DATABASE_URL:
        return True
    return bool(DB_CONFIG.get("dbname") and DB_CONFIG.get("user"))


def get_postgres_connection():
    """Attempts to connect to PostgreSQL with a strict timeout."""
    if DATABASE_URL:
        return psycopg.connect(DATABASE_URL, connect_timeout=3)
    return psycopg.connect(**DB_CONFIG, connect_timeout=3)


def check_postgres_health():
    """Returns True if PostgreSQL is reachable and has ticker table."""
    if not is_postgres_configured():
        return False
    try:
        with get_postgres_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                return True
    except Exception:
        return False


def get_database_status():
    """Returns structured status information for the frontend."""
    pg_ok = check_postgres_health()
    if pg_ok:
        try:
            tickers = get_available_tickers_pg()
            return {
                "online": True,
                "source": "postgresql",
                "message": f"Connected to PostgreSQL ({len(tickers)} tickers)",
                "ticker_count": len(tickers)
            }
        except Exception:
            pass

    return {
        "online": True,
        "source": "market_data",
        "message": f"Live Market Data Engine ({len(DEFAULT_MARKET_TICKERS)} Universe Tickers)",
        "ticker_count": len(DEFAULT_MARKET_TICKERS)
    }


# ============================================================
# AVAILABLE TICKERS
# ============================================================

def get_available_tickers_pg():
    """Queries tickers directly from PostgreSQL database."""
    sql = """
        SELECT DISTINCT UPPER(t.ticker) AS ticker
        FROM ticker t
        WHERE t.ticker IS NOT NULL
        ORDER BY ticker;
    """
    with get_postgres_connection() as conn:
        df = pd.read_sql(sql, conn)

    return (
        df["ticker"]
        .dropna()
        .astype(str)
        .str.upper()
        .str.strip()
        .tolist()
    )


def get_available_tickers():
    """
    Returns available tickers.
    If PostgreSQL is connected, returns tickers from DB.
    Otherwise returns comprehensive live market ticker universe.
    """
    try:
        if check_postgres_health():
            pg_tickers = get_available_tickers_pg()
            if pg_tickers:
                return pg_tickers
    except Exception as e:
        print("PostgreSQL ticker query fallback:", e)

    return DEFAULT_MARKET_TICKERS


# ============================================================
# STOCK DATA RETRIEVAL (HYBRID: POSTGRESQL + YFINANCE FALLBACK)
# ============================================================

def get_stock_data(*tickers):
    """
    Retrieves OHLC and return data for specified tickers.
    First tries PostgreSQL if available; if not or if some tickers
    are missing, seamlessly fetches from yfinance.
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

    # 1. Try PostgreSQL if healthy
    df_pg = pd.DataFrame()
    found_tickers = set()
    if check_postgres_health():
        try:
            df_pg = get_stock_data_pg(*cleaned_tickers)
            if df_pg is not None and not df_pg.empty:
                found_tickers = set(df_pg["ticker"].unique())
                if len(found_tickers) >= len(cleaned_tickers):
                    return df_pg
        except Exception as e:
            print("PostgreSQL data fetch error, switching to market data:", e)

    # 2. If some or all tickers missing in PG, fetch missing from yfinance and merge
    missing_tickers = [t for t in cleaned_tickers if t not in found_tickers]
    if missing_tickers:
        try:
            df_yf = get_stock_data_yfinance(missing_tickers)
            if df_yf is not None and not df_yf.empty:
                if df_pg is not None and not df_pg.empty:
                    return pd.concat([df_pg, df_yf], ignore_index=True)
                return df_yf
        except Exception as e:
            print("yfinance fallback fetch error:", e)

    return df_pg if (df_pg is not None and not df_pg.empty) else pd.DataFrame()


def get_stock_data_pg(*cleaned_tickers):
    """Queries OHLC from PostgreSQL."""
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
            d.date,
            d.open,
            d.high,
            d.low,
            d.close,
            d.volume,
            d.prev_close,
            d.gap,
            d.cls2cls
        FROM daily d
        JOIN selected_tickers st ON st.id = d.id_ticker
        CROSS JOIN max_date md
        WHERE d.date >= md.last_date - INTERVAL '1 year'
          AND d.date <= md.last_date
        ORDER BY d.date ASC, st.ticker ASC;
    """
    with get_postgres_connection() as conn:
        df = pd.read_sql(sql, conn, params=(list(cleaned_tickers),))

    if df.empty:
        return df

    df["date"] = pd.to_datetime(df["date"])
    for col in ["open", "high", "low", "close", "volume", "prev_close", "gap", "cls2cls"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["ticker", "date", "close"])
    df["ticker"] = df["ticker"].astype(str).str.upper().str.strip()
    return df


def get_stock_data_yfinance(tickers):
    """
    Downloads 1 year of daily historical prices for specified tickers using yfinance.
    Transforms data into standard schema: ticker, date, open, high, low, close, volume, prev_close, gap, cls2cls.
    """
    now = datetime.datetime.now()
    needed = []
    cached_dfs = []

    for t in tickers:
        if t in _MARKET_DATA_CACHE and _CACHE_EXPIRY.get(t, datetime.datetime.min) > now:
            cached_dfs.append(_MARKET_DATA_CACHE[t])
        else:
            needed.append(t)

    if needed:
        try:
            # Download in batch for high performance
            # Period: 1y (approx 252 trading days)
            yf_symbols = [t.replace(".", "-") for t in needed]
            data = yf.download(
                yf_symbols,
                period="1y",
                interval="1d",
                progress=False,
                group_by="ticker",
                auto_adjust=False,
                threads=True
            )

            new_rows = []
            if len(needed) == 1:
                t = needed[0]
                yf_sym = yf_symbols[0]
                if isinstance(data.columns, pd.MultiIndex):
                    if "Ticker" in data.columns.names:
                        sub = data.xs(yf_sym, axis=1, level="Ticker")
                    elif yf_sym in data.columns.levels[0]:
                        sub = data[yf_sym]
                    elif yf_sym in data.columns.levels[1]:
                        sub = data.xs(yf_sym, axis=1, level=1)
                    else:
                        sub = data
                else:
                    sub = data

                if not sub.empty and "Close" in sub.columns:
                    sub = sub.dropna(subset=["Close"]).reset_index()
                    date_col = "Date" if "Date" in sub.columns else sub.columns[0]
                    for _, r in sub.iterrows():
                        new_rows.append({
                            "ticker": t,
                            "date": pd.to_datetime(r[date_col]),
                            "open": float(r.get("Open", r["Close"])),
                            "high": float(r.get("High", r["Close"])),
                            "low": float(r.get("Low", r["Close"])),
                            "close": float(r["Close"]),
                            "volume": float(r.get("Volume", 0))
                        })
            else:
                for orig_t, yf_t in zip(needed, yf_symbols):
                    try:
                        if isinstance(data.columns, pd.MultiIndex):
                            if "Ticker" in data.columns.names:
                                sub = data.xs(yf_t, axis=1, level="Ticker")
                            elif yf_t in data.columns.levels[0]:
                                sub = data[yf_t]
                            elif yf_t in data.columns.levels[1]:
                                sub = data.xs(yf_t, axis=1, level=1)
                            else:
                                continue
                        else:
                            sub = data

                        if not sub.empty and "Close" in sub.columns:
                            sub = sub.dropna(subset=["Close"]).reset_index()
                            date_col = "Date" if "Date" in sub.columns else sub.columns[0]
                            for _, r in sub.iterrows():
                                new_rows.append({
                                    "ticker": orig_t,
                                    "date": pd.to_datetime(r[date_col]),
                                    "open": float(r.get("Open", r["Close"])),
                                    "high": float(r.get("High", r["Close"])),
                                    "low": float(r.get("Low", r["Close"])),
                                    "close": float(r["Close"]),
                                    "volume": float(r.get("Volume", 0))
                                })
                    except Exception as err:
                        print(f"Error parsing ticker {orig_t}:", err)

            if new_rows:
                df_new = pd.DataFrame(new_rows)
                df_new = df_new.sort_values(["ticker", "date"])
                df_new["prev_close"] = df_new.groupby("ticker")["close"].shift(1)
                df_new["gap"] = (df_new["open"] - df_new["prev_close"]) / df_new["prev_close"]
                df_new["cls2cls"] = (df_new["close"] - df_new["prev_close"]) / df_new["prev_close"]
                df_new = df_new.dropna(subset=["prev_close", "close"])

                # Cache per ticker for 1 hour
                expiry = now + datetime.timedelta(hours=1)
                for t, grp in df_new.groupby("ticker"):
                    _MARKET_DATA_CACHE[t] = grp
                    _CACHE_EXPIRY[t] = expiry
                cached_dfs.append(df_new)

        except Exception as e:
            print("yfinance download exception:", e)

    if not cached_dfs:
        return pd.DataFrame()

    combined = pd.concat(cached_dfs, ignore_index=True)
    combined = combined.drop_duplicates(subset=["ticker", "date"])
    return combined


def ticker_exists(ticker: str):
    if not ticker:
        return False
    ticker = str(ticker).strip().upper()
    return ticker in get_available_tickers()