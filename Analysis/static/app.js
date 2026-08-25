// ============================================================
// STOCK ANALYTICS - APP.JS
// High-Speed Multi-Asset Correlation & Beta Screener
// ============================================================

// State: Universe & Asset Groups
let groupCounter = 0;
const groupsState = new Map(); // groupId -> { id, name, tickers: Set<string>, moves: Map<string, number>, mode: 'chips'|'table' }
let availableDatabaseTickers = [];
let bulkDbSelectedTickers = new Set();

// Analysis Results State (Universe Screener)
let latestAnalysisData = null;
let configuredBenchmarks = [];
let activeBenchmarkView = "compare"; // "compare" or specific benchmark symbol (e.g. "SPY", "QQQ")
let filterBenchmarkTarget = "all";   // "all" or specific benchmark symbol
let latestBenchmarkRows = [];
let filteredBenchmarkRows = [];
let currentSortColumn = "correlation";
let currentSortDirection = "desc";
let currentPage = 1;
let pageSize = 50;

// State: Dedicated Custom Move & Relative Performance Tracker
const customTrackerItems = new Map(); // ticker -> { ticker: string, actual_move: number|null }
let trackerCalculatedRows = [];
let trackerFilteredRows = [];
let trackerSortColumn = "correlation";
let trackerSortDirection = "desc";
let trackerCurrentPage = 1;
let trackerPageSize = 50;

// ============================================================
// FORMATTERS & HELPERS
// ============================================================

function normalizeTicker(value) {
    return String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9\.\-\_\^]/g, "")
        .trim();
}

function parseTickerText(text) {
    if (!text) return [];

    const tokens = String(text)
        .replace(/\uFEFF/g, "")
        .replace(/[\r\n\t,;|/]+/g, " ")
        .split(/\s+/)
        .map(normalizeTicker)
        .filter(Boolean);

    const ignoredHeaders = new Set(["TICKER", "TICKERS", "SYMBOL", "SYMBOLS", "STOCK", "STOCKS", "NAME", "HEADER"]);
    const unique = [];

    tokens.forEach(ticker => {
        if (ignoredHeaders.has(ticker)) return;
        if (ticker.length > 0 && ticker.length <= 12 && !unique.includes(ticker)) {
            unique.push(ticker);
        }
    });

    return unique;
}

function parseTickerMovePairs(text) {
    if (!text) return [];
    const lines = String(text).replace(/\uFEFF/g, "").split(/[\r\n;]+/);
    const results = [];
    const seen = new Set();

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        // Split tokens by comma or whitespace or colon
        const tokens = trimmed.split(/[\s,:]+/).filter(Boolean);
        if (!tokens.length) return;

        const rawTicker = normalizeTicker(tokens[0]);
        if (!rawTicker || rawTicker.length > 12) return;

        let moveVal = null;
        if (tokens.length >= 2) {
            const cleanedNum = tokens[1].replace(/[%+]/g, "").trim();
            const parsedNum = parseFloat(cleanedNum);
            if (Number.isFinite(parsedNum)) {
                moveVal = parsedNum / 100;
            }
        }

        if (!seen.has(rawTicker)) {
            seen.add(rawTicker);
            results.push({ ticker: rawTicker, actual_move: moveVal });
        }
    });

    return results;
}

function formatPercent(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }
    const num = Number(value) * 100;
    const sign = num > 0 ? "+" : "";
    return `${sign}${num.toFixed(2)}%`;
}

function formatNumber(value, decimals = 3) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }
    return Number(value).toFixed(decimals);
}

function formatSignedNumber(value, decimals = 2) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }
    const num = Number(value);
    const sign = num > 0 ? "+" : "";
    return `${sign}${num.toFixed(decimals)}`;
}

// Color map for Pearson Correlation (-1.0 to +1.0)
function getCorrelationColor(value) {
    if (!Number.isFinite(value)) return "rgba(100, 116, 139, 0.2)";
    if (value >= 0.70) return "rgba(34, 197, 94, 0.35)";   // strong green
    if (value >= 0.50) return "rgba(34, 197, 94, 0.22)";   // green
    if (value >= 0.20) return "rgba(34, 197, 94, 0.12)";   // light green
    if (value > -0.20) return "rgba(100, 116, 139, 0.15)"; // neutral
    if (value > -0.50) return "rgba(239, 68, 68, 0.18)";   // light red
    return "rgba(239, 68, 68, 0.35)";                      // strong red
}

// Color map for Beta Sensitivity (<= 0 to >= 2.5)
function getBetaColor(value) {
    if (!Number.isFinite(value)) return "rgba(100, 116, 139, 0.2)";
    if (value <= 0) return "rgba(239, 68, 68, 0.35)";       // Red (inverse / negative beta)
    if (value < 0.50) return "rgba(245, 158, 11, 0.22)";    // Amber (very low beta)
    if (value < 0.90) return "rgba(100, 116, 139, 0.20)";   // Slate (low beta)
    if (value <= 1.10) return "rgba(59, 130, 246, 0.25)";   // Blue (neutral benchmark beta ~1.0)
    if (value <= 1.80) return "rgba(34, 197, 94, 0.22)";    // Soft green (moderate beta)
    if (value <= 2.50) return "rgba(34, 197, 94, 0.35)";    // Vibrant green (high beta)
    return "rgba(16, 185, 129, 0.45)";                      // Strong emerald green (super high beta)
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderTickerCellHtml(item, context = "tracker") {
    const isPartial = Boolean(item.is_partial_history);
    const ticker = escapeHtml(item.ticker);

    if (isPartial) {
        const periodRu = escapeHtml(item.history_period_ru || "короткий период");
        const periodSelected = escapeHtml(item.selected_period_label || item.period || "выбранный период");
        const start = escapeHtml(item.history_start || "—");
        const end = escapeHtml(item.history_end || "—");
        const obs = item.history_observations || item.observations || "—";

        return `
            <td class="asset-name-cell">
                <div class="ticker-badge partial-history tooltip-ticker-trigger"
                     data-ticker="${ticker}"
                     data-context="${context}"
                     data-partial="true"
                     data-period-ru="${periodRu}"
                     data-period-selected="${periodSelected}"
                     data-start="${start}"
                     data-end="${end}"
                     data-obs="${obs}"
                     title=""
                >
                    <span class="warning-icon" aria-hidden="true">⚠️</span>
                    <strong class="ticker-name">${ticker}</strong>
                    <span class="partial-tag">${periodRu}</span>
                </div>
            </td>
        `;
    }

    return `<td class="asset-name-cell"><strong class="ticker-name">${ticker}</strong></td>`;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    initializeTheme();
    initializeEventListeners();
    initializeCustomTracker();
    initializeTooltips();
    loadDatabaseTickers();

    // Create a clean, empty Group 1 on first visit (NO pre-filled stocks)
    const defaultGroupId = createGroup("Group 1");
    renderGroupBody(defaultGroupId);
});

function initializeEventListeners() {
    // Theme switchers
    document.querySelectorAll(".theme-switch-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const theme = btn.dataset.theme;
            if (theme) {
                setTheme(theme);
            }
        });
    });
    document.getElementById("themeToggle")?.addEventListener("click", cycleTheme);

    // Group buttons
    document.getElementById("addGroupButton")?.addEventListener("click", () => {
        const id = createGroup();
        renderGroupBody(id);
    });

    document.getElementById("bulkTickersButton")?.addEventListener("click", openBulkTickerModal);
    document.getElementById("calculateButton")?.addEventListener("click", calculateGroups);

    // Universe Screener controls
    document.getElementById("applyCorrelationFilter")?.addEventListener("click", applyScreenerFilters);
    document.getElementById("correlationOperator")?.addEventListener("change", handleOperatorChange);
    document.getElementById("correlationThreshold")?.addEventListener("input", debounce(applyScreenerFilters, 250));
    document.getElementById("correlationThresholdMax")?.addEventListener("input", debounce(applyScreenerFilters, 250));
    document.getElementById("screenerSearch")?.addEventListener("input", debounce(applyScreenerFilters, 150));
    document.getElementById("pageSizeSelect")?.addEventListener("change", handlePageSizeChange);

    // Filter target benchmark dropdown
    document.getElementById("filterBenchmarkSelect")?.addEventListener("change", (e) => {
        filterBenchmarkTarget = e.target.value;
        applyScreenerFilters();
    });

    // Preset pills (Universe Screener)
    document.querySelectorAll(".preset-pill:not(.tracker-preset)").forEach(pill => {
        pill.addEventListener("click", () => handlePresetClick(pill));
    });

    // Pagination (Universe Screener)
    document.getElementById("prevPageBtn")?.addEventListener("click", () => changePage(currentPage - 1));
    document.getElementById("nextPageBtn")?.addEventListener("click", () => changePage(currentPage + 1));

    // Export & Action buttons (Universe Screener)
    document.getElementById("screenerRemovePartialBtn")?.addEventListener("click", removePartialScreenerTickers);
    document.getElementById("exportFilteredButton")?.addEventListener("click", () => exportExcel(false));
    document.getElementById("exportAllButton")?.addEventListener("click", () => exportExcel(true));
    // Matrix filter event listeners (Correlation Matrix)
    document.getElementById("applyMatrixCorrFilter")?.addEventListener("click", () => renderCorrelationMatrix());
    document.getElementById("matrixCorrelationOperator")?.addEventListener("change", handleMatrixCorrOperatorChange);
    document.getElementById("matrixCorrelationThreshold")?.addEventListener("input", debounce(() => renderCorrelationMatrix(), 200));
    document.getElementById("matrixCorrelationThresholdMax")?.addEventListener("input", debounce(() => renderCorrelationMatrix(), 200));
    document.getElementById("matrixCorrFilterMode")?.addEventListener("change", () => renderCorrelationMatrix());
    document.getElementById("matrixSearchInput")?.addEventListener("input", debounce(() => renderCorrelationMatrix(), 150));

    document.querySelectorAll(".matrix-corr-preset").forEach(pill => {
        pill.addEventListener("click", () => handleMatrixCorrPresetClick(pill));
    });

    // Matrix filter event listeners (Beta Matrix)
    document.getElementById("applyMatrixBetaFilter")?.addEventListener("click", () => renderBetaMatrix());
    document.getElementById("matrixBetaOperator")?.addEventListener("change", handleMatrixBetaOperatorChange);
    document.getElementById("matrixBetaThreshold")?.addEventListener("input", debounce(() => renderBetaMatrix(), 200));
    document.getElementById("matrixBetaThresholdMax")?.addEventListener("input", debounce(() => renderBetaMatrix(), 200));
    document.getElementById("matrixBetaFilterMode")?.addEventListener("change", () => renderBetaMatrix());
    document.getElementById("betaMatrixSearchInput")?.addEventListener("input", debounce(() => renderBetaMatrix(), 150));

    document.querySelectorAll(".matrix-beta-preset").forEach(pill => {
        pill.addEventListener("click", () => handleMatrixBetaPresetClick(pill));
    });

    // Bulk modal listeners
    initializeBulkModal();
}

// ============================================================
// DEDICATED CUSTOM MOVE & RELATIVE PERFORMANCE TRACKER LOGIC
// ============================================================

function initializeCustomTracker() {
    // Inputs & Add Button
    const addBtn = document.getElementById("trackerAddAssetBtn");
    const tickerInput = document.getElementById("trackerNewTicker");
    const moveInput = document.getElementById("trackerNewMove");
    const refInput = document.getElementById("trackerReference");
    const refMoveInput = document.getElementById("trackerReferenceMove");
    const periodSelect = document.getElementById("trackerPeriod");

    const clearBtn = document.getElementById("trackerClearBtn");
    const copyBtn = document.getElementById("trackerCopyTickersBtn");
    const exportBtn = document.getElementById("trackerExportExcelBtn");

    addBtn?.addEventListener("click", handleAddTrackerAssetFromBar);
    tickerInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAddTrackerAssetFromBar();
    });
    moveInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAddTrackerAssetFromBar();
    });

    refInput?.addEventListener("input", debounce(calculateCustomTracker, 400));
    refMoveInput?.addEventListener("input", debounce(calculateCustomTracker, 300));
    periodSelect?.addEventListener("change", calculateCustomTracker);

    document.getElementById("trackerRemovePartialBtn")?.addEventListener("click", removePartialTrackerItems);
    clearBtn?.addEventListener("click", clearCustomTracker);
    copyBtn?.addEventListener("click", copyTrackerTickersToClipboard);
    exportBtn?.addEventListener("click", exportTrackerExcel);

    // Screener controls for Tracker
    document.getElementById("trackerApplyFilterBtn")?.addEventListener("click", applyTrackerFilters);
    document.getElementById("trackerOperator")?.addEventListener("change", handleTrackerOperatorChange);
    document.getElementById("trackerThreshold")?.addEventListener("input", debounce(applyTrackerFilters, 250));
    document.getElementById("trackerThresholdMax")?.addEventListener("input", debounce(applyTrackerFilters, 250));
    document.getElementById("trackerSearch")?.addEventListener("input", debounce(applyTrackerFilters, 150));
    document.getElementById("trackerPageSizeSelect")?.addEventListener("change", handleTrackerPageSizeChange);

    document.querySelectorAll(".tracker-preset").forEach(pill => {
        pill.addEventListener("click", () => handleTrackerPresetClick(pill));
    });

    // Pagination for Tracker
    document.getElementById("trackerPrevBtn")?.addEventListener("click", () => changeTrackerPage(trackerCurrentPage - 1));
    document.getElementById("trackerNextBtn")?.addEventListener("click", () => changeTrackerPage(trackerCurrentPage + 1));

    // Sort headers for Tracker Table
    document.querySelectorAll("#trackerTable th[data-sort]").forEach(th => {
        th.addEventListener("click", () => handleTrackerTableSort(th.dataset.sort));
    });

    // Bulk Modal for Tracker
    initializeTrackerBulkModal();

    // Start with a clean empty custom tracker
    applyTrackerFilters();
}

