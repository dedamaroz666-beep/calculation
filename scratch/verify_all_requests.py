import urllib.request
import json
import re
import sys

def test_frontend_and_api():
    base_url = "http://127.0.0.1:8000"
    errors = []

    # 1. Test GET /
    print("--- Testing GET / ---")
    try:
        req = urllib.request.urlopen(f"{base_url}/")
        html = req.read().decode("utf-8")
    except Exception as e:
        print(f"FAILED to fetch {base_url}/: {e}")
        return False

    # Check Photo 1: Remove emojis
    if "⚡ Custom move" in html:
        errors.append("Photo 1 Failed: '⚡ Custom move' emoji still present in HTML")
    elif "Custom move" not in html:
        errors.append("Photo 1 Failed: 'Custom move' button text missing")
    else:
        print("Photo 1: 'Custom move' button has NO emoji [OK]")

    if "🗑 Очистить всё" in html:
        errors.append("Photo 1 Failed: '🗑 Очистить всё' emoji still present in HTML")
    elif "Очистить всё" not in html:
        errors.append("Photo 1 Failed: 'Очистить всё' button text missing")
    else:
        print("Photo 1: 'Очистить всё' button has NO emoji [OK]")

    # Check Photo 2: CorrTable
    if "<th>Дневная вол-ть</th>" in html or "Дневная вол-ть" in html:
        # Check if it's in corrTable thead
        corr_table_match = re.search(r'<table class="data-table" id="corrTable">[\s\S]*?</table>', html)
        if corr_table_match and "вол-ть" in corr_table_match.group(0):
            errors.append("Photo 2 Failed: 'Дневная вол-ть' column still present in corrTable thead")
        else:
            print("Photo 2: 'Дневная вол-ть' removed from corrTable [OK]")
    else:
        print("Photo 2: 'Дневная вол-ть' column removed [OK]")

    # Check Photo 2: Data-sort attributes on corrTable
    required_sorts = ["symbol", "type", "correlation", "beta", "peer_move", "expected_move", "target_move", "diff", "normalized", "observations"]
    for s in required_sorts:
        if f'data-sort="{s}"' not in html:
            errors.append(f"Photo 2 Failed: corrTable missing data-sort='{s}'")
    print(f"Photo 2: All {len(required_sorts)} corrTable sortable headers present [OK]")

    # Check Photo 4: Bulk Modal
    if "tab-db" in html or "2. Выбор из базы данных" in html:
        errors.append("Photo 4 Failed: '2. Выбор из базы данных' tab still in bulkTickerModal")
    else:
        print("Photo 4: '2. Выбор из базы данных' tab removed [OK]")

    if "replaceBulkTickers" in html or "Заменить" in html:
        # Check if it's in bulk modal
        bulk_modal_match = re.search(r'<div id="bulkTickerModal"[\s\S]*?</div>\s*</div>\s*</div>', html)
        if bulk_modal_match and "Заменить" in bulk_modal_match.group(0):
            errors.append("Photo 4 Failed: 'Заменить' button still present in bulkTickerModal")
        else:
            print("Photo 4: 'Заменить' button removed from bulkTickerModal [OK]")
    else:
        print("Photo 4: 'Заменить' button removed [OK]")

    # Check Photo 5: analysis-info cards
    results_match = re.search(r'<section id="results"[\s\S]*?</section>', html)
    if results_match:
        res_content = results_match.group(0)
        if '<div class="analysis-info">' in res_content or 'id="resultBenchmark"' in res_content:
            errors.append("Photo 5 Failed: analysis-info summary cards still present in results section")
        else:
            print("Photo 5: summary cards removed from results section [OK]")
    else:
        errors.append("Photo 5 Failed: results section not found in HTML")

    # Check Requirement 7: (без фильтров) option in correlationOperator
    if '<option value="none">Без фильтров (все активы)</option>' not in html:
        errors.append("Requirement 7 Failed: '<option value=\"none\">Без фильтров (все активы)</option>' not found in HTML")
    else:
        print("Requirement 7: 'Без фильтров (все активы)' option present [OK]")

    # 2. Test static/style.css for Photo 3 (Theme Selector spacing) and Photo 2 (Sorting styles)
    print("\n--- Testing static/style.css ---")
    try:
        req = urllib.request.urlopen(f"{base_url}/static/style.css")
        css = req.read().decode("utf-8")
    except Exception as e:
        print(f"FAILED to fetch static/style.css: {e}")
        return False

    if "padding-left: 45px;" in css or "margin-right: 36px;" in css:
        print("Photo 3: Header theme selector shifted right away from tabs in style.css [OK]")
    else:
        errors.append("Photo 3 Failed: theme selector shift styles not found in style.css")

    if "#corrTable th[data-sort]" in css:
        print("Photo 2: #corrTable th[data-sort] styles present in style.css [OK]")
    else:
        errors.append("Photo 2 Failed: #corrTable th[data-sort] styles missing in style.css")

    # 3. Test POST /api/calculate-groups for Expected Move
    print("\n--- Testing POST /api/calculate-groups (Expected Move) ---")
    payload = {
        "groups": {"Group 1": ["AAPL", "MSFT", "NVDA"]},
        "benchmark": "SPY",
        "benchmark_move": 1.5,
        "period": "1y",
        "asset_moves": {"AAPL": 2.0, "MSFT": -1.0}
    }
    try:
        req = urllib.request.Request(
            f"{base_url}/api/calculate-groups",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = urllib.request.urlopen(req)
        data = json.loads(res.read().decode("utf-8"))
        
        tickers = data.get("tickers", [])
        exp_range = data.get("expected_range", {})
        print(f"Calculated tickers: {tickers}")

        for t in tickers:
            item = exp_range.get(t, {})
            beta = item.get("beta")
            exp_move = item.get("expected_move")
            act_move = item.get("actual_move")
            diff = item.get("difference")
            print(f"Ticker {t}: Beta={beta}, Expected Move={exp_move}, Actual Move={act_move}, Diff={diff}")
            
            if beta is not None:
                if exp_move is None:
                    errors.append(f"Expected Move Failed for {t}: expected_move is None!")
                else:
                    expected_calculated = beta * 1.5
                    if abs(exp_move - expected_calculated) > 0.01:
                        errors.append(f"Expected Move Mismatch for {t}: got {exp_move}, expected {expected_calculated}")
                    else:
                        print(f"  -> {t}: Expected move correctly computed as Beta({beta}) * BM(1.5) = {exp_move:.2f}% [OK]")

    except Exception as e:
        errors.append(f"API calculate-groups Failed: {e}")

    # 4. Test GET /api/ticker/AAPL/correlations?period=earnings_8q
    print("\n--- Testing GET /api/ticker/AAPL/correlations?period=earnings_8q ---")
    try:
        req = urllib.request.urlopen(f"{base_url}/api/ticker/AAPL/correlations?period=earnings_8q")
        corr_data = json.loads(req.read().decode("utf-8"))
        ticker_corrs = corr_data.get("ticker_correlations", [])
        print(f"Loaded {len(ticker_corrs)} correlation peers/benchmarks for AAPL (earnings_8q):")
        for item in ticker_corrs[:4]:
            print(f"  {item.get('symbol')} ({item.get('type')}): corr={item.get('correlation')}, beta={item.get('beta')}, obs={item.get('observations')}")
        if len(ticker_corrs) == 0:
            errors.append("Correlations list is empty!")
        else:
            print("Correlations API returns data [OK]")
    except Exception as e:
        errors.append(f"Correlations API Failed: {e}")

    # Summary
    print("\n=================================")
    if errors:
        print(f"FAILED with {len(errors)} error(s):")
        for err in errors:
            print(f"  - {err}")
        return False
    else:
        print("ALL 7 USER REQUIREMENTS VERIFIED SUCCESSFULLY!")
        return True

if __name__ == "__main__":
    success = test_frontend_and_api()
    sys.exit(0 if success else 1)
