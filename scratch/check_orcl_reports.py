import sys
sys.path.insert(0, '.')
from database import get_postgres_connection, check_postgres_health
from psycopg.rows import dict_row

print("Checking postgres health...")
if not check_postgres_health():
    print("Postgres is not healthy!")
    sys.exit(1)

with get_postgres_connection() as conn:
    with conn.cursor(row_factory=dict_row) as cur:
        # Check all tables in public schema
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public';
        """)
        tables = [t['table_name'] for t in cur.fetchall()]
        print("Tables in DB:", tables)

        # Check columns of reports
        if 'reports' in tables:
            cur.execute("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'reports';
            """)
            print("Columns in reports:", [c['column_name'] for c in cur.fetchall()])

            cur.execute("""
                SELECT r.* 
                FROM reports r
                JOIN ticker t ON t.id = r.id_ticker
                WHERE UPPER(t.ticker) = 'ORCL'
                ORDER BY r.date DESC
                LIMIT 5;
            """)
            rows = cur.fetchall()
            print("ORCL reports count in reports table:", len(rows))
            for row in rows:
                print(row)

        # Are there any other earnings / reports tables?
        # e.g. earnings, earnings_calendar, etc.
        for t_name in tables:
            if 'earn' in t_name.lower() or 'report' in t_name.lower() or 'stat' in t_name.lower():
                print(f"Table {t_name}:")
                cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{t_name}';")
                print("  Columns:", [c['column_name'] for c in cur.fetchall()])