function handleAddTrackerAssetFromBar() {
    const tickerEl = document.getElementById("trackerNewTicker");
    const moveEl = document.getElementById("trackerNewMove");
    if (!tickerEl) return;

    const rawTicker = normalizeTicker(tickerEl.value);
    if (!rawTicker) {
        showTrackerError("Введите тикер для добавления.");
        return;
    }

    let moveVal = null;
    if (moveEl && moveEl.value !== "") {
        const num = parseFloat(moveEl.value);
        if (Number.isFinite(num)) {
            moveVal = num / 100;
        }
    }

    customTrackerItems.set(rawTicker, { ticker: rawTicker, actual_move: moveVal });
    tickerEl.value = "";
    tickerEl.focus();

    calculateCustomTracker();
}

function removeTrackerItem(ticker) {
    ticker = normalizeTicker(ticker);
    customTrackerItems.delete(ticker);
    trackerCalculatedRows = trackerCalculatedRows.filter(r => normalizeTicker(r.ticker) !== ticker);
    applyTrackerFilters();
    hideGlobalTooltip();
}

function clearCustomTracker() {
    customTrackerItems.clear();
    trackerCalculatedRows = [];
    trackerFilteredRows = [];
    applyTrackerFilters();
    hideGlobalTooltip();
}

async function calculateCustomTracker() {
    clearTrackerAlerts();

    const items = Array.from(customTrackerItems.values());
    const reference = normalizeTicker(document.getElementById("trackerReference")?.value || "SPY") || "SPY";
    const refMoveNum = parseFloat(document.getElementById("trackerReferenceMove")?.value);
    const referenceMove = Number.isFinite(refMoveNum) ? refMoveNum / 100 : 0.01;
    const period = document.getElementById("trackerPeriod")?.value || "1y";

    if (!items.length) {
        trackerCalculatedRows = [];
        trackerFilteredRows = [];
        applyTrackerFilters();
        return;
    }

    try {
        const res = await fetch("/api/calculate-custom-tracker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: items,
                reference: reference,
                reference_move: referenceMove,
                period: period
            })
        });

        const data = await res.json();

        if (!res.ok) {
            let msg = data?.error || `Error calculating tracker (${res.status})`;
            if (Array.isArray(data?.missing)) {
                msg += `\nMissing: ${data.missing.join(", ")}`;
            }
            throw new Error(msg);
        }

        trackerCalculatedRows = data.rows || [];
        applyTrackerFilters();

        const warnParts = [];
        if (Array.isArray(data.partial) && data.partial.length > 0) {
            warnParts.push(`⚠️ ${data.partial.length} тикеров имеют историю меньше периода ${period} и подсвечены в таблице: ${data.partial.slice(0, 6).join(", ")}${data.partial.length > 6 ? "..." : ""}`);
        }
        if (Array.isArray(data.ignored) && data.ignored.length > 0) {
            warnParts.push(`Пропущено ${data.ignored.length} тикеров (< 2 наблюдений): ${data.ignored.join(", ")}`);
        }
        if (Array.isArray(data.missing) && data.missing.length > 0) {
            warnParts.push(`Тикеры не найдены в БД: ${data.missing.join(", ")}`);
        }

        if (warnParts.length > 0) {
            showTrackerWarning(warnParts.join(" | "));
        }

    } catch (err) {
        console.error("Custom tracker calculation failure:", err);
        showTrackerError(err.message || "Ошибка при расчете таблицы.");
    }
}

function handleTrackerInlineMoveChange(ticker, val) {
    const item = customTrackerItems.get(ticker);
    const num = parseFloat(val);
    const moveVal = Number.isFinite(num) ? num / 100 : null;

    if (item) {
        item.actual_move = moveVal;
    }

    // Instant in-memory recalculation for rapid responsiveness
    const updateRow = (r) => {
        if (r.ticker === ticker) {
            r.actual_move = moveVal;
            if (moveVal !== null && r.expected_move !== null) {
                r.difference = moveVal - r.expected_move;
            } else {
                r.difference = null;
            }
            if (r.difference !== null && r.volatility) {
                r.normalized = r.difference / r.volatility;
            } else {
                r.normalized = null;
            }
        }
    };

    trackerCalculatedRows.forEach(updateRow);
    trackerFilteredRows.forEach(updateRow);

    renderTrackerTablePage();
}

function applyTrackerFilters() {
    const op = document.getElementById("trackerOperator")?.value || "all";
    const threshold = parseFloat(document.getElementById("trackerThreshold")?.value);
    const thresholdMax = parseFloat(document.getElementById("trackerThresholdMax")?.value);
    const searchQuery = normalizeTicker(document.getElementById("trackerSearch")?.value);

    trackerFilteredRows = trackerCalculatedRows.filter(row => {
        if (searchQuery && !row.ticker.includes(searchQuery)) {
            return false;
        }

        const c = row.correlation;
        return checkCorrelationMatch(c, op, threshold, thresholdMax);
    });

    sortTrackerRows();

    const countEl = document.getElementById("trackerMatchCount");
    const totalEl = document.getElementById("trackerMatchTotal");
    const filterBadge = document.getElementById("trackerActiveFilterBadge");

    if (countEl) countEl.textContent = trackerFilteredRows.length;
    if (totalEl) totalEl.textContent = `/ ${trackerCalculatedRows.length} assets`;
    if (filterBadge) {
        if (op === "all") filterBadge.textContent = "All Assets";
        else if (op === "gte") filterBadge.textContent = `r ≥ ${threshold.toFixed(2)}`;
        else if (op === "lte") filterBadge.textContent = `r ≤ ${threshold.toFixed(2)}`;
        else if (op === "between") filterBadge.textContent = `${threshold.toFixed(2)} ≤ r ≤ ${thresholdMax.toFixed(2)}`;
        else if (op === "abs_gte") filterBadge.textContent = `|r| ≥ ${threshold.toFixed(2)}`;
    }

    trackerCurrentPage = 1;
    updateTrackerPartialButton();
    renderTrackerTablePage();
}

function handleTrackerOperatorChange() {
    const op = document.getElementById("trackerOperator")?.value;
    const maxField = document.getElementById("trackerMaxField");
    const minLabel = document.getElementById("trackerMinLabel");

    if (op === "between") {
        if (maxField) maxField.style.display = "block";
        if (minLabel) minLabel.textContent = "Min Threshold";
    } else {
        if (maxField) maxField.style.display = "none";
        if (minLabel) minLabel.textContent = op === "abs_gte" ? "|Correlation| Threshold" : "Correlation Threshold";
    }
    applyTrackerFilters();
}

function handleTrackerPresetClick(button) {
    document.querySelectorAll(".tracker-preset").forEach(p => p.classList.remove("active"));
    button.classList.add("active");

    const op = button.dataset.op;
    const val = button.dataset.val;

    const opSelect = document.getElementById("trackerOperator");
    const threshInput = document.getElementById("trackerThreshold");

    if (op === "all") {
        if (opSelect) opSelect.value = "all";
    } else {
        if (opSelect) opSelect.value = op;
        if (threshInput) threshInput.value = val;
    }

    handleTrackerOperatorChange();
}

function handleTrackerTableSort(column) {
    if (trackerSortColumn === column) {
        trackerSortDirection = trackerSortDirection === "desc" ? "asc" : "desc";
    } else {
        trackerSortColumn = column;
        trackerSortDirection = ["ticker"].includes(column) ? "asc" : "desc";
    }

    document.querySelectorAll("#trackerTable th").forEach(th => {
        const icon = th.querySelector(".sort-icon");
        if (!icon) return;
        if (th.dataset.sort === trackerSortColumn) {
            icon.textContent = trackerSortDirection === "desc" ? "▼" : "▲";
            th.classList.add("sorted");
        } else {
            icon.textContent = "⇅";
            th.classList.remove("sorted");
        }
    });

    sortTrackerRows();
    renderTrackerTablePage();
}

function sortTrackerRows() {
    trackerFilteredRows.sort((a, b) => {
        let valA = a[trackerSortColumn];
        let valB = b[trackerSortColumn];

        if (valA === null || valA === undefined) valA = trackerSortDirection === "desc" ? -Infinity : Infinity;
        if (valB === null || valB === undefined) valB = trackerSortDirection === "desc" ? -Infinity : Infinity;

        if (typeof valA === "string") {
            return trackerSortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }

        return trackerSortDirection === "asc" ? valA - valB : valB - valA;
    });
}

function handleTrackerPageSizeChange(e) {
    const val = e.target.value;
    trackerPageSize = val === "all" ? Infinity : parseInt(val, 10);
    trackerCurrentPage = 1;
    renderTrackerTablePage();
}

function changeTrackerPage(page) {
    const maxPage = Math.ceil(trackerFilteredRows.length / (trackerPageSize === Infinity ? trackerFilteredRows.length || 1 : trackerPageSize));
    if (page < 1 || page > maxPage) return;
    trackerCurrentPage = page;
    renderTrackerTablePage();
}

function renderTrackerTablePage() {
    const tbody = document.getElementById("trackerTableBody");
    const paginationInfo = document.getElementById("trackerPaginationInfo");
    const prevBtn = document.getElementById("trackerPrevBtn");
    const nextBtn = document.getElementById("trackerNextBtn");
    const pageNumbersEl = document.getElementById("trackerPageNumbers");
    if (!tbody) return;

    tbody.innerHTML = "";

    const total = trackerFilteredRows.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="no-results-td">Нет данных для отображения. Добавьте тикеры выше.</td></tr>`;
        if (paginationInfo) paginationInfo.textContent = "0 of 0 assets";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (pageNumbersEl) pageNumbersEl.innerHTML = "";
        return;
    }

    const effectivePageSize = trackerPageSize === Infinity ? total : trackerPageSize;
    const totalPages = Math.ceil(total / effectivePageSize);
    trackerCurrentPage = Math.min(trackerCurrentPage, totalPages);

    const startIdx = (trackerCurrentPage - 1) * effectivePageSize;
    const endIdx = Math.min(startIdx + effectivePageSize, total);
    const pageRows = trackerFilteredRows.slice(startIdx, endIdx);

    const frag = document.createDocumentFragment();

    pageRows.forEach(item => {
        const tr = document.createElement("tr");
        const corrBg = getCorrelationColor(item.correlation);
        const isPosDiff = item.difference > 0;
        const isNegDiff = item.difference < 0;
        const isPosNorm = item.normalized > 0;
        const isNegNorm = item.normalized < 0;

        const actVal = item.actual_move !== null && item.actual_move !== undefined ? (item.actual_move * 100).toFixed(2) : "";

        tr.innerHTML = `
            ${renderTickerCellHtml(item, "tracker")}
            <td class="corr-cell">
                <span class="corr-pill" style="background: ${corrBg}">
                    ${formatNumber(item.correlation, 3)}
                </span>
            </td>
            <td>${formatNumber(item.beta, 3)}</td>
            <td>${formatPercent(item.expected_move)}</td>
            <td>
                <div class="percent-input" style="max-width: 110px; margin: 0 auto;">
                    <input
                        class="tracker-table-input"
                        type="number"
                        step="0.1"
                        placeholder="0.0"
                        value="${actVal}"
                        onchange="handleTrackerInlineMoveChange('${item.ticker}', this.value)"
                    >
                    <span>%</span>
                </div>
            </td>
            <td class="${isPosDiff ? "positive-cell" : isNegDiff ? "negative-cell" : ""}">
                ${formatPercent(item.difference)}
            </td>
            <td class="${isPosNorm ? "positive-cell" : isNegNorm ? "negative-cell" : ""}">
                ${formatSignedNumber(item.normalized, 2)}
            </td>
            <td>${formatPercent(item.volatility)}</td>
            <td>${formatPercent(item.residual_volatility)}</td>
            <td class="obs-cell">${item.observations ?? "—"}</td>
            <td>
                <button class="tracker-remove-btn" type="button" onclick="removeTrackerItem('${item.ticker}')" title="Remove ${item.ticker}">×</button>
            </td>
        `;

        frag.appendChild(tr);
    });

    tbody.appendChild(frag);

    if (paginationInfo) {
        paginationInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${total} assets`;
    }
    if (prevBtn) prevBtn.disabled = trackerCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = trackerCurrentPage >= totalPages;
    if (pageNumbersEl) {
        pageNumbersEl.textContent = `Page ${trackerCurrentPage} of ${totalPages}`;
    }
}

