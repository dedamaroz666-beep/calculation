import filecmp
import asyncio
from unittest.mock import AsyncMock, MagicMock
from app_fastapi import api_calculate_groups

def test_all():
    print("--- 1. Testing HTML files ---")
    assert filecmp.cmp("static/index.html", "templates/index.html"), "static and templates index.html are not identical!"
    with open("static/index.html", "r", encoding="utf-8") as f:
        html = f.read()
    assert 'id="warningRemovePartialBtn"' in html, "warningRemovePartialBtn missing in HTML"
    assert 'id="warningText"' in html, "warningText missing in HTML"
    assert 'id="screenerRemovePartialBtn"' in html, "screenerRemovePartialBtn missing in HTML"
    print("HTML checks OK!")

    print("--- 2. Testing CSS ---")
    with open("static/style.css", "r", encoding="utf-8") as f:
        css = f.read()
    assert ".warning-remove-btn" in css, ".warning-remove-btn missing in CSS"
    assert "#screenerRemovePartialBtn" in css, "#screenerRemovePartialBtn missing in CSS"
    print("CSS checks OK!")

    print("--- 3. Testing JS ---")
    with open("static/app.js", "r", encoding="utf-8") as f:
        js = f.read()
    assert "function removePartialTickers()" in js, "removePartialTickers missing in JS"
    assert "warningRemovePartialBtn" in js, "warningRemovePartialBtn missing in JS"
    assert "screenerRemovePartialBtn" in js, "screenerRemovePartialBtn missing in JS"
    print("JS checks OK!")

    print("--- 4. Testing FastAPI /api/calculate-groups endpoint with short history tickers ---")
    payload = {
        "groups": {
            "Group 1": ["BSP", "SECZ", "AAPL", "MSFT"]
        },
        "benchmark": "ORCL",
        "benchmark_move": 1.0,
        "period": "3m",
        "asset_moves": {}
    }
    mock_request = MagicMock()
    mock_request.json = AsyncMock(return_value=payload)

    data = asyncio.run(api_calculate_groups(mock_request))
    assert "BSP" in data.get("partial_tickers", {}), "BSP should be identified as partial ticker"
    assert "SECZ" in data.get("partial_tickers", {}), "SECZ should be identified as partial ticker"
    assert "BSP" in data.get("warning", ""), "Warning should mention BSP"
    print("Identified partial tickers:", list(data.get("partial_tickers", {}).keys()))
    print("Warning message:", data.get("warning"))

    print("--- 5. Testing recalculation after removing partial tickers ---")
    cleaned_tickers = [t for t in payload["groups"]["Group 1"] if t not in data["partial_tickers"]]
    payload["groups"]["Group 1"] = cleaned_tickers
    mock_request.json = AsyncMock(return_value=payload)

    data2 = asyncio.run(api_calculate_groups(mock_request))
    assert len(data2.get("partial_tickers", {})) == 0, "No partial tickers should remain"
    assert "BSP" not in data2.get("tickers", []), "BSP should not be in tickers"
    assert "SECZ" not in data2.get("tickers", []), "SECZ should not be in tickers"
    assert data2.get("warning") is None or "BSP" not in data2.get("warning", ""), "Warning should no longer mention BSP"
    print("Recalculation with remaining tickers OK! Tickers:", data2.get("tickers"))

    print("\nALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_all()
