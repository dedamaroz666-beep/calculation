import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from config import BENCHMARKS
from calculations import (
    prepare_multi_asset_returns,
    select_period,
    pearson_correlation,
    calculate_beta,
    calculate_volatility,
    PERIODS,
    PERIOD_LABELS_RU
)
from database import get_stock_data, get_ticker_reports
from services.fmp_service import fmp_client
from services.polygon_service import polygon_client


# Predefined sector and industry ticker baskets for deep correlation discovery
INDUSTRY_BASKETS = {
    "Technology": ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "AMD", "AVGO", "QCOM", "TSM", "INTC", "MU", "ARM", "MRVL", "SMCI", "AMAT", "LRCX", "KLAC", "TXN", "ADI", "ORCL", "CRM", "ADBE", "NOW", "SNOW", "PLTR", "PANW", "CRWD", "DDOG", "NET", "SONY", "DELL", "HPQ"],
    "Semiconductors": ["NVDA", "AMD", "AVGO", "TSM", "QCOM", "INTC", "MU", "ARM", "MRVL", "SMCI", "AMAT", "LRCX", "KLAC", "ASML", "TXN", "ADI", "ON", "MCHP", "MPWR", "TER", "ENTG", "SWKS", "QRVO"],
    "Software": ["MSFT", "ORCL", "CRM", "ADBE", "NOW", "SNOW", "PLTR", "PANW", "CRWD", "DDOG", "MDB", "NET", "TEAM", "WDAY", "SHOP", "HUBS", "ZS", "FTNT", "PATH", "DOCU"],
    "Consumer Electronics": ["AAPL", "SONY", "DELL", "HPQ", "LOGI", "TBCH", "HEAR", "GPRO", "MSFT", "GOOGL"],
    "Automotive": ["TSLA", "RIVN", "LCID", "F", "GM", "NIO", "XPEV", "LI", "TM", "HMC", "STLA"],
    "Financial": ["JPM", "BAC", "WFC", "C", "GS", "MS", "V", "MA", "PYPL", "SQ", "COIN", "HOOD", "SCHW", "BLK", "AXP"],
    "Healthcare": ["LLY", "NVO", "JNJ", "UNH", "PFE", "ABBV", "MRK", "AMGN", "GILD", "BIIB", "VRTX", "REGN", "MRNA"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "OXY", "HAL", "MPC", "PSX", "VLO", "KMI", "WMB"],
    "Communication": ["GOOGL", "META", "DIS", "NFLX", "CMCSA", "WBD", "T", "VZ", "TMUS", "SPOT", "PINS", "SNAP", "ROKU"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "LOW", "NKE", "MCD", "SBUX", "BKNG", "ABNB", "TJX", "TGT", "LULU"]
}