function initializeTrackerBulkModal() {
    const modal = document.getElementById("trackerBulkModal");
    const openBtn = document.getElementById("trackerBulkModalBtn");
    const closeBtn = document.getElementById("closeTrackerBulkModal");
    const cancelBtn = document.getElementById("cancelTrackerBulkModal");
    const appendBtn = document.getElementById("submitTrackerBulkAppend");
    const replaceBtn = document.getElementById("submitTrackerBulkReplace");
    const textarea = document.getElementById("trackerBulkText");
    const countEl = document.getElementById("trackerBulkCount");

    openBtn?.addEventListener("click", () => {
        if (!modal) return;
        modal.classList.add("visible");
        modal.setAttribute("aria-hidden", "false");
        textarea?.focus();
        updateTrackerBulkCount();
    });

    const closeModal = () => {
        if (!modal) return;
        modal.classList.remove("visible");
        modal.setAttribute("aria-hidden", "true");
    };

    closeBtn?.addEventListener("click", closeModal);
    cancelBtn?.addEventListener("click", closeModal);

    const updateTrackerBulkCount = () => {
        const pairs = parseTickerMovePairs(textarea?.value || "");
        if (countEl) countEl.textContent = `${pairs.length} items`;
    };

    textarea?.addEventListener("input", updateTrackerBulkCount);

    appendBtn?.addEventListener("click", () => {
        const pairs = parseTickerMovePairs(textarea?.value || "");
        if (!pairs.length) {
            showTrackerError("Вставьте тикеры для импорта.");
            return;
        }
        pairs.forEach(p => {
            customTrackerItems.set(p.ticker, { ticker: p.ticker, actual_move: p.actual_move });
        });
        if (textarea) textarea.value = "";
        closeModal();
        calculateCustomTracker();
    });

    replaceBtn?.addEventListener("click", () => {
        const pairs = parseTickerMovePairs(textarea?.value || "");
        if (!pairs.length) {
            showTrackerError("Вставьте тикеры для импорта.");
            return;
        }
        customTrackerItems.clear();
        pairs.forEach(p => {
            customTrackerItems.set(p.ticker, { ticker: p.ticker, actual_move: p.actual_move });
        });
        if (textarea) textarea.value = "";
        closeModal();
        calculateCustomTracker();
    });
}

