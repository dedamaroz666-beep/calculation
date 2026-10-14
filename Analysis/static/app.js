/**
 * Stock Analytics & Correlation Platform - Unified Multi-Theme Frontend Engine
 * Tab 1: Correlation & Beta Calculator (Empty initial state by default)
 * Tab 2: FinWhale Dual TradingView Charts & Ticker Analytics
 * Themes: "sand" (Бежевый / FinWhale), "blue" (Синий), "graphite" (Графит)
 */

// ============================================================
// GLOBAL APPLICATION STATE
// ============================================================

// Tab 1 (Calculator) State - Clean empty initial state by default
let groupsState = {}; // { groupName: [ "COHR", "CRWV", ... ] }
let groupsMoveState = {}; // { ticker: floatOrNull }
let calculationResults = null;
let lastPearsonData = null;
let lastPearsonDisplaySymbols = [];
let lastBetaData = null;
let lastBetaDisplaySymbols = [];
let corrTableFilterOp = "none";
let corrTableFilterVal = 0.50;
let lastFilteredCorrList = [];
let activeBenchmarkView = "SPY";
let availableDbTickers = [];

function parseFilterNumber(val, defaultVal = 0) {
    if (val === null || val === undefined) return defaultVal;
    if (typeof val === "number") return isNaN(val) ? defaultVal : val;
    const str = String(val).trim().replace(",", ".");
    const num = parseFloat(str);
    return isNaN(num) ? defaultVal : num;
}

// Screener State
let screenerAllData = [];
let screenerFilteredData = [];
let corrSortCol = null;
let corrSortAsc = false;
let screenerSortCol = "correlation";
let screenerSortAsc = false;
let screenerPage = 1;
let screenerPageSize = 50;

// Tab 2 (FinWhale Stock Analytics) State
let currentStockTicker = "AAPL";
let activePremarketWindow = "04:00_09:30";
let activeCorrPeriod = "1y";
let activeTfMultiplier = 1;
let currentMarkerDetails = {};
let currentDailyCandlesMap = {};
let currentDailyCandles = [];

// Volume Visibility State
let isDailyVolVisible = true;
let isIntradayVolVisible = true;

// Active Peers for Dynamic Correlation Matrix
let currentActivePeers = [];

// Earnings Matrix Data & Column Metrics Selection
let currentEarningsMatrix = [];
let selectedDayMetrics = {
    "R-1": "postmarket",
    "R": "close_to_close",
    "R+1": "close_to_close",
    "R+2": "close_to_close"
};

// Lightweight Charts Instances
let dailyChart = null;
let dailySeries = null;
let dailyVolumeSeries = null;
let dailySelectionSeries = null;
let activeSelectedDailyDate = null;

let intradayChart = null;
let intradaySeries = null;
let intradayVolumeSeries = null;
let intradayBgSeries = null;

// Intraday Data & Viewport State
let currentIntradayAbortController = null;
let currentIntradayLoadedTicker = null;
let currentIntradayMultiplier = null;
let currentIntradayCandlesByDate = new Map();
let currentIntradaySortedTimes = [];
let userInteractedIntradayDuringLoad = false;
let lastDailyPointerDown = { x: 0, y: 0, time: 0 };
let lastDailyPointerUp = { x: 0, y: 0, time: 0 };

// TradingView Measure Tool (Date & Price Range Ruler)
let dailyRulerInstance = null;
let intradayRulerInstance = null;
let suppressChartClickAction = false;

// Theme State
let currentTheme = localStorage.getItem("stock_analytics_theme") || "sand";


// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initGlobalNavigation();
    initCalculatorGroups();
    initCalculatorEvents();
    initScreenerFilterEvents();
    initMatrixFilterEvents();
    initCharts();
    initStockAnalyticsEvents();
    initFloatingScrollbar();
    initializeTooltips();
    fetchSystemStatus();
    loadStockTickerData(currentStockTicker);
    initDataLens();
});

function fetchSystemStatus() {
    fetch("/api/tickers")
        .then(res => res.json())
        .then(data => {
            availableDbTickers = data.tickers || [];
        })
        .catch(() => {});
}

function initFloatingScrollbar() {
    let bar = document.getElementById("floatingHScrollbar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "floatingHScrollbar";
        bar.className = "floating-scrollbar-container";
        bar.innerHTML = '<div class="floating-scrollbar-inner" id="floatingHScrollbarInner"></div>';
        document.body.appendChild(bar);
    }

    const barInner = document.getElementById("floatingHScrollbarInner");
    let activeContainer = null;
    let isSyncing = false;

    bar.addEventListener("scroll", () => {
        if (isSyncing || !activeContainer) return;
        isSyncing = true;
        activeContainer.scrollLeft = bar.scrollLeft;
        requestAnimationFrame(() => { isSyncing = false; });
    });

    function checkContainers() {
        const candidates = document.querySelectorAll(".table-wrapper, .matrix-wrapper");
        let bestCandidate = null;
        const vh = window.innerHeight;

        for (const el of candidates) {
            if (el.offsetParent === null) continue; // hidden
            if (el.scrollWidth <= el.clientWidth + 2) continue; // no horizontal overflow

            const rect = el.getBoundingClientRect();
            // In view: table is visible on screen and bottom of table is currently below viewport
            if (rect.top < vh - 20 && rect.bottom > vh) {
                bestCandidate = el;
                break;
            }
        }

        if (bestCandidate) {
            activeContainer = bestCandidate;
            const rect = bestCandidate.getBoundingClientRect();
            const leftOffset = Math.max(0, rect.left);
            const visibleWidth = Math.min(window.innerWidth - leftOffset, rect.width);
            bar.style.display = "block";
            bar.style.left = `${leftOffset}px`;
            bar.style.width = `${visibleWidth}px`;
            barInner.style.width = `${bestCandidate.scrollWidth}px`;
            if (!isSyncing) {
                isSyncing = true;
                bar.scrollLeft = bestCandidate.scrollLeft;
                requestAnimationFrame(() => { isSyncing = false; });
            }
        } else {
            bar.style.display = "none";
            activeContainer = null;
        }
    }

    window.addEventListener("scroll", checkContainers, { passive: true });
    window.addEventListener("resize", checkContainers, { passive: true });
    document.addEventListener("scroll", checkContainers, { passive: true });

    document.addEventListener("scroll", (e) => {
        if (isSyncing || !activeContainer) return;
        if (e.target === activeContainer) {
            isSyncing = true;
            bar.scrollLeft = activeContainer.scrollLeft;
            requestAnimationFrame(() => { isSyncing = false; });
        }
    }, true);

    setInterval(checkContainers, 400);
}

function initializeTooltips() {
    const tooltip = document.getElementById("globalTooltip");
    const titleEl = document.getElementById("tooltipTitle");
    const textEl = document.getElementById("tooltipText");
    if (!tooltip || !titleEl || !textEl) return;

    document.addEventListener("mouseover", (e) => {
        const header = e.target.closest(".tooltip-header");
        if (header) {
            const title = header.dataset.tooltipTitle || header.textContent.replace(/[⇅▼▲]/g, "").trim();
            const text = header.dataset.tooltipText;
            if (text) {
                titleEl.textContent = title;
                textEl.textContent = text;
                tooltip.style.display = "block";
                positionTooltip(e, tooltip);
            }
        }
    });

    document.addEventListener("mousemove", (e) => {
        if (tooltip.style.display === "block") {
            positionTooltip(e, tooltip);
        }
    });

    document.addEventListener("mouseout", (e) => {
        const fromHeader = e.target.closest(".tooltip-header");
        const toHeader = e.relatedTarget ? e.relatedTarget.closest(".tooltip-header") : null;
        if (fromHeader && fromHeader !== toHeader) {
            tooltip.style.display = "none";
        }
    });
}

function positionTooltip(e, tooltip) {
    const pad = 12;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 10) {
        x = e.clientX - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - 10) {
        y = e.clientY - rect.height - pad;
    }
    tooltip.style.left = `${Math.max(10, x)}px`;
    tooltip.style.top = `${Math.max(10, y)}px`;
}


// ============================================================
// THEME SWITCHER LOGIC
// ============================================================
const THEME_CONFIGS = {
    sand: {
        chartBg: "#f4efe6",
        grid: "rgba(215, 206, 193, 0.65)",
        text: "#656157",
        border: "#ded7cb",
        crosshair: "#8d867a",
        upColor: "#257a58",
        downColor: "#963838",
        volUp: "rgba(37, 122, 88, 0.32)",
        volDown: "rgba(150, 56, 56, 0.32)",
        premarketBg: "rgba(234, 179, 8, 0.16)",
        postmarketBg: "rgba(37, 99, 235, 0.14)",
        intradayBg: "transparent"
    },
    blue: {
        chartBg: "#0a0f1d",
        grid: "rgba(30, 45, 82, 0.5)",
        text: "#94a3b8",
        border: "#1e2d52",
        crosshair: "#38bdf8",
        upColor: "#10b981",
        downColor: "#f43f5e",
        volUp: "rgba(16, 185, 129, 0.32)",
        volDown: "rgba(244, 63, 94, 0.32)",
        premarketBg: "rgba(234, 179, 8, 0.18)",
        postmarketBg: "rgba(37, 99, 235, 0.28)",
        intradayBg: "transparent"
    },
    graphite: {
        chartBg: "#07080b",
        grid: "rgba(30, 34, 45, 0.6)",
        text: "#8e95a5",
        border: "#1e222d",
        crosshair: "#0075ff",
        upColor: "#22c55e",
        downColor: "#ef4444",
        volUp: "rgba(34, 197, 94, 0.32)",
        volDown: "rgba(239, 68, 68, 0.32)",
        premarketBg: "rgba(234, 179, 8, 0.18)",
        postmarketBg: "rgba(37, 99, 235, 0.25)",
        intradayBg: "transparent"
    }
};

function initTheme() {
    applyTheme(currentTheme, false);

    const pills = document.querySelectorAll("#themePillsContainer .theme-pill");
    pills.forEach(pill => {
        pill.addEventListener("click", () => {
            const chosen = pill.dataset.theme;
            applyTheme(chosen, true);
        });
    });
}

function applyTheme(themeName, updateCharts = true) {
    currentTheme = themeName;
    document.documentElement.setAttribute("data-theme", themeName);
    localStorage.setItem("stock_analytics_theme", themeName);

    // Update pill active class
    const pills = document.querySelectorAll("#themePillsContainer .theme-pill");
    pills.forEach(pill => {
        if (pill.dataset.theme === themeName) {
            pill.classList.add("active");
        } else {
            pill.classList.remove("active");
        }
    });

    if (!updateCharts) return;

    const c = THEME_CONFIGS[themeName] || THEME_CONFIGS.sand;
    const chartOpts = {
        layout: { background: { color: c.chartBg }, textColor: c.text },
        grid: {
            vertLines: { color: c.grid, style: LightweightCharts.LineStyle.Solid },
            horzLines: { color: c.grid, style: LightweightCharts.LineStyle.Solid }
        },
        crosshair: {
            vertLine: { color: c.crosshair, labelBackgroundColor: c.crosshair },
            horzLine: { color: c.crosshair, labelBackgroundColor: c.crosshair }
        },
        rightPriceScale: { borderColor: c.border, textColor: c.text },
        timeScale: { borderColor: c.border, textColor: c.text }
    };

    const seriesOpts = {
        upColor: c.upColor,
        downColor: c.downColor,
        borderVisible: true,
        borderUpColor: c.upColor,
        borderDownColor: c.downColor,
        wickUpColor: c.upColor,
        wickDownColor: c.downColor
    };

    if (dailyChart) {
        dailyChart.applyOptions(chartOpts);
        if (dailySeries) dailySeries.applyOptions(seriesOpts);
    }
    if (intradayChart) {
        intradayChart.applyOptions(chartOpts);
        if (intradaySeries) intradaySeries.applyOptions(seriesOpts);
    }

    // Refresh intraday chart so background bars & candles sync to new theme colors
    const activeDate = document.getElementById("activeIntradayDate")?.textContent?.trim();
    if (currentStockTicker && activeDate) {
        loadStockIntradayChart(currentStockTicker, activeDate);
    }
}


// ============================================================
// GLOBAL TAB NAVIGATION (CALCULATOR VS STOCK ANALYTICS)
// ============================================================
function initGlobalNavigation() {
    const tabs = document.querySelectorAll(".global-tab-btn");
    tabs.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.dataset.targetView;
            tabs.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            document.querySelectorAll(".tab-view-container").forEach(view => {
                view.classList.remove("active");
            });

            const targetView = document.getElementById(targetId);
            if (targetView) {
                targetView.classList.add("active");
            }

            if (targetId === "viewStockAnalytics") {
                setTimeout(() => {
                    resizeCharts();
                }, 50);
            }
            if (targetId === "viewDataLens") {
                ensureDataLensLoaded();
            }
        });
    });
}

function switchToStockAnalytics(ticker, targetDate = null) {
    if (ticker) {
        currentStockTicker = ticker.trim().toUpperCase();
        const searchInp = document.getElementById("tickerInput");
        if (searchInp) searchInp.value = currentStockTicker;
    }

    const stockTabBtn = document.querySelector('.global-tab-btn[data-target-view="viewStockAnalytics"]');
    if (stockTabBtn) {
        stockTabBtn.click();
    }

    if (ticker) {
        if (currentDailyCandles && currentDailyCandles.length > 0 && currentStockTicker === ticker) {
            if (targetDate) {
                let dateToSelect = targetDate;
                if (!currentDailyCandlesMap[targetDate]) {
                    const sortedDates = Object.keys(currentDailyCandlesMap).sort();
                    const candidates = sortedDates.filter(d => d <= targetDate);
                    if (candidates.length > 0) dateToSelect = candidates[candidates.length - 1];
                }
                setDailySelectedDate(dateToSelect);
                loadStockIntradayChart(ticker, dateToSelect);
                setTimeout(() => {
                    document.querySelector(".charts-section")?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            }
        } else {
            loadStockTickerData(currentStockTicker, targetDate);
        }
    }
}

function resizeCharts() {
    const dailyCont = document.getElementById("dailyChartContainer");
    const intraCont = document.getElementById("intradayChartContainer");

    if (dailyChart && dailyCont) {
        dailyChart.applyOptions({ width: dailyCont.clientWidth, height: dailyCont.clientHeight });
    }
    if (intradayChart && intraCont) {
        intradayChart.applyOptions({ width: intraCont.clientWidth, height: intraCont.clientHeight });
    }
}



// Helper: Parse ticker and optional move % from string like "COHR 4.0", "CRWV 1.0%", "AAPL"
function parseTickerAndMove(str) {
    if (!str) return { ticker: "", move: null };
    const cleaned = str.trim().replace(/%/g, "");
    const parts = cleaned.split(/[\s,;:]+/).filter(Boolean);
    if (parts.length === 0) return { ticker: "", move: null };
    const ticker = parts[0].toUpperCase();
    let move = null;
    if (parts.length >= 2) {
        const parsedMove = parseFloat(parts[1]);
        if (!isNaN(parsedMove)) {
            move = parsedMove;
        }
    }
    return { ticker, move };
}

// Bidirectional sync: when move changes in groups chip, update screener table if open
function syncMoveWithScreenerTable(sym, valNum) {
    if (!screenerFilteredData || !screenerFilteredData.length) return;
    const r = screenerFilteredData.find(item => item.ticker === sym);
    if (!r) return;
    r.actual_move = valNum;
    if (r.actual_move !== null && r.expected_move !== null) {
        r.difference = r.actual_move - r.expected_move;
        const resVol = r.residual_volatility;
        if (resVol && resVol > 0) {
            r.normalized = r.difference / (resVol * 100);
        } else {
            r.normalized = null;
        }
    } else {
        r.difference = null;
        r.normalized = null;
    }
    const tableInput = document.querySelector(`.screener-actual-move-input[data-ticker="${sym}"]`);
    if (tableInput) {
        tableInput.value = (valNum !== null && valNum !== undefined) ? valNum : "";
        const tr = tableInput.closest("tr");
        if (tr) {
            const diffCell = tr.querySelector(".diff-cell");
            const normCell = tr.querySelector(".norm-cell");
            if (diffCell) diffCell.innerHTML = formatPctBadge(r.difference);
            if (normCell) normCell.innerHTML = (r.normalized !== null && !isNaN(r.normalized)) ? `${Number(r.normalized).toFixed(2)}σ` : "—";
        }
    }
}

// ============================================================
// TAB 1: GROUP BUILDER & MANAGEMENT WITH CUSTOM MOVE (%)
// ============================================================
function initCalculatorGroups() {
    renderGroups();

    const addGroupBtn = document.getElementById("addGroupButton");
    if (addGroupBtn) {
        addGroupBtn.addEventListener("click", () => {
            const num = Object.keys(groupsState).length + 1;
            const newName = `Group ${num}`;
            groupsState[newName] = [];
            renderGroups();
        });
    }

    const bulkBtn = document.getElementById("bulkTickersButton");
    if (bulkBtn) {
        bulkBtn.addEventListener("click", openBulkImportModal);
    }
}

function renderGroups() {
    const container = document.getElementById("groups");
    if (!container) return;
    container.innerHTML = "";

    const groupKeys = Object.keys(groupsState);
    if (groupKeys.length === 0) {
        const emptyBox = document.createElement("div");
        emptyBox.className = "empty-groups-box";
        emptyBox.innerHTML = `
            <p>Нет созданных групп тикеров. Нажмите «+ Добавить группу» или «Bulk Import» для добавления тикеров с Custom Move.</p>
            <div style="display: flex; gap: 8px;">
                <button class="primary-small-button" id="emptyCreateGroupBtn" type="button">+ Добавить группу</button>
                <button class="secondary-button" id="emptyBulkImportBtn" type="button">Bulk Import (300+)</button>
            </div>
        `;
        emptyBox.querySelector("#emptyCreateGroupBtn").addEventListener("click", () => {
            groupsState["Group 1"] = [];
            renderGroups();
        });
        emptyBox.querySelector("#emptyBulkImportBtn").addEventListener("click", openBulkImportModal);
        container.appendChild(emptyBox);
        return;
    }

    groupKeys.forEach(groupName => {
        const tickers = groupsState[groupName] || [];
        const card = document.createElement("div");
        card.className = "group-card";

        const header = document.createElement("div");
        header.className = "group-card-header";

        const nameInput = document.createElement("input");
        nameInput.className = "group-name-input";
        nameInput.value = groupName;
        nameInput.addEventListener("change", (e) => {
            const newName = e.target.value.trim() || groupName;
            if (newName !== groupName) {
                groupsState[newName] = groupsState[groupName];
                delete groupsState[groupName];
                renderGroups();
            }
        });

        const actions = document.createElement("div");
        actions.className = "group-actions";

        const countBadge = document.createElement("span");
        countBadge.className = "group-badge-count";
        countBadge.textContent = `${tickers.length} тикеров`;

        const removeBtn = document.createElement("button");
        removeBtn.className = "group-btn-icon";
        removeBtn.textContent = "✕";
        removeBtn.title = "Удалить группу";
        removeBtn.addEventListener("click", () => {
            delete groupsState[groupName];
            renderGroups();
        });

        actions.appendChild(countBadge);
        actions.appendChild(removeBtn);
        header.appendChild(nameInput);
        header.appendChild(actions);

        // Chips Container
        const chipsContainer = document.createElement("div");
        chipsContainer.className = "group-chips";

        tickers.forEach((sym, idx) => {
            const chip = document.createElement("span");
            chip.className = "ticker-chip";
            chip.title = "Кликните на символ для перехода к графику";

            const moveVal = (groupsMoveState[sym] !== undefined && groupsMoveState[sym] !== null) 
                ? groupsMoveState[sym] 
                : "";

            chip.innerHTML = `
                <span class="ticker-chip-sym" data-ticker="${sym}" title="Перейти к графику ${sym}">${sym}</span>
                <span class="ticker-chip-move-wrap" title="Custom Move (%) для ${sym}">
                    <input class="ticker-chip-move-input" type="number" step="0.1" placeholder="Move %" value="${moveVal}" data-ticker="${sym}">
                    <span class="ticker-chip-pct">%</span>
                </span>
                <span class="ticker-chip-remove" data-idx="${idx}" title="Удалить тикер">✕</span>
            `;

            // Click sym -> Switch to analytics
            const symEl = chip.querySelector(".ticker-chip-sym");
            symEl.addEventListener("click", (e) => {
                e.stopPropagation();
                switchToStockAnalytics(sym);
            });

            // Move input changes
            const moveInput = chip.querySelector(".ticker-chip-move-input");
            const onMoveChange = (e) => {
                e.stopPropagation();
                const rawVal = e.target.value.trim();
                const numVal = rawVal !== "" ? parseFloat(rawVal) : null;
                groupsMoveState[sym] = (numVal !== null && !isNaN(numVal)) ? numVal : null;
                syncMoveWithScreenerTable(sym, groupsMoveState[sym]);
            };
            moveInput.addEventListener("input", onMoveChange);
            moveInput.addEventListener("change", onMoveChange);
            moveInput.addEventListener("click", (e) => e.stopPropagation());

            // Remove button
            const chipRemoveBtn = chip.querySelector(".ticker-chip-remove");
            chipRemoveBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                tickers.splice(idx, 1);
                const stillExists = Object.values(groupsState).some(tList => tList.includes(sym));
                if (!stillExists) {
                    delete groupsMoveState[sym];
                }
                renderGroups();
            });

            chipsContainer.appendChild(chip);
        });

        // Inline Add Ticker Input (supports "COHR 4.0" or "COHR")
        const addInput = document.createElement("input");
        addInput.className = "group-add-ticker-input";
        addInput.placeholder = "+ Тикер [Move%] (Enter)";
        addInput.title = "Введите тикер (напр. COHR 4.0 или CRWV) и нажмите Enter";
        addInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                const raw = addInput.value.trim();
                if (!raw) return;
                const parsed = parseTickerAndMove(raw);
                if (parsed.ticker && !tickers.includes(parsed.ticker)) {
                    tickers.push(parsed.ticker);
                    if (parsed.move !== null) {
                        groupsMoveState[parsed.ticker] = parsed.move;
                    }
                    renderGroups();
                }
                addInput.value = "";
            }
        });

        chipsContainer.appendChild(addInput);
        card.appendChild(header);
        card.appendChild(chipsContainer);
        container.appendChild(card);
    });
}

// Bulk Import Modal with Custom Move parsing
function openBulkImportModal() {
    const modal = document.getElementById("bulkTickerModal");
    const groupSelect = document.getElementById("bulkTargetGroup");
    const closeBtn = document.getElementById("closeBulkModal");
    const cancelBtn = document.getElementById("cancelBulkModal");
    const addBtn = document.getElementById("addBulkTickers");
    const textarea = document.getElementById("bulkTickerText");
    const countSpan = document.getElementById("bulkTotalCount");

    groupSelect.innerHTML = "";
    const groupKeys = Object.keys(groupsState);
    if (groupKeys.length === 0) {
        groupsState["Group 1"] = [];
        groupKeys.push("Group 1");
    }

    groupKeys.forEach(g => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        groupSelect.appendChild(opt);
    });

    const parseBulkInput = (text) => {
        if (!text) return [];
        const rawTokens = text.trim().split(/[\s,;]+/).filter(Boolean);
        const results = [];
        const seen = new Set();
        let i = 0;
        while (i < rawTokens.length) {
            let tok = rawTokens[i].trim().replace(/[%:=$]/g, "");
            if (!tok) { i++; continue; }
            
            // Match tickers (e.g. AAPL, MSFT, BRK.B, BF-B)
            if (/^[A-Za-z][A-Za-z0-9.\-]*$/.test(tok)) {
                const sym = tok.toUpperCase();
                let move = null;
                
                // If next token is a number, it's the move percentage for this ticker
                if (i + 1 < rawTokens.length) {
                    const nextTok = rawTokens[i + 1].trim().replace(/%/g, "");
                    if (/^[-+]?[0-9]*\.?[0-9]+$/.test(nextTok)) {
                        move = parseFloat(nextTok);
                        i++; // advance past move token
                    }
                }
                
                if (!seen.has(sym)) {
                    seen.add(sym);
                    results.push({ ticker: sym, move: move });
                }
            }
            i++;
        }
        return results;
    };

    const updateCount = () => {
        const items = parseBulkInput(textarea.value);
        countSpan.textContent = `${items.length} тикеров`;
    };

    textarea.oninput = updateCount;
    updateCount();

    modal.classList.add("active");

    const closeModal = () => modal.classList.remove("active");
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    const applyImport = () => {
        const targetGroup = groupSelect.value;
        if (!targetGroup) return;
        const parsedItems = parseBulkInput(textarea.value);
        if (parsedItems.length === 0) {
            closeModal();
            return;
        }

        parsedItems.forEach(item => {
            if (!groupsState[targetGroup].includes(item.ticker)) {
                groupsState[targetGroup].push(item.ticker);
            }
            if (item.move !== null) {
                groupsMoveState[item.ticker] = item.move;
            }
        });

        renderGroups();
        closeModal();
    };

    addBtn.onclick = applyImport;
}



