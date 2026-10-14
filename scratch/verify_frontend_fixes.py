import re

def verify():
    # 1. Verify static/index.html and templates/index.html
    for path in ['static/index.html', 'templates/index.html']:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Check Photo 2: "Разделители" should NOT be in the modal text
        assert 'Разделители и дубликаты обрабатываются автоматически' not in content, f"{path}: separators text found in header"
        assert 'Разделители: пробел' not in content, f"{path}: separators text found in textarea"

        # Check Photo 3: Primary Screener
        assert '<h2>PRIMARY SCREENER</h2>' in content, f"{path}: PRIMARY SCREENER h2 not found"
        assert 'Correlation Screener & Excel Exporter' not in content, f"{path}: old screener title still found"

        # Check Photo 4: Matrix Correlation Pearson
        assert '<h2>Matrix Correlation Pearson</h2>' in content, f"{path}: Matrix Correlation Pearson h2 not found"
        assert '<option value="none" selected>Без фильтров (все активы)</option>' in content, f"{path}: none option not found in matrixOperator"

        # Check Photo 5: Matrix Beta (formul Slope)
        assert '<h2>Matrix Beta (formul Slope)</h2>' in content, f"{path}: Matrix Beta (formul Slope) h2 not found"

    print("HTML checks passed successfully!")

    # 2. Verify static/app.js
    with open('static/app.js', 'r', encoding='utf-8') as f:
        js = f.read()

    # Floating scrollbar
    assert 'initFloatingScrollbar' in js, "initFloatingScrollbar not in app.js"
    assert 'floatingHScrollbar' in js, "floatingHScrollbar not in app.js"

    # In-place updates for #corrTable inputs
    assert 'updateCorrTableRow' in js, "updateCorrTableRow not in app.js"
    assert 'updateAllCorrTableRowsForTargetMove' in js, "updateAllCorrTableRowsForTargetMove not in app.js"

    # Matrix Correlation Pearson and presets
    assert 'matrixOperator' in js, "matrixOperator not referenced in app.js"
    assert 'applyMatrixFilterBtn' in js, "applyMatrixFilterBtn not referenced in app.js"
    assert 'matrix-preset' in js, "matrix-preset not referenced in app.js"

    # Beta Matrix NxN and old platform gradient
    assert 'renderBetaMatrix' in js, "renderBetaMatrix not in app.js"
    assert 'rgba(16, 185, 129, 0.45)' in js, "Old platform emerald green not in getBetaBgColor"
    assert 'rgba(59, 130, 246, 0.25)' in js, "Old platform blue not in getBetaBgColor"
    assert 'rgba(245, 158, 11, 0.22)' in js, "Old platform amber not in getBetaBgColor"

    print("JS checks passed successfully!")

    # 3. Verify static/style.css
    with open('static/style.css', 'r', encoding='utf-8') as f:
        css = f.read()

    assert '.floating-scrollbar-container' in css, "floating scrollbar css missing"
    assert '.preset-pill' in css, "preset-pill css missing"
    print("CSS checks passed successfully!")

if __name__ == '__main__':
    verify()
