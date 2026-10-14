import datetime
from typing import Dict, List, Any, Optional
import requests
from config import FMP_API_KEY


# Known common Russian business descriptions for prominent tickers
DEFAULT_DESCRIPTIONS_RU = {
    "AAPL": "Apple Inc. проектирует, производит и продает смартфоны (iPhone), персональные компьютеры (Mac), планшеты (iPad), носимые устройства и аксессуары, а также предоставляет широкий спектр сопутствующих цифровых услуг (App Store, Apple Music, iCloud, Apple Pay).",
    "MSFT": "Microsoft Corporation разрабатывает и лицензирует программное обеспечение, облачные платформы (Microsoft Azure), серверные решения, линейку устройств Surface, игровую экосистему Xbox, а также пакет приложений для бизнеса Microsoft 365.",
    "NVDA": "NVIDIA Corporation — мировой лидер в области разработки графических процессоров (GPU) и архитектур ускоренных вычислений для искусственного интеллекта, центров обработки данных, игр, автономных систем и профессиональной визуализации.",
    "GOOGL": "Alphabet Inc. — холдинговая компания, управляющая поисковой системой Google, видеоплатформой YouTube, облачной платформой Google Cloud, Android, а также научно-технологическими подразделениями Other Bets.",
    "AMZN": "Amazon.com Inc. — крупнейшая глобальная платформа электронной коммерции, провайдер облачной инфраструктуры Amazon Web Services (AWS), поставщик цифровой рекламы, стримингового контента и логистических услуг.",
    "META": "Meta Platforms Inc. разрабатывает технологические платформы и мобильные приложения для социального взаимодействия (Facebook, Instagram, WhatsApp), а также оборудование виртуальной и дополненной реальности (Reality Labs / Meta Quest).",
    "TSLA": "Tesla Inc. проектирует, разрабатывает, производит и продает электромобили, системы хранения энергии (Megapack, Powerwall), солнечные панели и программное обеспечение автономного вождения (FSD).",
    "SPY": "SPDR S&P 500 ETF Trust — биржевой инвестиционный фонд, отслеживающий динамику ключевого индекса фондового рынка США S&P 500.",
    "QQQ": "Invesco QQQ Trust — биржевой фонд, отслеживающий индекс Nasdaq-100, включающий 100 крупнейших нефинансовых инновационных компаний.",
    "SOXX": "iShares Semiconductor ETF — биржевой фонд, отслеживающий динамику ведущих американских компаний сектора полупроводников.",
    "IGV": "iShares Expanded Tech-Software Sector ETF — биржевой фонд, ориентированный на ведущих поставщиков корпоративного и потребительского программного обеспечения.",
    "DRAM": "DRAM ETF / Micron Technology Ecosystem — эталонный индикатор динамики сегмента памяти и аппаратной полупроводниковой инфраструктуры."
}


def translate_to_russian_concise(ticker: str, full_desc: str) -> str:
    """
    Takes a company description, extracts the 1-2 core sentences describing
    what the company actually does, and translates them to clean Russian.
    """
    if not full_desc or not full_desc.strip():
        return DEFAULT_DESCRIPTIONS_RU.get(ticker, f"Компания {ticker} торгуется на фондовом рынке США.")

    parts = full_desc.strip().split(". ")
    concise = ". ".join(parts[:2]).strip()
    if not concise.endswith("."):
        concise += "."

    try:
        from deep_translator import GoogleTranslator
        translated = GoogleTranslator(source="en", target="ru").translate(concise)
        return translated
    except Exception as e:
        print(f"[FMPService] Translation error for {ticker}: {e}")
        return concise