async function exportTrackerExcel() {
    const rowsToExport = trackerFilteredRows;

    if (!rowsToExport || !rowsToExport.length) {
        showTrackerError("Нет данных для экспорта.");
        return;
    }

    const reference = normalizeTicker(document.getElementById("trackerReference")?.value || "SPY") || "SPY";
    const period = document.getElementById("trackerPeriod")?.value || "1y";
    const exportBtn = document.getElementById("trackerExportExcelBtn");
    const origText = exportBtn ? exportBtn.textContent : "";

    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.textContent = "Generating Excel...";
    }

    try {
        const res = await fetch("/api/export-excel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                rows: rowsToExport,
                benchmarks: [reference],
                benchmark: reference,
                is_multi_benchmark: false,
                period: period,
                filter_label: "Custom Move Tracker"
            })
        });

        if (!res.ok) {
            throw new Error("Excel export failed.");
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `custom_tracker_${reference}_${period}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        showTrackerWarning(`Файл Excel (${rowsToExport.length} тикеров) успешно скачан!`);

    } catch (err) {
        console.error("Excel download error:", err);
        showTrackerError(err.message || "Не удалось скачать файл Excel.");
    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.textContent = origText;
        }
    }
}

function copyTrackerTickersToClipboard() {
    if (!trackerFilteredRows.length) {
        showTrackerError("Список тикеров пуст.");
        return;
    }

    const tickersList = trackerFilteredRows.map(r => r.ticker).join(", ");
    navigator.clipboard.writeText(tickersList).then(() => {
        const copyBtn = document.getElementById("trackerCopyTickersBtn");
        if (copyBtn) {
            const orig = copyBtn.textContent;
            copyBtn.textContent = "Copied!";
            setTimeout(() => copyBtn.textContent = orig, 1800);
        }
        showTrackerWarning(`Скопировано ${trackerFilteredRows.length} тикеров в буфер обмена.`);
    }).catch(() => {
        showTrackerError("Не удалось скопировать тикеры.");
    });
}

function showTrackerError(msg) {
    const el = document.getElementById("trackerAlertError");
    if (el) {
        el.textContent = msg;
        el.style.display = "block";
        setTimeout(() => { el.style.display = "none"; }, 5000);
    }
}

function showTrackerWarning(msg) {
    const el = document.getElementById("trackerAlertWarning");
    if (el) {
        el.textContent = msg;
        el.style.display = "block";
        setTimeout(() => { el.style.display = "none"; }, 5000);
    }
}

function clearTrackerAlerts() {
    const errEl = document.getElementById("trackerAlertError");
    const warnEl = document.getElementById("trackerAlertWarning");
    if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
    if (warnEl) { warnEl.textContent = ""; warnEl.style.display = "none"; }
}

// ============================================================
// DYNAMIC FLOATING TOOLTIPS & TICKER POPOVERS
// ============================================================

let tooltipCloseTimer = null;
let isCursorOverTooltip = false;

function hideGlobalTooltip() {
    const tooltip = document.getElementById("globalTooltip");
    if (tooltip) {
        tooltip.style.display = "none";
        tooltip.classList.remove("interactive-tooltip");
    }
}

function initializeTooltips() {
    const tooltip = document.getElementById("globalTooltip");
    const titleEl = document.getElementById("tooltipTitle");
    const textEl = document.getElementById("tooltipText");
    if (!tooltip || !titleEl || !textEl) return;

    tooltip.addEventListener("mouseenter", () => {
        isCursorOverTooltip = true;
        if (tooltipCloseTimer) clearTimeout(tooltipCloseTimer);
    });

    tooltip.addEventListener("mouseleave", () => {
        isCursorOverTooltip = false;
        scheduleHideTooltip(120);
    });

    const scheduleHideTooltip = (delay = 150) => {
        if (tooltipCloseTimer) clearTimeout(tooltipCloseTimer);
        tooltipCloseTimer = setTimeout(() => {
            if (!isCursorOverTooltip) {
                hideGlobalTooltip();
            }
        }, delay);
    };

    document.addEventListener("mouseover", (e) => {
        // 1. Partial History Ticker Hover
        const tickerTrigger = e.target.closest(".tooltip-ticker-trigger");
        if (tickerTrigger) {
            if (tooltipCloseTimer) clearTimeout(tooltipCloseTimer);

            const ticker = tickerTrigger.dataset.ticker || "";
            const periodRu = tickerTrigger.dataset.periodRu || "короткий период";
            const periodSelected = tickerTrigger.dataset.periodSelected || "выбранный период";
            const start = tickerTrigger.dataset.start;
            const end = tickerTrigger.dataset.end;
            const obs = tickerTrigger.dataset.obs;

            titleEl.innerHTML = `<span class="tooltip-title-badge">⚠️ ${ticker}</span> <span class="tooltip-title-muted">— Неполный период</span>`;
            textEl.innerHTML = `
                <div class="partial-tooltip-body">
                    <div class="partial-tooltip-msg">
                        данные акции существуют за <strong>${periodRu}</strong>
                    </div>
                    <div class="partial-tooltip-meta">
                        <div>Период расчёта: <span class="meta-val">${periodSelected}</span></div>
                        ${(start && start !== "—") ? `<div>В базе данных: <span class="meta-val">с ${start} по ${end}</span> (${obs} торг. дн.)</div>` : ""}
                    </div>
                    <div class="partial-tooltip-actions">
                        <button class="tooltip-remove-btn" type="button" onclick="removeTickerFromAnyTable('${ticker}')">
                            <span class="btn-cross">✕</span> Убрать из таблицы
                        </button>
                    </div>
                </div>
            `;

            tooltip.classList.add("interactive-tooltip");
            tooltip.style.display = "block";
            positionTooltip(e, tooltip);
            return;
        }

        // 2. Standard Header Tooltip
        const header = e.target.closest(".tooltip-header");
        if (header) {
            if (tooltipCloseTimer) clearTimeout(tooltipCloseTimer);
            const title = header.dataset.tooltipTitle || header.textContent.replace(/[⇅▼▲]/g, "").trim();
            const text = header.dataset.tooltipText;
            if (text) {
                tooltip.classList.remove("interactive-tooltip");
                titleEl.textContent = title;
                textEl.textContent = text;
                tooltip.style.display = "block";
                positionTooltip(e, tooltip);
            }
            return;
        }
    });

    document.addEventListener("mousemove", (e) => {
        if (tooltip.style.display === "block" && !tooltip.classList.contains("interactive-tooltip")) {
            positionTooltip(e, tooltip);
        }
    });

    document.addEventListener("mouseout", (e) => {
        const trigger = e.target.closest(".tooltip-header, .tooltip-ticker-trigger");
        if (trigger) {
            const isInteractive = trigger.classList.contains("tooltip-ticker-trigger");
            scheduleHideTooltip(isInteractive ? 200 : 50);
        }
    });
}

function positionTooltip(e, tooltip) {
    const pad = 12;
    let x = e.clientX + pad;
    let y = e.clientY + pad;

    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 12) {
        x = e.clientX - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - 12) {
        y = e.clientY - rect.height - pad;
    }

    tooltip.style.left = `${Math.max(10, x)}px`;
    tooltip.style.top = `${Math.max(10, y)}px`;
}

function updateScreenerPartialButton() {
    const btn = document.getElementById("screenerRemovePartialBtn");
    const countEl = document.getElementById("screenerPartialCount");
    if (!btn) return;

    const count = latestBenchmarkRows.filter(r => r.is_partial_history).length;
    if (count > 0) {
        if (countEl) countEl.textContent = count;
        btn.style.display = "inline-flex";
    } else {
        btn.style.display = "none";
    }
}

function removePartialScreenerTickers() {
    const partialTickers = latestBenchmarkRows
        .filter(r => r.is_partial_history)
        .map(r => normalizeTicker(r.ticker));

    if (!partialTickers.length) {
        showWarning("В таблице нет тикеров с неполной историей.");
        return;
    }

    // 1. Remove from screener rows
    latestBenchmarkRows = latestBenchmarkRows.filter(r => !r.is_partial_history);
    filteredBenchmarkRows = filteredBenchmarkRows.filter(r => !r.is_partial_history);

    // 2. Remove from underlying groups in Universe Builder
    partialTickers.forEach(t => {
        groupsState.forEach((group, gId) => {
            if (group.tickers.has(t)) {
                group.tickers.delete(t);
                group.moves.delete(t);
                renderGroupBody(gId);
            }
        });
    });

    // 3. Update active data state
    if (latestAnalysisData) {
        if (Array.isArray(latestAnalysisData.tickers)) {
            latestAnalysisData.tickers = latestAnalysisData.tickers.filter(t => !partialTickers.includes(normalizeTicker(t)));
        }
        if (Array.isArray(latestAnalysisData.all_symbols)) {
            latestAnalysisData.all_symbols = latestAnalysisData.all_symbols.filter(t => !partialTickers.includes(normalizeTicker(t)));
        }
        partialTickers.forEach(t => {
            if (latestAnalysisData.expected_range) delete latestAnalysisData.expected_range[t];
            if (latestAnalysisData.partial_tickers) delete latestAnalysisData.partial_tickers[t];
            if (latestAnalysisData.tickers_history_info) delete latestAnalysisData.tickers_history_info[t];
            if (latestAnalysisData.benchmarks_data) {
                Object.values(latestAnalysisData.benchmarks_data).forEach(bmObj => {
                    if (bmObj.expected_range) delete bmObj.expected_range[t];
                });
            }
        });
    }

    // 4. Update status badges
    const countEl = document.getElementById("benchmarkResultCount");
    const totalEl = document.getElementById("benchmarkResultTotal");
    if (countEl) countEl.textContent = filteredBenchmarkRows.length;
    if (totalEl) totalEl.textContent = `/ ${latestBenchmarkRows.length} assets`;

    const totalAssetsOverview = document.getElementById("resultTotalAssets");
    if (totalAssetsOverview) totalAssetsOverview.textContent = `${latestBenchmarkRows.length} assets`;

    renderScreenerTablePage();
    updateScreenerPartialButton();

    // 5. Re-render matrices
    if (latestAnalysisData) {
        renderCorrelationMatrix(latestAnalysisData);
        renderBetaMatrix(latestAnalysisData);
    }

    hideGlobalTooltip();
    showWarning(`Удалено ${partialTickers.length} тикеров с неполной историей: ${partialTickers.join(", ")}`);
}

function updateTrackerPartialButton() {
    const btn = document.getElementById("trackerRemovePartialBtn");
    const countEl = document.getElementById("trackerPartialCount");
    if (!btn) return;

    const count = trackerCalculatedRows.filter(r => r.is_partial_history).length;
    if (count > 0) {
        if (countEl) countEl.textContent = count;
        btn.style.display = "inline-flex";
    } else {
        btn.style.display = "none";
    }
}

function removePartialTrackerItems() {
    const partialTickers = trackerCalculatedRows
        .filter(r => r.is_partial_history)
        .map(r => normalizeTicker(r.ticker));

    if (!partialTickers.length) {
        showTrackerWarning("В таблице нет тикеров с неполной историей.");
        return;
    }

    partialTickers.forEach(t => {
        customTrackerItems.delete(t);
    });

    trackerCalculatedRows = trackerCalculatedRows.filter(r => !r.is_partial_history);
    trackerFilteredRows = trackerFilteredRows.filter(r => !r.is_partial_history);

    applyTrackerFilters();
    hideGlobalTooltip();
    updateTrackerPartialButton();

    showTrackerWarning(`Удалено ${partialTickers.length} тикеров с неполной историей: ${partialTickers.join(", ")}`);
}

function removeScreenerTicker(ticker) {
    ticker = normalizeTicker(ticker);

    // 1. Remove from screener rows
    latestBenchmarkRows = latestBenchmarkRows.filter(r => normalizeTicker(r.ticker) !== ticker);
    filteredBenchmarkRows = filteredBenchmarkRows.filter(r => normalizeTicker(r.ticker) !== ticker);

    // 2. Remove from underlying groups in Universe Builder
    groupsState.forEach((group, gId) => {
        if (group.tickers.has(ticker)) {
            group.tickers.delete(ticker);
            group.moves.delete(ticker);
            renderGroupBody(gId);
        }
    });

    // 3. Update active data state
    if (latestAnalysisData) {
        if (Array.isArray(latestAnalysisData.tickers)) {
            latestAnalysisData.tickers = latestAnalysisData.tickers.filter(t => normalizeTicker(t) !== ticker);
        }
        if (Array.isArray(latestAnalysisData.all_symbols)) {
            latestAnalysisData.all_symbols = latestAnalysisData.all_symbols.filter(t => normalizeTicker(t) !== ticker);
        }
        if (latestAnalysisData.expected_range) {
            delete latestAnalysisData.expected_range[ticker];
        }
        if (latestAnalysisData.benchmarks_data) {
            Object.values(latestAnalysisData.benchmarks_data).forEach(bmObj => {
                if (bmObj.expected_range) delete bmObj.expected_range[ticker];
            });
        }
    }

    // 4. Update status badges
    const countEl = document.getElementById("benchmarkResultCount");
    const totalEl = document.getElementById("benchmarkResultTotal");
    if (countEl) countEl.textContent = filteredBenchmarkRows.length;
    if (totalEl) totalEl.textContent = `/ ${latestBenchmarkRows.length} assets`;

    const totalAssetsOverview = document.getElementById("resultTotalAssets");
    if (totalAssetsOverview) totalAssetsOverview.textContent = `${latestBenchmarkRows.length} assets`;

    renderScreenerTablePage();
    updateScreenerPartialButton();

    // 5. Re-render matrices
    if (latestAnalysisData) {
        renderCorrelationMatrix(latestAnalysisData);
        renderBetaMatrix(latestAnalysisData);
    }

    hideGlobalTooltip();
}

function removeTickerFromAnyTable(ticker) {
    ticker = normalizeTicker(ticker);
    removeTrackerItem(ticker);
    removeScreenerTicker(ticker);
    hideGlobalTooltip();
}

// ============================================================
// THEME (1. Dark Blue / Navy | 2. Light / White | 3. Graphite / Deep Black)
// ============================================================

const THEME_KEY = "stockAnalyticsTheme";

function initializeTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    let theme = "dark-blue";
    if (saved === "light") {
        theme = "light";
    } else if (saved === "dark-black" || saved === "black" || saved === "graphite") {
        theme = "dark-black";
    } else if (saved === "dark-blue" || saved === "dark") {
        theme = "dark-blue";
    }
    setTheme(theme);
}

function setTheme(theme) {
    if (!["dark-blue", "light", "dark-black"].includes(theme)) {
        theme = "dark-blue";
    }

    document.body.classList.remove(
        "light-theme", "theme-light",
        "theme-dark-blue",
        "theme-dark-black", "black-theme", "graphite-theme"
    );
    document.body.dataset.theme = theme;

    if (theme === "light") {
        document.body.classList.add("light-theme", "theme-light");
    } else if (theme === "dark-black") {
        document.body.classList.add("theme-dark-black", "black-theme", "graphite-theme");
    } else {
        document.body.classList.add("theme-dark-blue");
    }

    localStorage.setItem(THEME_KEY, theme);
    updateThemeUI(theme);
}

function toggleTheme() {
    cycleTheme();
}

function cycleTheme() {
    const current = document.body.dataset.theme || "dark-blue";
    let nextTheme = "dark-blue";
    if (current === "dark-blue") {
        nextTheme = "light";
    } else if (current === "light") {
        nextTheme = "dark-black";
    } else {
        nextTheme = "dark-blue";
    }
    setTheme(nextTheme);
}

function updateThemeUI(theme) {
    // Update segmented buttons active state
    document.querySelectorAll(".theme-switch-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.theme === theme);
    });

    // Update fallback toggle button text if present
    const btn = document.getElementById("themeToggle");
    if (btn) {
        if (theme === "dark-blue") {
            btn.textContent = "Темно-синий";
            btn.title = "Текущая: Темно-синий (клик для переключения)";
        } else if (theme === "light") {
            btn.textContent = "Белый";
            btn.title = "Текущая: Белый (клик для переключения)";
        } else {
            btn.textContent = "Графит (Фото)";
            btn.title = "Текущая: Графит (клик для переключения)";
        }
    }
}

// ============================================================
// DATABASE TICKERS FETCH & STATUS
// ============================================================

async function loadDatabaseTickers() {
    const statusEl = document.getElementById("dbStatus");
    try {
        let statusMsg = "Market Data Connected";
        try {
            const statusRes = await fetch("/api/db-status");
            if (statusRes.ok) {
                const statusInfo = await statusRes.json();
                statusMsg = statusInfo.message || statusMsg;
            }
        } catch {}

        const res = await fetch("/api/tickers");
        if (!res.ok) throw new Error("Database fetch error");
        const data = await res.json();
        availableDatabaseTickers = Array.isArray(data) ? data.map(normalizeTicker).filter(Boolean) : [];

        if (statusEl) {
            statusEl.classList.remove("error");
            statusEl.querySelector("span:last-child").textContent = statusMsg;
            statusEl.title = `${availableDatabaseTickers.length} tickers available for fast selection`;
        }
        renderDatabaseTickerList();
    } catch (err) {
        console.warn("DB connection warning:", err);
        if (statusEl) {
            statusEl.classList.add("error");
            statusEl.querySelector("span:last-child").textContent = "Database offline / disconnected";
        }
    }
}

// ============================================================
// GROUPS STATE & RENDERING (UNIVERSE BUILDER)
// ============================================================

function createGroup(customName = null) {
    groupCounter++;
    const groupId = groupCounter;
    const name = customName || `Group ${groupId}`;

    groupsState.set(groupId, {
        id: groupId,
        name: name,
        tickers: new Set(),
        moves: new Map(),
        mode: "chips" // 'chips' or 'table'
    });

    renderGroupCard(groupId);
    return groupId;
}

function renderGroupCard(groupId) {
    const container = document.getElementById("groups");
    if (!container) return;

    const group = groupsState.get(groupId);
    if (!group) return;

    const card = document.createElement("div");
    card.className = "asset-group-card";
    card.id = `group-card-${groupId}`;
    card.dataset.groupId = groupId;

    card.innerHTML = `
        <div class="group-card-header">
            <div class="group-title-zone">
                <span class="group-badge">#${groupId}</span>
                <input class="group-name-input" value="${escapeHtml(group.name)}" placeholder="Group name" autocomplete="off">
                <span class="group-count-pill" id="group-count-${groupId}">0 tickers</span>
            </div>

            <div class="group-header-actions">
                <button class="action-btn" type="button" title="Fast paste multiple tickers" onclick="openBulkForGroup(${groupId})">
                    Fast Paste (300+)
                </button>
                <button class="action-btn" type="button" title="Toggle detailed table for custom actual moves" onclick="toggleGroupMode(${groupId})">
                    Custom Moves
                </button>
                <button class="action-btn danger" type="button" title="Clear all tickers in group" onclick="clearGroupTickers(${groupId})">
                    Clear
                </button>
                <button class="group-remove-btn" type="button" title="Remove group" onclick="removeGroup(${groupId})">
                    ×
                </button>
            </div>
        </div>

        <div class="group-body" id="group-body-${groupId}"></div>
    `;

    container.appendChild(card);

    const nameInput = card.querySelector(".group-name-input");
    nameInput?.addEventListener("input", (e) => {
        group.name = e.target.value.trim() || `Group ${groupId}`;
    });
}

function renderGroupBody(groupId) {
    const group = groupsState.get(groupId);
    const body = document.getElementById(`group-body-${groupId}`);
    const countBadge = document.getElementById(`group-count-${groupId}`);
    if (!group || !body) return;

    const count = group.tickers.size;
    if (countBadge) {
        countBadge.textContent = `${count} ticker${count === 1 ? "" : "s"}`;
        countBadge.classList.toggle("has-tickers", count > 0);
    }

    if (group.mode === "chips") {
        renderChipsMode(group, body);
    } else {
        renderTableMode(group, body);
    }
}

function renderChipsMode(group, container) {
    const tickersArray = Array.from(group.tickers);

    container.innerHTML = `
        <div class="chips-input-bar">
            <div class="inline-add-wrapper">
                <input
                    class="inline-ticker-input"
                    id="inline-input-${group.id}"
                    placeholder="Type ticker or paste 300 tickers (e.g. AAPL, MSFT, NVDA)..."
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="characters"
                    spellcheck="false"
                >
                <button class="primary-small-button inline-add-btn" type="button" onclick="handleInlineAdd(${group.id})">
                    + Add
                </button>
            </div>

            ${tickersArray.length > 8 ? `
                <div class="inline-search-wrapper">
                    <input
                        class="chips-filter-input"
                        placeholder="Filter ${tickersArray.length} tickers..."
                        oninput="filterChipsInGroup(${group.id}, this.value)"
                    >
                </div>
            ` : ""}
        </div>

        <div class="chips-container" id="chips-list-${group.id}">
            ${tickersArray.length === 0 ? `
                <div class="chips-empty-msg">
                    No tickers added yet. Paste a list above or click <strong>Fast Paste (300+)</strong>.
                </div>
            ` : tickersArray.map(t => `
                <span class="ticker-chip" data-ticker="${t}">
                    <span class="chip-symbol">${t}</span>
                    ${group.moves.has(t) ? `<span class="chip-move-badge">${(group.moves.get(t) * 100).toFixed(1)}%</span>` : ""}
                    <button class="chip-remove" type="button" onclick="removeTickerFromGroup(${group.id}, '${t}')" title="Remove ${t}">×</button>
                </span>
            `).join("")}
        </div>
    `;

    const input = document.getElementById(`inline-input-${group.id}`);
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleInlineAdd(group.id);
        }
    });
}

function renderTableMode(group, container) {
    const tickersArray = Array.from(group.tickers);

    container.innerHTML = `
        <div class="table-mode-header">
            <span>Detailed Moves Table (${tickersArray.length} assets)</span>
            <button class="action-btn small" type="button" onclick="toggleGroupMode(${group.id})">
                Back to Compact Chips
            </button>
        </div>
        <div class="table-wrapper compact-table-wrapper">
            <table class="data-table moves-table">
                <thead>
                    <tr>
                        <th style="width: 140px;">Ticker</th>
                        <th>Actual Move Override (%)</th>
                        <th style="width: 80px;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${tickersArray.length === 0 ? `
                        <tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No tickers added.</td></tr>
                    ` : tickersArray.map(t => {
                        const val = group.moves.has(t) ? (group.moves.get(t) * 100) : "";
                        return `
                            <tr>
                                <td><strong>${t}</strong></td>
                                <td>
                                    <div class="percent-input small-percent">
                                        <input
                                            type="number"
                                            step="0.1"
                                            placeholder="Auto (0.0%)"
                                            value="${val !== "" ? val : ""}"
                                            onchange="handleTableMoveChange(${group.id}, '${t}', this.value)"
                                        >
                                        <span>%</span>
                                    </div>
                                </td>
                                <td>
                                    <button class="remove-asset" type="button" onclick="removeTickerFromGroup(${group.id}, '${t}')">×</button>
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function toggleGroupMode(groupId) {
    const group = groupsState.get(groupId);
    if (!group) return;
    group.mode = group.mode === "chips" ? "table" : "chips";
    renderGroupBody(groupId);
}

function handleInlineAdd(groupId) {
    const input = document.getElementById(`inline-input-${groupId}`);
    if (!input) return;

    const raw = input.value;
    const parsed = parseTickerText(raw);
    if (!parsed.length) return;

    parsed.forEach(t => addTickerToGroup(groupId, t, false));
    input.value = "";
    renderGroupBody(groupId);
}

function addTickerToGroup(groupId, ticker, reRender = true) {
    const group = groupsState.get(groupId);
    if (!group) return;
    const clean = normalizeTicker(ticker);
    if (!clean) return;

    group.tickers.add(clean);
    if (reRender) renderGroupBody(groupId);
}

function removeTickerFromGroup(groupId, ticker) {
    const group = groupsState.get(groupId);
    if (!group) return;
    group.tickers.delete(ticker);
    group.moves.delete(ticker);
    renderGroupBody(groupId);
}

function clearGroupTickers(groupId) {
    const group = groupsState.get(groupId);
    if (!group) return;
    group.tickers.clear();
    group.moves.clear();
    renderGroupBody(groupId);
}

function removeGroup(groupId) {
    if (groupsState.size <= 1) {
        showError("Нельзя удалить единственную группу.");
        return;
    }
    groupsState.delete(groupId);
    document.getElementById(`group-card-${groupId}`)?.remove();
}

function handleTableMoveChange(groupId, ticker, val) {
    const group = groupsState.get(groupId);
    if (!group) return;
    const num = parseFloat(val);
    if (Number.isFinite(num)) {
        group.moves.set(ticker, num / 100);
    } else {
        group.moves.delete(ticker);
    }
}

function filterChipsInGroup(groupId, query) {
    const clean = normalizeTicker(query);
    const chips = document.querySelectorAll(`#chips-list-${groupId} .ticker-chip`);
    chips.forEach(chip => {
        const sym = chip.dataset.ticker;
        chip.style.display = !clean || sym.includes(clean) ? "inline-flex" : "none";
    });
}

// ============================================================
// BULK MODAL HANDLERS (UNIVERSE BUILDER)
// ============================================================

function initializeBulkModal() {
    const modal = document.getElementById("bulkTickerModal");
    const closeBtn = document.getElementById("closeBulkModal");
    const cancelBtn = document.getElementById("cancelBulkModal");
    const addBtn = document.getElementById("addBulkTickers");
    const replaceBtn = document.getElementById("replaceBulkTickers");
    const pasteTextarea = document.getElementById("bulkTickerText");
    const fileInput = document.getElementById("bulkTickerFile");
    const dropZone = document.getElementById("fileDropZone");
    const clearPasteBtn = document.getElementById("clearPasteBtn");
    const dbSearch = document.getElementById("bulkDbSearch");
    const selectAllDb = document.getElementById("bulkDbSelectAll");
    const clearDb = document.getElementById("bulkDbClear");

    closeBtn?.addEventListener("click", closeBulkTickerModal);
    cancelBtn?.addEventListener("click", closeBulkTickerModal);
    addBtn?.addEventListener("click", () => submitBulkModal(false));
    replaceBtn?.addEventListener("click", () => submitBulkModal(true));

    document.querySelectorAll(".bulk-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".bulk-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".bulk-tab-content").forEach(c => c.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab)?.classList.add("active");
        });
    });

    pasteTextarea?.addEventListener("input", updateBulkModalCounts);
    clearPasteBtn?.addEventListener("click", () => {
        if (pasteTextarea) pasteTextarea.value = "";
        updateBulkModalCounts();
    });

    fileInput?.addEventListener("change", handleBulkFileSelect);
    dropZone?.addEventListener("click", () => fileInput?.click());
    dropZone?.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone?.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        if (e.dataTransfer?.files?.length) {
            handleBulkFile(e.dataTransfer.files[0]);
        }
    });

    dbSearch?.addEventListener("input", () => renderDatabaseTickerList(dbSearch.value));
    selectAllDb?.addEventListener("click", selectAllVisibleDatabaseTickers);
    clearDb?.addEventListener("click", clearDatabaseTickerSelection);
}