// ============================================================
// TAB 1: CALCULATE MODELS & MATRIX
// ============================================================
function initCalculatorEvents() {
    const calcBtn = document.getElementById("calculateButton");
    if (calcBtn) {
        calcBtn.addEventListener("click", runGroupCalculation);
    }
    const warningRemoveBtn = document.getElementById("warningRemovePartialBtn");
    if (warningRemoveBtn) {
        warningRemoveBtn.addEventListener("click", removePartialTickers);
    }
}

async function runGroupCalculation() {
    const benchmark = document.getElementById("benchmark").value.trim().toUpperCase() || "SPY";
    const benchmarkMove = parseFloat(document.getElementById("benchmarkMove").value) || 1.0;
    const period = document.getElementById("period").value || "1y";

    const errorEl = document.getElementById("error");
    const warningEl = document.getElementById("warning");
    const warningTextEl = document.getElementById("warningText");
    const warningBtn = document.getElementById("warningRemovePartialBtn");
    const screenerPartialBtn = document.getElementById("screenerRemovePartialBtn");
    const loadingEl = document.getElementById("loading");
    const resultsSection = document.getElementById("results");

    errorEl.style.display = "none";
    warningEl.style.display = "none";
    if (warningBtn) warningBtn.style.display = "none";
    if (screenerPartialBtn) screenerPartialBtn.style.display = "none";

    // Validate groups
    const activeGroups = {};
    Object.keys(groupsState).forEach(g => {
        if (groupsState[g] && groupsState[g].length > 0) {
            activeGroups[g] = groupsState[g];
        }
    });

    if (Object.keys(activeGroups).length === 0) {
        errorEl.textContent = "Добавьте хотя бы одну группу с тикерами для расчета моделей.";
        errorEl.style.display = "block";
        return;
    }

    loadingEl.style.display = "flex";

    try {
        const assetMoves = {};
        Object.keys(groupsMoveState).forEach(t => {
            const m = groupsMoveState[t];
            if (m !== null && m !== undefined && !isNaN(m)) {
                assetMoves[t] = parseFloat(m);
            }
        });

        const payload = {
            groups: activeGroups,
            benchmark: benchmark,
            benchmark_move: benchmarkMove,
            period: period,
            asset_moves: assetMoves
        };

        const res = await fetch("/api/calculate-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        loadingEl.style.display = "none";

        if (!res.ok) {
            errorEl.textContent = data.detail || data.error || "Ошибка расчета моделей.";
            errorEl.style.display = "block";
            return;
        }

        calculationResults = data;
        resultsSection.style.display = "block";

        const partialTickers = data.partial_tickers ? Object.keys(data.partial_tickers) : [];
        const partialCount = partialTickers.length;

        if (data.warning) {
            if (warningTextEl) {
                warningTextEl.textContent = data.warning;
            } else {
                warningEl.textContent = data.warning;
            }
            warningEl.style.display = "flex";

            if (partialCount > 0 && warningBtn) {
                const btnText = document.getElementById("warningRemovePartialText");
                if (btnText) {
                    btnText.textContent = `Удалить неполные тикеры (${partialCount})`;
                }
                warningBtn.title = `Удалить тикеры (${partialTickers.join(", ")}), существующие меньше выбранного периода, со всех таблиц`;
                warningBtn.style.display = "inline-flex";
            } else if (warningBtn) {
                warningBtn.style.display = "none";
            }
        } else {
            warningEl.style.display = "none";
            if (warningBtn) warningBtn.style.display = "none";
        }

        if (screenerPartialBtn) {
            if (partialCount > 0) {
                const countSpan = document.getElementById("screenerPartialCount");
                if (countSpan) countSpan.textContent = partialCount;
                screenerPartialBtn.title = `Удалить тикеры (${partialTickers.join(", ")}), существующие меньше выбранного периода, со всех таблиц`;
                screenerPartialBtn.style.display = "inline-flex";
            } else {
                screenerPartialBtn.style.display = "none";
            }
        }

        renderCalculationOverview(data);
        renderScreenerTable(data);
        renderPearsonMatrix(data);
        renderBetaMatrix(data);

        resultsSection.scrollIntoView({ behavior: "smooth" });

    } catch (e) {
        loadingEl.style.display = "none";
        errorEl.textContent = `Ошибка сети или сервера: ${e.message}`;
        errorEl.style.display = "block";
    }
}

function removePartialTickers() {
    if (!calculationResults || !calculationResults.partial_tickers) return;

    const partialTickers = Object.keys(calculationResults.partial_tickers);
    if (partialTickers.length === 0) return;

    const partialUpper = partialTickers.map(t => t.toUpperCase());

    // 1. Remove from all groups in groupsState
    let removedCount = 0;
    Object.keys(groupsState).forEach(groupName => {
        if (Array.isArray(groupsState[groupName])) {
            const beforeLen = groupsState[groupName].length;
            groupsState[groupName] = groupsState[groupName].filter(sym => !partialUpper.includes(sym.toUpperCase()));
            removedCount += (beforeLen - groupsState[groupName].length);
        }
    });

    // 2. Clean up groupsMoveState
    partialUpper.forEach(sym => {
        delete groupsMoveState[sym];
    });

    // 3. Re-render chips in groups container
    renderGroups();

    // 4. Check if there are remaining tickers
    const hasRemainingTickers = Object.values(groupsState).some(list => Array.isArray(list) && list.length > 0);

    if (hasRemainingTickers) {
        // Automatically re-run calculation:
        // recalculates backend models without partial tickers,
        // and updates Screener table, Pearson Matrix, Beta Matrix cleanly.
        runGroupCalculation();
    } else {
        // All tickers were removed
        calculationResults = null;
        screenerAllData = [];
        screenerFilteredData = [];

        const resultsSection = document.getElementById("results");
        if (resultsSection) resultsSection.style.display = "none";

        const warningEl = document.getElementById("warning");
        if (warningEl) warningEl.style.display = "none";

        const warningBtn = document.getElementById("warningRemovePartialBtn");
        if (warningBtn) warningBtn.style.display = "none";

        const screenerPartialBtn = document.getElementById("screenerRemovePartialBtn");
        if (screenerPartialBtn) screenerPartialBtn.style.display = "none";

        const errorEl = document.getElementById("error");
        if (errorEl) {
            errorEl.textContent = `Все тикеры (${partialTickers.join(", ")}) были удалены, так как их история меньше выбранного периода. Добавьте новые тикеры.`;
            errorEl.style.display = "block";
        }
    }
}

function renderCalculationOverview(data) {
    const rBm = document.getElementById("resultBenchmark");
    if (rBm) rBm.textContent = data.benchmarks ? data.benchmarks.join(", ") : data.benchmark;
    const rPer = document.getElementById("resultPeriod");
    if (rPer) rPer.textContent = data.period ? data.period.toUpperCase() : "1Y";
    const rDate = document.getElementById("resultDateRange");
    if (rDate) rDate.textContent = `${data.period_start || "—"} по ${data.period_end || "—"}`;
    const rTot = document.getElementById("resultTotalAssets");
    if (rTot) rTot.textContent = `${data.total_analyzed || 0} из ${data.total_requested || 0}`;
}

function renderScreenerTable(data) {
    const rows = [];
    const tickers = data.tickers || [];
    const bm = data.primary_benchmark || "SPY";
    const bmMove = (data.benchmark_moves && data.benchmark_moves[bm] !== undefined)
        ? data.benchmark_moves[bm]
        : (data.benchmark_move !== undefined ? data.benchmark_move : (parseFloat(document.getElementById("benchmarkMove")?.value) || 1.0));
    const corrMap = data.correlation || {};
    const betaMap = data.beta || {};
    const expRange = data.expected_range || {};

    tickers.forEach(t => {
        const corrVal = corrMap[t] ? corrMap[t][bm] : null;
        const betaVal = betaMap[t] ? betaMap[t][bm] : null;
        const metrics = expRange[t] || {};
        const customMove = (groupsMoveState[t] !== undefined && groupsMoveState[t] !== null) 
            ? groupsMoveState[t] 
            : metrics.actual_move;

        // Expected Move = Beta * Benchmark Move (%)
        let expMove = (metrics.expected_move !== undefined && metrics.expected_move !== null)
            ? metrics.expected_move
            : ((metrics.expected_stock_move !== undefined && metrics.expected_stock_move !== null)
                ? metrics.expected_stock_move
                : ((metrics.expected_return !== undefined && metrics.expected_return !== null)
                    ? metrics.expected_return
                    : ((betaVal !== null && betaVal !== undefined) ? betaVal * bmMove : null)));

        let diffVal = metrics.difference;
        let normVal = metrics.normalized_difference;

        if (customMove !== null && customMove !== undefined && expMove !== null) {
            diffVal = customMove - expMove;
            const resVol = (metrics.residual_volatility && metrics.residual_volatility > 0)
                ? metrics.residual_volatility
                : metrics.volatility;
            if (resVol && resVol > 0) {
                normVal = diffVal / (resVol * 100);
            }
        }

        rows.push({
            ticker: t,
            correlation: corrVal,
            beta: betaVal,
            expected_move: expMove,
            actual_move: customMove,
            difference: diffVal,
            normalized: normVal,
            volatility: metrics.volatility,
            residual_volatility: metrics.residual_volatility,
            observations: metrics.observations
        });
    });

    screenerAllData = rows;
    applyScreenerFilter();
}

function applyScreenerFilter() {
    if (!screenerAllData || screenerAllData.length === 0) return;
    const opSel = document.getElementById("correlationOperator");
    const thInp = document.getElementById("correlationThreshold");
    const thMaxInp = document.getElementById("correlationThresholdMax");
    const searchInp = document.getElementById("screenerSearch");
    const badge = document.getElementById("activeFilterBadge");

    const op = opSel ? opSel.value : "gte";
    const threshold = thInp ? parseFilterNumber(thInp.value, 0.50) : 0.50;
    const thresholdMax = thMaxInp ? parseFilterNumber(thMaxInp.value, 1.00) : 1.00;
    const search = searchInp ? searchInp.value.trim().toUpperCase() : "";

    let filtered = screenerAllData.slice();

    if (search) {
        filtered = filtered.filter(r => r.ticker.toUpperCase().includes(search));
    }

    if (op !== "none" && op !== "all") {
        filtered = filtered.filter(r => {
            if (r.correlation === null || r.correlation === undefined || isNaN(r.correlation)) return false;
            const c = Number(r.correlation);
            if (op === "gte") return c >= threshold;
            if (op === "lte") return c <= threshold;
            if (op === "between") return c >= threshold && c <= thresholdMax;
            if (op === "abs_gte") return Math.abs(c) >= threshold;
            return true;
        });
    }

    if (badge) {
        if (op === "none") badge.textContent = "Без фильтров";
        else if (op === "all") badge.textContent = "Все активы";
        else if (op === "between") badge.textContent = `r ∈ [${threshold}, ${thresholdMax}]`;
        else if (op === "abs_gte") badge.textContent = `|r| ≥ ${threshold}`;
        else if (op === "lte") badge.textContent = `r ≤ ${threshold}`;
        else badge.textContent = `r ≥ ${threshold}`;
    }

    // Sort filtered rows
    if (screenerSortCol) {
        filtered.sort((a, b) => {
            let valA = a[screenerSortCol];
            let valB = b[screenerSortCol];
            if (screenerSortCol === "ticker") {
                valA = valA || ""; valB = valB || "";
                return screenerSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            const numA = (valA !== null && valA !== undefined && !isNaN(valA)) ? Number(valA) : null;
            const numB = (valB !== null && valB !== undefined && !isNaN(valB)) ? Number(valB) : null;
            if (numA === null && numB === null) return 0;
            if (numA === null) return 1;
            if (numB === null) return -1;
            return screenerSortAsc ? (numA - numB) : (numB - numA);
        });
    }

    // Update sort icons in mainBenchmarkTable header
    document.querySelectorAll("#mainBenchmarkTable thead th[data-sort]").forEach(th => {
        const col = th.dataset.sort;
        const icon = th.querySelector(".sort-icon");
        if (col === screenerSortCol) {
            th.classList.add("active-sort");
            if (icon) icon.textContent = screenerSortAsc ? "▲" : "▼";
        } else {
            th.classList.remove("active-sort");
            if (icon) icon.textContent = "⇅";
        }
    });

    screenerFilteredData = filtered;
    updateScreenerView();
}

function updateScreenerView() {
    const tbody = document.getElementById("benchmarkResultsTable");
    if (!tbody) return;
    tbody.innerHTML = "";

    const countEl = document.getElementById("benchmarkResultCount");
    const totalEl = document.getElementById("benchmarkResultTotal");
    const paginationInfo = document.getElementById("screenerPaginationInfo");
    const prevBtn = document.getElementById("screenerPrevBtn");
    const nextBtn = document.getElementById("screenerNextBtn");
    const pageNumbersEl = document.getElementById("screenerPageNumbers");

    const total = screenerFilteredData.length;
    if (countEl) countEl.textContent = total;
    if (totalEl) totalEl.textContent = `/ ${calculationResults ? (calculationResults.tickers || []).length : 0}`;

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Нет тикеров, удовлетворяющих условиям фильтра.</td></tr>`;
        if (paginationInfo) paginationInfo.textContent = "Показано 0-0 из 0";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (pageNumbersEl) pageNumbersEl.textContent = "Стр. 1 из 1";
        return;
    }

    const pageSize = screenerPageSize;
    const totalPages = pageSize === Infinity ? 1 : Math.ceil(total / pageSize);
    if (screenerPage > totalPages) screenerPage = totalPages;
    if (screenerPage < 1) screenerPage = 1;

    const startIdx = pageSize === Infinity ? 0 : (screenerPage - 1) * pageSize;
    const endIdx = pageSize === Infinity ? total : Math.min(startIdx + pageSize, total);
    const itemsToDisplay = screenerFilteredData.slice(startIdx, endIdx);

    if (paginationInfo) {
        paginationInfo.textContent = `Показано ${startIdx + 1}-${endIdx} из ${total}`;
    }
    if (prevBtn) prevBtn.disabled = screenerPage <= 1;
    if (nextBtn) nextBtn.disabled = screenerPage >= totalPages;
    if (pageNumbersEl) {
        pageNumbersEl.textContent = `Стр. ${screenerPage} из ${totalPages}`;
    }

    itemsToDisplay.forEach(r => {
        const tr = document.createElement("tr");

        const corrFmt = formatCorrBadge(r.correlation);
        const betaFmt = r.beta !== null && r.beta !== undefined ? Number(r.beta).toFixed(3) : "—";
        const expMoveFmt = formatPctBadge(r.expected_move);
        const actMoveFmt = formatPctBadge(r.actual_move);
        const diffFmt = formatPctBadge(r.difference);
        const normFmt = r.normalized !== null && r.normalized !== undefined ? `${Number(r.normalized).toFixed(2)}σ` : "—";
        const volFmt = r.volatility ? `${(r.volatility * 100).toFixed(2)}%` : "—";
        const resVolFmt = r.residual_volatility ? `${(r.residual_volatility * 100).toFixed(2)}%` : "—";

        const moveInputVal = (r.actual_move !== null && r.actual_move !== undefined) ? r.actual_move : "";

        tr.innerHTML = `
            <td><span class="clickable-ticker" data-ticker="${r.ticker}">${r.ticker}</span></td>
            <td>${corrFmt}</td>
            <td><strong>${betaFmt}</strong></td>
            <td>${expMoveFmt}</td>
            <td>
                <div class="screener-actual-move-input-wrap" title="Нажмите, чтобы ввести Custom Move (%)">
                    <input class="screener-actual-move-input" type="number" step="0.1" value="${moveInputVal}" placeholder="—" data-ticker="${r.ticker}">
                    <span class="ticker-chip-pct">%</span>
                </div>
            </td>
            <td class="diff-cell">${diffFmt}</td>
            <td class="norm-cell">${normFmt}</td>
            <td>${volFmt}</td>
            <td>${resVolFmt}</td>
            <td>${r.observations || "—"}</td>
        `;

        tr.querySelector(".clickable-ticker").addEventListener("click", () => switchToStockAnalytics(r.ticker));

        // Interactive inline edit for Custom Move in screener
        const moveInp = tr.querySelector(".screener-actual-move-input");
        const onTableMoveChange = (e) => {
            const rawVal = e.target.value.trim();
            const numVal = rawVal !== "" ? parseFloat(rawVal) : null;
            r.actual_move = numVal;
            groupsMoveState[r.ticker] = numVal;

            // Recalculate Difference & Normalized in real-time
            if (r.actual_move !== null && r.expected_move !== null) {
                r.difference = r.actual_move - r.expected_move;
                const resVol = (r.residual_volatility && r.residual_volatility > 0) ? r.residual_volatility : r.volatility;
                if (resVol && resVol > 0) {
                    r.normalized = r.difference / (resVol * 100);
                } else {
                    r.normalized = null;
                }
            } else {
                r.difference = null;
                r.normalized = null;
            }

            const diffCell = tr.querySelector(".diff-cell");
            const normCell = tr.querySelector(".norm-cell");
            if (diffCell) diffCell.innerHTML = formatPctBadge(r.difference);
            if (normCell) normCell.innerHTML = (r.normalized !== null && !isNaN(r.normalized)) ? `${Number(r.normalized).toFixed(2)}σ` : "—";

            // Sync with group chip above
            const chipInp = document.querySelector(`.ticker-chip-move-input[data-ticker="${r.ticker}"]`);
            if (chipInp && chipInp.value !== rawVal) {
                chipInp.value = rawVal;
            }
        };

        moveInp.addEventListener("input", onTableMoveChange);
        moveInp.addEventListener("change", onTableMoveChange);

        tbody.appendChild(tr);
    });
}

function initScreenerFilterEvents() {
    const opSel = document.getElementById("correlationOperator");
    const maxField = document.getElementById("thresholdMaxField");
    const applyBtn = document.getElementById("applyCorrelationFilter");
    const thInp = document.getElementById("correlationThreshold");
    const thMaxInp = document.getElementById("correlationThresholdMax");
    const searchInp = document.getElementById("screenerSearch");
    const pageSizeSel = document.getElementById("pageSizeSelect");

    if (opSel) {
        opSel.addEventListener("change", () => {
            const val = opSel.value;
            if (maxField) maxField.style.display = val === "between" ? "block" : "none";
            screenerPage = 1;
            applyScreenerFilter();
        });
    }

    if (applyBtn) {
        applyBtn.addEventListener("click", () => {
            screenerPage = 1;
            applyScreenerFilter();
        });
    }

    if (thInp) thInp.addEventListener("change", () => {
        screenerPage = 1;
        applyScreenerFilter();
    });
    if (thMaxInp) thMaxInp.addEventListener("change", () => {
        screenerPage = 1;
        applyScreenerFilter();
    });
    if (searchInp) searchInp.addEventListener("input", debounce(() => {
        screenerPage = 1;
        applyScreenerFilter();
    }, 200));

    document.querySelectorAll(".screener-preset").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".screener-preset").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const op = btn.dataset.op;
            const val = btn.dataset.val;
            if (opSel) opSel.value = op === "all" ? "none" : op;
            if (maxField) maxField.style.display = op === "between" ? "block" : "none";
            if (thInp && val !== "all") thInp.value = val;
            screenerPage = 1;
            applyScreenerFilter();
        });
    });

    if (pageSizeSel) {
        pageSizeSel.addEventListener("change", () => {
            screenerPageSize = pageSizeSel.value === "all" ? Infinity : parseInt(pageSizeSel.value) || 50;
            screenerPage = 1;
            updateScreenerView();
        });
    }

    // Column sorting for Primary Screener (highest to lowest first click, lowest to highest second click)
    const screenerTable = document.getElementById("mainBenchmarkTable");
    if (screenerTable) {
        screenerTable.addEventListener("click", (e) => {
            const th = e.target.closest("thead th[data-sort]");
            if (!th) return;
            const col = th.dataset.sort;
            if (!col) return;
            if (screenerSortCol === col) {
                screenerSortAsc = !screenerSortAsc;
            } else {
                screenerSortCol = col;
                screenerSortAsc = false; // Descending first (highest to lowest)
            }
            screenerPage = 1;
            applyScreenerFilter();
        });
    }

    // Pagination buttons for Primary Screener
    const prevPageBtn = document.getElementById("screenerPrevBtn");
    const nextPageBtn = document.getElementById("screenerNextBtn");
    if (prevPageBtn) {
        prevPageBtn.addEventListener("click", () => {
            if (screenerPage > 1) {
                screenerPage--;
                updateScreenerView();
            }
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener("click", () => {
            const totalPages = screenerPageSize === Infinity ? 1 : Math.ceil(screenerFilteredData.length / screenerPageSize);
            if (screenerPage < totalPages) {
                screenerPage++;
                updateScreenerView();
            }
        });
    }

    // Remove Partial Tickers button in screener header
    const screenerRemoveBtn = document.getElementById("screenerRemovePartialBtn");
    if (screenerRemoveBtn) {
        screenerRemoveBtn.addEventListener("click", removePartialTickers);
    }

    // Copy Tickers button
    const copyBtn = document.getElementById("copyTickersButton");
    if (copyBtn) {
        copyBtn.addEventListener("click", () => {
            const list = screenerFilteredData.map(r => r.ticker).join(", ");
            navigator.clipboard.writeText(list).then(() => {
                const orig = copyBtn.textContent;
                copyBtn.textContent = "Скопировано!";
                setTimeout(() => { copyBtn.textContent = orig; }, 1500);
            }).catch(() => {});
        });
    }

    // Export All button
    const exportAllBtn = document.getElementById("exportAllButton");
    if (exportAllBtn) {
        exportAllBtn.addEventListener("click", () => exportScreenerToExcel(screenerAllData));
    }

    // Export Filtered button
    const exportFilteredBtn = document.getElementById("exportFilteredButton");
    if (exportFilteredBtn) {
        exportFilteredBtn.addEventListener("click", () => exportScreenerToExcel(screenerFilteredData));
    }
}

async function exportScreenerToExcel(rowsToExport) {
    if (!rowsToExport || rowsToExport.length === 0) {
        alert("Нет данных для экспорта.");
        return;
    }
    try {
        const benchmark = (calculationResults && calculationResults.benchmark) || "SPY";
        const period = (calculationResults && calculationResults.period) || "1y";
        const res = await fetch("/api/export-excel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                rows: rowsToExport,
                benchmark: benchmark,
                period: period
            })
        });
        if (!res.ok) throw new Error("Ошибка формирования Excel файла");
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Screener_${benchmark}_${period}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        alert(`Ошибка при скачивании Excel: ${e.message}`);
    }
}

function initMatrixFilterEvents() {
    // 1. Pearson Correlation Matrix Filters
    const opSelect = document.getElementById("matrixOperator") || document.getElementById("matrixCorrOperator");
    const threshInput = document.getElementById("matrixThreshold") || document.getElementById("matrixCorrThreshold");
    const threshMaxInput = document.getElementById("matrixThresholdMax") || document.getElementById("matrixCorrThresholdMax");
    const maxField = document.getElementById("matrixMaxField") || document.getElementById("matrixCorrMaxField");
    const searchInput = document.getElementById("matrixSearch") || document.getElementById("matrixCorrSearch");
    const applyBtn = document.getElementById("applyMatrixFilterBtn") || document.getElementById("applyMatrixCorrFilterBtn");

    if (opSelect) {
        opSelect.addEventListener("change", () => {
            const val = opSelect.value;
            if (maxField) maxField.style.display = val === "between" ? "block" : "none";
            applyMatrixCorrFilter();
        });
    }

    if (applyBtn) {
        applyBtn.addEventListener("click", applyMatrixCorrFilter);
    }

    if (searchInput) {
        searchInput.addEventListener("input", debounce(applyMatrixCorrFilter, 200));
    }

    if (threshInput) {
        threshInput.addEventListener("input", debounce(() => {
            document.querySelectorAll(".matrix-preset, .matrix-corr-preset").forEach(b => {
                if (b.dataset.val !== threshInput.value) b.classList.remove("active");
            });
            applyMatrixCorrFilter();
        }, 200));
        threshInput.addEventListener("change", applyMatrixCorrFilter);
    }
    if (threshMaxInput) {
        threshMaxInput.addEventListener("input", debounce(applyMatrixCorrFilter, 200));
        threshMaxInput.addEventListener("change", applyMatrixCorrFilter);
    }

    document.querySelectorAll(".matrix-preset, .matrix-corr-preset").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".matrix-preset, .matrix-corr-preset").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const op = btn.dataset.op;
            const val = btn.dataset.val;

            if (opSelect) {
                if (op === "all") opSelect.value = "none";
                else opSelect.value = op;
            }
            if (maxField) maxField.style.display = op === "between" ? "block" : "none";
            if (threshInput && val !== "all") threshInput.value = val;

            applyMatrixCorrFilter();
        });
    });

    // 2. Beta Matrix Filters
    const betaOpSelect = document.getElementById("matrixBetaOperator");
    const betaThreshInput = document.getElementById("matrixBetaThreshold");
    const betaThreshMaxInput = document.getElementById("matrixBetaThresholdMax");
    const betaMaxField = document.getElementById("matrixBetaMaxField");
    const betaSearchInput = document.getElementById("matrixBetaSearch");
    const betaApplyBtn = document.getElementById("applyMatrixBetaFilterBtn");

    if (betaOpSelect) {
        betaOpSelect.addEventListener("change", () => {
            const val = betaOpSelect.value;
            if (betaMaxField) betaMaxField.style.display = val === "between" ? "block" : "none";
            applyMatrixBetaFilter();
        });
    }

    if (betaApplyBtn) {
        betaApplyBtn.addEventListener("click", applyMatrixBetaFilter);
    }

    if (betaSearchInput) {
        betaSearchInput.addEventListener("input", debounce(applyMatrixBetaFilter, 200));
    }
    if (betaThreshInput) {
        betaThreshInput.addEventListener("input", debounce(() => {
            document.querySelectorAll(".matrix-beta-preset").forEach(b => {
                if (b.dataset.val !== betaThreshInput.value) b.classList.remove("active");
            });
            applyMatrixBetaFilter();
        }, 200));
        betaThreshInput.addEventListener("change", applyMatrixBetaFilter);
    }
    if (betaThreshMaxInput) {
        betaThreshMaxInput.addEventListener("input", debounce(applyMatrixBetaFilter, 200));
        betaThreshMaxInput.addEventListener("change", applyMatrixBetaFilter);
    }

    document.querySelectorAll(".matrix-beta-preset").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".matrix-beta-preset").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const op = btn.dataset.op;
            const val = btn.dataset.val;

            if (betaOpSelect) {
                if (op === "all") betaOpSelect.value = "none";
                else betaOpSelect.value = op;
            }
            if (betaMaxField) betaMaxField.style.display = op === "between" ? "block" : "none";
            if (betaThreshInput && val !== "all") betaThreshInput.value = val;

            applyMatrixBetaFilter();
        });
    });

    const expMatrixCorrBtn = document.getElementById("exportMatrixCorrExcelBtn");
    if (expMatrixCorrBtn) expMatrixCorrBtn.addEventListener("click", exportMatrixCorrelationToExcel);

    const expMatrixBetaBtn = document.getElementById("exportMatrixBetaExcelBtn");
    if (expMatrixBetaBtn) expMatrixBetaBtn.addEventListener("click", exportMatrixBetaToExcel);
}

function applyMatrixCorrFilter() {
    if (!calculationResults) return;
    renderPearsonMatrix(calculationResults);
}

function checkCorrCondition(val, op, threshold, thresholdMax) {
    if (val === null || val === undefined || isNaN(val)) return false;
    const num = Number(val);
    if (op === "all" || op === "none") return true;
    if (op === "gte") return num >= threshold;
    if (op === "lte") return num <= threshold;
    if (op === "between") return num >= threshold && num <= thresholdMax;
    if (op === "abs_gte") return Math.abs(num) >= threshold;
    return true;
}

function renderPearsonMatrix(data) {
    const table = document.getElementById("correlationMatrix");
    if (!table) return;
    table.innerHTML = "";

    const allSymbols = data.all_symbols || data.tickers || [];
    const corrMap = data.correlation || {};

    const opSelect = document.getElementById("matrixOperator") || document.getElementById("matrixCorrOperator");
    const threshInput = document.getElementById("matrixThreshold") || document.getElementById("matrixCorrThreshold");
    const threshMaxInput = document.getElementById("matrixThresholdMax") || document.getElementById("matrixCorrThresholdMax");
    const searchInput = document.getElementById("matrixSearch") || document.getElementById("matrixCorrSearch");

    const op = opSelect ? opSelect.value : "none";
    const threshold = threshInput ? parseFilterNumber(threshInput.value, 0.5) : 0.5;
    const thresholdMax = threshMaxInput ? parseFilterNumber(threshMaxInput.value, 1.0) : 1.0;
    const search = searchInput ? searchInput.value.trim().toUpperCase() : "";

    let candidateSymbols = allSymbols;
    if (search) {
        candidateSymbols = candidateSymbols.filter(s => s.toUpperCase().includes(search));
    }

    if (op !== "all" && op !== "none") {
        const matchingSet = new Set();
        candidateSymbols.forEach(s1 => {
            candidateSymbols.forEach(s2 => {
                if (s1 === s2) return;
                const v1 = corrMap[s1] ? corrMap[s1][s2] : null;
                const v2 = corrMap[s2] ? corrMap[s2][s1] : null;
                if (checkCorrCondition(v1, op, threshold, thresholdMax) || checkCorrCondition(v2, op, threshold, thresholdMax)) {
                    matchingSet.add(s1);
                    matchingSet.add(s2);
                }
            });
        });
        displaySymbols = candidateSymbols.filter(s => matchingSet.has(s));
    } else {
        displaySymbols = candidateSymbols;
    }

    const matchCountEl = document.getElementById("matrixMatchCount") || document.getElementById("matrixCorrMatchCount");
    const matchTotalEl = document.getElementById("matrixMatchTotal") || document.getElementById("matrixCorrMatchTotal");
    const badgeEl = document.getElementById("matrixActiveFilterBadge") || document.getElementById("matrixCorrActiveFilterBadge");

    if (matchCountEl) matchCountEl.textContent = displaySymbols.length;
    if (matchTotalEl) matchTotalEl.textContent = `/ ${allSymbols.length} активов`;
    if (badgeEl) {
        if (op === "all" || op === "none") badgeEl.textContent = "Без фильтров";
        else if (op === "between") badgeEl.textContent = `r ∈ [${threshold}, ${thresholdMax}]`;
        else if (op === "abs_gte") badgeEl.textContent = `|r| ≥ ${threshold}`;
        else if (op === "lte") badgeEl.textContent = `r ≤ ${threshold}`;
        else badgeEl.textContent = `r ≥ ${threshold}`;
    }

    if (displaySymbols.length === 0) {
        table.innerHTML = `<tr><td class="loading-cell" style="padding: 24px;">Нет активов, удовлетворяющих условиям фильтра.</td></tr>`;
        return;
    }

    lastPearsonData = data;
    lastPearsonDisplaySymbols = displaySymbols;

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    htr.innerHTML = `<th>Тикер</th>` + displaySymbols.map(s => `<th>${s}</th>`).join("");
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    displaySymbols.forEach(rowSym => {
        const tr = document.createElement("tr");
        let rowHtml = `<td><strong><span class="clickable-ticker" data-ticker="${rowSym}">${rowSym}</span></strong></td>`;

        displaySymbols.forEach(colSym => {
            if (rowSym === colSym) {
                const diagValid = (op === "all" || op === "none" || checkCorrCondition(1.0, op, threshold, thresholdMax));
                if (diagValid) {
                    rowHtml += `<td class="corr-cell" style="background: rgba(74, 222, 128, 0.3); font-weight: 800;">1.000</td>`;
                } else {
                    rowHtml += `<td class="corr-cell" style="color: var(--text-muted); background: transparent;">—</td>`;
                }
            } else {
                const val = corrMap[rowSym] ? corrMap[rowSym][colSym] : null;
                const isMatch = (op === "all" || op === "none" || checkCorrCondition(val, op, threshold, thresholdMax));
                if (isMatch && val !== null && val !== undefined && !isNaN(val)) {
                    const bg = getCorrBgColor(val);
                    rowHtml += `<td class="corr-cell" style="background: ${bg}; font-weight: 600;">${Number(val).toFixed(3)}</td>`;
                } else {
                    rowHtml += `<td class="corr-cell" style="color: var(--text-muted); background: transparent;">—</td>`;
                }
            }
        });

        tr.innerHTML = rowHtml;
        tr.querySelector(".clickable-ticker").addEventListener("click", () => switchToStockAnalytics(rowSym));
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
}

function applyMatrixBetaFilter() {
    if (!calculationResults) return;
    renderBetaMatrix(calculationResults);
}

function checkBetaCondition(val, op, threshold, thresholdMax) {
    if (val === null || val === undefined || isNaN(val)) return false;
    const num = Number(val);
    if (op === "all" || op === "none") return true;
    if (op === "gte") return num >= threshold;
    if (op === "lte") return num <= threshold;
    if (op === "between") return num >= threshold && num <= thresholdMax;
    return true;
}

function renderBetaMatrix(data) {
    const table = document.getElementById("betaMatrix");
    if (!table) return;
    table.innerHTML = "";

    const allSymbols = data.all_symbols || data.tickers || [];
    const betaMap = data.beta || {};

    const opSelect = document.getElementById("matrixBetaOperator");
    const threshInput = document.getElementById("matrixBetaThreshold");
    const threshMaxInput = document.getElementById("matrixBetaThresholdMax");
    const searchInput = document.getElementById("matrixBetaSearch");

    const op = opSelect ? opSelect.value : "none";
    const threshold = threshInput ? parseFilterNumber(threshInput.value, 1.0) : 1.0;
    const thresholdMax = threshMaxInput ? parseFilterNumber(threshMaxInput.value, 2.0) : 2.0;
    const search = searchInput ? searchInput.value.trim().toUpperCase() : "";

    let candidateSymbols = allSymbols;
    if (search) {
        candidateSymbols = candidateSymbols.filter(s => s.toUpperCase().includes(search));
    }

    if (op !== "all" && op !== "none") {
        const matchingSet = new Set();
        candidateSymbols.forEach(s1 => {
            candidateSymbols.forEach(s2 => {
                if (s1 === s2) return;
                const v1 = betaMap[s1] ? betaMap[s1][s2] : null;
                const v2 = betaMap[s2] ? betaMap[s2][s1] : null;
                if (checkBetaCondition(v1, op, threshold, thresholdMax) || checkBetaCondition(v2, op, threshold, thresholdMax)) {
                    matchingSet.add(s1);
                    matchingSet.add(s2);
                }
            });
        });
        displaySymbols = candidateSymbols.filter(s => matchingSet.has(s));
    } else {
        displaySymbols = candidateSymbols;
    }

    const matchCountEl = document.getElementById("matrixBetaMatchCount");
    const matchTotalEl = document.getElementById("matrixBetaMatchTotal");
    const badgeEl = document.getElementById("matrixBetaActiveFilterBadge");

    if (matchCountEl) matchCountEl.textContent = displaySymbols.length;
    if (matchTotalEl) matchTotalEl.textContent = `/ ${allSymbols.length} активов`;
    if (badgeEl) {
        if (op === "all" || op === "none") badgeEl.textContent = "Без фильтров";
        else if (op === "between") badgeEl.textContent = `β ∈ [${threshold}, ${thresholdMax}]`;
        else if (op === "lte") badgeEl.textContent = `β ≤ ${threshold}`;
        else badgeEl.textContent = `β ≥ ${threshold}`;
    }

    if (displaySymbols.length === 0) {
        table.innerHTML = `<tr><td class="loading-cell" style="padding: 24px;">Нет активов, удовлетворяющих условиям фильтра Beta.</td></tr>`;
        return;
    }

    lastBetaData = data;
    lastBetaDisplaySymbols = displaySymbols;

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    htr.innerHTML = `<th>Тикер</th>` + displaySymbols.map(s => `<th>${s}</th>`).join("");
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    displaySymbols.forEach(rowSym => {
        const tr = document.createElement("tr");
        let rowHtml = `<td><strong><span class="clickable-ticker" data-ticker="${rowSym}">${rowSym}</span></strong></td>`;

        displaySymbols.forEach(colSym => {
            if (rowSym === colSym) {
                const diagValid = (op === "all" || op === "none" || checkBetaCondition(1.0, op, threshold, thresholdMax));
                if (diagValid) {
                    rowHtml += `<td class="corr-cell" style="background: rgba(191, 219, 254, 0.9); font-weight: 800;">1.000</td>`;
                } else {
                    rowHtml += `<td class="corr-cell" style="color: var(--text-muted); background: transparent;">—</td>`;
                }
            } else {
                const val = betaMap[rowSym] ? betaMap[rowSym][colSym] : null;
                const isMatch = (op === "all" || op === "none" || checkBetaCondition(val, op, threshold, thresholdMax));
                if (isMatch && val !== null && val !== undefined && !isNaN(val)) {
                    const bg = getBetaBgColor(val);
                    rowHtml += `<td class="corr-cell" style="background: ${bg}; font-weight: 600;">${Number(val).toFixed(3)}</td>`;
                } else {
                    rowHtml += `<td class="corr-cell" style="color: var(--text-muted); background: transparent;">—</td>`;
                }
            }
        });

        tr.innerHTML = rowHtml;
        tr.querySelector(".clickable-ticker").addEventListener("click", () => switchToStockAnalytics(rowSym));
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
}




// ============================================================
// TAB 2: FINWHALE STOCK & DUAL CHART ANALYTICS
// ============================================================
function initCharts() {
    const c = THEME_CONFIGS[currentTheme] || THEME_CONFIGS.sand;

    const chartCommonOptions = {
        layout: {
            background: { color: c.chartBg },
            textColor: c.text,
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
        },
        localization: {
            locale: "en-US",
            dateFormat: "yyyy-MM-dd",
        },
        grid: {
            vertLines: { color: c.grid, style: LightweightCharts.LineStyle.Solid },
            horzLines: { color: c.grid, style: LightweightCharts.LineStyle.Solid },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: c.crosshair,
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: c.crosshair,
            },
            horzLine: {
                color: c.crosshair,
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: c.crosshair,
            },
        },
        rightPriceScale: {
            borderColor: c.border,
            textColor: c.text,
            scaleMargins: { top: 0.14, bottom: 0.20 },
        },
        timeScale: {
            borderColor: c.border,
            textColor: c.text,
            timeVisible: true,
            secondsVisible: false,
        },
    };

    // Apply saved heights from localStorage if set
    try {
        const savedHeights = JSON.parse(localStorage.getItem("finwhale_chart_heights"));
        if (savedHeights && typeof savedHeights.daily === "number" && typeof savedHeights.intraday === "number") {
            const minH = 160;
            if (savedHeights.daily >= minH && savedHeights.intraday >= minH) {
                const dw = document.getElementById("dailyChartWrapper");
                const iw = document.getElementById("intradayChartWrapper");
                if (dw) dw.style.height = `${savedHeights.daily}px`;
                if (iw) iw.style.height = `${savedHeights.intraday}px`;
            }
        }
    } catch (e) {}

    // 1. Initialize Daily Chart
    const dailyContainer = document.getElementById("dailyChartContainer");
    const hudCard = document.getElementById("dailyHudCard");

    if (dailyContainer) {
        dailyChart = LightweightCharts.createChart(dailyContainer, {
            ...chartCommonOptions,
            autoSize: true,
        });

        dailySeries = dailyChart.addCandlestickSeries({
            upColor: c.upColor,
            downColor: c.downColor,
            borderVisible: true,
            borderUpColor: c.upColor,
            borderDownColor: c.downColor,
            wickUpColor: c.upColor,
            wickDownColor: c.downColor,
            autoscaleInfoProvider: (original) => {
                const res = original();
                if (res && res.priceRange) {
                    const min = res.priceRange.minValue;
                    const max = res.priceRange.maxValue;
                    const span = max - min || 1;
                    return {
                        priceRange: {
                            minValue: min - span * 0.04,
                            maxValue: max + span * 0.10,
                        }
                    };
                }
                return res;
            },
        });

        // Subtle volume series on daily chart (at bottom, max 18% height)
        dailyVolumeSeries = dailyChart.addHistogramSeries({
            priceScaleId: "volume_scale",
            priceFormat: { type: "volume" },
            lastValueVisible: false,
            priceLineVisible: false,
        });
        dailyChart.priceScale("volume_scale").applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
            visible: false,
        });

        // Hover visibility for Daily HUD Card
        dailyContainer.addEventListener("mouseenter", () => {
            if (hudCard) hudCard.classList.add("visible");
        });

        dailyContainer.addEventListener("mouseleave", () => {
            if (hudCard) hudCard.classList.remove("visible");
            const tooltip = document.getElementById("eventTooltip");
            if (tooltip) tooltip.classList.add("hidden");
        });

        let lastClickTimestamp = 0;
        let lastHoveredDateStr = "";
        let isChartsSynced = true;

        const syncBtn = document.getElementById("syncChartsBtn");
        if (syncBtn) {
            syncBtn.addEventListener("click", () => {
                isChartsSynced = !isChartsSynced;
                syncBtn.classList.toggle("active", isChartsSynced);
                if (isChartsSynced && lastHoveredDateStr) {
                    loadStockIntradayChart(currentStockTicker, lastHoveredDateStr);
                }
            });
        }

        // Native Double Click on daily chart container
        dailyContainer.addEventListener("dblclick", () => {
            if (lastHoveredDateStr) {
                loadStockIntradayChart(currentStockTicker, lastHoveredDateStr);
            }
        });

        dailyContainer.addEventListener("pointerdown", (e) => {
            lastDailyPointerDown = { x: e.clientX, y: e.clientY, time: Date.now() };
        }, true);
        dailyContainer.addEventListener("pointerup", (e) => {
            lastDailyPointerUp = { x: e.clientX, y: e.clientY, time: Date.now() };
        }, true);

        // Click / Double Click -> Sync & Load exact Intraday Chart Day
        dailyChart.subscribeClick((param) => {
            if (suppressChartClickAction) return;
            // Ignore click if mouse moved during drag (user was panning the daily chart)
            const dragDist = Math.hypot(
                lastDailyPointerUp.x - lastDailyPointerDown.x,
                lastDailyPointerUp.y - lastDailyPointerDown.y
            );
            if (dragDist > 6) return;
            if (!param || !param.time) return;
            let dateStr = "";
            if (typeof param.time === "string") {
                dateStr = param.time;
            } else if (typeof param.time === "object" && param.time.year) {
                const y = param.time.year;
                const m = String(param.time.month).padStart(2, "0");
                const d = String(param.time.day).padStart(2, "0");
                dateStr = `${y}-${m}-${d}`;
            }

            if (dateStr && currentDailyCandlesMap[dateStr]) {
                updateDailyHudCard(currentDailyCandlesMap[dateStr]);
            }

            const now = Date.now();
            const isDouble = (now - lastClickTimestamp < 450);
            lastClickTimestamp = now;

            // Always set selection line on clicked date
            if (dateStr) {
                setDailySelectedDate(dateStr);
            }

            // Load intraday on click or when sync is active
            if (dateStr && (isDouble || isChartsSynced)) {
                loadStockIntradayChart(currentStockTicker, dateStr);
            }
        });

        // Sync subtle laser line position on pan / zoom
        dailyChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            updateDailySelectionLine();
        });
        dailyChart.timeScale().subscribeVisibleTimeRangeChange(() => {
            updateDailySelectionLine();
        });

        // Hover -> Update Floating HUD Card & Event Tooltip
        dailyChart.subscribeCrosshairMove((param) => {
            const tooltip = document.getElementById("eventTooltip");

            if (dailyRulerInstance && dailyRulerInstance.getState() === "MEASURING") {
                if (hudCard) hudCard.classList.remove("visible");
                if (tooltip) tooltip.classList.add("hidden");
                return;
            }

            if (!param || !param.time || !param.point) {
                if (tooltip) tooltip.classList.add("hidden");
                return;
            }

            let dateStr = "";
            if (typeof param.time === "string") {
                dateStr = param.time;
            } else if (typeof param.time === "object" && param.time.year) {
                const y = param.time.year;
                const m = String(param.time.month).padStart(2, "0");
                const d = String(param.time.day).padStart(2, "0");
                dateStr = `${y}-${m}-${d}`;
            }

            if (dateStr) {
                lastHoveredDateStr = dateStr;
            }

            if (dateStr && currentDailyCandlesMap[dateStr]) {
                updateDailyHudCard(currentDailyCandlesMap[dateStr]);
                if (hudCard) hudCard.classList.add("visible");
            }

            const eKey = `e_${dateStr}`;
            const dKey = `d_${dateStr}`;
            const eventData = currentMarkerDetails[eKey] || currentMarkerDetails[dKey];

            if (eventData && tooltip) {
                renderEventTooltip(tooltip, eventData, param.point, dailyContainer);
            } else if (tooltip) {
                tooltip.classList.add("hidden");
            }
        });
    }

    // 2. Initialize Intraday Chart (Soft Layered Background + Volume)
    const intradayContainer = document.getElementById("intradayChartContainer");
    if (intradayContainer) {
        intradayChart = LightweightCharts.createChart(intradayContainer, {
            ...chartCommonOptions,
            autoSize: true,
        });

        intradayBgSeries = intradayChart.addHistogramSeries({
            priceScaleId: "session_bg_scale",
            priceFormat: { type: "volume" },
            scaleMargins: { top: 0, bottom: 0 },
            lastValueVisible: false,
            priceLineVisible: false,
            base: 0,
            autoscaleInfoProvider: () => ({
                priceRange: {
                    minValue: 0,
                    maxValue: 1,
                },
            }),
        });
        intradayChart.priceScale("session_bg_scale").applyOptions({
            scaleMargins: { top: 0, bottom: 0 },
            visible: false,
        });

        // Subtle volume series on intraday chart (at bottom, max 18% height)
        intradayVolumeSeries = intradayChart.addHistogramSeries({
            priceScaleId: "volume_scale",
            priceFormat: { type: "volume" },
            lastValueVisible: false,
            priceLineVisible: false,
        });
        intradayChart.priceScale("volume_scale").applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
            visible: false,
        });

        intradaySeries = intradayChart.addCandlestickSeries({
            upColor: c.upColor,
            downColor: c.downColor,
            borderVisible: true,
            borderUpColor: c.upColor,
            borderDownColor: c.downColor,
            wickUpColor: c.upColor,
            wickDownColor: c.downColor,
            autoscaleInfoProvider: (original) => {
                const res = original();
                if (res && res.priceRange) {
                    const min = res.priceRange.minValue;
                    const max = res.priceRange.maxValue;
                    const span = max - min || 1;
                    return {
                        priceRange: {
                            minValue: min - span * 0.04,
                            maxValue: max + span * 0.14,
                        }
                    };
                }
                return res;
            },
        });

        // Track user panning/interaction on intraday chart to prevent in-flight snap-backs
        intradayContainer.addEventListener("pointerdown", () => {
            userInteractedIntradayDuringLoad = true;
        }, { passive: true });
        intradayContainer.addEventListener("wheel", () => {
            userInteractedIntradayDuringLoad = true;
        }, { passive: true });
    }

    // Connect Volume Toggle Buttons
    const toggleDailyVolBtn = document.getElementById("toggleDailyVolBtn");
    if (toggleDailyVolBtn) {
        toggleDailyVolBtn.addEventListener("click", () => {
            isDailyVolVisible = !isDailyVolVisible;
            toggleDailyVolBtn.classList.toggle("active", isDailyVolVisible);
            if (dailyVolumeSeries) {
                dailyVolumeSeries.applyOptions({ visible: isDailyVolVisible });
            }
        });
    }

    const toggleIntradayVolBtn = document.getElementById("toggleIntradayVolBtn");
    if (toggleIntradayVolBtn) {
        toggleIntradayVolBtn.addEventListener("click", () => {
            isIntradayVolVisible = !isIntradayVolVisible;
            toggleIntradayVolBtn.classList.toggle("active", isIntradayVolVisible);
            if (intradayVolumeSeries) {
                intradayVolumeSeries.applyOptions({ visible: isIntradayVolVisible });
            }
        });
    }

    // Initialize TradingView Measure Tools (Ctrl + LMB)
    if (dailyContainer) {
        const dailyWrapper = dailyContainer.closest(".chart-wrapper");
        if (dailyWrapper) {
            dailyRulerInstance = setupChartRuler({
                chart: dailyChart,
                series: dailySeries,
                container: dailyContainer,
                wrapper: dailyWrapper,
                svgId: "dailyRulerSvg",
                badgeId: "dailyRulerBadge",
                isIntraday: false,
            });
        }
    }

    if (intradayContainer) {
        const intradayWrapper = intradayContainer.closest(".chart-wrapper");
        if (intradayWrapper) {
            intradayRulerInstance = setupChartRuler({
                chart: intradayChart,
                series: intradaySeries,
                container: intradayContainer,
                wrapper: intradayWrapper,
                svgId: "intradayRulerSvg",
                badgeId: "intradayRulerBadge",
                isIntraday: true,
            });
        }
    }

    window.addEventListener("resize", resizeCharts);
    initChartResizer();
}

// ============================================================
// DUAL CHARTS SPLITTER RESIZER (Interactive Height Adjustment)
// ============================================================
function initChartResizer() {
    const resizer = document.getElementById("chartResizer");
    const dailyWrapper = document.getElementById("dailyChartWrapper");
    const intradayWrapper = document.getElementById("intradayChartWrapper");

    if (!resizer || !dailyWrapper || !intradayWrapper) return;

    let isDragging = false;
    let startY = 0;
    let startDailyHeight = 0;
    let startIntradayHeight = 0;
    const minHeight = 160;

    const onPointerDown = (e) => {
        isDragging = true;
        startY = e.clientY;
        startDailyHeight = dailyWrapper.getBoundingClientRect().height;
        startIntradayHeight = intradayWrapper.getBoundingClientRect().height;

        resizer.classList.add("dragging");
        document.body.classList.add("chart-resizing");

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;

        const dy = e.clientY - startY;
        const totalHeight = startDailyHeight + startIntradayHeight;

        // Pulling UP (dy < 0) -> daily decreases, intraday increases
        // Pulling DOWN (dy > 0) -> daily increases, intraday decreases
        let newDaily = Math.round(startDailyHeight + dy);
        let newIntraday = Math.round(startIntradayHeight - dy);

        if (newDaily < minHeight) {
            newDaily = minHeight;
            newIntraday = totalHeight - minHeight;
        } else if (newIntraday < minHeight) {
            newIntraday = minHeight;
            newDaily = totalHeight - minHeight;
        }

        dailyWrapper.style.height = `${newDaily}px`;
        intradayWrapper.style.height = `${newIntraday}px`;

        if (dailyChart) {
            dailyChart.applyOptions({ height: newDaily });
        }
        if (intradayChart) {
            intradayChart.applyOptions({ height: newIntraday });
        }

        updateDailySelectionLine();
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;

        resizer.classList.remove("dragging");
        document.body.classList.remove("chart-resizing");

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);

        const finalDaily = Math.round(dailyWrapper.getBoundingClientRect().height);
        const finalIntraday = Math.round(intradayWrapper.getBoundingClientRect().height);

        try {
            localStorage.setItem("finwhale_chart_heights", JSON.stringify({
                daily: finalDaily,
                intraday: finalIntraday
            }));
        } catch (e) {}

        resizeCharts();
        updateDailySelectionLine();
    };

    resizer.addEventListener("pointerdown", onPointerDown);

    // Double-click resets back to standard 380px / 380px layout
    resizer.addEventListener("dblclick", () => {
        dailyWrapper.style.height = "380px";
        intradayWrapper.style.height = "380px";
        if (dailyChart) dailyChart.applyOptions({ height: 380 });
        if (intradayChart) intradayChart.applyOptions({ height: 380 });
        try {
            localStorage.removeItem("finwhale_chart_heights");
        } catch (e) {}
        resizeCharts();
        updateDailySelectionLine();
    });
}

// ============================================================
// TRADINGVIEW DATE & PRICE RANGE MEASURE TOOL (RULER)
// ============================================================
function setupChartRuler({ chart, series, container, wrapper, svgId, badgeId, isIntraday }) {
    if (!chart || !series || !container || !wrapper) return null;

    const svg = document.getElementById(svgId);
    const badge = document.getElementById(badgeId);
    if (!svg || !badge) return null;

    const rectEl = svg.querySelector(".chart-ruler-rect");
    const lineEl = svg.querySelector(".chart-ruler-line");
    const dots = svg.querySelectorAll(".chart-ruler-dot");
    const dotStartEl = dots[0];
    const dotEndEl = dots[1];

    // Static badge elements (never destroyed on mousemove)
    const pctEl = badge.querySelector(".ruler-pct");
    const diffEl = badge.querySelector(".ruler-diff");
    const closeBtn = badge.querySelector(".ruler-close-btn");
    const statEl = badge.querySelector(".ruler-stat");
    const pricesEl = badge.querySelector(".ruler-prices");

    let state = "IDLE"; // 'IDLE' | 'MEASURING' | 'PINNED'
    let start = null;   // { x, y, price, logical, time }
    let current = null; // { x, y, price, logical, time }
    let isMouseDown = false;
    let dragStartX = 0;
    let dragStartY = 0;

    function getRussianPlural(n, forms) {
        n = Math.abs(n) % 100;
        const n1 = n % 10;
        if (n > 10 && n < 20) return forms[2];
        if (n1 > 1 && n1 < 5) return forms[1];
        if (n1 === 1) return forms[0];
        return forms[2];
    }

    function parseTimeVal(t) {
        if (!t) return null;
        if (typeof t === "number") return new Date(t * 1000);
        if (typeof t === "string") return new Date(t);
        if (typeof t === "object" && t.year) return new Date(t.year, t.month - 1, t.day);
        return null;
    }

    function clear() {
        state = "IDLE";
        start = null;
        current = null;
        isMouseDown = false;
        container.classList.remove("ruler-measuring");
        svg.classList.add("hidden");
        badge.classList.add("hidden");
        svg.style.display = "none";
        badge.style.display = "none";
        if (rectEl) {
            rectEl.removeAttribute("x");
            rectEl.removeAttribute("y");
            rectEl.removeAttribute("width");
            rectEl.removeAttribute("height");
            rectEl.setAttribute("class", "chart-ruler-rect");
        }
        if (lineEl) {
            lineEl.removeAttribute("x1");
            lineEl.removeAttribute("y1");
            lineEl.removeAttribute("x2");
            lineEl.removeAttribute("y2");
            lineEl.setAttribute("class", "chart-ruler-line");
        }
        if (dotStartEl) {
            dotStartEl.removeAttribute("cx");
            dotStartEl.removeAttribute("cy");
            dotStartEl.setAttribute("class", "chart-ruler-dot");
        }
        if (dotEndEl) {
            dotEndEl.removeAttribute("cx");
            dotEndEl.removeAttribute("cy");
            dotEndEl.setAttribute("class", "chart-ruler-dot");
        }
        badge.style.left = "";
        badge.style.top = "";
    }

    // Initialize ruler state to clean and hidden
    clear();

    // Attach direct fail-safe dismiss listeners on close button
    if (closeBtn) {
        const handleClose = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            clear();
            suppressChartClickAction = true;
            setTimeout(() => { suppressChartClickAction = false; }, 250);
        };
        closeBtn.addEventListener("pointerdown", handleClose, true);
        closeBtn.addEventListener("mousedown", handleClose, true);
        closeBtn.addEventListener("click", handleClose, true);
    }

    wrapper.addEventListener("click", (e) => {
        if (e.target && e.target.closest(".ruler-close-btn")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            clear();
            suppressChartClickAction = true;
            setTimeout(() => { suppressChartClickAction = false; }, 250);
        }
    }, true);

    function draw(x1, y1, x2, y2) {
        if (!start || !current || start.price === null || current.price === null) return;

        const xMin = Math.min(x1, x2);
        const yMin = Math.min(y1, y2);
        const w = Math.max(1, Math.abs(x2 - x1));
        const h = Math.max(1, Math.abs(y2 - y1));

        const diffP = current.price - start.price;
        const pct = start.price !== 0 ? ((diffP / start.price) * 100) : 0;
        const isPositive = diffP >= 0;
        const sign = isPositive ? "+" : "";

        const statusClass = isPositive ? "positive" : "negative";

        // SVG rect
        if (rectEl) {
            rectEl.setAttribute("x", xMin);
            rectEl.setAttribute("y", yMin);
            rectEl.setAttribute("width", w);
            rectEl.setAttribute("height", h);
            rectEl.setAttribute("class", `chart-ruler-rect ${statusClass}`);
        }

        // SVG line
        if (lineEl) {
            lineEl.setAttribute("x1", x1);
            lineEl.setAttribute("y1", y1);
            lineEl.setAttribute("x2", x2);
            lineEl.setAttribute("y2", y2);
            lineEl.setAttribute("class", `chart-ruler-line ${statusClass}`);
        }

        // SVG dots
        if (dotStartEl) {
            dotStartEl.setAttribute("cx", x1);
            dotStartEl.setAttribute("cy", y1);
            dotStartEl.setAttribute("class", `chart-ruler-dot ${statusClass}`);
        }

        if (dotEndEl) {
            dotEndEl.setAttribute("cx", x2);
            dotEndEl.setAttribute("cy", y2);
            dotEndEl.setAttribute("class", `chart-ruler-dot ${statusClass}`);
        }

        // Bars & Time difference
        const barCount = (start.logical !== null && start.logical !== undefined && current.logical !== null && current.logical !== undefined)
            ? Math.abs(Math.round(current.logical - start.logical))
            : 0;
        const barsWord = getRussianPlural(barCount, ["бар", "бара", "баров"]);
        const barsStr = `${barCount} ${barsWord}`;

        let timeStr = "";
        if (isIntraday) {
            let diffSec = 0;
            if (typeof start.time === "number" && typeof current.time === "number") {
                diffSec = Math.abs(current.time - start.time);
            }
            if (diffSec > 0) {
                const totalMins = Math.round(diffSec / 60);
                const hrs = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                timeStr = hrs > 0 ? `${hrs}ч ${mins}мин` : `${mins}мин`;
            } else {
                const totalMins = barCount * (activeTfMultiplier || 1);
                const hrs = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                timeStr = hrs > 0 ? `${hrs}ч ${mins}мин` : `${mins}мин`;
            }
        } else {
            const d1 = parseTimeVal(start.time);
            const d2 = parseTimeVal(current.time);
            if (d1 && d2 && !isNaN(d1) && !isNaN(d2)) {
                const diffDays = Math.round(Math.abs(d2 - d1) / (1000 * 3600 * 24));
                timeStr = `${diffDays}д`;
            } else {
                timeStr = `${barCount}д`;
            }
        }

        // Format prices
        const pctStr = `${sign}${pct.toFixed(2)}%`;
        const diffPStr = `${sign}${diffP.toFixed(2)}`;
        const p1Str = start.price.toFixed(2);
        const p2Str = current.price.toFixed(2);

        // Update badge text without rebuilding DOM
        if (pctEl) {
            pctEl.textContent = pctStr;
            pctEl.className = `ruler-pct ${statusClass}`;
        }
        if (diffEl) {
            diffEl.textContent = `(${diffPStr})`;
            diffEl.className = `ruler-diff ${statusClass}`;
        }
        if (statEl) {
            statEl.textContent = `${barsStr}, ${timeStr}`;
        }
        if (pricesEl) {
            pricesEl.textContent = `${p1Str} → ${p2Str}`;
        }

        badge.className = `chart-ruler-badge ${statusClass}`;

        svg.style.display = "block";
        badge.style.display = "block";
        svg.classList.remove("hidden");
        badge.classList.remove("hidden");

        // Calculate badge position: centered horizontally above or below the box
        const cWidth = container.clientWidth || 600;
        const cHeight = container.clientHeight || 380;
        const bWidth = badge.offsetWidth || 180;
        const bHeight = badge.offsetHeight || 52;

        let bx = xMin + (w / 2) - (bWidth / 2);
        bx = Math.max(8, Math.min(bx, cWidth - bWidth - 65)); // leave room for right price scale

        let by;
        if (y2 < y1) {
            // Measuring up: badge sits above top edge
            by = yMin - bHeight - 8;
            if (by < 6) by = yMin + 8;
        } else {
            // Measuring down: badge sits below bottom edge
            by = yMin + h + 8;
            if (by + bHeight > cHeight - 6) by = yMin + h - bHeight - 8;
        }

        badge.style.left = `${Math.round(bx)}px`;
        badge.style.top = `${Math.round(by)}px`;
    }

    function syncCoordinatesFromChart() {
        if (state !== "PINNED" || !start || !current) return;

        let x1 = null;
        let x2 = null;

        if (start.time !== undefined && start.time !== null) {
            try { x1 = chart.timeScale().timeToCoordinate(start.time); } catch (e) {}
        }
        if ((x1 === null || x1 === undefined) && start.logical !== null && start.logical !== undefined) {
            try { x1 = chart.timeScale().logicalToCoordinate(start.logical); } catch (e) {}
        }

        if (current.time !== undefined && current.time !== null) {
            try { x2 = chart.timeScale().timeToCoordinate(current.time); } catch (e) {}
        }
        if ((x2 === null || x2 === undefined) && current.logical !== null && current.logical !== undefined) {
            try { x2 = chart.timeScale().logicalToCoordinate(current.logical); } catch (e) {}
        }

        let y1 = null;
        let y2 = null;
        try {
            y1 = series.priceToCoordinate(start.price);
            y2 = series.priceToCoordinate(current.price);
        } catch (e) {}

        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null &&
            x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
            start.x = x1;
            start.y = y1;
            current.x = x2;
            current.y = y2;
            draw(x1, y1, x2, y2);
        }
    }

    // Subscribe to chart zoom / scroll to keep pinned ruler aligned
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        syncCoordinatesFromChart();
    });
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        syncCoordinatesFromChart();
    });
    window.addEventListener("resize", () => {
        syncCoordinatesFromChart();
    });

    // Mousedown (Capture Phase to handle all chart clicks and ruler triggers)
    wrapper.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // left click only

        // 1. Direct click on close button: ALWAYS clear immediately!
        if (e.target && e.target.closest(".ruler-close-btn")) {
            clear();
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            suppressChartClickAction = true;
            setTimeout(() => { suppressChartClickAction = false; }, 250);
            return;
        }

        // 2. If currently PINNED, any click clears the ruler
        if (state === "PINNED") {
            clear();
            e.preventDefault();
            e.stopPropagation();
            suppressChartClickAction = true;
            setTimeout(() => { suppressChartClickAction = false; }, 250);
            return;
        }

        // 3. If Ctrl or Shift is pressed, start measuring
        if (e.ctrlKey || e.shiftKey) {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const price = series.coordinateToPrice(y);
            if (price === null || price === undefined) return;

            const logical = chart.timeScale().coordinateToLogical(x);
            const time = chart.timeScale().coordinateToTime(x);

            state = "MEASURING";
            container.classList.add("ruler-measuring");
            isMouseDown = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            start = { x, y, price, logical, time };
            current = { ...start };

            draw(x, y, x, y);

            e.preventDefault();
            e.stopPropagation();
            suppressChartClickAction = true;
            setTimeout(() => { suppressChartClickAction = false; }, 250);
            return;
        }

        // 4. If in MEASURING mode and user clicks without Ctrl
        if (state === "MEASURING") {
            const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
            if (dist >= 6) {
                // Pin the measurement on second click
                state = "PINNED";
                container.classList.remove("ruler-measuring");
                e.preventDefault();
                e.stopPropagation();
                suppressChartClickAction = true;
                setTimeout(() => { suppressChartClickAction = false; }, 250);
            } else {
                // Clicked without moving -> cancel
                clear();
                e.preventDefault();
                e.stopPropagation();
                suppressChartClickAction = true;
                setTimeout(() => { suppressChartClickAction = false; }, 250);
            }
        }
    }, true);

    // Mousemove on window so user can move freely across the chart
    window.addEventListener("mousemove", (e) => {
        if (state !== "MEASURING" || !start) return;

        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        const clampedX = Math.max(0, Math.min(cx, container.clientWidth));
        const clampedY = Math.max(0, Math.min(cy, container.clientHeight));

        const price = series.coordinateToPrice(clampedY);
        const logical = chart.timeScale().coordinateToLogical(clampedX);
        const time = chart.timeScale().coordinateToTime(clampedX);

        if (price !== null && price !== undefined) {
            current = { x: clampedX, y: clampedY, price, logical, time };
            draw(start.x, start.y, current.x, current.y);
        }
    });

    // Mouseup on window
    window.addEventListener("mouseup", (e) => {
        if (state === "MEASURING" && isMouseDown) {
            isMouseDown = false;
            const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
            if (dist >= 6) {
                // User dragged and released: lock to PINNED
                state = "PINNED";
                container.classList.remove("ruler-measuring");
                suppressChartClickAction = true;
                setTimeout(() => { suppressChartClickAction = false; }, 250);
            }
        }
    });

    // Escape key removes ruler
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && state !== "IDLE") {
            clear();
        }
    });

    return {
        clear,
        getState: () => state,
    };
}

function setDailySelectedDate(dateStr) {
    if (!dateStr) return;
    activeSelectedDailyDate = dateStr;

    // Clear heavy histogram fill so only the delicate, subtle laser line is shown
    if (dailySelectionSeries) {
        dailySelectionSeries.setData([]);
    }

    // Position subtle vertical laser guide line
    updateDailySelectionLine();

    // 3. Update HUD card
    if (currentDailyCandlesMap[dateStr]) {
        updateDailyHudCard(currentDailyCandlesMap[dateStr]);
    }
}

function updateDailySelectionLine() {
    const lineEl = document.getElementById("dailySelectionLine");
    if (!lineEl || !activeSelectedDailyDate || !dailyChart) {
        if (lineEl) lineEl.style.display = "none";
        return;
    }

    try {
        const x = dailyChart.timeScale().timeToCoordinate(activeSelectedDailyDate);
        if (x !== null && x !== undefined && !isNaN(x) && x >= 0) {
            lineEl.style.display = "block";
            lineEl.style.left = `${Math.round(x)}px`;
        } else {
            lineEl.style.display = "none";
        }
    } catch (e) {
        lineEl.style.display = "none";
    }
}

function formatCardDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return dateStr || "—";
    const clean = dateStr.split(" ")[0];
    const parts = clean.split("-");
    if (parts.length === 3) {
        const [year, month, day] = parts;
        const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const mIdx = parseInt(month, 10) - 1;
        if (mIdx >= 0 && mIdx < 12) {
            return `${months[mIdx]} ${parseInt(day, 10)}, ${year}`;
        }
    }
    return dateStr.toUpperCase();
}

function updateDailyHudCard(candleData) {
    const card = document.getElementById("dailyHudCard");
    if (!card || !candleData) return;

    const dateDisplay = formatCardDate(candleData.time);

    const headerEl = document.getElementById("hudHeaderTitle");
    if (headerEl) {
        headerEl.textContent = `${currentStockTicker} - ${dateDisplay}`;
    }

    document.getElementById("hudOpen").textContent = Number(candleData.open).toFixed(2);
    document.getElementById("hudHigh").textContent = Number(candleData.high).toFixed(2);
    document.getElementById("hudLow").textContent = Number(candleData.low).toFixed(2);
    document.getElementById("hudClose").textContent = Number(candleData.close).toFixed(2);

    // VOL
    const volVal = candleData.volume || 0;
    const volEl = document.getElementById("hudVol");
    if (volEl) {
        volEl.textContent = formatVolumeReadable(volVal);
    }
}

function renderFinWhaleMetric(elementId, diffVal, pctVal) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const isPos = diffVal >= 0;
    const sign = isPos ? "+" : "";
    const cls = isPos ? "positive" : "negative";
    el.innerHTML = `<span class="${cls}">${sign}${diffVal.toFixed(2)} ${sign}${pctVal.toFixed(2)}%</span>`;
}

function renderEventTooltip(tooltip, eventData, point, container) {
    if (eventData.type === "Earnings") {
        const surprise = eventData.eps_surprise_pct;
        let surpriseHtml = "—";
        if (surprise !== null && surprise !== undefined) {
            const isPos = surprise >= 0;
            const cls = isPos ? "positive" : "negative";
            const prefix = isPos ? "+" : "";
            surpriseHtml = `<span class="${cls}">${prefix}${Number(surprise).toFixed(1)}%</span>`;
        }

        const dateDisplay = formatCardDate(eventData.date);
        const sessionTag = (eventData.session || "AMC").toUpperCase();

        tooltip.innerHTML = `
            <div class="tooltip-date-header">${dateDisplay}</div>
            <div class="tooltip-tag-line">EARNINGS ${sessionTag}</div>
            <div class="tooltip-grid-finwhale">
                <div class="tooltip-grid-row">
                    <span class="lbl">EPS act</span>
                    <span class="val">${eventData.eps_actual !== null && eventData.eps_actual !== undefined ? Number(eventData.eps_actual).toFixed(2) : "—"}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">EPS est</span>
                    <span class="val">${eventData.eps_estimate !== null && eventData.eps_estimate !== undefined ? Number(eventData.eps_estimate).toFixed(2) : "—"}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">surp</span>
                    <span class="val">${surpriseHtml}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">Rev act</span>
                    <span class="val">${eventData.revenue_actual ? formatCurrency(eventData.revenue_actual) : "—"}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">Rev est</span>
                    <span class="val">${eventData.revenue_estimate ? formatCurrency(eventData.revenue_estimate) : "—"}</span>
                </div>
            </div>
        `;
    } else if (eventData.type === "Dividend") {
        const dateDisplay = formatCardDate(eventData.ex_date);

        tooltip.innerHTML = `
            <div class="tooltip-date-header">${dateDisplay}</div>
            <div class="tooltip-tag-line dividend">DIVIDEND</div>
            <div class="tooltip-grid-finwhale">
                <div class="tooltip-grid-row">
                    <span class="lbl">Amount</span>
                    <span class="val">$${Number(eventData.amount || 0).toFixed(4)}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">Pay date</span>
                    <span class="val">${eventData.pay_date || "—"}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">Yield</span>
                    <span class="val">${eventData.yield !== null && eventData.yield !== undefined ? Number(eventData.yield).toFixed(2) + "%" : "—"}</span>
                </div>
                <div class="tooltip-grid-row">
                    <span class="lbl">Freq</span>
                    <span class="val">${eventData.frequency || "Quarterly"}</span>
                </div>
            </div>
        `;
    }

    const maxLeft = (container ? container.clientWidth : window.innerWidth) - 200;
    const targetLeft = Math.max(10, Math.min(point.x + 14, maxLeft));
    const targetTop = Math.max(10, point.y - 20);

    tooltip.style.left = `${targetLeft}px`;
    tooltip.style.top = `${targetTop}px`;
    tooltip.classList.remove("hidden");
}

async function loadStockTickerData(ticker, targetDate = null) {
    ticker = ticker.trim().toUpperCase();
    currentStockTicker = ticker;
    currentActivePeers = [];

    document.getElementById("tickerInput").value = ticker;
    document.getElementById("stockViewSymbolBadge").textContent = ticker;
    const avatarEl = document.getElementById("tickerAvatar");
    if (avatarEl) avatarEl.textContent = ticker.slice(0, 2);

    try {
        await Promise.all([
            loadCompanyProfile(ticker),
            loadStockDailyChart(ticker, targetDate),
            loadEarningsMoves(ticker),
            loadTickerCorrelations(ticker, activeCorrPeriod),
            loadDividends(ticker)
        ]);
    } catch (err) {
        console.error("Error loading ticker data:", err);
    }
}

async function loadCompanyProfile(ticker) {
    try {
        const res = await fetch(`/api/ticker/${ticker}/profile`);
        const data = await res.json();

        document.getElementById("profileSymbol").textContent = data.symbol || data.ticker || ticker;
        document.getElementById("profileName").textContent = data.companyName || data.company_name || ticker;
        document.getElementById("profileExchange").textContent = data.exchange || "US";
        document.getElementById("profilePrice").textContent = data.price ? `$${Number(data.price).toFixed(2)}` : "—";
        document.getElementById("profileSector").textContent = data.sector || "—";
        document.getElementById("profileIndustry").textContent = data.industry || "—";
        document.getElementById("profileMktCap").textContent = (data.mktCap || data.mkt_cap) ? formatCurrency(data.mktCap || data.mkt_cap) : "—";

        const volEl = document.getElementById("profileVolatility");
        if (volEl) {
            if (data.volatility !== null && data.volatility !== undefined) {
                volEl.textContent = `${Number(data.volatility).toFixed(1)}%`;
            } else if (data.beta !== null && data.beta !== undefined) {
                volEl.textContent = `${Number(data.beta).toFixed(2)}`;
            } else {
                volEl.textContent = "—";
            }
        }
        const betaEl = document.getElementById("profileBeta");
        if (betaEl) {
            betaEl.textContent = data.beta !== null && data.beta !== undefined ? Number(data.beta).toFixed(2) : "—";
        }

        const descBox = document.getElementById("profileDescRu");
        const descText = data.description_ru || data.descriptionRu || data.description || "";
        descBox.textContent = descText.trim() ? descText : "Описание деятельности компании отсутствует в базе данных.";

        const businessPeersList = document.getElementById("businessPeersList");
        businessPeersList.innerHTML = "";
        const peers = data.business_peers || [];
        if (peers.length > 0) {
            peers.forEach(peer => {
                const chip = createPeerChip(peer.symbol, peer.companyName, peer.correlation);
                businessPeersList.appendChild(chip);
            });
        } else {
            businessPeersList.innerHTML = `<span class="peers-placeholder">Прямые конкуренты не найдены в базе.</span>`;
        }
    } catch (e) {
        console.error("Profile load error:", e);
    }
}

function createPeerChip(symbol, title, correlation = null) {
    const chip = document.createElement("div");
    chip.className = "peer-chip";
    chip.title = title || symbol;

    let corrHtml = "";
    if (correlation !== null && correlation !== undefined && !isNaN(correlation)) {
        const corrNum = Number(correlation);
        const prefix = corrNum >= 0 ? "+" : "";
        corrHtml = ` <span class="corr-val">${prefix}${corrNum.toFixed(2)}</span>`;
    }

    chip.innerHTML = `<span class="peer-chip-sym">${symbol}</span>${corrHtml}`;
    chip.addEventListener("click", () => switchToStockAnalytics(symbol));
    return chip;
}

async function loadStockDailyChart(ticker, targetDate = null) {
    if (!dailySeries) return;
    if (dailyRulerInstance) dailyRulerInstance.clear();

    try {
        const res = await fetch(`/api/ticker/${ticker}/chart/daily`);
        const data = await res.json();

        const rawCandles = data.candles || [];
        currentDailyCandles = [];
        currentDailyCandlesMap = {};

        const candles = [];
        const volumes = [];
        const c = THEME_CONFIGS[currentTheme] || THEME_CONFIGS.sand;

        for (let i = 0; i < rawCandles.length; i++) {
            const candle = rawCandles[i];
            const prevClose = i > 0 ? rawCandles[i - 1].close : candle.open;
            const isUp = candle.close >= candle.open;

            const candleObj = {
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume || 0,
                prevClose: prevClose
            };

            currentDailyCandles.push(candleObj);
            currentDailyCandlesMap[candle.time] = candleObj;

            candles.push({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
            });

            volumes.push({
                time: candle.time,
                value: candle.volume || 0,
                color: isUp ? c.volUp : c.volDown,
            });
        }

        dailySeries.setData(candles);
        if (dailyVolumeSeries) {
            dailyVolumeSeries.setData(volumes);
            dailyVolumeSeries.applyOptions({ visible: isDailyVolVisible });
        }

        currentMarkerDetails = data.marker_details || {};
        const markers = (data.markers || []).sort((a, b) => a.time.localeCompare(b.time));
        const formattedMarkers = markers.map(m => {
            const isEarnings = m.text === "E";
            return {
                time: m.time,
                position: m.position || "belowBar",
                color: isEarnings ? c.upColor : "#a36816",
                shape: isEarnings ? "square" : "circle",
                text: m.text || "E",
                size: 1.2
            };
        });
        dailySeries.setMarkers(formattedMarkers);
        dailyChart.timeScale().fitContent();

        // Initially link to the target date (or latest daily candle) with guide line
        if (currentDailyCandles.length > 0) {
            let dateToSelect = currentDailyCandles[currentDailyCandles.length - 1].time;
            if (targetDate) {
                if (currentDailyCandlesMap[targetDate]) {
                    dateToSelect = targetDate;
                } else {
                    const sortedDates = Object.keys(currentDailyCandlesMap).sort();
                    const candidates = sortedDates.filter(d => d <= targetDate);
                    if (candidates.length > 0) {
                        dateToSelect = candidates[candidates.length - 1];
                    }
                }
            }
            setDailySelectedDate(dateToSelect);
            loadStockIntradayChart(ticker, dateToSelect);
            if (targetDate) {
                setTimeout(() => {
                    document.querySelector(".charts-section")?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            }
        }
    } catch (e) {
        console.error("Daily chart load error:", e);
    }
}

async function loadStockIntradayChart(ticker, dateStr) {
    if (!intradaySeries) return;
    if (intradayRulerInstance) intradayRulerInstance.clear();
    const dateEl = document.getElementById("activeIntradayDate");
    if (dateEl) dateEl.textContent = dateStr;

    // 1. In-memory Cache Check: If data for this ticker & multiplier is already loaded and contains dateStr, focus instantly without network delay!
    if (
        currentIntradayLoadedTicker === ticker &&
        currentIntradayMultiplier === activeTfMultiplier &&
        currentIntradayCandlesByDate.has(dateStr)
    ) {
        focusIntradayOnDate(dateStr);
        return;
    }

    // 2. Abort any previous pending fetch to prevent race conditions & multi-click snap-backs
    if (currentIntradayAbortController) {
        currentIntradayAbortController.abort();
    }
    currentIntradayAbortController = new AbortController();
    const signal = currentIntradayAbortController.signal;

    // Reset interaction guard for the new load
    userInteractedIntradayDuringLoad = false;

    const intraWrapper = document.getElementById("intradayChartContainer")?.closest(".chart-wrapper");
    if (intraWrapper) intraWrapper.classList.add("chart-loading-dim");

    try {
        const res = await fetch(`/api/ticker/${ticker}/chart/intraday?date=${dateStr}&multiplier=${activeTfMultiplier}`, { signal });
        const data = await res.json();

        const rawCandles = data.candles || [];
        if (rawCandles.length === 0) {
            if (intradayBgSeries) intradayBgSeries.setData([]);
            if (intradayVolumeSeries) intradayVolumeSeries.setData([]);
            intradaySeries.setData([]);
            currentIntradayLoadedTicker = ticker;
            currentIntradayMultiplier = activeTfMultiplier;
            currentIntradayCandlesByDate.clear();
            currentIntradaySortedTimes = [];
            return;
        }

        const c = THEME_CONFIGS[currentTheme] || THEME_CONFIGS.sand;

        // Map-based deduplication guaranteeing strictly ascending, unique timestamps
        const candleMap = new Map();
        const bgMap = new Map();
        const volMap = new Map();
        const byDate = new Map();

        rawCandles.forEach(candle => {
            let timeVal = candle.timestamp;
            if (!timeVal) {
                const dt = new Date(`${candle.time.replace(" ", "T")}Z`);
                timeVal = Math.floor(dt.getTime() / 1000);
            }
            if (isNaN(timeVal)) return;

            // Session background: Premarket is yellow, Postmarket is blue, Intraday regular session is untouched (transparent)
            let sType = candle.session_type;
            if (!sType) {
                const tStr = candle.time_str || (typeof candle.time === "string" && candle.time.includes(" ") ? candle.time.split(" ")[1]?.slice(0, 5) : "");
                if (tStr) {
                    if (tStr >= "04:00" && tStr < "09:30") sType = "premarket";
                    else if (tStr >= "09:30" && tStr < "16:00") sType = "regular";
                    else if (tStr >= "16:00" && tStr <= "20:00") sType = "postmarket";
                }
            }

            let bgColor = "transparent";
            let bgVal = 0;

            if (sType === "premarket") {
                bgColor = c.premarketBg || "rgba(234, 179, 8, 0.18)"; // Премаркет желтый
                bgVal = 1;
            } else if (sType === "postmarket") {
                bgColor = c.postmarketBg || "rgba(37, 99, 235, 0.25)"; // Постмаркет синий
                bgVal = 1;
            }

            bgMap.set(timeVal, {
                time: timeVal,
                value: bgVal,
                color: bgColor
            });

            candleMap.set(timeVal, {
                time: timeVal,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                date: candle.date
            });

            const isUp = (candle.close >= candle.open);
            volMap.set(timeVal, {
                time: timeVal,
                value: candle.volume || 0,
                color: isUp ? c.volUp : c.volDown
            });

            const dKey = candle.date || (candle.time ? candle.time.split(" ")[0] : "");
            if (dKey) {
                if (!byDate.has(dKey)) byDate.set(dKey, []);
                byDate.get(dKey).push(timeVal);
            }
        });

        const sortedTimes = Array.from(candleMap.keys()).sort((a, b) => a - b);
        const candles = sortedTimes.map(t => candleMap.get(t));
        const bgBars = sortedTimes.map(t => bgMap.get(t));
        const volumes = sortedTimes.map(t => volMap.get(t));

        currentIntradayLoadedTicker = ticker;
        currentIntradayMultiplier = activeTfMultiplier;
        currentIntradayCandlesByDate = byDate;
        currentIntradaySortedTimes = sortedTimes;

        if (intradayBgSeries) intradayBgSeries.setData(bgBars);
        if (intradayVolumeSeries) {
            intradayVolumeSeries.setData(volumes);
            intradayVolumeSeries.applyOptions({ visible: isIntradayVolVisible });
        }
        intradaySeries.setData(candles);

        // Only snap/set viewport if user didn't start panning while the data was loading
        if (!userInteractedIntradayDuringLoad) {
            focusIntradayOnDate(dateStr);
        }

    } catch (e) {
        if (e.name !== "AbortError") {
            console.error("Intraday chart load error:", e);
        }
    } finally {
        if (intraWrapper) intraWrapper.classList.remove("chart-loading-dim");
    }
}

function focusIntradayOnDate(dateStr) {
    if (!intradayChart || !currentIntradaySortedTimes.length) return;
    let dayMatchedTimes = [];
    if (dateStr && currentIntradayCandlesByDate.has(dateStr)) {
        dayMatchedTimes = currentIntradayCandlesByDate.get(dateStr);
    } else if (dateStr) {
        dayMatchedTimes = currentIntradaySortedTimes.filter(t => {
            const dt = new Date(t * 1000);
            return dt.toISOString().split("T")[0] === dateStr;
        });
    }

    if (dayMatchedTimes.length > 0) {
        const firstTs = dayMatchedTimes[0];
        const lastTs = dayMatchedTimes[dayMatchedTimes.length - 1];
        const pad = Math.max(1800, (lastTs - firstTs) * 0.05);
        intradayChart.timeScale().setVisibleRange({
            from: firstTs - pad,
            to: lastTs + pad
        });
    } else if (currentIntradaySortedTimes.length > 0) {
        const lastTs = currentIntradaySortedTimes[currentIntradaySortedTimes.length - 1];
        intradayChart.timeScale().setVisibleRange({
            from: lastTs - (3600 * 18),
            to: lastTs + 1800
        });
    }
}

async function loadEarningsMoves(ticker) {
    const tbody = document.getElementById("earningsTableBody");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Загрузка данных по отчетам...</td></tr>`;
    }

    try {
        const res = await fetch(`/api/ticker/${ticker}/earnings-moves?limit=8`);
        const data = await res.json();
        currentEarningsMatrix = data.matrix || [];

        if (currentEarningsMatrix.length === 0) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Нет данных по отчетности за последние 8 кварталов.</td></tr>`;
            }
            return;
        }

        renderEarningsTable();
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Ошибка загрузки матрицы отчетов.</td></tr>`;
        }
    }
}

