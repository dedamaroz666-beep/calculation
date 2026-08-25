import numpy as np
import pandas as pd


# ============================================================
# PERIODS
# ============================================================

PERIODS = {
    "2w": 14,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "ytd": "YTD",
    "1y": 365,
}


# ============================================================
# PREPARE MULTI-ASSET RETURNS
# ============================================================

def prepare_multi_asset_returns(df, tickers):
    """
    Transforms multi-ticker OHLC/close data into a wide DataFrame of daily returns.
    """
    if df is None or df.empty:
        return pd.DataFrame()

    data = df.copy()

    data["ticker"] = (
        data["ticker"]
        .astype(str)
        .str.strip()
        .str.upper()
    )

    clean_tickers = [
        str(t).strip().upper()
        for t in tickers
        if str(t).strip()
    ]

    data = data[data["ticker"].isin(clean_tickers)].copy()

    if data.empty:
        return pd.DataFrame()

    data["date"] = pd.to_datetime(data["date"], errors="coerce")
    data["close"] = pd.to_numeric(data["close"], errors="coerce")

    data = data.dropna(subset=["date", "close"])
    data = data.sort_values(["ticker", "date"])

    # Calculate close-to-close returns per ticker
    data["return"] = data.groupby("ticker")["close"].pct_change()

    returns = (
        data.pivot(index="date", columns="ticker", values="return")
        .sort_index()
    )

    return returns


# ============================================================
# STATISTICAL HELPERS (SINGLE PAIR)
# ============================================================

