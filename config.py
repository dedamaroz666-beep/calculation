import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR.parent / "GapAnalysis" / ".env")

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL")
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "128.140.40.78"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "dbname": os.getenv("DB_NAME", "helion_db"),
    "user": os.getenv("DB_USER", "user3"),
    "password": os.getenv("DB_PASSWORD", "Rc74UgeGHZZwPUaykvvv"),
}

# API Keys
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "skhBi8KZAOHJzehsIyGwboV7fdQZc2pK")
FMP_API_KEY = os.getenv("FMP_API_KEY", "7zLwOHU7j6Cx437gkZZuskJzGEWoXKhk")
FINVIZ_CALENDAR_URL = os.getenv("FINVIZ_CALENDAR_URL", "https://elite.finviz.com/export/calendar/")

# Cache & Paths
CACHE_DIR = BASE_DIR / "cache"
CACHE_DB_PATH = CACHE_DIR / "analytics_cache.db"
os.makedirs(CACHE_DIR, exist_ok=True)

# Default Benchmarks
BENCHMARKS = ["SPY", "QQQ", "SOXX", "IGV", "DRAM"]

# Timezone
MARKET_TIMEZONE = "America/New_York"