function renderEarningsTable() {
    const tbody = document.getElementById("earningsTableBody");
    if (!tbody || !currentEarningsMatrix.length) return;

    tbody.innerHTML = "";

    const dayKeys = ["R-1", "R", "R+1", "R+2"];
    const dayStats = {
        "R-1": [],
        "R": [],
        "R+1": [],
        "R+2": []
    };

    currentEarningsMatrix.forEach(row => {
        const tr = document.createElement("tr");

        const surpriseMove = formatPctBadge(row.eps_surprise_pct);
        const sessionBadge = `<span class="tooltip-session-pill">${row.session || 'AMC'}</span>`;

        const epsStr = row.eps_actual !== null 
            ? `$${Number(row.eps_actual).toFixed(2)} / $${Number(row.eps_estimate || 0).toFixed(2)}`
            : "—";

        const revStr = row.revenue_actual 
            ? `${formatCurrency(row.revenue_actual)} / ${formatCurrency(row.revenue_estimate)}`
            : "—";

        let daysHtml = "";
        dayKeys.forEach(dKey => {
            const metric = selectedDayMetrics[dKey] || "close_to_close";
            const dayObj = (row.days && row.days[dKey]) ? row.days[dKey] : null;
            const val = dayObj ? dayObj[metric] : null;

            if (val !== null && val !== undefined && !isNaN(val)) {
                dayStats[dKey].push(Number(val));
                daysHtml += `<td>${formatPctBadge(val)}</td>`;
            } else {
                daysHtml += `<td><span style="color: var(--text-muted);">—</span></td>`;
            }
        });

        tr.innerHTML = `
            <td><strong>${row.quarter}</strong></td>
            <td>${row.date}</td>
            <td>${sessionBadge}</td>
            <td>${epsStr}</td>
            <td>${surpriseMove}</td>
            <td>${revStr}</td>
            ${daysHtml}
        `;

        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
            const targetDate = row.reaction_date || row.date;
            setDailySelectedDate(targetDate);
            loadStockIntradayChart(currentStockTicker, targetDate);
            document.querySelector(".charts-section").scrollIntoView({ behavior: "smooth" });
        });

        tbody.appendChild(tr);
    });

    renderEarningsTableFooter(dayStats);
}