def pearson_correlation(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    mask = np.isfinite(x) & np.isfinite(y)
    x = x[mask]
    y = y[mask]

    if len(x) < 2:
        return np.nan

    x_mean = np.mean(x)
    y_mean = np.mean(y)

    num = np.sum((x - x_mean) * (y - y_mean))
    den = np.sqrt(np.sum((x - x_mean) ** 2) * np.sum((y - y_mean) ** 2))

    if den == 0:
        return np.nan

    return float(num / den)


def sample_covariance(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    mask = np.isfinite(x) & np.isfinite(y)
    x = x[mask]
    y = y[mask]

    if len(x) < 2:
        return np.nan

    return float(np.sum((x - np.mean(x)) * (y - np.mean(y))) / (len(x) - 1))


def sample_variance(x):
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]

    if len(x) < 2:
        return np.nan

    return float(np.sum((x - np.mean(x)) ** 2) / (len(x) - 1))


def calculate_beta(asset_returns, market_returns):
    covariance = sample_covariance(asset_returns, market_returns)
    market_variance = sample_variance(market_returns)

    if (
        not np.isfinite(covariance)
        or not np.isfinite(market_variance)
        or market_variance == 0
    ):
        return np.nan

    return float(covariance / market_variance)


def calculate_volatility(returns):
    returns = np.asarray(returns, dtype=float)
    returns = returns[np.isfinite(returns)]

    if len(returns) < 2:
        return np.nan

    return float(np.std(returns, ddof=1))


# ============================================================
# PERIOD SELECTION
# ============================================================

def select_period(returns, period):
    if returns.empty:
        raise ValueError("Нет данных для расчёта.")

    period = str(period or "1y").lower()

    if period not in PERIODS:
        raise ValueError(f"Неизвестный период: {period}")

    last_date = returns.index.max()

    if period == "ytd":
        start_date = pd.Timestamp(year=last_date.year, month=1, day=1)
    else:
        days = PERIODS[period]
        start_date = last_date - pd.Timedelta(days=days)

    period_returns = returns[returns.index >= start_date].copy()

    return period_returns, start_date, last_date


# ============================================================
# RUSSIAN PERIOD LABELS & DURATION FORMATTERS
# ============================================================

PERIOD_LABELS_RU = {
    "2w": "2 недели",
    "1m": "1 месяц",
    "3m": "3 месяца",
    "6m": "6 месяцев",
    "ytd": "с начала года (YTD)",
    "1y": "1 год",
}

def get_period_label_ru(period):
    p = str(period or "1y").lower()
    return PERIOD_LABELS_RU.get(p, f"{period}")


def format_history_duration_ru(days, obs_count=None):
    """
    Returns natural Russian duration string, e.g. "1 месяц", "2 недели", "25 дней", "1.5 месяца".
    """
    if days is None or days < 0:
        return f"{obs_count or 0} торг. дн."

    days = int(days)
    if days < 14:
        if days == 1:
            return "1 день"
        elif 2 <= days <= 4:
            return f"{days} дня"
        else:
            return f"{days} дней"
    elif days < 30:
        weeks = round(days / 7)
        if weeks <= 1:
            return "1 неделю"
        elif 2 <= weeks <= 4:
            return f"{weeks} недели"
        else:
            return f"{weeks} недель"
    elif days < 60:
        return "1 месяц"
    elif days < 360:
        months = round(days / 30.4, 1)
        if months.is_integer() or months == int(months):
            m_int = int(months)
            if m_int == 1:
                return "1 месяц"
            elif 2 <= m_int <= 4:
                return f"{m_int} месяца"
            else:
                return f"{m_int} месяцев"
        return f"{months} мес."
    else:
        years = round(days / 365.25, 1)
        if years.is_integer() or years == int(years):
            y_int = int(years)
            if y_int == 1:
                return "1 год"
            elif 2 <= y_int <= 4:
                return f"{y_int} года"
            else:
                return f"{y_int} лет"
        return f"{years} г."


# ============================================================
# PERIOD DATA HISTORY & SUFFICIENCY ANALYSIS
# ============================================================

def get_ticker_history_info(ticker, df, period_returns, start_date, last_date, period):
    """
    Analyzes historical availability for a ticker relative to the selected period.
    Returns a dict with:
      - is_sufficient: bool (True if covers full required period, False if partial)
      - is_partial: bool (True if historical span or observations are shorter than selected period)
      - has_data: bool
      - history_days: int
      - history_period_ru: str (e.g. "1 месяц", "2 недели", "25 дней")
      - history_text: str (e.g. "данные акции существуют за 1 месяц")
      - history_start: str (YYYY-MM-DD)
      - history_end: str (YYYY-MM-DD)
      - history_observations: int
      - selected_period: str
      - selected_period_label: str
      - reason: str or None
    """
    period_str = str(period or "1y").lower()
    period_label_ru = get_period_label_ru(period_str)

    if df is None or df.empty or ticker not in period_returns.columns:
        return {
            "is_sufficient": False,
            "is_partial": True,
            "has_data": False,
            "history_days": 0,
            "history_period_ru": "0 дней",
            "history_text": "данные акции отсутствуют за выбранный период",
            "history_start": None,
            "history_end": None,
            "history_observations": 0,
            "selected_period": period_str,
            "selected_period_label": period_label_ru,
            "reason": "Нет данных доходности за выбранный период"
        }

    ticker_clean = str(ticker).strip().upper()
    df_tickers = df["ticker"].astype(str).str.strip().str.upper()
    t_df = df[df_tickers == ticker_clean]

    if t_df.empty:
        return {
            "is_sufficient": False,
            "is_partial": True,
            "has_data": False,
            "history_days": 0,
            "history_period_ru": "0 дней",
            "history_text": "данные по активу отсутствуют в базе",
            "history_start": None,
            "history_end": None,
            "history_observations": 0,
            "selected_period": period_str,
            "selected_period_label": period_label_ru,
            "reason": "Нет данных по активу в базе"
        }

    dates = pd.to_datetime(t_df["date"], errors="coerce").dropna()
    if dates.empty:
        return {
            "is_sufficient": False,
            "is_partial": True,
            "has_data": False,
            "history_days": 0,
            "history_period_ru": "0 дней",
            "history_text": "некорректные даты в базе данных",
            "history_start": None,
            "history_end": None,
            "history_observations": 0,
            "selected_period": period_str,
            "selected_period_label": period_label_ru,
            "reason": "Некорректные даты в базе"
        }

    min_date = dates.min()
    max_date = dates.max()
    history_span_days = max(1, (max_date - min_date).days)

    # Required calendar days for the chosen period
    if period_str == "ytd":
        start_of_year = pd.Timestamp(year=last_date.year, month=1, day=1)
        required_days = max(1, (last_date - start_of_year).days)
    else:
        required_days = PERIODS.get(period_str, 365)

    t_returns = period_returns[ticker].dropna()
    obs_count = len(t_returns)
    total_window_trading_days = len(period_returns)

    # Human-friendly duration string in Russian
    history_period_ru = format_history_duration_ru(history_span_days, obs_count)
    history_text = f"данные акции существуют за {history_period_ru}"

    if obs_count < 2:
        return {
            "is_sufficient": False,
            "is_partial": True,
            "has_data": True,
            "history_days": history_span_days,
            "history_period_ru": history_period_ru,
            "history_text": history_text,
            "history_start": min_date.strftime("%Y-%m-%d"),
            "history_end": max_date.strftime("%Y-%m-%d"),
            "history_observations": obs_count,
            "selected_period": period_str,
            "selected_period_label": period_label_ru,
            "reason": f"Недостаточно торговых наблюдений ({obs_count} дн.)"
        }

    first_valid_period_date = t_returns.index.min()
    last_valid_period_date = t_returns.index.max()
    first_window_date = period_returns.index.min()
    last_window_date = period_returns.index.max()

    is_partial = False
    reasons = []

    # 1. Check if the entire history in DB is noticeably shorter than the period
    # (using 7 calendar days margin to account for weekends / holiday starts)
    if history_span_days < (required_days - 7):
        is_partial = True
        reasons.append(f"История актива ({history_period_ru}) меньше периода {period_label_ru}")

    # 2. If the stock began trading noticeably after the period started (e.g. IPO)
    if (first_valid_period_date - first_window_date).days > 7:
        is_partial = True
        reasons.append(f"Торги начались {first_valid_period_date.strftime('%d.%m.%Y')}")

    # 3. If the stock stopped trading noticeably before the period ended
    if (last_window_date - last_valid_period_date).days > 7:
        is_partial = True
        reasons.append(f"Торги прекратились {last_valid_period_date.strftime('%d.%m.%Y')}")

    # 4. Observation ratio compared to total trading days in period
    if total_window_trading_days > 0 and (obs_count / total_window_trading_days) < 0.70:
        is_partial = True
        reasons.append(f"{obs_count} из {total_window_trading_days} торг. дней")

    return {
        "is_sufficient": not is_partial,
        "is_partial": is_partial,
        "has_data": True,
        "history_days": history_span_days,
        "history_period_ru": history_period_ru,
        "history_text": history_text,
        "history_start": min_date.strftime("%Y-%m-%d"),
        "history_end": max_date.strftime("%Y-%m-%d"),
        "history_observations": obs_count,
        "selected_period": period_str,
        "selected_period_label": period_label_ru,
        "reason": " | ".join(reasons) if reasons else None
    }


def check_ticker_period_sufficiency(ticker, df, period_returns, start_date, last_date, period):
    info = get_ticker_history_info(ticker, df, period_returns, start_date, last_date, period)
    return info["is_sufficient"], info.get("reason")


# ============================================================
# NORMALIZED METRICS
# ============================================================

def calculate_normalized_move(actual_move, beta):
    if not np.isfinite(actual_move) or not np.isfinite(beta) or beta == 0:
        return np.nan
    return float(actual_move / beta)


def calculate_normalized_difference(normalized_move, benchmark_move):
    if not np.isfinite(normalized_move) or not np.isfinite(benchmark_move):
        return np.nan
    return float(normalized_move - benchmark_move)


# ============================================================
# VECTORIZED GROUP & PORTFOLIO ANALYSIS (300+ TICKER OPTIMIZED)
# ============================================================

def calculate_groups_analysis(
    df,
    groups,
    benchmark=None,
    benchmarks=None,
    period="1y",
    reference=None,
    benchmark_move=0.01,
    benchmark_moves=None,
    asset_moves=None,
):
    import re

    # Normalize benchmarks list
    benchmarks_list = []
    if benchmarks is not None:
        if isinstance(benchmarks, (list, tuple, set)):
            benchmarks_list = [str(b).strip().upper() for b in benchmarks if str(b).strip()]
        elif isinstance(benchmarks, str):
            benchmarks_list = [b.strip().upper() for b in re.split(r"[\s,;]+", benchmarks) if b.strip()]

    if not benchmarks_list:
        raw_bm = benchmark if benchmark is not None else reference
        if raw_bm is not None:
            if isinstance(raw_bm, (list, tuple, set)):
                benchmarks_list = [str(b).strip().upper() for b in raw_bm if str(b).strip()]
            elif isinstance(raw_bm, str):
                benchmarks_list = [b.strip().upper() for b in re.split(r"[\s,;]+", raw_bm) if b.strip()]

    # Deduplicate while preserving order
    clean_benchmarks = []
    for bm in benchmarks_list:
        if bm and bm not in clean_benchmarks:
            clean_benchmarks.append(bm)

    if not clean_benchmarks:
        raise ValueError("Не указан Market Asset (Benchmark).")

    primary_benchmark = clean_benchmarks[0]

    # Normalize default benchmark move
    try:
        benchmark_move = float(benchmark_move)
    except (TypeError, ValueError):
        raise ValueError("Некорректное движение benchmark.")

    if not np.isfinite(benchmark_move):
        raise ValueError("Benchmark Move должен быть числом.")

    # Normalize per-benchmark moves
    cleaned_benchmark_moves = {}
    if isinstance(benchmark_moves, dict):
        for b_name, b_mv in benchmark_moves.items():
            b_name = str(b_name).strip().upper()
            try:
                b_mv_float = float(b_mv)
                if np.isfinite(b_mv_float):
                    cleaned_benchmark_moves[b_name] = b_mv_float
            except (TypeError, ValueError):
                continue

    for bm in clean_benchmarks:
        if bm not in cleaned_benchmark_moves:
            cleaned_benchmark_moves[bm] = benchmark_move

    # Normalize asset moves
    if asset_moves is None:
        asset_moves = {}

    cleaned_asset_moves = {}
    for ticker, move in asset_moves.items():
        ticker = str(ticker).strip().upper()
        try:
            move = float(move)
        except (TypeError, ValueError):
            continue
        if np.isfinite(move):
            cleaned_asset_moves[ticker] = move

    # Extract all unique tickers from groups
    all_tickers = []
    for group_tickers in groups.values():
        for ticker in group_tickers:
            ticker = str(ticker).strip().upper()
            if ticker and ticker not in all_tickers:
                all_tickers.append(ticker)

    # Ensure all benchmarks are in the list of symbols to fetch
    for bm in clean_benchmarks:
        if bm not in all_tickers:
            all_tickers.append(bm)

    # 1. Prepare Returns Matrix
    returns = prepare_multi_asset_returns(df, all_tickers)
    if returns.empty:
        raise ValueError("Не удалось получить доходности активов.")

    available_symbols = list(returns.columns)
    missing_benchmarks = [bm for bm in clean_benchmarks if bm not in available_symbols]
    if missing_benchmarks:
        raise ValueError(f"Нет данных для Market Asset: {', '.join(missing_benchmarks)}")

    # 2. Slice for selected Period
    period_returns, start_date, last_date = select_period(returns, period)
    if period_returns.empty:
        raise ValueError("Нет данных за выбранный период.")

    # 3. Validate benchmarks data sufficiency for the selected period
    for bm in clean_benchmarks:
        bm_ok, bm_reason = check_ticker_period_sufficiency(bm, df, period_returns, start_date, last_date, period)
        if not bm_ok:
            raise ValueError(f"Market Asset (Benchmark) '{bm}' не имеет достаточной истории торгов за выбранный период ({period}): {bm_reason}")

    # 4. Check history info & sufficiency for each asset ticker
    valid_symbols = []
    ignored_tickers = {}
    partial_tickers = {}
    tickers_history_info = {}

    for ticker in all_tickers:
        if ticker in clean_benchmarks:
            continue
        if ticker not in period_returns.columns:
            ignored_tickers[ticker] = "Нет данных в выборке доходностей"
            continue

        h_info = get_ticker_history_info(ticker, df, period_returns, start_date, last_date, period)
        tickers_history_info[ticker] = h_info

        # If ticker has at least 2 trading observations, calculate metrics
        if h_info.get("history_observations", 0) >= 2:
            valid_symbols.append(ticker)
            if h_info.get("is_partial"):
                partial_tickers[ticker] = h_info
        else:
            ignored_tickers[ticker] = h_info.get("reason") or "Недостаточно торговых наблюдений (< 2 дней)"

    # Active symbols including benchmarks
    symbols = clean_benchmarks + [s for s in valid_symbols if s not in clean_benchmarks]

    # 3. Vectorized Pearson Correlation Matrix
    corr_df = period_returns[symbols].corr(method="pearson")
    correlation = {}
    for col_a in symbols:
        correlation[col_a] = {}
        for col_b in symbols:
            val = corr_df.loc[col_a, col_b] if (col_a in corr_df.index and col_b in corr_df.columns) else np.nan
            correlation[col_a][col_b] = float(val) if np.isfinite(val) else None

    # 4. Vectorized Covariance & Beta Matrix
    cov_df = period_returns[symbols].cov(ddof=1)
    variances = np.diag(cov_df.values)

    with np.errstate(divide="ignore", invalid="ignore"):
        var_col = variances[np.newaxis, :]
        beta_matrix_vals = np.where(var_col > 0, cov_df.values / var_col, np.nan)

    beta_df = pd.DataFrame(beta_matrix_vals, index=symbols, columns=symbols)
    for s in symbols:
        if s in beta_df.index:
            beta_df.loc[s, s] = 1.0

    beta = {}
    for col_a in symbols:
        beta[col_a] = {}
        for col_b in symbols:
            val = beta_df.loc[col_a, col_b] if (col_a in beta_df.index and col_b in beta_df.columns) else np.nan
            beta[col_a][col_b] = float(val) if np.isfinite(val) else None

    # 5. Volatilities of all assets
    std_series = period_returns[symbols].std(ddof=1)

    # 6. Calculate Metrics for Each Benchmark
    benchmarks_data = {}

    for bm in clean_benchmarks:
        bm_beta = {}
        bm_series = beta_df[bm] if bm in beta_df.columns else pd.Series(index=symbols, dtype=float)

        for s in symbols:
            val = bm_series.get(s, np.nan)
            bm_beta[s] = float(val) if np.isfinite(val) else None

        bm_returns = period_returns[bm].to_numpy(dtype=float)
        bm_valid_mask = np.isfinite(bm_returns)
        bm_current_move = cleaned_benchmark_moves.get(bm, benchmark_move)

        expected_range_bm = {}

        for ticker in symbols:
            h_info = tickers_history_info.get(ticker) or get_ticker_history_info(ticker, df, period_returns, start_date, last_date, period)
            asset_returns = period_returns[ticker].to_numpy(dtype=float)
            joint_mask = np.isfinite(asset_returns) & bm_valid_mask
            observations = int(np.sum(joint_mask))

            if observations < 2:
                expected_range_bm[ticker] = {
                    "beta": None,
                    "actual_move": None,
                    "expected_stock_move": None,
                    "expected_return": None,
                    "difference": None,
                    "normalized_move": None,
                    "normalized_difference": None,
                    "volatility": None,
                    "residual_volatility": None,
                    "benchmark_move": float(bm_current_move),
                    "observations": observations,
                    "is_partial_history": bool(h_info.get("is_partial", False)),
                    "history_period_ru": h_info.get("history_period_ru"),
                    "history_text": h_info.get("history_text"),
                    "history_start": h_info.get("history_start"),
                    "history_end": h_info.get("history_end"),
                    "history_days": h_info.get("history_days"),
                    "history_observations": h_info.get("history_observations", observations),
                    "selected_period": period,
                    "selected_period_label": get_period_label_ru(period),
                }
                continue

            b_val = 1.0 if ticker == bm else bm_beta.get(ticker)
            b_val_float = float(b_val) if (b_val is not None and np.isfinite(b_val)) else np.nan

            vol = float(std_series.get(ticker, np.nan))
            vol_float = vol if np.isfinite(vol) else None

            # Expected Move
            if np.isfinite(b_val_float):
                exp_move = bm_current_move * b_val_float
            else:
                exp_move = np.nan

            # Actual Move
            if ticker == bm:
                act_move = bm_current_move
            else:
                act_move = cleaned_asset_moves.get(ticker, np.nan)

            # Difference
            if np.isfinite(act_move) and np.isfinite(exp_move):
                diff = act_move - exp_move
            else:
                diff = np.nan

            # Normalized Move
            if np.isfinite(act_move) and np.isfinite(b_val_float) and b_val_float != 0:
                norm_move = act_move / b_val_float
            else:
                norm_move = np.nan

            # Normalized Difference (sigma units)
            if np.isfinite(diff) and vol_float is not None and np.isfinite(vol_float) and vol_float > 0:
                norm_diff = diff / vol_float
            else:
                norm_diff = np.nan

            # Residual Volatility
            if np.isfinite(b_val_float) and observations >= 2:
                res = asset_returns[joint_mask] - (b_val_float * bm_returns[joint_mask])
                res_vol = float(np.std(res, ddof=1)) if len(res) >= 2 else None
            else:
                res_vol = None

            expected_range_bm[ticker] = {
                "beta": b_val_float if np.isfinite(b_val_float) else None,
                "actual_move": float(act_move) if np.isfinite(act_move) else None,
                "expected_stock_move": float(exp_move) if np.isfinite(exp_move) else None,
                "expected_return": float(exp_move) if np.isfinite(exp_move) else None,
                "difference": float(diff) if np.isfinite(diff) else None,
                "normalized_move": float(norm_move) if np.isfinite(norm_move) else None,
                "normalized_difference": float(norm_diff) if np.isfinite(norm_diff) else None,
                "volatility": vol_float,
                "residual_volatility": res_vol if (res_vol is not None and np.isfinite(res_vol)) else None,
                "benchmark_move": float(bm_current_move),
                "observations": observations,
                "is_partial_history": bool(h_info.get("is_partial", False)),
                "history_period_ru": h_info.get("history_period_ru"),
                "history_text": h_info.get("history_text"),
                "history_start": h_info.get("history_start"),
                "history_end": h_info.get("history_end"),
                "history_days": h_info.get("history_days"),
                "history_observations": h_info.get("history_observations", observations),
                "selected_period": period,
                "selected_period_label": get_period_label_ru(period),
            }

        # Group Summaries for this benchmark
        group_summary_bm = {}
        for group_name, tickers in groups.items():
            betas = []
            correlations = []
            valid_assets = 0

            for t in tickers:
                t = str(t).strip().upper()
                if t not in symbols:
                    continue
                valid_assets += 1
                b = bm_beta.get(t)
                c = correlation.get(t, {}).get(bm)

                if b is not None and np.isfinite(b):
                    betas.append(b)
                if c is not None and np.isfinite(c):
                    correlations.append(c)

            group_summary_bm[group_name] = {
                "average_beta": float(np.mean(betas)) if betas else None,
                "average_correlation": float(np.mean(correlations)) if correlations else None,
                "assets": valid_assets,
                "total_configured": len(tickers),
            }

        benchmarks_data[bm] = {
            "benchmark_beta": bm_beta,
            "expected_range": expected_range_bm,
            "group_summary": group_summary_bm,
            "benchmark_move": float(bm_current_move),
        }

    # Primary benchmark data for backward compatibility
    primary_data = benchmarks_data[primary_benchmark]

    return {
        "period": period,
        "period_start": period_returns.index.min().strftime("%Y-%m-%d"),
        "period_end": period_returns.index.max().strftime("%Y-%m-%d"),
        "correlation": correlation,
        "beta": beta,
        "benchmarks": clean_benchmarks,
        "primary_benchmark": primary_benchmark,
        "benchmark": primary_benchmark,
        "reference": primary_benchmark,
        "benchmark_moves": cleaned_benchmark_moves,
        "benchmark_move": float(cleaned_benchmark_moves.get(primary_benchmark, benchmark_move)),
        "benchmark_beta": primary_data["benchmark_beta"],
        "expected_range": primary_data["expected_range"],
        "group_summary": primary_data["group_summary"],
        "benchmarks_data": benchmarks_data,
        "tickers": [t for t in symbols if t not in clean_benchmarks],
        "all_symbols": symbols,
        "ignored_tickers": ignored_tickers,
        "partial_tickers": partial_tickers,
        "tickers_history_info": tickers_history_info,
    }


# ============================================================
# COMPATIBILITY WRAPPER
# ============================================================

def calculate_all_periods(
    df,
    stock,
    benchmark,
    benchmark_move=0.01,
    asset_move=None,
):
    results = {}
    stock = str(stock).strip().upper()

    for period in PERIODS:
        try:
            analysis = calculate_groups_analysis(
                df,
                {"Analysis": [stock]},
                benchmark=benchmark,
                period=period,
                benchmark_move=benchmark_move,
                asset_moves={stock: asset_move} if asset_move is not None else {},
            )

            # If stock was ignored due to data history < period duration
            if stock in analysis.get("ignored_tickers", {}) or stock not in analysis.get("tickers", []):
                results[period] = None
                continue

            item = analysis["expected_range"].get(stock, {})
            if not item or item.get("beta") is None:
                results[period] = None
                continue

            results[period] = {
                "correlation": analysis["correlation"].get(stock, {}).get(str(benchmark).upper()),
                "beta": item.get("beta"),
                "actual_move": item.get("actual_move"),
                "expected_return": item.get("expected_return"),
                "expected_stock_move": item.get("expected_stock_move"),
                "difference": item.get("difference"),
                "normalized_move": item.get("normalized_move"),
                "normalized_difference": item.get("normalized_difference"),
                "volatility": item.get("volatility"),
                "benchmark_move": item.get("benchmark_move", benchmark_move),
                "observations": item.get("observations", 0),
                "start_date": analysis["period_start"],
                "end_date": analysis["period_end"],
                "is_partial_history": item.get("is_partial_history", False),
                "history_period_ru": item.get("history_period_ru"),
                "history_text": item.get("history_text"),
                "history_start": item.get("history_start"),
                "history_end": item.get("history_end"),
                "history_days": item.get("history_days"),
                "history_observations": item.get("history_observations"),
                "selected_period": period,
                "selected_period_label": get_period_label_ru(period),
            }
        except Exception as e:
            results[period] = None

    return results, pd.DataFrame()