class QuantService:
    def __init__(self):
        self.default_benchmarks = BENCHMARKS

    def calculate_ticker_correlations(
        self,
        ticker: str,
        period: str = "1y",
        benchmarks: Optional[List[str]] = None,
        peers: Optional[List[str]] = None,
        custom_df: Optional[pd.DataFrame] = None
    ) -> Dict[str, Any]:
        """
        Calculates correlation and Beta matrix for target ticker against benchmarks,
        direct business peers, and industry candidates.
        """
        benchmarks = self.default_benchmarks if benchmarks is None else benchmarks
        benchmarks = [b.strip().upper() for b in benchmarks if b.strip()]

        raw_fmp_peers = fmp_client.get_stock_peers(ticker)
        business_peers_list = []
        for p in raw_fmp_peers[:12]:
            sym = p.get("symbol", "").strip().upper()
            if sym and sym != ticker:
                business_peers_list.append({
                    "symbol": sym,
                    "companyName": p.get("companyName", sym),
                    "price": p.get("price")
                })

        if peers is None:
            fmp_symbols = [p["symbol"] for p in business_peers_list]
            # Add sector candidates for deeper industry correlation discovery
            sector_candidates = []
            for b_name, b_tickers in INDUSTRY_BASKETS.items():
                if ticker in b_tickers:
                    sector_candidates.extend(b_tickers)
            if not sector_candidates:
                sector_candidates = INDUSTRY_BASKETS["Technology"]

            peers = list(dict.fromkeys(fmp_symbols + sector_candidates))[:25]

        peers = [p.strip().upper() for p in peers if p.strip() and p.strip().upper() != ticker]
        all_symbols = list(dict.fromkeys([ticker] + benchmarks + peers))

        # Fetch daily price history
        if custom_df is not None and not custom_df.empty:
            df = custom_df
        else:
            df = get_stock_data(*all_symbols)
            # If any symbol missing in DB, backfill with Polygon
            if df.empty or ticker not in df["ticker"].values:
                poly_bars = polygon_client.fetch_daily_bars(ticker, start_date="2021-01-01")
                if poly_bars:
                    p_df = pd.DataFrame(poly_bars)
                    df = pd.concat([df, p_df], ignore_index=True) if not df.empty else p_df

        if df.empty:
            return {
                "ticker": ticker,
                "period": period,
                "error": "No daily price data available for correlation calculation."
            }

        # Calculate returns matrix
        returns = prepare_multi_asset_returns(df, all_symbols)
        if returns.empty or ticker not in returns.columns:
            return {
                "ticker": ticker,
                "period": period,
                "error": f"Insufficient return data for target ticker {ticker}."
            }

        # Slice returns by period
        if period in ("earnings_8q", "earnings"):
            try:
                # Retrieve last 8 past earnings reports from FMP and database
                earn_reps = fmp_client.get_earnings_history(ticker, limit=16)
                db_reps = get_ticker_reports(ticker)

                all_reps = []
                seen_dates = set()
                for r in earn_reps:
                    d = r.get("date")
                    if d and d not in seen_dates:
                        seen_dates.add(d)
                        all_reps.append(r)
                if not db_reps.empty:
                    for _, row in db_reps.iterrows():
                        d = str(row["date"])
                        if d not in seen_dates:
                            seen_dates.add(d)
                            all_reps.append({
                                "date": d,
                                "time": str(row.get("time", "amc")).lower()
                            })

                today_s = pd.Timestamp.now().strftime("%Y-%m-%d")
                past_reps = [r for r in all_reps if r.get("date") and r["date"] <= today_s]
                past_reps.sort(key=lambda x: x["date"], reverse=True)
                target_reps = past_reps[:8]

                # Match dates in returns index
                returns_date_strs = returns.index.strftime("%Y-%m-%d")
                mask = pd.Series(False, index=returns.index)

                for rep in target_reps:
                    p_date = rep["date"]
                    t_str = str(rep.get("time", "amc")).lower()
                    is_bmo = "bmo" in t_str or "07:" in t_str or "08:" in t_str or "09:" in t_str

                    matching_idx = np.where(returns_date_strs == p_date)[0]
                    if len(matching_idx) > 0:
                        idx_val = matching_idx[0]
                    else:
                        prior_idx = np.where(returns_date_strs <= p_date)[0]
                        idx_val = prior_idx[-1] if len(prior_idx) > 0 else None

                    if idx_val is not None:
                        # Strictly 1 reaction day per report:
                        # BMO -> report day (market opens after report)
                        # AMC -> next trading day (first full session after report)
                        reaction_idx = idx_val if is_bmo else min(idx_val + 1, len(returns) - 1)
                        mask.iloc[reaction_idx] = True

                period_returns = returns[mask]
                if len(period_returns) < 2:
                    period_returns = returns.tail(8)
                start_date = period_returns.index.min()
                last_date = period_returns.index.max()
            except Exception as e:
                print(f"[QuantService] Error filtering for earnings_8q: {e}")
                period_returns = returns.tail(8)
                start_date = period_returns.index.min()
                last_date = period_returns.index.max()
        else:
            try:
                period_returns, start_date, last_date = select_period(returns, period)
            except Exception:
                period_returns = returns
                start_date = returns.index.min()
                last_date = returns.index.max()

        target_series = period_returns[ticker].to_numpy(dtype=float)
        target_vol = calculate_volatility(target_series)

        ticker_correlations = []
        full_correlation_matrix = {}
        available_cols = list(period_returns.columns)

        # Full correlation matrix
        corr_df = period_returns.corr(method="pearson")
        for col_a in available_cols:
            full_correlation_matrix[col_a] = {}
            for col_b in available_cols:
                v = corr_df.loc[col_a, col_b] if (col_a in corr_df.index and col_b in corr_df.columns) else np.nan
                full_correlation_matrix[col_a][col_b] = round(float(v), 4) if np.isfinite(v) else None

        # 1. Benchmarks
        for bm in benchmarks:
            if bm in period_returns.columns:
                bm_series = period_returns[bm].to_numpy(dtype=float)
                c_val = pearson_correlation(target_series, bm_series)
                b_val = calculate_beta(target_series, bm_series)
                v_val = calculate_volatility(bm_series)
                joint_mask = np.isfinite(target_series) & np.isfinite(bm_series)
                obs = int(np.sum(joint_mask))

                # Residual volatility (sigma_residual = std(target - beta * benchmark))
                res_vol = None
                if b_val is not None and np.isfinite(b_val) and obs >= 2:
                    res = target_series[joint_mask] - (b_val * bm_series[joint_mask])
                    res_vol = float(np.std(res, ddof=1)) if len(res) >= 2 else None
            else:
                c_val, b_val, v_val, res_vol, obs = None, None, None, None, 0

            ticker_correlations.append({
                "symbol": bm,
                "type": "Benchmark",
                "correlation": round(c_val, 4) if c_val is not None and np.isfinite(c_val) else None,
                "beta": round(b_val, 4) if b_val is not None and np.isfinite(b_val) else None,
                "volatility": round(v_val, 4) if v_val is not None and np.isfinite(v_val) else None,
                "residual_volatility": round(res_vol, 4) if res_vol is not None and np.isfinite(res_vol) else None,
                "observations": obs
            })

        # 2. Peers & Industry Candidates
        calculated_peers_map = {}
        for p in peers:
            if p in period_returns.columns:
                p_series = period_returns[p].to_numpy(dtype=float)
                c_val = pearson_correlation(target_series, p_series)
                b_val = calculate_beta(target_series, p_series)
                v_val = calculate_volatility(p_series)
                joint_mask = np.isfinite(target_series) & np.isfinite(p_series)
                obs = int(np.sum(joint_mask))

                res_vol = None
                if b_val is not None and np.isfinite(b_val) and obs >= 2:
                    res = target_series[joint_mask] - (b_val * p_series[joint_mask])
                    res_vol = float(np.std(res, ddof=1)) if len(res) >= 2 else None
            else:
                c_val, b_val, v_val, res_vol, obs = None, None, None, None, 0

            corr_entry = {
                "symbol": p,
                "type": "Peer",
                "correlation": round(c_val, 4) if c_val is not None and np.isfinite(c_val) else None,
                "beta": round(b_val, 4) if b_val is not None and np.isfinite(b_val) else None,
                "volatility": round(v_val, 4) if v_val is not None and np.isfinite(v_val) else None,
                "residual_volatility": round(res_vol, 4) if res_vol is not None and np.isfinite(res_vol) else None,
                "observations": obs
            }
            ticker_correlations.append(corr_entry)
            calculated_peers_map[p] = corr_entry

        # Categorized Peers:
        # A. High Correlation in Industry (r >= 0.60)
        high_corr_industry = []
        for p in peers:
            entry = calculated_peers_map.get(p)
            if entry and entry["correlation"] is not None and entry["correlation"] >= 0.60:
                high_corr_industry.append(entry)

        # Sort descending by correlation
        high_corr_industry.sort(key=lambda x: x["correlation"], reverse=True)

        # If none >= 0.60, collect highest positive industry correlation assets
        top_positive_industry = []
        if not high_corr_industry:
            valid_pos = [
                entry for p, entry in calculated_peers_map.items()
                if entry["correlation"] is not None and entry["correlation"] > 0
            ]
            valid_pos.sort(key=lambda x: x["correlation"], reverse=True)
            top_positive_industry = valid_pos[:4]

        # B. Direct Business Peers (with attached correlation if available)
        for bp in business_peers_list:
            sym = bp["symbol"]
            if sym in calculated_peers_map and calculated_peers_map[sym]["correlation"] is not None:
                bp["correlation"] = calculated_peers_map[sym]["correlation"]
                bp["beta"] = calculated_peers_map[sym]["beta"]

        # Multi-period breakdown for SPY and QQQ
        multi_period_summary = {}
        for p_code in ["2w", "1m", "3m", "6m", "ytd", "1y"]:
            try:
                sub_ret, _, _ = select_period(returns, p_code)
                sub_target = sub_ret[ticker].to_numpy(dtype=float)

                sub_spy = sub_ret["SPY"].to_numpy(dtype=float) if "SPY" in sub_ret.columns else None
                sub_qqq = sub_ret["QQQ"].to_numpy(dtype=float) if "QQQ" in sub_ret.columns else None

                spy_c = pearson_correlation(sub_target, sub_spy) if sub_spy is not None else None
                spy_b = calculate_beta(sub_target, sub_spy) if sub_spy is not None else None
                qqq_c = pearson_correlation(sub_target, sub_qqq) if sub_qqq is not None else None
                qqq_b = calculate_beta(sub_target, sub_qqq) if sub_qqq is not None else None

                multi_period_summary[p_code] = {
                    "label_ru": PERIOD_LABELS_RU.get(p_code, p_code),
                    "spy_correlation": round(spy_c, 4) if spy_c is not None and np.isfinite(spy_c) else None,
                    "spy_beta": round(spy_b, 4) if spy_b is not None and np.isfinite(spy_b) else None,
                    "qqq_correlation": round(qqq_c, 4) if qqq_c is not None and np.isfinite(qqq_c) else None,
                    "qqq_beta": round(qqq_b, 4) if qqq_b is not None and np.isfinite(qqq_b) else None,
                }
            except Exception:
                multi_period_summary[p_code] = None

        return {
            "ticker": ticker,
            "period": period,
            "period_label_ru": PERIOD_LABELS_RU.get(period, period),
            "period_start": start_date.strftime("%Y-%m-%d") if hasattr(start_date, "strftime") else str(start_date),
            "period_end": last_date.strftime("%Y-%m-%d") if hasattr(last_date, "strftime") else str(last_date),
            "target_volatility": round(target_vol, 4) if target_vol is not None and np.isfinite(target_vol) else None,
            "benchmarks": benchmarks,
            "peers": peers,
            "high_corr_industry": high_corr_industry,
            "top_positive_industry": top_positive_industry,
            "business_peers": business_peers_list,
            "symbols": available_cols,
            "ticker_correlations": ticker_correlations,
            "full_correlation_matrix": full_correlation_matrix,
            "multi_period_summary": multi_period_summary
        }


# Singleton instance
quant_client = QuantService()
