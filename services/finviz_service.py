import io
import csv
import datetime
from typing import Dict, List, Any, Optional
import requests
from config import FINVIZ_CALENDAR_URL


class FinvizService:
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or FINVIZ_CALENDAR_URL

    def export_calendar_csv(
        self,
        calendar_type: str = "earnings",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Exports calendars (Earnings, Economic, Dividends) in CSV format from Finviz Elite.
        calendar_type: 'earnings', 'economic', 'dividends'
        """
        if not start_date:
            start_date = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
        if not end_date:
            end_date = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()

        # Finviz export endpoint structure
        url = f"{self.base_url.rstrip('/')}/{calendar_type}.ashx"
        params = {
            "v": "1",
            "start": start_date,
            "end": end_date
        }

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }

        try:
            resp = requests.get(url, params=params, headers=headers, timeout=15)
            if resp.status_code == 200 and resp.text:
                reader = csv.DictReader(io.StringIO(resp.text))
                items = []
                for row in reader:
                    items.append(dict(row))
                return items
            else:
                print(f"[FinvizService] Export status {resp.status_code} for {calendar_type}")
        except Exception as e:
            print(f"[FinvizService] Exception exporting {calendar_type}: {e}")

        return []


# Singleton instance
finviz_client = FinvizService()