function renderEarningsTableFooter(dayStats) {
    const tfoot = document.getElementById("earningsTableFoot");
    if (!tfoot) return;

    const dayKeys = ["R-1", "R", "R+1", "R+2"];

    const calcMetrics = (vals) => {
        if (!vals || vals.length === 0) return { mean: "—", med: "—", max: "—", min: "—", win: "—" };
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sorted = [...vals].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        const max = Math.max(...vals);
        const min = Math.min(...vals);
        const wins = (vals.filter(v => v > 0).length / vals.length) * 100;
        return {
            mean: formatPctBadge(mean),
            med: formatPctBadge(med),
            max: formatPctBadge(max),
            min: formatPctBadge(min),
            win: `<span style="font-weight:700; color:var(--text-green);">${wins.toFixed(0)}%</span>`
        };
    };

    const metricsByDay = {};
    dayKeys.forEach(k => {
        metricsByDay[k] = calcMetrics(dayStats[k]);
    });

    tfoot.innerHTML = `
        <tr>
            <td colspan="6" class="stat-label-cell">MEAN (СРЕДНЕЕ)</td>
            ${dayKeys.map(k => `<td class="stat-val-cell">${metricsByDay[k].mean}</td>`).join("")}
        </tr>
        <tr>
            <td colspan="6" class="stat-label-cell">MEDIAN (МЕДИАНА)</td>
            ${dayKeys.map(k => `<td class="stat-val-cell">${metricsByDay[k].med}</td>`).join("")}
        </tr>
        <tr>
            <td colspan="6" class="stat-label-cell">MAX (МАКСИМУМ)</td>
            ${dayKeys.map(k => `<td class="stat-val-cell">${metricsByDay[k].max}</td>`).join("")}
        </tr>
        <tr>
            <td colspan="6" class="stat-label-cell">MIN (МИНИМУМ)</td>
            ${dayKeys.map(k => `<td class="stat-val-cell">${metricsByDay[k].min}</td>`).join("")}
        </tr>
        <tr>
            <td colspan="6" class="stat-label-cell">WIN RATE (% ПОЛОЖИТЕЛЬНЫХ)</td>
            ${dayKeys.map(k => `<td class="stat-val-cell">${metricsByDay[k].win}</td>`).join("")}
        </tr>
    `;
}