function openBulkTickerModal() {
    const modal = document.getElementById("bulkTickerModal");
    if (!modal) return;

    populateBulkTargetDropdown();
    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("bulkTickerText")?.focus();
    updateBulkModalCounts();
}

function openBulkForGroup(groupId) {
    openBulkTickerModal();
    const select = document.getElementById("bulkTargetGroup");
    if (select) select.value = String(groupId);
}

function closeBulkTickerModal() {
    const modal = document.getElementById("bulkTickerModal");
    if (!modal) return;
    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");
}

function populateBulkTargetDropdown() {
    const select = document.getElementById("bulkTargetGroup");
    if (!select) return;
    select.innerHTML = "";

    groupsState.forEach(g => {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.tickers.size} tickers)`;
        select.appendChild(opt);
    });
}

function updateBulkModalCounts() {
    const textarea = document.getElementById("bulkTickerText");
    const pasteCountEl = document.getElementById("pasteDetectedCount");
    const totalCountEl = document.getElementById("bulkTotalCount");
    const dbCountEl = document.getElementById("bulkDbCount");

    const pasted = parseTickerText(textarea?.value || "");
    const dbSelected = Array.from(bulkDbSelectedTickers);

    if (pasteCountEl) pasteCountEl.textContent = `${pasted.length} unique tickers detected`;
    if (dbCountEl) dbCountEl.textContent = `${dbSelected.length} tickers selected`;

    const combined = new Set([...pasted, ...dbSelected]);
    if (totalCountEl) totalCountEl.textContent = `${combined.size} tickers`;
}

function handleBulkFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) handleBulkFile(file);
}

function handleBulkFile(file) {
    const status = document.getElementById("bulkFileStatus");
    const textarea = document.getElementById("bulkTickerText");
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const text = String(reader.result || "");
        const parsed = parseTickerText(text);
        if (textarea) {
            const existing = parseTickerText(textarea.value);
            const merged = Array.from(new Set([...existing, ...parsed]));
            textarea.value = merged.join(", ");
        }
        if (status) status.textContent = `${file.name} — ${parsed.length} tickers extracted`;
        updateBulkModalCounts();
    };
    reader.onerror = () => {
        if (status) status.textContent = "Error reading file.";
    };
    reader.readAsText(file);
}

function renderDatabaseTickerList(search = "") {
    const list = document.getElementById("bulkDbList");
    if (!list) return;

    const query = normalizeTicker(search);
    const filtered = availableDatabaseTickers.filter(t => !query || t.includes(query));

    list.innerHTML = "";
    if (!filtered.length) {
        list.innerHTML = `<div class="bulk-db-empty">${query ? "No matching tickers." : "No database tickers found."}</div>`;
        return;
    }

    const frag = document.createDocumentFragment();
    filtered.slice(0, 500).forEach(ticker => {
        const label = document.createElement("label");
        label.className = "bulk-db-item";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.value = ticker;
        chk.checked = bulkDbSelectedTickers.has(ticker);

        chk.addEventListener("change", () => {
            if (chk.checked) bulkDbSelectedTickers.add(ticker);
            else bulkDbSelectedTickers.delete(ticker);
            updateBulkModalCounts();
        });

        label.appendChild(chk);
        label.appendChild(document.createTextNode(ticker));
        frag.appendChild(label);
    });

    list.appendChild(frag);
    updateBulkModalCounts();
}

function selectAllVisibleDatabaseTickers() {
    const search = document.getElementById("bulkDbSearch")?.value || "";
    const query = normalizeTicker(search);
    availableDatabaseTickers
        .filter(t => !query || t.includes(query))
        .forEach(t => bulkDbSelectedTickers.add(t));
    renderDatabaseTickerList(search);
}

function clearDatabaseTickerSelection() {
    bulkDbSelectedTickers.clear();
    renderDatabaseTickerList(document.getElementById("bulkDbSearch")?.value || "");
}

function submitBulkModal(replaceExisting = false) {
    const targetId = parseInt(document.getElementById("bulkTargetGroup")?.value, 10);
    const group = groupsState.get(targetId);

    if (!group) {
        showError("Выберите группу для импорта.");
        return;
    }

    const textarea = document.getElementById("bulkTickerText");
    const pasted = parseTickerText(textarea?.value || "");
    const dbSelected = Array.from(bulkDbSelectedTickers);
    const all = Array.from(new Set([...pasted, ...dbSelected]));

    if (!all.length) {
        showError("Нет тикеров для импорта. Вставьте список или выберите тикеры из БД.");
        return;
    }

    if (replaceExisting) {
        group.tickers.clear();
        group.moves.clear();
    }

    all.forEach(t => group.tickers.add(t));
    renderGroupBody(group.id);
    closeBulkTickerModal();

    if (textarea) textarea.value = "";
    bulkDbSelectedTickers.clear();
    renderDatabaseTickerList();
    updateBulkModalCounts();

    showWarning(`Успешно добавлено ${all.length} тикеров в ${group.name}!`);
}

// ============================================================
// CALCULATION (UNIVERSE SCREENER)
// ============================================================

async function calculateGroups() {
    clearAlerts();

    const rawBenchmark = document.getElementById("benchmark")?.value || "";
    const benchmarks = parseTickerText(rawBenchmark);
    const benchmarkMove = parseFloat(document.getElementById("benchmarkMove")?.value);
    const period = document.getElementById("period")?.value || "1y";

    if (!benchmarks.length) {
        showError("Введите хотя бы один Market Asset (Benchmark), например SPY или SPY, QQQ.");
        return;
    }

    if (!Number.isFinite(benchmarkMove)) {
        showError("Введите корректное ожидаемое движение Benchmark (например, 1.0%).");
        return;
    }

    const groupsPayload = {};
    const assetMovesPayload = {};
    let totalTickersCount = 0;

    groupsState.forEach(g => {
        const arr = Array.from(g.tickers);
        if (arr.length > 0) {
            groupsPayload[g.name] = arr;
            totalTickersCount += arr.length;
        }
        g.moves.forEach((move, ticker) => {
            assetMovesPayload[ticker] = move;
        });
    });

    if (totalTickersCount === 0) {
        showError("Добавьте хотя бы один тикер для анализа.");
        return;
    }

    const loading = document.getElementById("loading");
    const resultsSec = document.getElementById("results");
    const calcBtn = document.getElementById("calculateButton");

    if (loading) loading.style.display = "flex";
    if (resultsSec) resultsSec.style.display = "none";
    if (calcBtn) {
        calcBtn.disabled = true;
        calcBtn.classList.add("loading");
    }

    try {
        const res = await fetch("/api/calculate-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                groups: groupsPayload,
                benchmarks: benchmarks,
                benchmark: benchmarks[0],
                period: period,
                benchmark_move: benchmarkMove / 100,
                asset_moves: assetMovesPayload
            })
        });

        const data = await res.json();

        if (!res.ok) {
            let msg = data?.error || `Calculation error (${res.status})`;
            if (Array.isArray(data?.missing)) {
                msg += `\nMissing: ${data.missing.join(", ")}`;
            }
            throw new Error(msg);
        }

        latestAnalysisData = data;
        configuredBenchmarks = data.benchmarks || [data.benchmark || "SPY"];

        if (configuredBenchmarks.length > 1) {
            activeBenchmarkView = "compare";
            currentSortColumn = `correlation_${configuredBenchmarks[0]}`;
        } else {
            activeBenchmarkView = configuredBenchmarks[0];
            currentSortColumn = "correlation";
        }
        filterBenchmarkTarget = "all";

        renderAllResults(data);

        if (data.warning) {
            showWarning(data.warning);
        }

        // Show all results panels immediately
        if (resultsSec) {
            resultsSec.style.display = "block";
            resultsSec.scrollIntoView({ behavior: "smooth", block: "start" });
        }

    } catch (err) {
        console.error("Calculation failure:", err);
        showError(err.message || "Ошибка при выполнении расчёта.");
    } finally {
        if (loading) loading.style.display = "none";
        if (calcBtn) {
            calcBtn.disabled = false;
            calcBtn.classList.remove("loading");
        }
    }
}

// ============================================================
// RESULTS RENDERING & SCREENER (UNIVERSE SCREENER)
// ============================================================

function renderAllResults(data) {
    // 1. Overview bar
    const bmList = configuredBenchmarks.length ? configuredBenchmarks.join(", ") : (data.benchmark || "—");
    document.getElementById("resultBenchmark").textContent = bmList;
    document.getElementById("resultPeriod").textContent = data.period?.toUpperCase() || "1Y";
    document.getElementById("resultDateRange").textContent = `${data.period_start || "—"} → ${data.period_end || "—"}`;
    document.getElementById("resultTotalAssets").textContent = `${data.total_analyzed || (data.tickers?.length || 0)} assets`;

    // 2. Setup Multi-Benchmark Switcher Toolbar & Filter Dropdown
    setupBenchmarkTabsAndFilter();

    // 3. Setup Table Header
    setupBenchmarkTableHeader();

    // 4. Build Screener Rows
    buildScreenerRows(data);

    // 5. Apply Screener Filter
    applyScreenerFilters();

    // 6. Render Pearson Correlation Matrix
    renderCorrelationMatrix(data);

    // 7. Render Beta Matrix with Color Heatmap
    renderBetaMatrix(data);
}

function setupBenchmarkTabsAndFilter() {
    const tabsContainer = document.getElementById("benchmarkTabsContainer");
    const tabsEl = document.getElementById("benchmarkTabs");
    const filterBenchmarkField = document.getElementById("filterBenchmarkField");
    const filterBenchmarkSelect = document.getElementById("filterBenchmarkSelect");

    if (!tabsContainer || !tabsEl) return;

    if (configuredBenchmarks.length > 1) {
        tabsContainer.style.display = "flex";
        if (filterBenchmarkField) filterBenchmarkField.style.display = "flex";

        // Render tabs
        let tabsHtml = `<button class="benchmark-tab-pill ${activeBenchmarkView === 'compare' ? 'active' : ''}" type="button" onclick="switchBenchmarkView('compare')">Compare All (${configuredBenchmarks.length})</button>`;
        configuredBenchmarks.forEach(bm => {
            tabsHtml += `<button class="benchmark-tab-pill ${activeBenchmarkView === bm ? 'active' : ''}" type="button" onclick="switchBenchmarkView('${bm}')">${bm}</button>`;
        });
        tabsEl.innerHTML = tabsHtml;

        // Populate filter target select
        if (filterBenchmarkSelect) {
            let optsHtml = `<option value="all">All / Any Benchmark</option>`;
            configuredBenchmarks.forEach(bm => {
                optsHtml += `<option value="${bm}">${bm}</option>`;
            });
            filterBenchmarkSelect.innerHTML = optsHtml;
            filterBenchmarkSelect.value = filterBenchmarkTarget;
        }
    } else {
        tabsContainer.style.display = "none";
        if (filterBenchmarkField) filterBenchmarkField.style.display = "none";
    }
}

function switchBenchmarkView(view) {
    activeBenchmarkView = view;

    // Update active class on tabs
    document.querySelectorAll(".benchmark-tab-pill").forEach(btn => {
        btn.classList.toggle("active", btn.textContent.startsWith(view) || (view === "compare" && btn.textContent.startsWith("Compare")));
    });

    if (view === "compare") {
        currentSortColumn = configuredBenchmarks.length > 0 ? `correlation_${configuredBenchmarks[0]}` : "ticker";
        filterBenchmarkTarget = "all";
        const sel = document.getElementById("filterBenchmarkSelect");
        if (sel) sel.value = "all";
    } else {
        currentSortColumn = "correlation";
        filterBenchmarkTarget = view;
        const sel = document.getElementById("filterBenchmarkSelect");
        if (sel) sel.value = view;
    }

    currentSortDirection = "desc";
    setupBenchmarkTableHeader();
    buildScreenerRows(latestAnalysisData);
    applyScreenerFilters();
}

function setupBenchmarkTableHeader() {
    const thead = document.getElementById("benchmarkTableHead");
    if (!thead) return;

    if (activeBenchmarkView === "compare" && configuredBenchmarks.length > 1) {
        // Multi-Benchmark Comparison Table Header
        let thHtml = `<tr>
            <th data-sort="ticker" class="sortable-th tooltip-header" data-tooltip-title="Ticker" data-tooltip-text="Тикер анализируемого актива.">
                Ticker <span class="sort-icon">⇅</span>
            </th>`;

        configuredBenchmarks.forEach(bm => {
            thHtml += `
                <th data-sort="correlation_${bm}" class="sortable-th tooltip-header" data-tooltip-title="Correlation vs ${bm}" data-tooltip-text="Коэффициент корреляции Пирсона между активом и ${bm}.">
                    Corr (${bm}) <span class="sort-icon">⇅</span>
                </th>
                <th data-sort="beta_${bm}" class="sortable-th tooltip-header" data-tooltip-title="Beta vs ${bm}" data-tooltip-text="Beta актива относительно ${bm}.">
                    Beta (${bm}) <span class="sort-icon">⇅</span>
                </th>
                <th data-sort="expected_move_${bm}" class="sortable-th tooltip-header" data-tooltip-title="Expected Move (${bm})" data-tooltip-text="Расчётное ожидаемое движение актива по модели ${bm}.">
                    Exp (${bm}) <span class="sort-icon">⇅</span>
                </th>
            `;
        });

        thHtml += `
            <th data-sort="actual_move" class="sortable-th tooltip-header" data-tooltip-title="Actual Move" data-tooltip-text="Фактическое движение актива.">
                Actual Move <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="volatility" class="sortable-th tooltip-header" data-tooltip-title="Daily Volatility" data-tooltip-text="Историческая дневная close-to-close волатильность акции.">
                Daily Vol <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="observations" class="sortable-th tooltip-header" data-tooltip-title="Observations" data-tooltip-text="Количество торговых наблюдений.">
                Obs <span class="sort-icon">⇅</span>
            </th>
            <th style="width: 60px;">Action</th>
        </tr>`;

        thead.innerHTML = thHtml;

    } else {
        // Single Benchmark In-Depth Header
        const bmLabel = activeBenchmarkView !== "compare" ? activeBenchmarkView : (configuredBenchmarks[0] || "Market");
        thead.innerHTML = `<tr>
            <th data-sort="ticker" class="sortable-th tooltip-header" data-tooltip-title="Ticker" data-tooltip-text="Тикер анализируемого актива.">
                Ticker <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="correlation" class="sortable-th tooltip-header" data-tooltip-title="Correlation vs ${bmLabel}" data-tooltip-text="Коэффициент корреляции Пирсона между активом и ${bmLabel} (от -1.0 до +1.0).">
                Correlation <span class="sort-icon">▼</span>
            </th>
            <th data-sort="beta" class="sortable-th tooltip-header" data-tooltip-title="Beta vs ${bmLabel}" data-tooltip-text="Beta актива относительно ${bmLabel}.">
                Beta <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="expected_move" class="sortable-th tooltip-header" data-tooltip-title="Expected Move (${bmLabel})" data-tooltip-text="Расчётное движение акции: Market Move × Beta.">
                Expected Move <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="actual_move" class="sortable-th tooltip-header" data-tooltip-title="Actual Move" data-tooltip-text="Фактическое движение актива.">
                Actual Move <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="difference" class="sortable-th tooltip-header" data-tooltip-title="Difference" data-tooltip-text="Разница: Actual Move − Expected Move.">
                Difference <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="normalized" class="sortable-th tooltip-header" data-tooltip-title="Normalized Difference" data-tooltip-text="Отклонение в сигмах волатильности (Difference ÷ Volatility).">
                Normalized <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="volatility" class="sortable-th tooltip-header" data-tooltip-title="Daily Volatility" data-tooltip-text="Историческая дневная волатильность акции.">
                Daily Vol <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="residual_volatility" class="sortable-th tooltip-header" data-tooltip-title="Residual Volatility" data-tooltip-text="Остаточная волатильность вне модели beta.">
                Residual Vol <span class="sort-icon">⇅</span>
            </th>
            <th data-sort="observations" class="sortable-th tooltip-header" data-tooltip-title="Observations" data-tooltip-text="Количество совместных торговых дней.">
                Obs <span class="sort-icon">⇅</span>
            </th>
            <th style="width: 60px;">Action</th>
        </tr>`;
    }

    // Attach sorting handlers
    thead.querySelectorAll("th[data-sort]").forEach(th => {
        th.addEventListener("click", () => handleTableSort(th.dataset.sort));
    });
}

function buildScreenerRows(data) {
    if (!data) return;

    const correlation = data.correlation || {};
    const benchmarksData = data.benchmarks_data || {};
    const primaryBm = configuredBenchmarks[0] || "SPY";

    const symbols = data.tickers || Object.keys(data.expected_range || {}).filter(t => !configuredBenchmarks.includes(t));
    const rows = [];

    if (activeBenchmarkView === "compare" && configuredBenchmarks.length > 1) {
        symbols.forEach(ticker => {
            if (configuredBenchmarks.includes(ticker)) return;

            const primaryItem = (benchmarksData[primaryBm]?.expected_range?.[ticker]) || (data.expected_range?.[ticker]) || {};
            const hInfo = (data.tickers_history_info?.[ticker]) || (data.partial_tickers?.[ticker]) || primaryItem || {};

            const row = {
                ticker: ticker,
                actual_move: Number.isFinite(primaryItem.actual_move) ? primaryItem.actual_move : null,
                volatility: Number.isFinite(primaryItem.volatility) ? primaryItem.volatility : null,
                observations: primaryItem.observations ?? null,
                is_partial_history: Boolean(hInfo.is_partial_history || hInfo.is_partial),
                history_period_ru: hInfo.history_period_ru || null,
                history_text: hInfo.history_text || null,
                history_start: hInfo.history_start || null,
                history_end: hInfo.history_end || null,
                history_days: hInfo.history_days ?? null,
                history_observations: hInfo.history_observations ?? primaryItem.observations,
                selected_period_label: hInfo.selected_period_label || data.period,
                benchmarks_metrics: {}
            };

            configuredBenchmarks.forEach(bm => {
                const bmInfo = benchmarksData[bm]?.expected_range?.[ticker] || {};
                const corrVal = correlation[ticker]?.[bm];
                const betaVal = bmInfo.beta;
                const expVal = bmInfo.expected_stock_move;
                const diffVal = bmInfo.difference;
                const normVal = bmInfo.normalized_difference;
                const resVolVal = bmInfo.residual_volatility;

                row[`correlation_${bm}`] = Number.isFinite(corrVal) ? corrVal : null;
                row[`beta_${bm}`] = Number.isFinite(betaVal) ? betaVal : null;
                row[`expected_move_${bm}`] = Number.isFinite(expVal) ? expVal : null;
                row[`difference_${bm}`] = Number.isFinite(diffVal) ? diffVal : null;
                row[`normalized_${bm}`] = Number.isFinite(normVal) ? normVal : null;
                row[`residual_volatility_${bm}`] = Number.isFinite(resVolVal) ? resVolVal : null;

                row.benchmarks_metrics[bm] = {
                    correlation: row[`correlation_${bm}`],
                    beta: row[`beta_${bm}`],
                    expected_move: row[`expected_move_${bm}`],
                    difference: row[`difference_${bm}`],
                    normalized: row[`normalized_${bm}`],
                    volatility: row.volatility,
                    residual_volatility: row[`residual_volatility_${bm}`],
                    observations: row.observations,
                    actual_move: row.actual_move
                };
            });

            rows.push(row);
        });

    } else {
        const activeBm = activeBenchmarkView !== "compare" ? activeBenchmarkView : primaryBm;
        const bmExpected = (benchmarksData[activeBm]?.expected_range) || (data.expected_range) || {};

        symbols.forEach(ticker => {
            if (configuredBenchmarks.includes(ticker)) return;

            const item = bmExpected[ticker] || {};
            const corrVal = correlation[ticker]?.[activeBm];
            const hInfo = (data.tickers_history_info?.[ticker]) || (data.partial_tickers?.[ticker]) || item || {};

            const row = {
                ticker: ticker,
                correlation: Number.isFinite(corrVal) ? corrVal : null,
                beta: Number.isFinite(item.beta) ? item.beta : null,
                expected_move: Number.isFinite(item.expected_stock_move) ? item.expected_stock_move : null,
                actual_move: Number.isFinite(item.actual_move) ? item.actual_move : null,
                difference: Number.isFinite(item.difference) ? item.difference : null,
                normalized: Number.isFinite(item.normalized_difference) ? item.normalized_difference : null,
                volatility: Number.isFinite(item.volatility) ? item.volatility : null,
                residual_volatility: Number.isFinite(item.residual_volatility) ? item.residual_volatility : null,
                observations: item.observations ?? null,
                is_partial_history: Boolean(hInfo.is_partial_history || hInfo.is_partial),
                history_period_ru: hInfo.history_period_ru || null,
                history_text: hInfo.history_text || null,
                history_start: hInfo.history_start || null,
                history_end: hInfo.history_end || null,
                history_days: hInfo.history_days ?? null,
                history_observations: hInfo.history_observations ?? item.observations,
                selected_period_label: hInfo.selected_period_label || data.period,
                benchmarks_metrics: {
                    [activeBm]: {
                        correlation: Number.isFinite(corrVal) ? corrVal : null,
                        beta: Number.isFinite(item.beta) ? item.beta : null,
                        expected_move: Number.isFinite(item.expected_stock_move) ? item.expected_stock_move : null,
                        actual_move: Number.isFinite(item.actual_move) ? item.actual_move : null,
                        difference: Number.isFinite(item.difference) ? item.difference : null,
                        normalized: Number.isFinite(item.normalized_difference) ? item.normalized_difference : null,
                        volatility: Number.isFinite(item.volatility) ? item.volatility : null,
                        residual_volatility: Number.isFinite(item.residual_volatility) ? item.residual_volatility : null,
                        observations: item.observations ?? null
                    }
                }
            };

            rows.push(row);
        });
    }

    latestBenchmarkRows = rows;
}

function checkCorrelationMatch(c, op, threshold, thresholdMax) {
    if (!Number.isFinite(c)) return false;
    if (op === "all") return true;
    if (op === "gte") return Number.isFinite(threshold) ? c >= threshold : true;
    if (op === "lte") return Number.isFinite(threshold) ? c <= threshold : true;
    if (op === "between") {
        const min = Number.isFinite(threshold) ? threshold : -1;
        const max = Number.isFinite(thresholdMax) ? thresholdMax : 1;
        return c >= min && c <= max;
    }
    if (op === "abs_gte") return Number.isFinite(threshold) ? Math.abs(c) >= threshold : true;
    return true;
}

function applyScreenerFilters() {
    if (!latestBenchmarkRows.length) return;

    const op = document.getElementById("correlationOperator")?.value || "gte";
    const threshold = parseFloat(document.getElementById("correlationThreshold")?.value);
    const thresholdMax = parseFloat(document.getElementById("correlationThresholdMax")?.value);
    const searchQuery = normalizeTicker(document.getElementById("screenerSearch")?.value);

    filteredBenchmarkRows = latestBenchmarkRows.filter(row => {
        if (searchQuery && !row.ticker.includes(searchQuery)) {
            return false;
        }

        if (activeBenchmarkView === "compare" && configuredBenchmarks.length > 1) {
            if (filterBenchmarkTarget !== "all" && filterBenchmarkTarget) {
                const c = row[`correlation_${filterBenchmarkTarget}`];
                return checkCorrelationMatch(c, op, threshold, thresholdMax);
            } else {
                return configuredBenchmarks.some(bm => {
                    const c = row[`correlation_${bm}`];
                    return checkCorrelationMatch(c, op, threshold, thresholdMax);
                });
            }
        } else {
            const c = row.correlation;
            return checkCorrelationMatch(c, op, threshold, thresholdMax);
        }
    });

    sortFilteredRows();

    const countEl = document.getElementById("benchmarkResultCount");
    const totalEl = document.getElementById("benchmarkResultTotal");
    const filterBadge = document.getElementById("activeFilterBadge");

    if (countEl) countEl.textContent = filteredBenchmarkRows.length;
    if (totalEl) totalEl.textContent = `/ ${latestBenchmarkRows.length} assets`;
    if (filterBadge) {
        const targetLabel = (filterBenchmarkTarget && filterBenchmarkTarget !== "all") ? ` (${filterBenchmarkTarget})` : "";
        if (op === "all") filterBadge.textContent = "All Assets";
        else if (op === "gte") filterBadge.textContent = `r ≥ ${threshold.toFixed(2)}${targetLabel}`;
        else if (op === "lte") filterBadge.textContent = `r ≤ ${threshold.toFixed(2)}${targetLabel}`;
        else if (op === "between") filterBadge.textContent = `${threshold.toFixed(2)} ≤ r ≤ ${thresholdMax.toFixed(2)}${targetLabel}`;
        else if (op === "abs_gte") filterBadge.textContent = `|r| ≥ ${threshold.toFixed(2)}${targetLabel}`;
    }

    currentPage = 1;
    updateScreenerPartialButton();
    renderScreenerTablePage();
}

function handleOperatorChange() {
    const op = document.getElementById("correlationOperator")?.value;
    const maxField = document.getElementById("thresholdMaxField");
    const minLabel = document.getElementById("thresholdMinLabel");

    if (op === "between") {
        if (maxField) maxField.style.display = "block";
        if (minLabel) minLabel.textContent = "Min Threshold";
    } else {
        if (maxField) maxField.style.display = "none";
        if (minLabel) minLabel.textContent = op === "abs_gte" ? "|Correlation| Threshold" : "Correlation Threshold";
    }
    applyScreenerFilters();
}

function handlePresetClick(button) {
    document.querySelectorAll(".preset-pill:not(.tracker-preset)").forEach(p => p.classList.remove("active"));
    button.classList.add("active");

    const op = button.dataset.op;
    const val = button.dataset.val;

    const opSelect = document.getElementById("correlationOperator");
    const threshInput = document.getElementById("correlationThreshold");

    if (op === "all") {
        if (opSelect) opSelect.value = "all";
    } else {
        if (opSelect) opSelect.value = op;
        if (threshInput) threshInput.value = val;
    }

    handleOperatorChange();
}

function handleTableSort(column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === "desc" ? "asc" : "desc";
    } else {
        currentSortColumn = column;
        currentSortDirection = ["ticker"].includes(column) ? "asc" : "desc";
    }

    document.querySelectorAll(".benchmark-table th").forEach(th => {
        const icon = th.querySelector(".sort-icon");
        if (!icon) return;
        if (th.dataset.sort === currentSortColumn) {
            icon.textContent = currentSortDirection === "desc" ? "▼" : "▲";
            th.classList.add("sorted");
        } else {
            icon.textContent = "⇅";
            th.classList.remove("sorted");
        }
    });

    sortFilteredRows();
    renderScreenerTablePage();
}

function sortFilteredRows() {
    filteredBenchmarkRows.sort((a, b) => {
        let valA = a[currentSortColumn];
        let valB = b[currentSortColumn];

        if (valA === null || valA === undefined) valA = currentSortDirection === "desc" ? -Infinity : Infinity;
        if (valB === null || valB === undefined) valB = currentSortDirection === "desc" ? -Infinity : Infinity;

        if (typeof valA === "string") {
            return currentSortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }

        return currentSortDirection === "asc" ? valA - valB : valB - valA;
    });
}

function handlePageSizeChange(e) {
    const val = e.target.value;
    pageSize = val === "all" ? Infinity : parseInt(val, 10);
    currentPage = 1;
    renderScreenerTablePage();
}

function changePage(page) {
    const maxPage = Math.ceil(filteredBenchmarkRows.length / (pageSize === Infinity ? filteredBenchmarkRows.length || 1 : pageSize));
    if (page < 1 || page > maxPage) return;
    currentPage = page;
    renderScreenerTablePage();
}

function renderScreenerTablePage() {
    const tbody = document.getElementById("benchmarkResultsTable");
    const paginationInfo = document.getElementById("paginationInfo");
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    const pageNumbersEl = document.getElementById("pageNumbers");
    if (!tbody) return;

    tbody.innerHTML = "";

    const total = filteredBenchmarkRows.length;
    const colSpan = (activeBenchmarkView === "compare" && configuredBenchmarks.length > 1) ? (5 + configuredBenchmarks.length * 3) : 11;

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="no-results-td">No assets match the selected correlation criteria.</td></tr>`;
        if (paginationInfo) paginationInfo.textContent = "0 of 0 assets";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (pageNumbersEl) pageNumbersEl.innerHTML = "";
        return;
    }

    const effectivePageSize = pageSize === Infinity ? total : pageSize;
    const totalPages = Math.ceil(total / effectivePageSize);
    currentPage = Math.min(currentPage, totalPages);

    const startIdx = (currentPage - 1) * effectivePageSize;
    const endIdx = Math.min(startIdx + effectivePageSize, total);
    const pageRows = filteredBenchmarkRows.slice(startIdx, endIdx);

    const frag = document.createDocumentFragment();

    if (activeBenchmarkView === "compare" && configuredBenchmarks.length > 1) {
        pageRows.forEach(item => {
            const tr = document.createElement("tr");
            let tdHtml = `${renderTickerCellHtml(item, "screener")}`;

            configuredBenchmarks.forEach(bm => {
                const cVal = item[`correlation_${bm}`];
                const bVal = item[`beta_${bm}`];
                const expVal = item[`expected_move_${bm}`];
                const corrBg = getCorrelationColor(cVal);

                tdHtml += `
                    <td class="corr-cell">
                        <span class="corr-pill" style="background: ${corrBg}">
                            ${formatNumber(cVal, 3)}
                        </span>
                    </td>
                    <td>${formatNumber(bVal, 3)}</td>
                    <td>${formatPercent(expVal)}</td>
                `;
            });

            tdHtml += `
                <td>${formatPercent(item.actual_move)}</td>
                <td>${formatPercent(item.volatility)}</td>
                <td class="obs-cell">${item.observations ?? "—"}</td>
                <td class="action-cell">
                    <button class="tracker-remove-btn" type="button" onclick="removeScreenerTicker('${item.ticker}')" title="Убрать ${item.ticker} из таблицы">×</button>
                </td>
            `;

            tr.innerHTML = tdHtml;
            frag.appendChild(tr);
        });

    } else {
        pageRows.forEach(item => {
            const tr = document.createElement("tr");
            const corrBg = getCorrelationColor(item.correlation);
            const isPosDiff = item.difference > 0;
            const isNegDiff = item.difference < 0;
            const isPosNorm = item.normalized > 0;
            const isNegNorm = item.normalized < 0;

            tr.innerHTML = `
                ${renderTickerCellHtml(item, "screener")}
                <td class="corr-cell">
                    <span class="corr-pill" style="background: ${corrBg}">
                        ${formatNumber(item.correlation, 3)}
                    </span>
                </td>
                <td>${formatNumber(item.beta, 3)}</td>
                <td>${formatPercent(item.expected_move)}</td>
                <td>${formatPercent(item.actual_move)}</td>
                <td class="${isPosDiff ? "positive-cell" : isNegDiff ? "negative-cell" : ""}">
                    ${formatPercent(item.difference)}
                </td>
                <td class="${isPosNorm ? "positive-cell" : isNegNorm ? "negative-cell" : ""}">
                    ${formatSignedNumber(item.normalized, 2)}
                </td>
                <td>${formatPercent(item.volatility)}</td>
                <td>${formatPercent(item.residual_volatility)}</td>
                <td class="obs-cell">${item.observations ?? "—"}</td>
                <td class="action-cell">
                    <button class="tracker-remove-btn" type="button" onclick="removeScreenerTicker('${item.ticker}')" title="Убрать ${item.ticker} из таблицы">×</button>
                </td>
            `;

            frag.appendChild(tr);
        });
    }

    tbody.appendChild(frag);

    if (paginationInfo) {
        paginationInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${total} assets`;
    }
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (pageNumbersEl) {
        pageNumbersEl.textContent = `Page ${currentPage} of ${totalPages}`;
    }
}

// ============================================================
// EXCEL EXPORT & CLIPBOARD (UNIVERSE SCREENER)
// ============================================================

async function exportExcel(exportAll = false) {
    const rowsToExport = exportAll ? latestBenchmarkRows : filteredBenchmarkRows;

    if (!rowsToExport || !rowsToExport.length) {
        showError("Нет данных для экспорта.");
        return;
    }

    const primaryBm = configuredBenchmarks[0] || "SPY";
    const benchmark = activeBenchmarkView !== "compare" ? activeBenchmarkView : primaryBm;
    const period = latestAnalysisData?.period || "1y";
    const filterLabel = exportAll ? "All Configured Assets" : document.getElementById("activeFilterBadge")?.textContent || "Filtered Assets";

    const exportBtn = exportAll ? document.getElementById("exportAllButton") : document.getElementById("exportFilteredButton");
    const originalText = exportBtn ? exportBtn.textContent : "";
    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.textContent = "Generating Excel...";
    }

    try {
        const res = await fetch("/api/export-excel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                rows: rowsToExport,
                benchmarks: configuredBenchmarks,
                benchmark: benchmark,
                benchmarks_data: latestAnalysisData?.benchmarks_data || {},
                is_multi_benchmark: (activeBenchmarkView === "compare"),
                period: period,
                benchmark_move: latestAnalysisData?.benchmark_move || 0.01,
                filter_label: filterLabel
            })
        });

        if (!res.ok) {
            let msg = "Excel export failed.";
            try {
                const errJson = await res.json();
                msg = errJson?.error || msg;
            } catch {}
            throw new Error(msg);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        const tag = exportAll ? "all" : "filtered";
        const bmTag = configuredBenchmarks.length > 1 ? configuredBenchmarks.slice(0, 3).join("_") : benchmark;
        link.download = `correlation_${bmTag}_${period}_${tag}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        showWarning(`Файл Excel (${rowsToExport.length} тикеров) успешно скачан!`);

    } catch (err) {
        console.error("Excel download error:", err);
        showError(err.message || "Не удалось скачать файл Excel.");
    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.textContent = originalText;
        }
    }
}

