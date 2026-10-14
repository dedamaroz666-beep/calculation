import datetime
import zoneinfo
from typing import Dict, List, Any, Optional
import requests
import pandas as pd
import numpy as np
from config import POLYGON_API_KEY, MARKET_TIMEZONE

TZ_NY = zoneinfo.ZoneInfo(MARKET_TIMEZONE)
TZ_UTC = zoneinfo.ZoneInfo("UTC")


class PolygonService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or POLYGON_API_KEY
        self.base_url = "https://api.polygon.io"

    def fetch_daily_bars(
        self,
        ticker: str,
        start_date: str = "2020-01-01",
        end_date: Optional[str] = None,
        adjusted: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Fetches daily OHLCV bars from Polygon.io.
        """
        ticker = str(ticker).strip().upper()
        if not end_date:
            end_date = datetime.date.today().isoformat()

        url = f"{self.base_url}/v2/aggs/ticker/{ticker}/range/1/day/{start_date}/{end_date}"
        params = {
            "adjusted": "true" if adjusted else "false",
            "sort": "asc",
            "limit": 50000,
            "apiKey": self.api_key
        }

        try:
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code != 200:
                print(f"[PolygonService] Error fetching daily for {ticker}: {resp.status_code} - {resp.text[:200]}")
                return []

            data = resp.json()
            results = data.get("results", [])
            bars = []

            for r in results:
                # Milliseconds UTC timestamp
                ts_ms = r.get("t")
                if not ts_ms:
                    continue
                dt_utc = datetime.datetime.fromtimestamp(ts_ms / 1000.0, tz=TZ_UTC)
                dt_et = dt_utc.astimezone(TZ_NY)
                date_str = dt_et.strftime("%Y-%m-%d")

                bars.append({
                    "ticker": ticker,
                    "date": date_str,
                    "timestamp": int(ts_ms / 1000),
                    "open": float(r.get("o", 0.0)),
                    "high": float(r.get("h", 0.0)),
                    "low": float(r.get("l", 0.0)),
                    "close": float(r.get("c", 0.0)),
                    "volume": float(r.get("v", 0.0)),
                    "vwap": float(r.get("vw", 0.0)) if "vw" in r else None,
                    "transactions": r.get("n")
                })

            return bars
        except Exception as e:
            print(f"[PolygonService] Exception in fetch_daily_bars for {ticker}: {e}")
            return []

    def fetch_intraday_bars(
        self,
        ticker: str,
        start_date: str,
        end_date: Optional[str] = None,
        multiplier: int = 5,
        timespan: str = "minute",
        adjusted: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Fetches 1-minute or 5-minute OHLCV bars from Polygon.io with full Extended Hours (04:00 - 20:00 ET).
        """
        ticker = str(ticker).strip().upper()
        if not end_date:
            end_date = start_date

        url = f"{self.base_url}/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{start_date}/{end_date}"
        params = {
            "adjusted": "true" if adjusted else "false",
            "sort": "asc",
            "limit": 50000,
            "apiKey": self.api_key
        }

        try:
            resp = requests.get(url, params=params, timeout=20)
            if resp.status_code != 200:
                print(f"[PolygonService] Error fetching {multiplier}{timespan} for {ticker}: {resp.status_code} - {resp.text[:200]}")
                return []

            data = resp.json()
            results = data.get("results", [])
            bars = []

            for r in results:
                ts_ms = r.get("t")
                if not ts_ms:
                    continue
                dt_utc = datetime.datetime.fromtimestamp(ts_ms / 1000.0, tz=TZ_UTC)
                dt_et = dt_utc.astimezone(TZ_NY)
                date_str = dt_et.strftime("%Y-%m-%d")
                time_str = dt_et.strftime("%H:%M")
                time_full = dt_et.strftime("%H:%M:%S")

                # Session classification (EST/EDT)
                hour = dt_et.hour
                minute = dt_et.minute
                minute_of_day = hour * 60 + minute

                # Premarket: 04:00 (240 min) to 09:30 (570 min)
                # Regular: 09:30 (570 min) to 16:00 (960 min)
                # Postmarket: 16:00 (960 min) to 20:00 (1200 min)
                if 240 <= minute_of_day < 570:
                    session_type = "premarket"
                elif 570 <= minute_of_day < 960:
                    session_type = "regular"
                elif 960 <= minute_of_day <= 1200:
                    session_type = "postmarket"
                else:
                    session_type = "other"

                bars.append({
                    "ticker": ticker,
                    "date": date_str,
                    "time": time_full,
                    "time_str": time_str,
                    "datetime_et": f"{date_str} {time_full}",
                    "timestamp": int(ts_ms / 1000),
                    "open": float(r.get("o", 0.0)),
                    "high": float(r.get("h", 0.0)),
                    "low": float(r.get("l", 0.0)),
                    "close": float(r.get("c", 0.0)),
                    "volume": float(r.get("v", 0.0)),
                    "session_type": session_type,
                    "minute_from_open": (hour - 9) * 60 + (minute - 30)
                })

            return bars
        except Exception as e:
            print(f"[PolygonService] Exception in fetch_intraday_bars for {ticker}: {e}")
            return []

    def fetch_dividends(self, ticker: str, limit: int = 24) -> List[Dict[str, Any]]:
        """
        Fetches historical dividends from Polygon.io v3 reference endpoint.
        """
        ticker = str(ticker).strip().upper()
        url = f"{self.base_url}/v3/reference/dividends"
        params = {
            "ticker": ticker,
            "limit": limit,
            "order": "desc",
            "sort": "ex_dividend_date",
            "apiKey": self.api_key
        }
        try:
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code != 200:
                return []
            results = resp.json().get("results", [])
            divs = []
            freq_map = {1: "Annual", 2: "Semi-Annual", 4: "Quarterly", 12: "Monthly"}
            for r in results:
                ex_date = r.get("ex_dividend_date")
                if not ex_date:
                    continue
                divs.append({
                    "ticker": ticker,
                    "ex_date": ex_date,
                    "amount": float(r.get("cash_amount", 0.0)),
                    "pay_date": r.get("pay_date") or "",
                    "record_date": r.get("record_date") or "",
                    "declaration_date": r.get("declaration_date") or "",
                    "yield": None,
                    "frequency": freq_map.get(r.get("frequency"), "Quarterly")
                })
            return divs
        except Exception as e:
            print(f"[PolygonService] Exception in fetch_dividends for {ticker}: {e}")
            return []


# Singleton instance
polygon_client = PolygonService()