let activeCorrBenchmarks = ["SPY", "QQQ", "SOXX", "IGV", "DRAM"];
let corrTargetMove = 2.0;
let corrDefaultPeerMove = 1.0;
let corrCustomMovesMap = {};
let currentCorrList = [];

async function loadTickerCorrelations(ticker, period = activeCorrPeriod) {
    activeCorrPeriod = period;
    const tbody = document.getElementById("corrTableBody");
    const industryCorrList = document.getElementById("industryCorrList");
    const industryCorrCount = document.getElementById("industryCorrCount");

    // Update target ticker labels in UI
    const targetTickerEl = document.getElementById("corrTargetTickerLabel");
    if (targetTickerEl) targetTickerEl.textContent = ticker;
    const targetColEl = document.getElementById("corrTargetColLabel");
    if (targetColEl) targetColEl.textContent = ticker;
    const targetActEl = document.getElementById("corrTargetActLabel");
    if (targetActEl) targetActEl.textContent = ticker;

    const targetInputEl = document.getElementById("corrTargetMoveInput");
    if (targetInputEl && !isNaN(parseFloat(targetInputEl.value))) {
        corrTargetMove = parseFloat(targetInputEl.value);
    }

    // If all benchmarks and peers were explicitly cleared
    if (activeCorrBenchmarks.length === 0 && currentActivePeers.length === 0) {
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="12" class="loading-cell" style="padding: 28px 16px; text-align: center;">
                        <div style="margin-bottom: 8px; font-weight: 600; color: var(--text-muted);">
                            Все активы и бенчмарки удалены из матрицы.
                        </div>
                        <button class="corr-restore-btn" id="restoreBenchmarksBtn" type="button">
                            ↺ Восстановить бенчмарки по умолчанию
                        </button>
                    </td>
                </tr>
            `;
            const restoreBtn = document.getElementById("restoreBenchmarksBtn");
            if (restoreBtn) {
                restoreBtn.addEventListener("click", () => {
                    activeCorrBenchmarks = ["SPY", "QQQ", "SOXX", "IGV", "DRAM"];
                    loadTickerCorrelations(ticker, period);
                });
            }
        }
        return;
    }

    try {
        let url = `/api/ticker/${ticker}/correlations?period=${period}`;
        url += `&benchmarks=${encodeURIComponent(activeCorrBenchmarks.join(","))}`;
        if (currentActivePeers.length > 0) {
            url += `&peers=${encodeURIComponent(currentActivePeers.join(","))}`;
        }
        const res = await fetch(url);
        const data = await res.json();

        const highCorrs = data.high_corr_industry || [];
        const topPositives = data.top_positive_industry || [];
        if (industryCorrList) {
            industryCorrList.innerHTML = "";
            if (highCorrs.length > 0) {
                if (industryCorrCount) industryCorrCount.textContent = `${highCorrs.length} тикеров (r ≥ 0.60)`;
                highCorrs.forEach(item => {
                    const chip = createPeerChip(item.symbol, `Correlation: ${Number(item.correlation).toFixed(3)}`, item.correlation);
                    industryCorrList.appendChild(chip);
                });
            } else if (topPositives.length > 0) {
                if (industryCorrCount) industryCorrCount.textContent = `Макс. за период:`;
                topPositives.forEach(item => {
                    const chip = createPeerChip(item.symbol, `Correlation: ${Number(item.correlation).toFixed(3)}`, item.correlation);
                    industryCorrList.appendChild(chip);
                });
            } else {
                if (industryCorrCount) industryCorrCount.textContent = "Нет связей";
                industryCorrList.innerHTML = `<span class="peers-placeholder">Нет активов с положительной корреляцией.</span>`;
            }
        }

        const multiSummary = data.multi_period_summary || {};
        const activeSummary = multiSummary[period] || {};

        const spyC = document.getElementById("spyCorrVal");
        if (spyC) spyC.textContent = activeSummary.spy_correlation !== undefined && activeSummary.spy_correlation !== null 
            ? Number(activeSummary.spy_correlation).toFixed(2) : "—";
        const spyB = document.getElementById("spyBetaVal");
        if (spyB) spyB.textContent = activeSummary.spy_beta !== undefined && activeSummary.spy_beta !== null
            ? `Beta: ${Number(activeSummary.spy_beta).toFixed(2)}` : "Beta: —";

        const qqqC = document.getElementById("qqqCorrVal");
        if (qqqC) qqqC.textContent = activeSummary.qqq_correlation !== undefined && activeSummary.qqq_correlation !== null
            ? Number(activeSummary.qqq_correlation).toFixed(2) : "—";
        const qqqB = document.getElementById("qqqBetaVal");
        if (qqqB) qqqB.textContent = activeSummary.qqq_beta !== undefined && activeSummary.qqq_beta !== null
            ? `Beta: ${Number(activeSummary.qqq_beta).toFixed(2)}` : "Beta: —";

        const dailyVol = data.target_volatility;
        const volValEl = document.getElementById("targetVolVal");
        if (volValEl) volValEl.textContent = dailyVol ? `${(dailyVol * 100).toFixed(2)}%` : "—";
        const volAnnEl = document.getElementById("targetVolAnn");
        if (volAnnEl) volAnnEl.textContent = dailyVol ? `Годовая: ${(dailyVol * Math.sqrt(252) * 100).toFixed(1)}%` : "Годовая: —";

        currentCorrList = data.ticker_correlations || [];
        if (currentCorrList.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="loading-cell">Нет данных для расчета корреляций.</td></tr>`;
            return;
        }

        renderCorrTableRows();
    } catch (e) {
        console.error("Correlations matrix fetch error:", e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="loading-cell">Ошибка расчета матрицы корреляций.</td></tr>`;
    }
}

function updateCorrTableRow(tr, item) {
    if (!tr || !item) return;
    const peerMove = corrCustomMovesMap[item.symbol] !== undefined ? corrCustomMovesMap[item.symbol] : corrDefaultPeerMove;
    item._peerMove = peerMove;

    let expMove = null;
    let diff = null;
    let normDiff = null;

    if (item.beta !== null && !isNaN(item.beta) && peerMove !== null && !isNaN(peerMove)) {
        expMove = item.beta * peerMove;
        if (corrTargetMove !== null && !isNaN(corrTargetMove)) {
            diff = corrTargetMove - expMove;
            const resVol = (item.residual_volatility !== null && item.residual_volatility !== undefined && item.residual_volatility > 0)
                ? item.residual_volatility
                : item.volatility;
            if (resVol && resVol > 0) {
                normDiff = diff / (resVol * 100);
            }
        }
    }
    item._expMove = expMove;
    item._diff = diff;
    item._normDiff = normDiff;

    const expFmt = expMove !== null ? `${expMove >= 0 ? "+" : ""}${expMove.toFixed(2)}%` : "—";
    let diffHtml = "—";
    if (diff !== null) {
        if (diff > 0.001) {
            diffHtml = `<span class="badge-diff overbought">+${diff.toFixed(2)}% Перекуплен</span>`;
        } else if (diff < -0.001) {
            diffHtml = `<span class="badge-diff oversold">${diff.toFixed(2)}% Перепродан</span>`;
        } else {
            diffHtml = `<span class="badge-diff neutral">0.00%</span>`;
        }
    }

    let normHtml = "—";
    if (normDiff !== null && !isNaN(normDiff)) {
        const sign = normDiff > 0 ? "+" : "";
        normHtml = `<span class="badge-sigma">${sign}${normDiff.toFixed(2)}σ</span>`;
    }

    const expCell = tr.querySelector(".corr-exp-cell");
    if (expCell) expCell.innerHTML = `<strong>${expFmt}</strong>`;

    const diffCell = tr.querySelector(".corr-diff-cell");
    if (diffCell) diffCell.innerHTML = diffHtml;

    const normCell = tr.querySelector(".corr-norm-cell");
    if (normCell) normCell.innerHTML = normHtml;
}

function updateAllCorrTableRowsForTargetMove() {
    const tbody = document.getElementById("corrTableBody");
    if (!tbody) return;
    const trList = tbody.querySelectorAll("tr");
    trList.forEach(tr => {
        const sym = tr.querySelector(".clickable-ticker")?.dataset?.ticker;
        if (!sym) return;
        const item = currentCorrList.find(i => i.symbol === sym);
        if (item) {
            updateCorrTableRow(tr, item);
        }
    });
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderCorrTableRows() {
    const tbody = document.getElementById("corrTableBody");
    if (!tbody) return;

    // Update partial remove button in toolbar
    const partialBtn = document.getElementById("corrRemovePartialBtn");
    const partialCountEl = document.getElementById("corrPartialCount");
    const partialList = currentCorrList.filter(item => item.is_partial);
    if (partialBtn) {
        if (partialList.length > 0) {
            partialBtn.style.display = "inline-flex";
            if (partialCountEl) partialCountEl.textContent = partialList.length;
            const names = partialList.map(i => i.symbol).join(", ");
            partialBtn.title = `Убрать ${partialList.length} тикер(ов) с неполной историей (< горизонта): ${names}`;
        } else {
            partialBtn.style.display = "none";
        }
    }

    if (currentCorrList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="loading-cell" style="padding: 24px 16px; text-align: center;">
                    <div style="margin-bottom: 8px; font-weight: 600; color: var(--text-muted);">
                        Все активы и бенчмарки удалены из матрицы.
                    </div>
                    <button class="corr-restore-btn" id="restoreBenchmarksBtn" type="button">
                        Восстановить бенчмарки по умолчанию
                    </button>
                </td>
            </tr>
        `;
        const restoreBtn = document.getElementById("restoreBenchmarksBtn");
        if (restoreBtn) {
            restoreBtn.addEventListener("click", () => {
                activeCorrBenchmarks = ["SPY", "QQQ", "SOXX", "IGV", "DRAM"];
                loadTickerCorrelations(currentStockTicker, activeCorrPeriod);
            });
        }
        return;
    }

    // Compute metrics for each row
    currentCorrList.forEach(item => {
        const peerMove = corrCustomMovesMap[item.symbol] !== undefined ? corrCustomMovesMap[item.symbol] : corrDefaultPeerMove;
        item._peerMove = peerMove;

        let expMove = null;
        let diff = null;
        let normDiff = null;

        if (item.beta !== null && !isNaN(item.beta) && peerMove !== null && !isNaN(peerMove)) {
            expMove = item.beta * peerMove;
            if (corrTargetMove !== null && !isNaN(corrTargetMove)) {
                diff = corrTargetMove - expMove;
                const resVol = (item.residual_volatility !== null && item.residual_volatility !== undefined && item.residual_volatility > 0)
                    ? item.residual_volatility
                    : item.volatility;
                if (resVol && resVol > 0) {
                    normDiff = diff / (resVol * 100);
                }
            }
        }
        item._expMove = expMove;
        item._diff = diff;
        item._normDiff = normDiff;
    });

    // Filter rows based on correlation threshold filter (Request 1)
    let rowsToDisplay = currentCorrList;
    if (corrTableFilterOp !== "none") {
        rowsToDisplay = currentCorrList.filter(item => {
            if (item.correlation === null || item.correlation === undefined || isNaN(item.correlation)) return false;
            const num = Number(item.correlation);
            if (corrTableFilterOp === "gte") return num >= corrTableFilterVal;
            if (corrTableFilterOp === "lte") return num <= corrTableFilterVal;
            if (corrTableFilterOp === "abs_gte") return Math.abs(num) >= corrTableFilterVal;
            return true;
        });
    }
    lastFilteredCorrList = rowsToDisplay;

    if (rowsToDisplay.length === 0) {
        const condTxt = corrTableFilterOp === "gte" ? `r ≥ ${corrTableFilterVal}` : corrTableFilterOp === "lte" ? `r ≤ ${corrTableFilterVal}` : `|r| ≥ ${corrTableFilterVal}`;
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="loading-cell" style="padding: 24px 16px; text-align: center;">
                    <div style="margin-bottom: 8px; font-weight: 600; color: var(--text-muted);">
                        Нет активов с корреляцией, удовлетворяющей фильтру (${condTxt}).
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Interactive sorting on rowsToDisplay
    if (corrSortCol) {
        rowsToDisplay.sort((a, b) => {
            if (corrSortCol === "symbol") {
                const sA = (a.symbol || "").toUpperCase();
                const sB = (b.symbol || "").toUpperCase();
                return corrSortAsc ? sA.localeCompare(sB) : sB.localeCompare(sA);
            }
            if (corrSortCol === "type") {
                const tA = (a.type || "").toUpperCase();
                const tB = (b.type || "").toUpperCase();
                return corrSortAsc ? tA.localeCompare(tB) : tB.localeCompare(tA);
            }
            let valA, valB;
            if (corrSortCol === "correlation") {
                valA = a.correlation; valB = b.correlation;
            } else if (corrSortCol === "beta") {
                valA = a.beta; valB = b.beta;
            } else if (corrSortCol === "peer_move") {
                valA = a._peerMove; valB = b._peerMove;
            } else if (corrSortCol === "expected_move") {
                valA = a._expMove; valB = b._expMove;
            } else if (corrSortCol === "target_move") {
                valA = (a._targetMove !== undefined) ? a._targetMove : corrTargetMove;
                valB = (b._targetMove !== undefined) ? b._targetMove : corrTargetMove;
            } else if (corrSortCol === "diff") {
                valA = a._diff; valB = b._diff;
            } else if (corrSortCol === "normalized") {
                valA = a._normDiff; valB = b._normDiff;
            } else if (corrSortCol === "observations") {
                valA = a.observations; valB = b.observations;
            }
            const numA = (valA !== null && valA !== undefined && !isNaN(valA)) ? Number(valA) : null;
            const numB = (valB !== null && valB !== undefined && !isNaN(valB)) ? Number(valB) : null;
            if (numA === null && numB === null) return 0;
            if (numA === null) return 1;
            if (numB === null) return -1;
            return corrSortAsc ? (numA - numB) : (numB - numA);
        });
    }

    // Update table header sort indicators
    document.querySelectorAll("#corrTable thead th[data-sort]").forEach(th => {
        const col = th.dataset.sort;
        const icon = th.querySelector(".sort-icon");
        if (col === corrSortCol) {
            th.classList.add("active-sort");
            if (icon) {
                icon.textContent = corrSortAsc ? "▲" : "▼";
                th.title = corrSortAsc ? "Сортировка: от меньшего к большему (кликните для сортировки от большего к меньшему)" : "Сортировка: от большего к меньшему (кликните для сортировки от меньшего к большему)";
            }
        } else {
            th.classList.remove("active-sort");
            if (icon) {
                icon.textContent = "⇅";
                th.title = "Кликните для сортировки от большего к меньшему";
            }
        }
    });

    tbody.innerHTML = "";
    rowsToDisplay.forEach(item => {
        const tr = document.createElement("tr");
        const isBenchmark = item.type === "Benchmark";
        const isPartial = Boolean(item.is_partial);
        if (isPartial) {
            tr.classList.add("row-partial-period");
        }

        const typeBadge = `<span class="group-badge-count">${item.type}</span>`;
        const corrFmt = (item.correlation !== null && item.correlation !== undefined && !isNaN(item.correlation))
            ? `${Number(item.correlation) >= 0 ? "+" : ""}${Number(item.correlation).toFixed(3)}`
            : "—";
        const betaFmt = (item.beta !== null && item.beta !== undefined && !isNaN(item.beta))
            ? Number(item.beta).toFixed(3)
            : "—";

        const corrBgStyle = getCorrGradientBg(item.correlation);
        const betaBgStyle = getBetaGradientBg(item.beta);

        const peerMove = item._peerMove;
        const expMove = item._expMove;
        const diff = item._diff;
        const normDiff = item._normDiff;

        const expFmt = expMove !== null ? `${expMove >= 0 ? "+" : ""}${expMove.toFixed(2)}%` : "—";
        const targetMoveVal = corrTargetMove !== null ? corrTargetMove.toFixed(2) : "0.00";

        // Badge: overbought (green if diff > 0), oversold (red if diff < 0)
        let diffHtml = "—";
        if (diff !== null) {
            if (diff > 0.001) {
                diffHtml = `<span class="badge-diff overbought">+${diff.toFixed(2)}% Перекуплен</span>`;
            } else if (diff < -0.001) {
                diffHtml = `<span class="badge-diff oversold">${diff.toFixed(2)}% Перепродан</span>`;
            } else {
                diffHtml = `<span class="badge-diff neutral">0.00%</span>`;
            }
        }

        let normHtml = "—";
        if (normDiff !== null && !isNaN(normDiff)) {
            const sign = normDiff > 0 ? "+" : "";
            normHtml = `<span class="badge-sigma">${sign}${normDiff.toFixed(2)}σ</span>`;
        }

        const partialTooltip = item.partial_reason || "Тикер существует меньше выбранного периода";
        const partialBadge = isPartial
            ? `<span class="badge-partial-period" title="${escapeHtml(partialTooltip)}">⚠️ <span class="partial-txt">Меньше горизонта</span></span>`
            : "";
        const obsWarning = isPartial
            ? `<span class="obs-partial-warning" title="${escapeHtml(partialTooltip)}">⚠️</span>`
            : "";
        const removeBtnCls = isPartial ? "btn-remove-peer btn-remove-partial" : "btn-remove-peer";
        const removeTitle = isPartial
            ? `Удалить тикер с неполной историей (${escapeHtml(partialTooltip)})`
            : "Удалить из таблицы";
        const removeBtn = `<button class="${removeBtnCls}" data-symbol="${item.symbol}" title="${removeTitle}">×</button>`;

        const obsText = (item.observations !== null && item.observations !== undefined) ? `${item.observations} дн.` : "—";

        tr.innerHTML = `
            <td class="td-ticker-col">
                <strong><span class="clickable-ticker" data-ticker="${item.symbol}">${item.symbol}</span></strong>
                ${partialBadge}
            </td>
            <td>${typeBadge}</td>
            <td class="corr-val-cell" style="${corrBgStyle}; text-align: center; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary);">${corrFmt}</td>
            <td class="beta-val-cell" style="${betaBgStyle}; text-align: center; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary);">${betaFmt}</td>
            <td style="text-align: center;">
                <input type="number" step="0.1" class="custom-move-inline-input corr-peer-move-input" data-symbol="${item.symbol}" value="${peerMove.toFixed(2)}">
            </td>
            <td class="corr-exp-cell"><strong>${expFmt}</strong></td>
            <td style="text-align: center;">
                <input type="number" step="0.1" class="custom-move-inline-input corr-target-move-cell-input" value="${targetMoveVal}" title="Ход ${currentStockTicker} (%)">
            </td>
            <td class="corr-diff-cell">${diffHtml}</td>
            <td class="corr-norm-cell">${normHtml}</td>
            <td>${obsText} ${obsWarning}</td>
            <td style="text-align: center;">${removeBtn}</td>
        `;

        tr.querySelector(".clickable-ticker").addEventListener("click", () => switchToStockAnalytics(item.symbol));

        // Real-time inline peer move change without scroll jump
        const peerInp = tr.querySelector(".corr-peer-move-input");
        if (peerInp) {
            peerInp.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    corrCustomMovesMap[item.symbol] = val;
                }
                updateCorrTableRow(tr, item);
            });
            peerInp.addEventListener("change", () => {
                if (["peer_move", "expected_move", "diff", "normalized"].includes(corrSortCol)) {
                    renderCorrTableRows();
                }
            });
            peerInp.addEventListener("click", (e) => e.stopPropagation());
        }

        // Real-time inline target move change without scroll jump
        const targetInp = tr.querySelector(".corr-target-move-cell-input");
        if (targetInp) {
            targetInp.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    corrTargetMove = val;
                    const topInp = document.getElementById("corrTargetMoveInput");
                    if (topInp) topInp.value = val.toFixed(2);
                    // Update all target move inputs in table in real-time
                    document.querySelectorAll(".corr-target-move-cell-input").forEach(inp => {
                        if (inp !== e.target) inp.value = val.toFixed(2);
                    });
                    updateAllCorrTableRowsForTargetMove();
                }
            });
            targetInp.addEventListener("change", () => {
                if (["target_move", "diff", "normalized"].includes(corrSortCol)) {
                    renderCorrTableRows();
                }
            });
            targetInp.addEventListener("click", (e) => e.stopPropagation());
        }

        const btn = tr.querySelector(".btn-remove-peer");
        if (btn) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                removeCorrTicker(item.symbol, isBenchmark);
            });
        }

        tbody.appendChild(tr);
    });
}