function copyFilteredTickersToClipboard() {
    if (!filteredBenchmarkRows.length) {
        showError("Список тикеров пуст.");
        return;
    }

    const tickersList = filteredBenchmarkRows.map(r => r.ticker).join(", ");
    navigator.clipboard.writeText(tickersList).then(() => {
        const copyBtn = document.getElementById("copyTickersButton");
        if (copyBtn) {
            const orig = copyBtn.textContent;
            copyBtn.textContent = "Copied!";
            setTimeout(() => copyBtn.textContent = orig, 1800);
        }
        showWarning(`Скопировано ${filteredBenchmarkRows.length} тикеров в буфер обмена: ${tickersList.slice(0, 40)}...`);
    }).catch(() => {
        showError("Не удалось скопировать тикеры.");
    });
}

// ============================================================
// CORRELATION MATRIX & BETA MATRIX (HEATMAP)
// ============================================================

function handleMatrixCorrOperatorChange() {
    const op = document.getElementById("matrixCorrelationOperator")?.value;
    const maxField = document.getElementById("matrixCorrMaxField");
    const minLabel = document.getElementById("matrixCorrMinLabel");

    if (op === "between") {
        if (maxField) maxField.style.display = "block";
        if (minLabel) minLabel.textContent = "Min Threshold";
    } else {
        if (maxField) maxField.style.display = "none";
        if (minLabel) minLabel.textContent = op === "abs_gte" ? "|Correlation| Threshold" : "Correlation Threshold";
    }
    renderCorrelationMatrix();
}

