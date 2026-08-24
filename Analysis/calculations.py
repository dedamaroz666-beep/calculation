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
# PERIOD DATA SUFFICIENCY CHECK
# ============================================================

def check_ticker_period_sufficiency(ticker, df, period_returns, start_date, last_date, period):
    """
    Checks whether a ticker has sufficient historical data covering the selected period.
    Returns (is_sufficient: bool, reason: str or None).

    If an asset's data exists for less than the specified period (e.g., IPO 3 weeks ago
    while 3m period is selected), it will be flagged as insufficient so it can be ignored.
    """
    if df is None or df.empty or ticker not in period_returns.columns:
        return False, "Нет данных доходности за выбранный период"

    ticker_clean = str(ticker).strip().upper()
    df_tickers = df["ticker"].astype(str).str.strip().str.upper()
    t_df = df[df_tickers == ticker_clean]

    if t_df.empty:
        return False, "Нет данных по активу в базе"

    dates = pd.to_datetime(t_df["date"], errors="coerce").dropna()
    if dates.empty:
        return False, "Некорректные даты в базе"

    min_date = dates.min()
    max_date = dates.max()
    history_span_days = (max_date - min_date).days

    # Required calendar days for the chosen period
    period_str = str(period or "1y").lower()
    if period_str == "ytd":
        start_of_year = pd.Timestamp(year=last_date.year, month=1, day=1)
        required_days = max(1, (last_date - start_of_year).days)
    else:
        required_days = PERIODS.get(period_str, 365)

    # 1. Check if the entire history in DB is noticeably shorter than the period
    # (using 7 calendar days margin to account for weekends / holiday starts)
    if history_span_days < (required_days - 7):
        return False, f"История актива ({history_span_days} дн.) меньше периода {period} ({required_days} дн.)"

    # 2. Returns within the sliced period window [start_date, last_date]
    t_returns = period_returns[ticker].dropna()
    obs_count = len(t_returns)
    if obs_count < 2:
        return False, f"Недостаточно торговых наблюдений ({obs_count} дн.)"

    first_valid_period_date = t_returns.index.min()
    last_valid_period_date = t_returns.index.max()
    first_window_date = period_returns.index.min()
    last_window_date = period_returns.index.max()

    # If the stock began trading noticeably after the period started (e.g. IPO 3 weeks ago for 3m period)
    if (first_valid_period_date - first_window_date).days > 7:
        return False, f"Торги начались позже начала периода ({first_valid_period_date.strftime('%Y-%m-%d')} > {first_window_date.strftime('%Y-%m-%d')})"

    # If the stock stopped trading noticeably before the period ended
    if (last_window_date - last_valid_period_date).days > 7:
        return False, f"Торги прекратились раньше окончания периода ({last_valid_period_date.strftime('%Y-%m-%d')} < {last_window_date.strftime('%Y-%m-%d')})"

    # 3. Observation ratio compared to total trading days in period
    total_window_trading_days = len(period_returns)
    if total_window_trading_days > 0:
        obs_ratio = obs_count / total_window_trading_days
        if obs_ratio < 0.70:
            return False, f"Слишком мало торговых дней ({obs_count} из {total_window_trading_days}, {obs_ratio:.0%})"

    return True, None


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

    # 4. Check sufficiency for each asset ticker (ignore tickers with history < period)
    valid_symbols = []
    ignored_tickers = {}

    for ticker in all_tickers:
        if ticker in clean_benchmarks:
            continue
        if ticker not in period_returns.columns:
            ignored_tickers[ticker] = "Нет данных в выборке доходностей"
            continue

        is_ok, reason = check_ticker_period_sufficiency(ticker, df, period_returns, start_date, last_date, period)
        if is_ok:
            valid_symbols.append(ticker)
        else:
            ignored_tickers[ticker] = reason

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
            }
        except Exception as e:
            results[period] = None

    return results, pd.DataFrame()