function removeCorrTicker(sym, isBenchmark) {
    if (isBenchmark) {
        activeCorrBenchmarks = activeCorrBenchmarks.filter(s => s !== sym);
    } else {
        currentActivePeers = currentActivePeers.filter(s => s !== sym);
    }
    delete corrCustomMovesMap[sym];
    currentCorrList = currentCorrList.filter(item => item.symbol !== sym);
    renderCorrTableRows();
}

function removePartialCorrTickers() {
    const partialSymbols = currentCorrList.filter(item => item.is_partial).map(item => item.symbol);
    if (partialSymbols.length === 0) return;

    activeCorrBenchmarks = activeCorrBenchmarks.filter(s => !partialSymbols.includes(s));
    currentActivePeers = currentActivePeers.filter(s => !partialSymbols.includes(s));
    partialSymbols.forEach(s => delete corrCustomMovesMap[s]);
    currentCorrList = currentCorrList.filter(item => !partialSymbols.includes(item.symbol));
    renderCorrTableRows();
}

function parseTickersInput(rawStr) {
    if (!rawStr) return [];
    const tokens = rawStr.split(/[\s,;\n\t]+/);
    const cleaned = [];
    const seen = new Set();
    for (let t of tokens) {
        t = t.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
        if (t && !seen.has(t)) {
            seen.add(t);
            cleaned.push(t);
        }
    }
    return cleaned;
}

function addPeerTickers(tickersInput) {
    const symbols = Array.isArray(tickersInput) ? tickersInput : parseTickersInput(tickersInput);
    if (!symbols || symbols.length === 0) return 0;

    let addedCount = 0;
    for (const sym of symbols) {
        if (!sym || sym === currentStockTicker) continue;
        if (!currentActivePeers.includes(sym) && !activeCorrBenchmarks.includes(sym)) {
            currentActivePeers.push(sym);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        loadTickerCorrelations(currentStockTicker, activeCorrPeriod);
    }
    return addedCount;
}

function addPeerTicker(sym) {
    addPeerTickers(sym);
}

async function loadDividends(ticker) {
    const tbody = document.getElementById("dividendsTableBody");

    try {
        const res = await fetch(`/api/ticker/${ticker}/dividends`);
        const data = await res.json();
        const divs = data.dividends || [];

        if (divs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color: var(--text-muted);">Компания ${ticker} не выплачивает дивиденды (дивидендные выплаты отсутствуют).</td></tr>`;
            return;
        }

        tbody.innerHTML = "";
        divs.forEach(d => {
            const tr = document.createElement("tr");
            const yieldStr = d.yield !== null && d.yield !== undefined ? `${Number(d.yield).toFixed(2)}%` : "—";

            tr.innerHTML = `
                <td><strong>${d.ex_date || d.date}</strong></td>
                <td class="positive">$${Number(d.amount || d.dividend || 0).toFixed(4)}</td>
                <td>${d.pay_date || d.paymentDate || "—"}</td>
                <td>${d.record_date || d.recordDate || "—"}</td>
                <td>${yieldStr}</td>
                <td><span class="group-badge-count">${d.frequency || "Quarterly"}</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">Ошибка загрузки дивидендов.</td></tr>`;
    }
}

function initStockAnalyticsEvents() {
    const input = document.getElementById("tickerInput");
    const searchBtn = document.getElementById("searchBtn");
    const syncBtn = document.getElementById("syncBtn");
    const dropdown = document.getElementById("tickerDropdown");

    const triggerSearch = () => {
        const val = input.value.trim().toUpperCase();
        if (val && val !== currentStockTicker) {
            dropdown.classList.add("hidden");
            loadStockTickerData(val);
        }
    };

    if (searchBtn) searchBtn.addEventListener("click", triggerSearch);
    if (input) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") triggerSearch();
        });

        input.addEventListener("input", debounce(async () => {
            const val = input.value.trim().toUpperCase();
            if (val.length < 1) {
                dropdown.classList.add("hidden");
                return;
            }
            try {
                const res = await fetch(`/api/tickers?q=${val}`);
                const data = await res.json();
                const tickers = data.tickers || [];

                if (tickers.length > 0) {
                    dropdown.innerHTML = "";
                    tickers.slice(0, 10).forEach(t => {
                        const item = document.createElement("div");
                        item.className = "ticker-option";
                        item.textContent = t;
                        item.addEventListener("click", () => {
                            input.value = t;
                            dropdown.classList.add("hidden");
                            loadStockTickerData(t);
                        });
                        dropdown.appendChild(item);
                    });
                    dropdown.classList.remove("hidden");
                } else {
                    dropdown.classList.add("hidden");
                }
            } catch (e) {}
        }, 150));
    }

    document.addEventListener("click", (e) => {
        if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add("hidden");
        }
    });

    if (syncBtn) {
        syncBtn.addEventListener("click", async () => {
            syncBtn.disabled = true;
            syncBtn.textContent = "Синхронизация...";
            try {
                await fetch(`/api/ticker/${currentStockTicker}/sync`, { method: "POST" });
                await loadStockTickerData(currentStockTicker);
            } catch (e) {
                console.error("Sync error:", e);
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = "Синхронизация";
            }
        });
    }

    // Earnings Matrix Column Metric Dropdowns
    const metricSelects = [
        { id: "metricSel_RMinus1", key: "R-1" },
        { id: "metricSel_R0", key: "R" },
        { id: "metricSel_RPlus1", key: "R+1" },
        { id: "metricSel_RPlus2", key: "R+2" },
    ];

    metricSelects.forEach(({ id, key }) => {
        const sel = document.getElementById(id);
        if (sel) {
            sel.value = selectedDayMetrics[key];
            sel.addEventListener("change", () => {
                selectedDayMetrics[key] = sel.value;
                renderEarningsTable();
            });
        }
    });

    // Earnings Matrix Global Metric Preset Pills
    document.querySelectorAll("#earningsGlobalMetricPills .pill-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#earningsGlobalMetricPills .pill-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const m = btn.dataset.metric;
            metricSelects.forEach(({ id, key }) => {
                selectedDayMetrics[key] = m;
                const sel = document.getElementById(id);
                if (sel) sel.value = m;
            });
            renderEarningsTable();
        });
    });

    // Export Earnings Matrix to Excel Button
    const exportExcelBtn = document.getElementById("exportEarningsExcelBtn");
    if (exportExcelBtn) {
        exportExcelBtn.addEventListener("click", () => {
            const url = `/api/ticker/${currentStockTicker}/earnings-moves/export?r_minus_1_metric=${selectedDayMetrics['R-1']}&r_0_metric=${selectedDayMetrics['R']}&r_plus_1_metric=${selectedDayMetrics['R+1']}&r_plus_2_metric=${selectedDayMetrics['R+2']}`;
            window.open(url, "_blank");
        });
    }

    // Correlation Horizon Period Pills
    document.querySelectorAll("#periodPillGroup .pill-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#periodPillGroup .pill-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeCorrPeriod = btn.dataset.period;
            loadTickerCorrelations(currentStockTicker, activeCorrPeriod);
        });
    });

    // Add Peer Input in Correlation Matrix (supports multiple tickers via comma/space/newline)
    const addPeerInput = document.getElementById("addPeerInput");
    const addPeerBtn = document.getElementById("addPeerBtn");
    if (addPeerInput) {
        const handleAddPeersFromInput = () => {
            const raw = addPeerInput.value.trim();
            if (raw) {
                addPeerTickers(raw);
                addPeerInput.value = "";
            }
        };
        addPeerInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleAddPeersFromInput();
            }
        });
        addPeerInput.addEventListener("paste", () => {
            setTimeout(() => {
                const raw = addPeerInput.value.trim();
                if (raw && (raw.includes(",") || raw.includes(" ") || raw.includes("\n") || raw.includes(";"))) {
                    addPeerTickers(raw);
                    addPeerInput.value = "";
                }
            }, 10);
        });
        if (addPeerBtn) {
            addPeerBtn.addEventListener("click", handleAddPeersFromInput);
        }
    }

    // Bulk Add Tickers Modal for Correlation Matrix
    const corrBulkAddBtn = document.getElementById("corrBulkAddBtn");
    const corrBulkModal = document.getElementById("corrBulkModal");
    const closeCorrBulkModal = document.getElementById("closeCorrBulkModal");
    const cancelCorrBulkModal = document.getElementById("cancelCorrBulkModal");
    const submitCorrBulkTickers = document.getElementById("submitCorrBulkTickers");
    const corrBulkTickerText = document.getElementById("corrBulkTickerText");
    const corrBulkTotalCount = document.getElementById("corrBulkTotalCount");

    const closeBulkModalFn = () => {
        if (corrBulkModal) corrBulkModal.classList.remove("active");
        if (corrBulkTickerText) corrBulkTickerText.value = "";
        if (corrBulkTotalCount) corrBulkTotalCount.textContent = "Распознано: 0 тикеров";
    };

    if (corrBulkAddBtn && corrBulkModal) {
        corrBulkAddBtn.addEventListener("click", () => {
            corrBulkModal.classList.add("active");
            if (corrBulkTickerText) {
                corrBulkTickerText.value = "";
                corrBulkTickerText.focus();
            }
            if (corrBulkTotalCount) {
                corrBulkTotalCount.textContent = "Распознано: 0 тикеров";
            }
        });
    }

    if (closeCorrBulkModal) closeCorrBulkModal.addEventListener("click", closeBulkModalFn);
    if (cancelCorrBulkModal) cancelCorrBulkModal.addEventListener("click", closeBulkModalFn);

    if (corrBulkTickerText) {
        corrBulkTickerText.addEventListener("input", () => {
            const list = parseTickersInput(corrBulkTickerText.value);
            if (corrBulkTotalCount) {
                corrBulkTotalCount.textContent = `Распознано: ${list.length} тикеров`;
            }
        });
    }

    if (submitCorrBulkTickers && corrBulkTickerText) {
        submitCorrBulkTickers.addEventListener("click", () => {
            const list = parseTickersInput(corrBulkTickerText.value);
            if (list.length > 0) {
                addPeerTickers(list);
                closeBulkModalFn();
            }
        });
    }

    // Remove Partial History Tickers Button
    const corrRemovePartialBtn = document.getElementById("corrRemovePartialBtn");
    if (corrRemovePartialBtn) {
        corrRemovePartialBtn.addEventListener("click", () => {
            removePartialCorrTickers();
        });
    }

    // Clear All Tickers & Benchmarks button
    const clearAllCorrBtn = document.getElementById("clearAllCorrBtn");
    if (clearAllCorrBtn) {
        clearAllCorrBtn.addEventListener("click", () => {
            activeCorrBenchmarks = [];
            currentActivePeers = [];
            corrCustomMovesMap = {};
            currentCorrList = [];
            renderCorrTableRows();
        });
    }

    // Custom Move Panel Toggle
    const customMoveToggleBtn = document.getElementById("customMoveToggleBtn");
    const corrCustomMovePanel = document.getElementById("corrCustomMovePanel");
    if (customMoveToggleBtn && corrCustomMovePanel) {
        customMoveToggleBtn.addEventListener("click", () => {
            const isVis = corrCustomMovePanel.classList.toggle("visible");
            customMoveToggleBtn.classList.toggle("active", isVis);
        });
    }

    // Target Asset Custom Move Input
    const corrTargetMoveInput = document.getElementById("corrTargetMoveInput");
    if (corrTargetMoveInput) {
        corrTargetMoveInput.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            corrTargetMove = !isNaN(val) ? val : 0;
            document.querySelectorAll(".corr-target-move-cell-input").forEach(inp => {
                inp.value = corrTargetMove.toFixed(2);
            });
            updateAllCorrTableRowsForTargetMove();
        });
        corrTargetMoveInput.addEventListener("change", () => {
            if (["target_move", "diff", "normalized"].includes(corrSortCol)) {
                renderCorrTableRows();
            }
        });
    }

    // Apply Benchmark Default Move to All Peers
    const applyCustomMoveBtn = document.getElementById("applyCustomMoveBtn");
    const corrBenchmarkMoveInput = document.getElementById("corrBenchmarkMoveInput");
    if (applyCustomMoveBtn && corrBenchmarkMoveInput) {
        applyCustomMoveBtn.addEventListener("click", () => {
            const val = parseFloat(corrBenchmarkMoveInput.value);
            corrDefaultPeerMove = !isNaN(val) ? val : 1.0;
            currentCorrList.forEach(item => {
                corrCustomMovesMap[item.symbol] = corrDefaultPeerMove;
            });
            renderCorrTableRows();
        });
    }

    // Correlation Table Toolbar Filter Listeners
    const corrFilterOpSelect = document.getElementById("corrTableFilterOp");
    const corrFilterValInput = document.getElementById("corrTableFilterVal");
    const resetCorrFilterBtn = document.getElementById("resetCorrTableFilterBtn");

    const updateCorrFilter = () => {
        if (corrFilterOpSelect) corrTableFilterOp = corrFilterOpSelect.value;
        if (corrFilterValInput) {
            corrTableFilterVal = parseFilterNumber(corrFilterValInput.value, 0.50);
        }
        if (resetCorrFilterBtn) {
            resetCorrFilterBtn.style.display = corrTableFilterOp !== "none" ? "inline-flex" : "none";
        }
        renderCorrTableRows();
    };

    if (corrFilterOpSelect) {
        corrFilterOpSelect.addEventListener("change", updateCorrFilter);
    }
    if (corrFilterValInput) {
        corrFilterValInput.addEventListener("input", debounce(updateCorrFilter, 200));
        corrFilterValInput.addEventListener("change", updateCorrFilter);
    }
    if (resetCorrFilterBtn) {
        resetCorrFilterBtn.addEventListener("click", () => {
            if (corrFilterOpSelect) corrFilterOpSelect.value = "none";
            corrTableFilterOp = "none";
            resetCorrFilterBtn.style.display = "none";
            renderCorrTableRows();
        });
    }

    // Export Correlation Matrix to Excel
    const corrExportExcelBtn = document.getElementById("corrExportExcelBtn");
    if (corrExportExcelBtn) {
        corrExportExcelBtn.addEventListener("click", exportCorrMatrixToExcel);
    }

    // Sortable Headers for Correlation Table (#corrTable)
    // 1st click: sort descending (highest to lowest)
    // 2nd click: sort ascending (lowest to highest)
    document.querySelectorAll("#corrTable thead th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (corrSortCol === col) {
                corrSortAsc = !corrSortAsc;
            } else {
                corrSortCol = col;
                corrSortAsc = false; // Descending first: highest to lowest
            }
            renderCorrTableRows();
        });
    });

    // Analytics Sub-Tabs Navigation
    document.querySelectorAll(".analytics-workspace .tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".analytics-workspace .tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".analytics-workspace .tab-content").forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.classList.add("active");
        });
    });
}


// ============================================================
// HELPER FORMATTERS
// ============================================================
function formatPctBadge(val) {
    if (val === null || val === undefined || isNaN(val)) return `<span style="color: var(--text-muted);">—</span>`;
    const num = Number(val);
    const cls = num >= 0 ? "positive" : "negative";
    const prefix = num >= 0 ? "+" : "";
    return `<span class="${cls}">${prefix}${num.toFixed(2)}%</span>`;
}

function formatCorrBadge(val) {
    if (val === null || val === undefined || isNaN(val)) return `<span style="color: var(--text-muted);">—</span>`;
    const num = Number(val);
    let color = "var(--text-secondary)";
    if (num >= 0.5) color = "var(--text-green)";
    else if (num <= -0.2) color = "var(--text-red)";
    const prefix = num >= 0 ? "+" : "";
    return `<span style="color: ${color}; font-weight: 700;">${prefix}${num.toFixed(3)}</span>`;
}