function handleMatrixCorrPresetClick(button) {
    document.querySelectorAll(".matrix-corr-preset").forEach(p => p.classList.remove("active"));
    button.classList.add("active");

    const op = button.dataset.op;
    const val = button.dataset.val;

    const opSelect = document.getElementById("matrixCorrelationOperator");
    const threshInput = document.getElementById("matrixCorrelationThreshold");

    if (op === "all") {
        if (opSelect) opSelect.value = "all";
    } else {
        if (opSelect) opSelect.value = op;
        if (threshInput) threshInput.value = val;
    }

    handleMatrixCorrOperatorChange();
}

function renderCorrelationMatrix(data) {
    if (!data) data = latestAnalysisData;
    if (!data) return;

    const table = document.getElementById("correlationMatrix");
    if (!table) return;

    const op = document.getElementById("matrixCorrelationOperator")?.value || "gte";
    const threshold = parseFloat(document.getElementById("matrixCorrelationThreshold")?.value);
    const thresholdMax = parseFloat(document.getElementById("matrixCorrelationThresholdMax")?.value);
    const filterMode = document.getElementById("matrixCorrFilterMode")?.value || "any_pair";
    const searchQuery = normalizeTicker(document.getElementById("matrixSearchInput")?.value);

    const allSymbols = data.all_symbols || Object.keys(data.correlation || {});
    const benchmarks = configuredBenchmarks.length ? configuredBenchmarks : [data.benchmark || "SPY"];

    // Determine matching symbols
    const matchingSymbols = allSymbols.filter(sym => {
        // Search query filter
        if (searchQuery && !sym.includes(searchQuery)) {
            return false;
        }

        if (op === "all" || filterMode === "dim_cells") {
            return true;
        }

        if (filterMode === "benchmark_only") {
            return benchmarks.some(bm => {
                if (sym === bm) return true;
                const val = data.correlation?.[sym]?.[bm];
                return checkCorrelationMatch(val, op, threshold, thresholdMax);
            });
        }

        // any_pair mode: stock must have at least 1 pair with another stock meeting the condition
        return allSymbols.some(otherSym => {
            if (sym === otherSym) return false;
            const val = data.correlation?.[sym]?.[otherSym];
            return checkCorrelationMatch(val, op, threshold, thresholdMax);
        });
    });

    // Update status counters & badge
    const countEl = document.getElementById("matrixCorrMatchCount");
    const totalEl = document.getElementById("matrixCorrMatchTotal");
    const badgeEl = document.getElementById("matrixCorrActiveFilterBadge");

    if (countEl) countEl.textContent = matchingSymbols.length;
    if (totalEl) totalEl.textContent = `/ ${allSymbols.length} assets`;
    if (badgeEl) {
        if (op === "all") badgeEl.textContent = "All Values";
        else if (op === "gte") badgeEl.textContent = `r ≥ ${threshold.toFixed(2)}`;
        else if (op === "lte") badgeEl.textContent = `r ≤ ${threshold.toFixed(2)}`;
        else if (op === "between") badgeEl.textContent = `${threshold.toFixed(2)} ≤ r ≤ ${thresholdMax.toFixed(2)}`;
        else if (op === "abs_gte") badgeEl.textContent = `|r| ≥ ${threshold.toFixed(2)}`;
    }

    if (matchingSymbols.length === 0) {
        table.innerHTML = `<tbody><tr><td class="no-results-td">Нет активов, удовлетворяющих условию корреляции (${badgeEl?.textContent || ""}). Попробуйте изменить порог.</td></tr></tbody>`;
        return;
    }

    const renderSymbols = matchingSymbols.slice(0, 100);

    let html = "<thead><tr><th></th>";
    renderSymbols.forEach(s => {
        html += `<th>${s}</th>`;
    });
    html += "</tr></thead><tbody>";

    renderSymbols.forEach(rowSym => {
        html += `<tr><th>${rowSym}</th>`;
        renderSymbols.forEach(colSym => {
            const val = data.correlation?.[rowSym]?.[colSym];
            const isDiag = rowSym === colSym;
            const isMatch = isDiag || checkCorrelationMatch(val, op, threshold, thresholdMax);
            const isDimmed = (op !== "all") && !isMatch;
            const color = isDimmed ? "transparent" : getCorrelationColor(val);
            const cellClass = isDimmed ? "matrix-cell-dimmed" : (isMatch && op !== "all" && !isDiag ? "matrix-cell-matched" : "");

            html += `<td style="background: ${color}" class="${cellClass}">${formatNumber(val, 2)}</td>`;
        });
        html += "</tr>";
    });

    html += "</tbody>";
    table.innerHTML = html;
}