class FMPService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or FMP_API_KEY
        self.base_url = "https://financialmodelingprep.com"

    def get_company_profile(self, ticker: str) -> Dict[str, Any]:
        """
        Fetches detailed company profile from FMP /stable/profile with concise Russian translation.
        """
        ticker = str(ticker).strip().upper()
        url = f"{self.base_url}/stable/profile"
        params = {"symbol": ticker, "apikey": self.api_key}

        try:
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code == 200 and resp.json():
                data = resp.json()[0]
                desc_en = data.get("description", "").strip()
                desc_ru = translate_to_russian_concise(ticker, desc_en)

                return {
                    "symbol": ticker,
                    "companyName": data.get("companyName", ticker),
                    "price": data.get("price"),
                    "marketCap": data.get("marketCap"),
                    "beta": data.get("beta"),
                    "sector": data.get("sector", "Technology"),
                    "industry": data.get("industry", "Consumer Electronics"),
                    "ceo": data.get("ceo", ""),
                    "website": data.get("website", ""),
                    "image": data.get("image", ""),
                    "description": desc_en,
                    "description_ru": desc_ru,
                    "currency": data.get("currency", "USD"),
                    "exchange": data.get("exchange", "NASDAQ"),
                    "ipoDate": data.get("ipoDate", ""),
                    "lastDividend": data.get("lastDividend", 0.0)
                }
            else:
                print(f"[FMPService] Error profile for {ticker}: {resp.status_code} - {resp.text[:150]}")
        except Exception as e:
            print(f"[FMPService] Exception profile for {ticker}: {e}")

        # Fallback profile using yfinance (English description, reliable & free)
        try:
            import yfinance as yf
            t = yf.Ticker(ticker)
            info = t.info or {}
            desc_en = info.get("longBusinessSummary") or info.get("description") or ""
            desc_ru = translate_to_russian_concise(ticker, desc_en)
            return {
                "symbol": ticker,
                "companyName": info.get("longName") or info.get("shortName") or ticker,
                "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "marketCap": info.get("marketCap"),
                "beta": info.get("beta") or 1.0,
                "sector": info.get("sector", "Technology"),
                "industry": info.get("industry", "Market Asset"),
                "ceo": "",
                "website": info.get("website", ""),
                "image": "",
                "description": desc_en,
                "description_ru": desc_ru,
                "currency": info.get("currency", "USD"),
                "exchange": info.get("exchange", "US"),
                "ipoDate": "",
                "lastDividend": 0.0
            }
        except Exception as e:
            print(f"[FMPService] yfinance fallback profile error for {ticker}: {e}")

        return {
            "symbol": ticker,
            "companyName": ticker,
            "price": None,
            "marketCap": None,
            "beta": 1.0,
            "sector": "Equity",
            "industry": "Market Asset",
            "ceo": "",
            "website": "",
            "image": "",
            "description": "",
            "description_ru": "",
            "currency": "USD",
            "exchange": "US",
            "ipoDate": "",
            "lastDividend": 0.0
        }

    def get_stock_peers(self, ticker: str) -> List[Dict[str, Any]]:
        """
        Fetches direct competitors from FMP /stable/stock-peers.
        """
        ticker = str(ticker).strip().upper()
        url = f"{self.base_url}/stable/stock-peers"
        params = {"symbol": ticker, "apikey": self.api_key}

        try:
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code == 200 and resp.json():
                peers_raw = resp.json()
                peers = []
                for p in peers_raw:
                    sym = p.get("symbol", "").strip().upper()
                    if sym and sym != ticker:
                        peers.append({
                            "symbol": sym,
                            "companyName": p.get("companyName", sym),
                            "price": p.get("price"),
                            "mktCap": p.get("mktCap")
                        })
                return peers
        except Exception as e:
            print(f"[FMPService] Exception stock-peers for {ticker}: {e}")

        # Default fallback peers for common tech tickers
        fallback_map = {
            "AAPL": [{"symbol": "MSFT", "companyName": "Microsoft Corp"}, {"symbol": "GOOGL", "companyName": "Alphabet Inc"}, {"symbol": "META", "companyName": "Meta Platforms"}, {"symbol": "AMZN", "companyName": "Amazon.com"}],
            "NVDA": [{"symbol": "AMD", "companyName": "Advanced Micro Devices"}, {"symbol": "AVGO", "companyName": "Broadcom"}, {"symbol": "QCOM", "companyName": "Qualcomm"}, {"symbol": "INTC", "companyName": "Intel Corp"}],
            "TSLA": [{"symbol": "RIVN", "companyName": "Rivian"}, {"symbol": "LCID", "companyName": "Lucid Group"}, {"symbol": "F", "companyName": "Ford Motor"}, {"symbol": "GM", "companyName": "General Motors"}]
        }
        return fallback_map.get(ticker, [])

    def get_earnings_history(self, ticker: str, limit: int = 16) -> List[Dict[str, Any]]:
        """
        Fetches historical earnings reports with EPS & Revenue actual vs estimated.
        """
        ticker = str(ticker).strip().upper()
        url = f"{self.base_url}/stable/earnings"
        params = {"symbol": ticker, "apikey": self.api_key}

        try:
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code == 200 and resp.json():
                earnings_raw = resp.json()
                reports = []

                for item in earnings_raw[:limit]:
                    date_str = item.get("date")
                    eps_act = item.get("epsActual")
                    eps_est = item.get("epsEstimated")
                    rev_act = item.get("revenueActual")
                    rev_est = item.get("revenueEstimated")

                    # Calculate surprise % if both actual and estimated EPS exist
                    surprise_pct = None
                    if eps_act is not None and eps_est is not None:
                        try:
                            eps_act = float(eps_act)
                            eps_est = float(eps_est)
                            if abs(eps_est) > 1e-6:
                                surprise_pct = round(((eps_act - eps_est) / abs(eps_est)) * 100.0, 2)
                            else:
                                surprise_pct = round((eps_act - eps_est) * 100.0, 2)
                        except (ValueError, TypeError):
                            surprise_pct = None

                    reports.append({
                        "ticker": ticker,
                        "date": date_str,
                        "eps_actual": float(eps_act) if eps_act is not None else None,
                        "eps_estimate": float(eps_est) if eps_est is not None else None,
                        "eps_surprise_pct": surprise_pct,
                        "revenue_actual": float(rev_act) if rev_act is not None else None,
                        "revenue_estimate": float(rev_est) if rev_est is not None else None,
                        "time": item.get("time", "amc")
                    })

                return reports
        except Exception as e:
            print(f"[FMPService] Exception earnings for {ticker}: {e}")

        return []

    def get_dividends_history(self, ticker: str, limit: int = 24) -> List[Dict[str, Any]]:
        """
        Fetches dividend payment history from FMP /stable/dividends.
        """
        ticker = str(ticker).strip().upper()
        url = f"{self.base_url}/stable/dividends"
        params = {"symbol": ticker, "apikey": self.api_key}

        try:
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code == 200 and resp.json():
                divs_raw = resp.json()
                dividends = []

                for item in divs_raw[:limit]:
                    ex_date = item.get("date")
                    amount = item.get("dividend") or item.get("adjDividend")
                    if not ex_date or amount is None:
                        continue

                    dividends.append({
                        "ticker": ticker,
                        "ex_date": ex_date,
                        "amount": float(amount),
                        "pay_date": item.get("paymentDate"),
                        "record_date": item.get("recordDate"),
                        "declaration_date": item.get("declarationDate"),
                        "yield": float(item.get("yield")) if item.get("yield") is not None else None,
                        "frequency": item.get("frequency", "Quarterly")
                    })

                return dividends
        except Exception as e:
            print(f"[FMPService] Exception dividends for {ticker}: {e}")

        return []


# Singleton instance
fmp_client = FMPService()