function getCorrBgColor(val) {
    const num = Number(val);
    if (isNaN(num)) return "transparent";
    if (num >= 0.70) return "rgba(74, 222, 128, 0.28)";    // Light, luminous green (high)
    if (num >= 0.40) return "rgba(110, 190, 140, 0.22)";   // Soft pastel green
    if (num >= 0.10) return "rgba(148, 163, 184, 0.22)";   // Slate / light grey
    if (num >= -0.10) return "rgba(148, 163, 184, 0.32)";  // Neutral grey (low / ~0)
    if (num >= -0.40) return "rgba(180, 160, 175, 0.26)";  // Grey-rose
    return "rgba(254, 202, 202, 0.75)";                    // Soft pink/salmon (negative)
}

function getBetaBgColor(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return "rgba(100, 116, 139, 0.15)";
    if (num < -2.50) return "rgba(220, 38, 38, 0.40)";       // Very strong inverse red (e.g. -3, -5)
    if (num < -1.20) return "rgba(239, 68, 68, 0.30)";       // Strong inverse red (e.g. -1.8, -2.4)
    if (num < -0.60) return "rgba(239, 68, 68, 0.22)";       // Moderate inverse coral (e.g. -0.8, -1.0)
    if (num < -0.20) return "rgba(244, 63, 94, 0.16)";       // Mild inverse rose (e.g. -0.5)
    if (num < -0.05) return "rgba(148, 163, 184, 0.22)";     // Near zero negative (e.g. -0.186)
    if (num <= 0.05) return "rgba(148, 163, 184, 0.26)";     // True neutral (e.g. -0.002, 0.000)
    if (num <= 0.20) return "rgba(148, 163, 184, 0.22)";     // Near zero positive (e.g. 0.107)
    if (num < 0.80) return "rgba(245, 158, 11, 0.18)";       // Defensive / low beta amber (e.g. 0.265, 0.404)
    if (num <= 1.20) return "rgba(59, 130, 246, 0.24)";      // Market benchmark blue (~1.0)
    if (num <= 2.00) return "rgba(34, 197, 94, 0.20)";       // Moderate high beta green
    if (num <= 4.00) return "rgba(34, 197, 94, 0.30)";       // High beta green (e.g. 2.5, 3.5)
    return "rgba(16, 185, 129, 0.40)";                       // Extreme beta emerald green (e.g. 4.8, 10.6)
}

function getCorrGradientBg(val) {
    if (val === null || val === undefined || isNaN(val)) return "background: transparent;";
    const num = Number(val);
    if (num >= 0.70) {
        // High correlation: light, luminous, bright emerald tint
        return "background: linear-gradient(135deg, rgba(74, 222, 128, 0.32) 0%, rgba(34, 197, 94, 0.18) 100%);";
    } else if (num >= 0.40) {
        // Moderate correlation: soft muted green
        return "background: linear-gradient(135deg, rgba(110, 190, 140, 0.24) 0%, rgba(148, 163, 184, 0.15) 100%);";
    } else if (num >= 0.10) {
        // Low correlation: transitioning to grey
        return "background: linear-gradient(135deg, rgba(148, 163, 184, 0.25) 0%, rgba(148, 163, 184, 0.12) 100%);";
    } else if (num >= -0.10) {
        // Near zero: pure soft neutral grey gradient
        return "background: linear-gradient(135deg, rgba(148, 163, 184, 0.32) 0%, rgba(203, 213, 225, 0.20) 100%);";
    } else if (num >= -0.40) {
        // Mild inverse: grey with faint rose tint
        return "background: linear-gradient(135deg, rgba(148, 163, 184, 0.26) 0%, rgba(248, 113, 113, 0.18) 100%);";
    } else {
        // Strong inverse: soft muted coral/red
        return "background: linear-gradient(135deg, rgba(239, 68, 68, 0.30) 0%, rgba(220, 38, 38, 0.18) 100%);";
    }
}

function getBetaGradientBg(val) {
    if (val === null || val === undefined || isNaN(val)) return "background: transparent;";
    const num = Number(val);
    if (!Number.isFinite(num)) return "background: transparent;";

    // Extreme inverse beta: < -2.50 (e.g. -3.2, -4.7, -5.35)
    if (num < -2.50) {
        return "background: linear-gradient(135deg, rgba(220, 38, 38, 0.42) 0%, rgba(153, 27, 27, 0.28) 100%);";
    }
    // Strong inverse beta: -2.50 <= num < -1.20 (e.g. -1.77, -2.41)
    if (num < -1.20) {
        return "background: linear-gradient(135deg, rgba(239, 68, 68, 0.32) 0%, rgba(220, 38, 38, 0.20) 100%);";
    }
    // Moderate inverse beta: -1.20 <= num < -0.60 (e.g. -0.63, -1.05)
    if (num < -0.60) {
        return "background: linear-gradient(135deg, rgba(239, 68, 68, 0.24) 0%, rgba(225, 29, 72, 0.16) 100%);";
    }
    // Mild inverse beta: -0.60 <= num < -0.20 (e.g. -0.501)
    if (num < -0.20) {
        return "background: linear-gradient(135deg, rgba(244, 63, 94, 0.18) 0%, rgba(148, 163, 184, 0.14) 100%);";
    }
    // Near zero slightly negative: -0.20 <= num < -0.05 (e.g. -0.186 - SPY near-zero beta)
    if (num < -0.05) {
        return "background: linear-gradient(135deg, rgba(148, 163, 184, 0.25) 0%, rgba(244, 63, 94, 0.12) 100%);";
    }
    // True neutral: -0.05 <= num <= 0.05 (e.g. -0.002, 0.000)
    if (num <= 0.05) {
        return "background: linear-gradient(135deg, rgba(148, 163, 184, 0.28) 0%, rgba(203, 213, 225, 0.16) 100%);";
    }
    // Near zero slightly positive: 0.05 < num <= 0.20 (e.g. 0.107)
    if (num <= 0.20) {
        return "background: linear-gradient(135deg, rgba(148, 163, 184, 0.25) 0%, rgba(245, 158, 11, 0.12) 100%);";
    }
    // Low beta / defensive: 0.20 < num < 0.80 (e.g. 0.265, 0.404)
    if (num < 0.80) {
        return "background: linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(148, 163, 184, 0.12) 100%);";
    }
    // Benchmark baseline: 0.80 <= num <= 1.20 (around 1.000)
    if (num <= 1.20) {
        return "background: linear-gradient(135deg, rgba(59, 130, 246, 0.24) 0%, rgba(96, 165, 250, 0.14) 100%);";
    }
    // Moderate high beta: 1.20 < num <= 2.00
    if (num <= 2.00) {
        return "background: linear-gradient(135deg, rgba(34, 197, 94, 0.20) 0%, rgba(74, 222, 128, 0.12) 100%);";
    }
    // High beta: 2.00 < num <= 4.00
    if (num <= 4.00) {
        return "background: linear-gradient(135deg, rgba(34, 197, 94, 0.30) 0%, rgba(16, 185, 129, 0.18) 100%);";
    }
    // Extreme high beta: num > 4.00 (e.g. 4.77, 4.82, 5.75, 10.65)
    return "background: linear-gradient(135deg, rgba(16, 185, 129, 0.40) 0%, rgba(5, 150, 105, 0.26) 100%);";
}

async function exportCorrMatrixToExcel() {
    const rowsToExport = (corrTableFilterOp !== "none" && lastFilteredCorrList) ? lastFilteredCorrList : currentCorrList;
    if (!rowsToExport || rowsToExport.length === 0) {
        alert("Нет данных для экспорта матрицы корреляций.");
        return;
    }

    const btn = document.getElementById("corrExportExcelBtn");
    const originalHtml = btn ? btn.innerHTML : "Экспорт";
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Экспорт...";
    }

    try {
        const ticker = currentStockTicker || "TICKER";
        const period = activeCorrPeriod || "1y";
        const targetMove = corrTargetMove !== null ? corrTargetMove : 2.0;

        const res = await fetch(`/api/ticker/${encodeURIComponent(ticker)}/correlations/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                period: period,
                target_move: targetMove,
                rows: rowsToExport
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `Ошибка сервера: ${res.status}`);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${ticker}_correlation_matrix_${period}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Export corr excel error:", e);
        alert(`Ошибка при экспорте в Excel: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

async function exportMatrixCorrelationToExcel() {
    const data = lastPearsonData || calculationResults;
    if (!data || !data.correlation) {
        alert("Нет данных матрицы корреляций для экспорта. Сначала выполните расчет.");
        return;
    }
    const btn = document.getElementById("exportMatrixCorrExcelBtn");
    const orig = btn ? btn.innerHTML : "Экспорт";
    if (btn) { btn.disabled = true; btn.textContent = "Экспорт..."; }
    try {
        const period = data.period || "1y";
        const symbols = (lastPearsonDisplaySymbols && lastPearsonDisplaySymbols.length > 0)
            ? lastPearsonDisplaySymbols
            : (data.all_symbols || data.tickers || Object.keys(data.correlation || {}));
        
        // Filter matrix cells if operator is active
        const opSelect = document.getElementById("matrixOperator") || document.getElementById("matrixCorrOperator");
        const threshInput = document.getElementById("matrixThreshold") || document.getElementById("matrixCorrThreshold");
        const threshMaxInput = document.getElementById("matrixThresholdMax") || document.getElementById("matrixCorrThresholdMax");
        const op = opSelect ? opSelect.value : "none";
        const threshold = threshInput ? parseFilterNumber(threshInput.value, 0.5) : 0.5;
        const thresholdMax = threshMaxInput ? parseFilterNumber(threshMaxInput.value, 1.0) : 1.0;
        const diagValid = (op === "all" || op === "none" || checkCorrCondition(1.0, op, threshold, thresholdMax));

        const filteredMatrix = {};
        symbols.forEach(s1 => {
            filteredMatrix[s1] = {};
            symbols.forEach(s2 => {
                if (s1 === s2) {
                    filteredMatrix[s1][s2] = diagValid ? 1.0 : null;
                } else {
                    const v = data.correlation[s1] ? data.correlation[s1][s2] : null;
                    if (op === "all" || op === "none" || checkCorrCondition(v, op, threshold, thresholdMax)) {
                        filteredMatrix[s1][s2] = v;
                    } else {
                        filteredMatrix[s1][s2] = null;
                    }
                }
            });
        });

        const res = await fetch("/api/matrix/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "correlation",
                title: "Matrix Correlation Pearson",
                period: period,
                symbols: symbols,
                matrix: filteredMatrix
            })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `Ошибка сервера: ${res.status}`);
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Matrix_Correlation_Pearson_${period}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Export Pearson excel error:", e);
        alert(`Ошибка при экспорте в Excel: ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

async function exportMatrixBetaToExcel() {
    const data = lastBetaData || calculationResults;
    if (!data || !data.beta) {
        alert("Нет данных матрицы Beta для экспорта. Сначала выполните расчет.");
        return;
    }
    const btn = document.getElementById("exportMatrixBetaExcelBtn");
    const orig = btn ? btn.innerHTML : "Экспорт";
    if (btn) { btn.disabled = true; btn.textContent = "Экспорт..."; }
    try {
        const period = data.period || "1y";
        const symbols = (lastBetaDisplaySymbols && lastBetaDisplaySymbols.length > 0)
            ? lastBetaDisplaySymbols
            : (data.all_symbols || data.tickers || Object.keys(data.beta || {}));

        // Filter matrix cells if operator is active
        const opSelect = document.getElementById("matrixBetaOperator");
        const threshInput = document.getElementById("matrixBetaThreshold");
        const threshMaxInput = document.getElementById("matrixBetaThresholdMax");
        const op = opSelect ? opSelect.value : "none";
        const threshold = threshInput ? parseFilterNumber(threshInput.value, 1.0) : 1.0;
        const thresholdMax = threshMaxInput ? parseFilterNumber(threshMaxInput.value, 2.0) : 2.0;
        const diagValid = (op === "all" || op === "none" || checkBetaCondition(1.0, op, threshold, thresholdMax));

        const filteredMatrix = {};
        symbols.forEach(s1 => {
            filteredMatrix[s1] = {};
            symbols.forEach(s2 => {
                if (s1 === s2) {
                    filteredMatrix[s1][s2] = diagValid ? 1.0 : null;
                } else {
                    const v = data.beta[s1] ? data.beta[s1][s2] : null;
                    if (op === "all" || op === "none" || checkBetaCondition(v, op, threshold, thresholdMax)) {
                        filteredMatrix[s1][s2] = v;
                    } else {
                        filteredMatrix[s1][s2] = null;
                    }
                }
            });
        });

        const res = await fetch("/api/matrix/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "beta",
                title: "Matrix Beta (formul Slope)",
                period: period,
                symbols: symbols,
                matrix: filteredMatrix
            })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `Ошибка сервера: ${res.status}`);
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Matrix_Beta_Slope_${period}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Export Beta excel error:", e);
        alert(`Ошибка при экспорте в Excel: ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

function formatCorrHeatmap(val) {
    if (val === null || val === undefined || isNaN(val)) return `<span style="color: var(--text-muted);">—</span>`;
    const num = Number(val);
    let color = "var(--text-secondary)";
    if (num >= 0.6) color = "var(--text-green)";
    else if (num >= 0.3) color = "var(--accent-blue)";
    else if (num <= -0.2) color = "var(--text-red)";
    const prefix = num >= 0 ? "+" : "";
    return `<span style="color: ${color}; font-weight: 700;">${prefix}${num.toFixed(3)}</span>`;
}

function formatCurrency(val) {
    if (!val || isNaN(val)) return "—";
    const num = Number(val);
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    return `$${num.toLocaleString()}`;
}

function formatVolumeReadable(vol) {
    if (!vol || isNaN(vol)) return "0";
    const num = Number(vol);
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toLocaleString();
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}


// ============================================================
// DATALENS MODULE (FinWhale Vintage / Modern Comparative Return Matrix)
// ============================================================

const dataLensState = {
    tickers: [], // Empty by default per user request
    period: "1y",
    metric: "cls2cls", // "cls2cls" | "intra" | "gap"
    customStart: null,
    customEnd: null,
    asOf: "",
    data: {}, // date -> ticker -> { close, prev_close, cls2cls, intra, gap, is_earnings, is_ex_div, is_pay_date }
    allDates: [],
    filters: [], // Empty by default
    editingFilterId: null,
    modalScopeTicker: "",
    isLoaded: false,
    isLoading: false
};

function ensureDataLensLoaded() {
    if (!dataLensState.isLoaded && !dataLensState.isLoading) {
        if (dataLensState.tickers.length > 0) {
            fetchDataLensData();
        } else {
            renderDataLensTickers();
            renderDataLensFilters();
            renderDataLensTable();
        }
    }
}

function initDataLens() {
    const tableEl = document.getElementById("datalensTable");
    if (!tableEl) return;

    // 1. Ticker input & add button
    const tickerInp = document.getElementById("datalensTickerInput");
    const addTickerBtn = document.getElementById("datalensAddTickerBtn");
    if (tickerInp) {
        tickerInp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                addTickerFromInput();
            }
        });
    }
    if (addTickerBtn) {
        addTickerBtn.addEventListener("click", addTickerFromInput);
    }

    // 2. Timeframe pills
    const tfPills = document.querySelectorAll("#datalensTfPills .datalens-tf-btn");
    tfPills.forEach(btn => {
        btn.addEventListener("click", () => {
            const period = btn.dataset.period;
            if (period === "custom") {
                const customBar = document.getElementById("datalensCustomRangeBar");
                if (customBar) customBar.style.display = customBar.style.display === "none" ? "flex" : "none";
                return;
            }
            tfPills.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const customBar = document.getElementById("datalensCustomRangeBar");
            if (customBar) customBar.style.display = "none";
            dataLensState.period = period;
            dataLensState.customStart = null;
            dataLensState.customEnd = null;
            if (dataLensState.tickers.length > 0) {
                fetchDataLensData();
            }
        });
    });

    // Custom range handlers
    const applyCustomBtn = document.getElementById("datalensApplyCustomRange");
    const cancelCustomBtn = document.getElementById("datalensCancelCustomRange");
    if (applyCustomBtn) {
        applyCustomBtn.addEventListener("click", () => {
            const startVal = document.getElementById("datalensCustomStart")?.value;
            const endVal = document.getElementById("datalensCustomEnd")?.value;
            if (!startVal) {
                alert("Пожалуйста, укажите начальную дату.");
                return;
            }
            dataLensState.period = "custom";
            dataLensState.customStart = startVal;
            dataLensState.customEnd = endVal || null;
            tfPills.forEach(b => b.classList.remove("active"));
            document.getElementById("datalensCustomTfBtn")?.classList.add("active");
            if (dataLensState.tickers.length > 0) {
                fetchDataLensData();
            }
        });
    }
    if (cancelCustomBtn) {
        cancelCustomBtn.addEventListener("click", () => {
            const customBar = document.getElementById("datalensCustomRangeBar");
            if (customBar) customBar.style.display = "none";
        });
    }

    // 3. Metric selector
    const metricSelect = document.getElementById("datalensMetricSelect");
    if (metricSelect) {
        metricSelect.addEventListener("change", () => {
            dataLensState.metric = metricSelect.value;
            renderDataLensTable();
        });
    }

    // 4. Export dropdown & actions
    const exportToggleBtn = document.getElementById("datalensExportToggleBtn");
    const exportMenu = document.getElementById("datalensExportMenu");
    if (exportToggleBtn && exportMenu) {
        exportToggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            exportMenu.style.display = exportMenu.style.display === "none" ? "block" : "none";
        });
        document.addEventListener("click", () => {
            exportMenu.style.display = "none";
        });
    }

    const exportCsvBtn = document.getElementById("datalensExportCsvBtn");
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener("click", () => {
            exportDataLensAsCSV();
            if (exportMenu) exportMenu.style.display = "none";
        });
    }

    const exportExcelBtn = document.getElementById("datalensExportExcelBtn");
    if (exportExcelBtn) {
        exportExcelBtn.addEventListener("click", () => {
            exportDataLensAsExcel();
            if (exportMenu) exportMenu.style.display = "none";
        });
    }

    // 5. Add Filter button
    const addFilterBtn = document.getElementById("datalensAddFilterBtn");
    if (addFilterBtn) {
        addFilterBtn.addEventListener("click", () => {
            if (dataLensState.tickers.length === 0) {
                alert("Сначала добавьте хотя бы один тикер через «+ Add ticker».");
                return;
            }
            const firstTicker = dataLensState.tickers[0];
            openDataLensFilterModal(firstTicker);
        });
    }

    // 8. Filter modal controls
    initDataLensModalControls();

    // 9. Table cell click listener for interactive chart navigation
    const tbody = document.getElementById("datalensTbody");
    if (tbody) {
        tbody.addEventListener("click", (e) => {
            const cell = e.target.closest(".datalens-cell-pct");
            if (cell) {
                const ticker = cell.dataset.ticker;
                const dateStr = cell.dataset.date;
                if (ticker && dateStr) {
                    switchToStockAnalytics(ticker, dateStr);
                }
            }
        });
    }

    // 10. Initial render of chips
    renderDataLensTickers();
    renderDataLensFilters();
}

function addTickerFromInput() {
    const inp = document.getElementById("datalensTickerInput");
    if (!inp) return;
    const sym = inp.value.trim().toUpperCase();
    if (!sym) return;

    if (dataLensState.tickers.includes(sym)) {
        inp.value = "";
        return;
    }

    if (dataLensState.tickers.length >= 100) {
        alert("Достигнут лимит в 100 тикеров.");
        return;
    }

    dataLensState.tickers.push(sym);
    inp.value = "";
    fetchDataLensData();
}

function renderDataLensTickers() {
    const list = document.getElementById("datalensChipsList");
    const counter = document.getElementById("datalensTickerCounter");
    if (!list) return;

    list.innerHTML = "";
    dataLensState.tickers.forEach(ticker => {
        const chip = document.createElement("span");
        chip.className = "datalens-ticker-chip";
        chip.innerHTML = `
            <span>${ticker}</span>
            <button class="chip-del-btn" title="Удалить ${ticker}" type="button">✕</button>
        `;

        chip.querySelector(".chip-del-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            dataLensState.tickers = dataLensState.tickers.filter(t => t !== ticker);
            // Also clean up filters for removed ticker
            dataLensState.filters = dataLensState.filters.filter(f => f.ticker !== ticker);
            if (dataLensState.tickers.length === 0) {
                dataLensState.data = {};
                dataLensState.allDates = [];
                renderDataLensTickers();
                renderDataLensFilters();
                renderDataLensTable();
            } else {
                fetchDataLensData();
            }
        });

        list.appendChild(chip);
    });

    if (counter) {
        counter.textContent = `${dataLensState.tickers.length}/100`;
    }
}

function renderDataLensFilters() {
    const container = document.getElementById("datalensFilterChips");
    const countBadge = document.getElementById("datalensFilterCountBadge");
    if (!container) return;

    container.innerHTML = "";
    if (countBadge) {
        countBadge.textContent = `FILTERS (${dataLensState.filters.length})`;
    }

    dataLensState.filters.forEach(filter => {
        const chip = document.createElement("div");
        chip.className = "datalens-applied-filter-chip";

        let filterText = "";
        if (filter.type === "Earnings") {
            const offs = (filter.offsets && filter.offsets.length > 0) ? filter.offsets.join(",") : "R";
            filterText = `<span class="chip-ticker">${filter.ticker}</span> <span class="chip-col">Earnings</span> <span class="chip-offset">[${offs}]</span>`;
        } else if (filter.type === "Ex-Div") {
            filterText = `<span class="chip-ticker">${filter.ticker}</span> <span class="chip-col">Ex-Div</span>`;
        } else if (filter.type === "Pay Date") {
            filterText = `<span class="chip-ticker">${filter.ticker}</span> <span class="chip-col">Pay Date</span>`;
        } else if (filter.type === "HoldMove") {
            const dirLabel = filter.direction === "up" ? "+≥" : filter.direction === "down" ? "-≤" : "±≥";
            const winLabel = filter.window === "premarket" ? "PRE" : filter.window === "regular" ? "RTH" : filter.window === "postmarket" ? "POST" : "ANY";
            filterText = `<span class="chip-ticker">${filter.ticker}</span> <span class="chip-col">Hold ${dirLabel}${filter.threshold}%</span> <span class="chip-offset">[${winLabel} ➔ ${filter.holdUntil}]</span>`;
        } else {
            // Quantitative
            const colLabel = filter.column === "intra" ? "Intra%" : filter.column === "gap" ? "Gap%" : "Close%";
            const opLabel = filter.operator === "gte" ? "≥" : filter.operator === "lte" ? "≤" : filter.operator === "abs_lte" ? "|x| ≤" : "|x| ≥";
            filterText = `<span class="chip-ticker">${filter.ticker}</span> <span class="chip-col">${colLabel}</span> <span class="chip-op">${opLabel}</span> <span class="chip-val">${filter.value}</span>`;
        }

        chip.innerHTML = `
            ${filterText}
            <button class="chip-remove-btn" title="Удалить фильтр" type="button">✕</button>
        `;

        // Click chip to edit
        chip.addEventListener("click", (e) => {
            if (e.target.closest(".chip-remove-btn")) return;
            openDataLensFilterModal(filter.ticker, filter.id);
        });

        // Click X to remove
        chip.querySelector(".chip-remove-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            dataLensState.filters = dataLensState.filters.filter(f => f.id !== filter.id);
            renderDataLensFilters();
            renderDataLensTable();
        });

        container.appendChild(chip);
    });
}

async function refreshDataLensHoldMoveFilters() {
    const holdMoveFilters = (dataLensState.filters || []).filter(f => f.type === "HoldMove");
    if (holdMoveFilters.length === 0) return;

    await Promise.all(holdMoveFilters.map(async (filter) => {
        try {
            let url = `/api/datalens/filter/hold-move?ticker=${encodeURIComponent(filter.ticker)}&period=${encodeURIComponent(dataLensState.period)}&threshold_pct=${filter.threshold}&min_hold_pct=${filter.minHold}&direction=${filter.direction}&window=${filter.window}&hold_until=${encodeURIComponent(filter.holdUntil)}`;
            if (dataLensState.period === "custom" && dataLensState.customStart) {
                url += `&start_date=${encodeURIComponent(dataLensState.customStart)}`;
                if (dataLensState.customEnd) {
                    url += `&end_date=${encodeURIComponent(dataLensState.customEnd)}`;
                }
            }
            const res = await fetch(url);
            const json = await res.json();
            if (json.status === "ok") {
                filter.matchingDates = json.matching_dates || [];
                filter.matchingDatesSet = new Set(filter.matchingDates);
            }
        } catch (e) {
            console.error(`Error refreshing HoldMove filter for ${filter.ticker}:`, e);
        }
    }));
}