function handleMatrixBetaOperatorChange() {
    const op = document.getElementById("matrixBetaOperator")?.value;
    const maxField = document.getElementById("matrixBetaMaxField");
    const minLabel = document.getElementById("matrixBetaMinLabel");

    if (op === "between") {
        if (maxField) maxField.style.display = "block";
        if (minLabel) minLabel.textContent = "Min Threshold";
    } else {
        if (maxField) maxField.style.display = "none";
        if (minLabel) minLabel.textContent = op === "abs_gte" ? "|Beta| Threshold" : "Beta Threshold";
    }
    renderBetaMatrix();
}

function handleMatrixBetaPresetClick(button) {
    document.querySelectorAll(".matrix-beta-preset").forEach(p => p.classList.remove("active"));
    button.classList.add("active");

    const op = button.dataset.op;
    const val = button.dataset.val;

    const opSelect = document.getElementById("matrixBetaOperator");
    const threshInput = document.getElementById("matrixBetaThreshold");

    if (op === "all") {
        if (opSelect) opSelect.value = "all";
    } else {
        if (opSelect) opSelect.value = op;
        if (threshInput) threshInput.value = val;
    }

    handleMatrixBetaOperatorChange();
}

function renderBetaMatrix(data) {
    if (!data) data = latestAnalysisData;
    if (!data) return;

    const table = document.getElementById("betaMatrix");
    const label = document.getElementById("betaBenchmark");
    if (!table) return;

    const bmList = configuredBenchmarks.length ? configuredBenchmarks.join(", ") : (data.benchmark || "SPY");
    if (label) {
        label.textContent = `Market Reference: ${bmList}`;
    }

    const op = document.getElementById("matrixBetaOperator")?.value || "gte";
    const threshold = parseFloat(document.getElementById("matrixBetaThreshold")?.value);
    const thresholdMax = parseFloat(document.getElementById("matrixBetaThresholdMax")?.value);
    const filterMode = document.getElementById("matrixBetaFilterMode")?.value || "any_pair";
    const searchQuery = normalizeTicker(document.getElementById("betaMatrixSearchInput")?.value);

    const allSymbols = data.all_symbols || Object.keys(data.beta || {});
    const benchmarks = configuredBenchmarks.length ? configuredBenchmarks : [data.benchmark || "SPY"];

    // Determine matching symbols
    const matchingSymbols = allSymbols.filter(sym => {
        if (searchQuery && !sym.includes(searchQuery)) {
            return false;
        }

        if (op === "all" || filterMode === "dim_cells") {
            return true;
        }

        if (filterMode === "benchmark_only") {
            return benchmarks.some(bm => {
                if (sym === bm) return true;
                const val = data.beta?.[sym]?.[bm];
                return checkCorrelationMatch(val, op, threshold, thresholdMax);
            });
        }

        return allSymbols.some(otherSym => {
            if (sym === otherSym) return false;
            const val = data.beta?.[sym]?.[otherSym];
            return checkCorrelationMatch(val, op, threshold, thresholdMax);
        });
    });

    // Update status counters & badge
    const countEl = document.getElementById("matrixBetaMatchCount");
    const totalEl = document.getElementById("matrixBetaMatchTotal");
    const badgeEl = document.getElementById("matrixBetaActiveFilterBadge");

    if (countEl) countEl.textContent = matchingSymbols.length;
    if (totalEl) totalEl.textContent = `/ ${allSymbols.length} assets`;
    if (badgeEl) {
        if (op === "all") badgeEl.textContent = "All Values";
        else if (op === "gte") badgeEl.textContent = `β ≥ ${threshold.toFixed(2)}`;
        else if (op === "lte") badgeEl.textContent = `β ≤ ${threshold.toFixed(2)}`;
        else if (op === "between") badgeEl.textContent = `${threshold.toFixed(2)} ≤ β ≤ ${thresholdMax.toFixed(2)}`;
        else if (op === "abs_gte") badgeEl.textContent = `|β| ≥ ${threshold.toFixed(2)}`;
    }

    if (matchingSymbols.length === 0) {
        table.innerHTML = `<tbody><tr><td class="no-results-td">Нет активов, удовлетворяющих условию беты (${badgeEl?.textContent || ""}). Попробуйте изменить порог.</td></tr></tbody>`;
        return;
    }

    const renderSymbols = matchingSymbols.slice(0, 100);

    let html = "<thead><tr><th>Asset</th>";
    renderSymbols.forEach(s => {
        html += `<th>${s}</th>`;
    });
    html += "</tr></thead><tbody>";

    renderSymbols.forEach(rowSym => {
        html += `<tr><th>${rowSym}</th>`;
        renderSymbols.forEach(colSym => {
            const val = data.beta?.[rowSym]?.[colSym];
            const isDiag = rowSym === colSym;
            const isMatch = isDiag || checkCorrelationMatch(val, op, threshold, thresholdMax);
            const isDimmed = (op !== "all") && !isMatch;
            const color = isDimmed ? "transparent" : getBetaColor(val);
            const cellClass = [
                isDiag ? 'diag-cell' : '',
                isDimmed ? 'matrix-cell-dimmed' : '',
                (isMatch && op !== "all" && !isDiag) ? 'matrix-cell-matched' : ''
            ].filter(Boolean).join(' ');

            html += `<td style="background: ${color}" class="${cellClass}">${formatNumber(val, 3)}</td>`;
        });
        html += "</tr>";
    });

    html += "</tbody>";
    table.innerHTML = html;
}

// ============================================================
// ALERTS & TOASTS
// ============================================================

let alertTimeout = null;

function showError(msg) {
    const errorEl = document.getElementById("error");
    if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = "block";
        clearTimeout(alertTimeout);
        alertTimeout = setTimeout(() => {
            errorEl.style.display = "none";
        }, 5000);
    }
}

function showWarning(msg) {
    const warnEl = document.getElementById("warning");
    if (warnEl) {
        warnEl.textContent = msg;
        warnEl.style.display = "block";
        clearTimeout(alertTimeout);
        alertTimeout = setTimeout(() => {
            warnEl.style.display = "none";
        }, 5000);
    }
}

function clearAlerts() {
    const errorEl = document.getElementById("error");
    const warnEl = document.getElementById("warning");
    if (errorEl) { errorEl.textContent = ""; errorEl.style.display = "none"; }
    if (warnEl) { warnEl.textContent = ""; warnEl.style.display = "none"; }
}

function escapeHtml(str) {
    return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}