async function fetchDataLensData() {
    if (dataLensState.tickers.length === 0) {
        dataLensState.data = {};
        dataLensState.allDates = [];
        dataLensState.isLoaded = true;
        renderDataLensTickers();
        renderDataLensFilters();
        renderDataLensTable();
        return;
    }

    dataLensState.isLoading = true;
    const overlay = document.getElementById("datalensLoadingOverlay");
    if (overlay) overlay.style.display = "flex";

    try {
        let url = `/api/datalens/data?tickers=${encodeURIComponent(dataLensState.tickers.join(","))}&period=${encodeURIComponent(dataLensState.period)}`;
        if (dataLensState.period === "custom" && dataLensState.customStart) {
            url += `&start_date=${encodeURIComponent(dataLensState.customStart)}`;
            if (dataLensState.customEnd) {
                url += `&end_date=${encodeURIComponent(dataLensState.customEnd)}`;
            }
        }

        const [res] = await Promise.all([
            fetch(url),
            refreshDataLensHoldMoveFilters()
        ]);
        const json = await res.json();

        if (json.status === "ok") {
            dataLensState.asOf = json.as_of || "";
            dataLensState.allDates = json.dates || [];
            dataLensState.data = json.data || {};
            dataLensState.isLoaded = true;

            const badge = document.getElementById("datalensAsOfBadge");
            if (badge && dataLensState.asOf) {
                badge.textContent = `• AS OF ${dataLensState.asOf}`;
            }
        }
    } catch (e) {
        console.error("DataLens fetch error:", e);
    } finally {
        dataLensState.isLoading = false;
        if (overlay) overlay.style.display = "none";
        renderDataLensTickers();
        renderDataLensFilters();
        renderDataLensTable();
    }
}

function getFilteredDataLensDates() {
    if (!dataLensState.filters || dataLensState.filters.length === 0) {
        return dataLensState.allDates;
    }

    return dataLensState.allDates.filter(dateStr => {
        const rowData = dataLensState.data[dateStr];
        if (!rowData) return false;

        return dataLensState.filters.every(filter => {
            if (filter.type === "HoldMove") {
                if (!filter.matchingDatesSet) {
                    filter.matchingDatesSet = new Set(filter.matchingDates || []);
                }
                return filter.matchingDatesSet.has(dateStr);
            }

            const tData = rowData[filter.ticker];
            if (!tData) return false;

            if (filter.type === "Earnings") {
                const targetOffsets = (filter.offsets && filter.offsets.length > 0) ? filter.offsets : ["R"];
                const dayOffsets = tData.earnings_offsets || [];
                const hasMatch = targetOffsets.some(off => dayOffsets.includes(off));
                if (hasMatch) return true;
                if (targetOffsets.includes("R") && tData.is_earnings) return true;
                return false;
            }
            if (filter.type === "Ex-Div") {
                return Boolean(tData.is_ex_div);
            }
            if (filter.type === "Pay Date") {
                return Boolean(tData.is_pay_date);
            }

            // Quantitative
            const metricVal = tData[filter.column || "cls2cls"];
            if (metricVal === null || metricVal === undefined) return false;

            const targetVal = parseFloat(filter.value);
            if (isNaN(targetVal)) return true;

            switch (filter.operator) {
                case "gte":
                    return metricVal >= targetVal;
                case "lte":
                    return metricVal <= targetVal;
                case "abs_gte":
                    return Math.abs(metricVal) >= targetVal;
                case "abs_lte":
                    return Math.abs(metricVal) <= targetVal;
                default:
                    return true;
            }
        });
    });
}

function getDataLensCellColor(val) {
    if (val === null || val === undefined || isNaN(val)) {
        return { bg: "transparent", text: "var(--text-dim)" };
    }
    if (val === 0) {
        return { bg: "rgba(0, 0, 0, 0.02)", text: "var(--text-primary)" };
    }

    const absVal = Math.abs(val);
    // Dynamic alpha curve matching FinWhale photo: 0.16 for small moves up to 0.82 for >= 10%
    let alpha = 0.16 + Math.min(absVal / 12, 1) * 0.66;
    alpha = Math.round(alpha * 100) / 100;

    if (val > 0) {
        // Soft muted pine/sage green
        return {
            bg: `rgba(127, 168, 152, ${alpha})`,
            text: "var(--text-primary)"
        };
    } else {
        // Soft muted terracotta/salmon coral
        return {
            bg: `rgba(217, 155, 146, ${alpha})`,
            text: "var(--text-primary)"
        };
    }
}

function renderDataLensTable() {
    const thead = document.getElementById("datalensThead");
    const tbody = document.getElementById("datalensTbody");
    const tfoot = document.getElementById("datalensTfoot");
    const emptyState = document.getElementById("datalensEmptyState");
    const emptyText = document.getElementById("datalensEmptyStateText");
    if (!thead || !tbody || !tfoot) return;

    if (dataLensState.tickers.length === 0) {
        thead.innerHTML = "";
        tbody.innerHTML = "";
        tfoot.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        if (emptyText) emptyText.textContent = "Добавьте тикеры через «+ Add ticker», чтобы отобразить таблицу данных.";
        return;
    }

    const filteredDates = getFilteredDataLensDates();

    // 1. Header Row
    let theadHtml = `<tr><th>DATE</th>`;
    dataLensState.tickers.forEach(sym => {
        const isFiltered = dataLensState.filters.some(f => f.ticker === sym);
        theadHtml += `
            <th>
                <div class="th-ticker-wrap">
                    <span>${sym}</span>
                    <button type="button" class="th-funnel-btn ${isFiltered ? 'active-filtered' : ''}" data-ticker="${sym}" title="Фильтр по ${sym}">
                        ${isFiltered ? '⚚' : '▽'}
                    </button>
                </div>
            </th>
        `;
    });
    theadHtml += `</tr>`;
    thead.innerHTML = theadHtml;

    // Attach funnel click listeners in thead
    thead.querySelectorAll(".th-funnel-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const sym = btn.dataset.ticker;
            if (sym) openDataLensFilterModal(sym);
        });
    });

    // 2. Empty check
    if (filteredDates.length === 0) {
        tbody.innerHTML = "";
        tfoot.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        if (emptyText) emptyText.textContent = "Нет данных для выбранных фильтров или периода.";
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    // 3. Body Rows
    const metricKey = dataLensState.metric; // "cls2cls", "intra", "gap"
    let tbodyHtml = "";

    // Track column values for summary statistics
    const columnValues = {};
    dataLensState.tickers.forEach(sym => { columnValues[sym] = []; });

    filteredDates.forEach(dateStr => {
        const rowData = dataLensState.data[dateStr] || {};
        tbodyHtml += `<tr><td class="datalens-cell-date">${dateStr}</td>`;

        dataLensState.tickers.forEach(sym => {
            const tData = rowData[sym];
            const val = (tData && tData[metricKey] !== undefined && tData[metricKey] !== null) ? Number(tData[metricKey]) : null;

            if (val !== null && !isNaN(val)) {
                columnValues[sym].push(val);
                const col = getDataLensCellColor(val);
                const displayVal = val >= 0 ? val.toFixed(2) : val.toFixed(2);
                tbodyHtml += `
                    <td class="datalens-cell-pct"
                        data-ticker="${sym}"
                        data-date="${dateStr}"
                        style="background-color: ${col.bg}; color: ${col.text};"
                        title="Нажмите для перехода на график ${sym} на дату ${dateStr}">
                        ${displayVal}
                    </td>
                `;
            } else {
                tbodyHtml += `<td class="datalens-cell-pct" data-ticker="${sym}" data-date="${dateStr}" style="color: var(--text-dim);">—</td>`;
            }
        });

        tbodyHtml += `</tr>`;
    });

    tbody.innerHTML = tbodyHtml;

    // 4. Summary Statistics Footer (COUNT, MEAN, MEDIAN, STD DEV, MIN, MAX)
    const statsDefs = [
        { key: "COUNT", name: "COUNT", fn: (arr) => arr.length },
        { key: "MEAN", name: "MEAN", fn: (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : "—" },
        { key: "MEDIAN", name: "MEDIAN", fn: (arr) => {
            if (!arr.length) return "—";
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0 ? sorted[mid].toFixed(2) : ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2);
        }},
        { key: "STD_DEV", name: "STD DEV", fn: (arr) => {
            if (arr.length < 2) return "—";
            const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
            const variance = arr.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (arr.length - 1);
            return Math.sqrt(variance).toFixed(2);
        }},
        { key: "MIN", name: "MIN", fn: (arr) => arr.length ? Math.min(...arr).toFixed(2) : "—" },
        { key: "MAX", name: "MAX", fn: (arr) => arr.length ? Math.max(...arr).toFixed(2) : "—" },
    ];

    let tfootHtml = "";
    statsDefs.forEach(stat => {
        tfootHtml += `<tr><td class="datalens-stat-label">${stat.name}</td>`;
        dataLensState.tickers.forEach(sym => {
            const arr = columnValues[sym] || [];
            const res = stat.fn(arr);
            tfootHtml += `<td>${res}</td>`;
        });
        tfootHtml += `</tr>`;
    });

    tfoot.innerHTML = tfootHtml;
}

// 5. Filter Scope Modal Logic
function initDataLensModalControls() {
    const backdrop = document.getElementById("datalensFilterModalBackdrop");
    const closeBtn = document.getElementById("closeDatalensFilterModal");
    const cancelBtn = document.getElementById("filterModalCancelBtn");
    const addBtn = document.getElementById("filterModalAddBtn");
    const deleteBtn = document.getElementById("filterModalDeleteBtn");

    if (closeBtn) closeBtn.addEventListener("click", closeDataLensFilterModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeDataLensFilterModal);
    if (backdrop) {
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeDataLensFilterModal();
        });
    }

    // Step 1: Filter Type buttons
    const typeButtons = document.querySelectorAll("#filterTypeOptions .filter-pill-btn");
    typeButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            typeButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            toggleModalStepsVisibility(btn.dataset.type);
        });
    });

    // Step 2: Offset buttons (For Earnings, exact as photo)
    const offsetButtons = document.querySelectorAll("#filterOffsetOptions .filter-pill-btn");
    offsetButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            if (e.ctrlKey || e.metaKey) {
                btn.classList.toggle("active");
                const anyActive = document.querySelector("#filterOffsetOptions .filter-pill-btn.active");
                if (!anyActive) btn.classList.add("active");
            } else {
                offsetButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            }
        });
    });

    // Step 2: Column buttons
    const colButtons = document.querySelectorAll("#filterColOptions .filter-pill-btn");
    colButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            colButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Step 3: Operator buttons
    const opButtons = document.querySelectorAll("#filterOpOptions .filter-pill-btn");
    opButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            opButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Step 2 (HoldMove): Direction buttons
    const holdDirButtons = document.querySelectorAll("#filterHoldDirectionOptions .filter-pill-btn");
    holdDirButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            holdDirButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Step 4 (HoldMove): Window buttons
    const holdWinButtons = document.querySelectorAll("#filterHoldWindowOptions .filter-pill-btn");
    holdWinButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            holdWinButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Smart sync: regular or postmarket window requires hold_until = 16:30
            const win = btn.dataset.window;
            if (win === "regular" || win === "postmarket") {
                const until1630Btn = document.querySelector("#filterHoldUntilOptions .filter-pill-btn[data-until='16:30']");
                if (until1630Btn) {
                    document.querySelectorAll("#filterHoldUntilOptions .filter-pill-btn").forEach(b => b.classList.remove("active"));
                    until1630Btn.classList.add("active");
                }
            }
        });
    });

    // Step 5 (HoldMove): Hold Until buttons
    const holdUntilButtons = document.querySelectorAll("#filterHoldUntilOptions .filter-pill-btn");
    holdUntilButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            holdUntilButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Smart sync: 09:30 cutoff cannot have regular or postmarket window
            const until = btn.dataset.until;
            if (until === "09:30") {
                const activeWin = document.querySelector("#filterHoldWindowOptions .filter-pill-btn.active")?.dataset.window;
                if (activeWin === "regular" || activeWin === "postmarket") {
                    const anyWinBtn = document.querySelector("#filterHoldWindowOptions .filter-pill-btn[data-window='any']");
                    if (anyWinBtn) {
                        document.querySelectorAll("#filterHoldWindowOptions .filter-pill-btn").forEach(b => b.classList.remove("active"));
                        anyWinBtn.classList.add("active");
                    }
                }
            }
        });
    });

    // Modal Add / Save Button
    if (addBtn) {
        addBtn.addEventListener("click", async () => {
            const activeType = document.querySelector("#filterTypeOptions .filter-pill-btn.active")?.dataset.type || "Earnings";
            const ticker = dataLensState.modalScopeTicker;

            let newFilter = {
                id: dataLensState.editingFilterId || `f_${Date.now()}`,
                ticker: ticker,
                type: activeType
            };

            if (activeType === "Earnings") {
                const activeOffsets = Array.from(document.querySelectorAll("#filterOffsetOptions .filter-pill-btn.active"))
                    .map(b => b.dataset.offset);
                newFilter.offsets = activeOffsets.length > 0 ? activeOffsets : ["R"];
            } else if (activeType === "HoldMove") {
                const direction = document.querySelector("#filterHoldDirectionOptions .filter-pill-btn.active")?.dataset.dir || "both";
                const threshInp = document.getElementById("filterHoldThresholdInput");
                const threshold = threshInp ? parseFloat(threshInp.value) : 1.0;
                const minHoldInp = document.getElementById("filterHoldMinHoldInput");
                const minHold = minHoldInp ? parseFloat(minHoldInp.value) : 0.90;
                const windowVal = document.querySelector("#filterHoldWindowOptions .filter-pill-btn.active")?.dataset.window || "any";
                const holdUntil = document.querySelector("#filterHoldUntilOptions .filter-pill-btn.active")?.dataset.until || "09:30";

                newFilter.direction = direction;
                newFilter.threshold = isNaN(threshold) ? 1.0 : threshold;
                newFilter.minHold = isNaN(minHold) ? 0.90 : minHold;
                newFilter.window = windowVal;
                newFilter.holdUntil = holdUntil;

                // Show calculation state on button
                const origText = addBtn.textContent;
                addBtn.textContent = "CALCULATING...";
                addBtn.disabled = true;

                try {
                    let url = `/api/datalens/filter/hold-move?ticker=${encodeURIComponent(ticker)}&period=${encodeURIComponent(dataLensState.period)}&threshold_pct=${newFilter.threshold}&min_hold_pct=${newFilter.minHold}&direction=${newFilter.direction}&window=${newFilter.window}&hold_until=${encodeURIComponent(newFilter.holdUntil)}`;
                    if (dataLensState.period === "custom" && dataLensState.customStart) {
                        url += `&start_date=${encodeURIComponent(dataLensState.customStart)}`;
                        if (dataLensState.customEnd) {
                            url += `&end_date=${encodeURIComponent(dataLensState.customEnd)}`;
                        }
                    }
                    const res = await fetch(url);
                    const json = await res.json();
                    if (json.status === "ok") {
                        newFilter.matchingDates = json.matching_dates || [];
                        newFilter.matchingDatesSet = new Set(newFilter.matchingDates);
                    } else {
                        alert("Ошибка фильтра: " + (json.detail || "Не удалось рассчитать"));
                        return;
                    }
                } catch (err) {
                    console.error("HoldMove fetch error:", err);
                    alert("Ошибка при запросе к серверу.");
                    return;
                } finally {
                    addBtn.textContent = origText;
                    addBtn.disabled = false;
                }
            } else if (activeType === "Quantitative") {
                const activeCol = document.querySelector("#filterColOptions .filter-pill-btn.active")?.dataset.col || "cls2cls";
                const activeOp = document.querySelector("#filterOpOptions .filter-pill-btn.active")?.dataset.op || "abs_gte";
                const valInp = document.getElementById("filterModalValueInput");
                const val = valInp ? parseFloat(valInp.value) : 2.0;

                newFilter.column = activeCol;
                newFilter.operator = activeOp;
                newFilter.value = isNaN(val) ? 2.0 : val;
            }

            if (dataLensState.editingFilterId) {
                // Update existing
                const idx = dataLensState.filters.findIndex(f => f.id === dataLensState.editingFilterId);
                if (idx !== -1) {
                    dataLensState.filters[idx] = newFilter;
                } else {
                    dataLensState.filters.push(newFilter);
                }
            } else {
                dataLensState.filters.push(newFilter);
            }

            closeDataLensFilterModal();
            renderDataLensFilters();
            renderDataLensTable();
        });
    }

    // Modal Delete Button
    if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
            if (dataLensState.editingFilterId) {
                dataLensState.filters = dataLensState.filters.filter(f => f.id !== dataLensState.editingFilterId);
                closeDataLensFilterModal();
                renderDataLensFilters();
                renderDataLensTable();
            }
        });
    }
}

function toggleModalStepsVisibility(filterType) {
    const offsetStep = document.getElementById("filterEarningsOffsetStep");
    const colStep = document.getElementById("filterColumnStep");
    const opStep = document.getElementById("filterOperatorStep");
    const valStep = document.getElementById("filterValueStep");

    const holdDirStep = document.getElementById("filterHoldMoveDirectionStep");
    const holdThreshStep = document.getElementById("filterHoldMoveThresholdsStep");
    const holdWinStep = document.getElementById("filterHoldMoveWindowStep");
    const holdUntilStep = document.getElementById("filterHoldMoveUntilStep");

    const isEarnings = (filterType === "Earnings");
    const isQuant = (filterType === "Quantitative");
    const isHoldMove = (filterType === "HoldMove");

    if (offsetStep) offsetStep.style.display = isEarnings ? "block" : "none";
    if (colStep) colStep.style.display = isQuant ? "block" : "none";
    if (opStep) opStep.style.display = isQuant ? "block" : "none";
    if (valStep) valStep.style.display = isQuant ? "block" : "none";

    if (holdDirStep) holdDirStep.style.display = isHoldMove ? "block" : "none";
    if (holdThreshStep) holdThreshStep.style.display = isHoldMove ? "block" : "none";
    if (holdWinStep) holdWinStep.style.display = isHoldMove ? "block" : "none";
    if (holdUntilStep) holdUntilStep.style.display = isHoldMove ? "block" : "none";
}

function openDataLensFilterModal(ticker, filterId = null) {
    dataLensState.modalScopeTicker = ticker;
    dataLensState.editingFilterId = filterId;

    const backdrop = document.getElementById("datalensFilterModalBackdrop");
    const badge = document.getElementById("modalScopeTickerBadge");
    const tickerSelect = document.getElementById("modalScopeTickerSelect");
    const deleteBtn = document.getElementById("filterModalDeleteBtn");
    const addBtn = document.getElementById("filterModalAddBtn");

    if (tickerSelect && dataLensState.tickers.length > 1) {
        tickerSelect.innerHTML = dataLensState.tickers.map(t => `<option value="${t}" ${t === ticker ? "selected" : ""}>[${t}]</option>`).join("");
        tickerSelect.style.display = "inline-block";
        tickerSelect.value = ticker;
        tickerSelect.onchange = (e) => {
            dataLensState.modalScopeTicker = e.target.value;
            if (badge) badge.innerHTML = `[${e.target.value}]`;
        };
        if (badge) badge.style.display = "none";
    } else {
        if (tickerSelect) tickerSelect.style.display = "none";
        if (badge) {
            badge.style.display = "inline-block";
            badge.innerHTML = `[${ticker}]`;
        }
    }

    if (filterId) {
        // Editing mode
        const filter = dataLensState.filters.find(f => f.id === filterId);
        if (filter) {
            dataLensState.modalScopeTicker = filter.ticker;
            if (tickerSelect) tickerSelect.value = filter.ticker;
            if (badge) badge.innerHTML = `[${filter.ticker}]`;

            // Set type
            document.querySelectorAll("#filterTypeOptions .filter-pill-btn").forEach(b => {
                b.classList.toggle("active", b.dataset.type === filter.type);
            });
            toggleModalStepsVisibility(filter.type);

            // Set offsets
            const savedOffsets = filter.offsets || ["R"];
            document.querySelectorAll("#filterOffsetOptions .filter-pill-btn").forEach(b => {
                b.classList.toggle("active", savedOffsets.includes(b.dataset.offset));
            });

            // Set column
            document.querySelectorAll("#filterColOptions .filter-pill-btn").forEach(b => {
                b.classList.toggle("active", b.dataset.col === (filter.column || "cls2cls"));
            });

            // Set operator
            document.querySelectorAll("#filterOpOptions .filter-pill-btn").forEach(b => {
                b.classList.toggle("active", b.dataset.op === (filter.operator || "abs_gte"));
            });

            // Set value
            const valInp = document.getElementById("filterModalValueInput");
            if (valInp) valInp.value = filter.value !== undefined ? filter.value : 2;

            // Set HoldMove fields
            if (filter.type === "HoldMove") {
                const savedDir = filter.direction || "both";
                document.querySelectorAll("#filterHoldDirectionOptions .filter-pill-btn").forEach(b => {
                    b.classList.toggle("active", b.dataset.dir === savedDir);
                });
                const threshInp = document.getElementById("filterHoldThresholdInput");
                if (threshInp) threshInp.value = filter.threshold !== undefined ? filter.threshold : 1.0;
                const minHoldInp = document.getElementById("filterHoldMinHoldInput");
                if (minHoldInp) minHoldInp.value = filter.minHold !== undefined ? filter.minHold : 0.90;
                const savedWin = filter.window || "any";
                document.querySelectorAll("#filterHoldWindowOptions .filter-pill-btn").forEach(b => {
                    b.classList.toggle("active", b.dataset.window === savedWin);
                });
                const savedUntil = filter.holdUntil || "09:30";
                document.querySelectorAll("#filterHoldUntilOptions .filter-pill-btn").forEach(b => {
                    b.classList.toggle("active", b.dataset.until === savedUntil);
                });
            }
        }

        if (deleteBtn) deleteBtn.style.display = "block";
        if (addBtn) addBtn.textContent = "SAVE";
    } else {
        // New filter mode (matches photo: Earnings with R active)
        document.querySelectorAll("#filterTypeOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.type === "Earnings");
        });
        document.querySelectorAll("#filterOffsetOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.offset === "R");
        });
        toggleModalStepsVisibility("Earnings");

        document.querySelectorAll("#filterColOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.col === "cls2cls");
        });

        document.querySelectorAll("#filterOpOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.op === "abs_gte");
        });

        const valInp = document.getElementById("filterModalValueInput");
        if (valInp) valInp.value = 2;

        // Reset HoldMove fields to default
        document.querySelectorAll("#filterHoldDirectionOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.dir === "both");
        });
        const threshInp = document.getElementById("filterHoldThresholdInput");
        if (threshInp) threshInp.value = 1.0;
        const minHoldInp = document.getElementById("filterHoldMinHoldInput");
        if (minHoldInp) minHoldInp.value = 0.90;
        document.querySelectorAll("#filterHoldWindowOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.window === "any");
        });
        document.querySelectorAll("#filterHoldUntilOptions .filter-pill-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.until === "09:30");
        });

        if (deleteBtn) deleteBtn.style.display = "none";
        if (addBtn) addBtn.textContent = "ADD";
    }

    if (backdrop) backdrop.style.display = "flex";
}

function closeDataLensFilterModal() {
    const backdrop = document.getElementById("datalensFilterModalBackdrop");
    if (backdrop) backdrop.style.display = "none";
    dataLensState.editingFilterId = null;
}

// 6. Export helpers
function exportDataLensAsCSV() {
    const filteredDates = getFilteredDataLensDates();
    if (!filteredDates.length) {
        alert("Нет данных для экспорта.");
        return;
    }

    const metricKey = dataLensState.metric;
    const header = ["DATE", ...dataLensState.tickers].join(",");
    const rows = [header];

    filteredDates.forEach(dateStr => {
        const rowData = dataLensState.data[dateStr] || {};
        const vals = [dateStr];
        dataLensState.tickers.forEach(sym => {
            const tData = rowData[sym];
            const val = (tData && tData[metricKey] !== undefined && tData[metricKey] !== null) ? Number(tData[metricKey]).toFixed(2) : "";
            vals.push(val);
        });
        rows.push(vals.join(","));
    });

    const csvContent = "data:text/csv;charset=utf-8," + rows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `data_${dataLensState.metric}_${dataLensState.asOf || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportDataLensAsExcel() {
    const filteredDates = getFilteredDataLensDates();
    if (!filteredDates.length) {
        alert("Нет данных для экспорта.");
        return;
    }

    const metricKey = dataLensState.metric;
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`;
    html += `<head><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Data</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><meta charset="utf-8"></head><body>`;
    html += `<table border="1"><thead><tr><th>DATE</th>`;
    dataLensState.tickers.forEach(sym => {
        html += `<th>${sym} (%)</th>`;
    });
    html += `</tr></thead><tbody>`;

    filteredDates.forEach(dateStr => {
        const rowData = dataLensState.data[dateStr] || {};
        html += `<tr><td>${dateStr}</td>`;
        dataLensState.tickers.forEach(sym => {
            const tData = rowData[sym];
            const val = (tData && tData[metricKey] !== undefined && tData[metricKey] !== null) ? Number(tData[metricKey]).toFixed(2) : "";
            html += `<td>${val}</td>`;
        });
        html += `</tr>`;
    });

    html += `</tbody></table></body></html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `data_${dataLensState.metric}_${dataLensState.asOf || 'export'}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

