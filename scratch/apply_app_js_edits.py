import re

with open(r"c:\Users\K009\PycharmProjects\Analysis\static\app.js", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Global state
if 'let screenerAllData = [];' not in content:
    content = content.replace('let screenerFilteredData = [];', 'let screenerAllData = [];\nlet screenerFilteredData = [];\nlet corrSortCol = null;\nlet corrSortAsc = false;', 1)
    print("1. Added global state.")

# 2. openBulkImportModal
new_bulk_modal = r'''function openBulkImportModal() {
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
}'''

pattern_bulk = re.compile(r'function openBulkImportModal\(\) \{[\s\S]*?replaceBtn\.onclick = \(\) => applyImport\(true\);\s*\}', re.MULTILINE)
if pattern_bulk.search(content):
    content = pattern_bulk.sub(lambda m: new_bulk_modal, content)
    print("2. Replaced openBulkImportModal.")
else:
    print("2. pattern_bulk already updated or not found.")

# 3. renderCalculationOverview optional chaining
old_overview = '''function renderCalculationOverview(data) {
    document.getElementById("resultBenchmark").textContent = data.benchmarks ? data.benchmarks.join(", ") : data.benchmark;
    document.getElementById("resultPeriod").textContent = data.period ? data.period.toUpperCase() : "1Y";
    document.getElementById("resultDateRange").textContent = `${data.period_start || "—"} по ${data.period_end || "—"}`;
    document.getElementById("resultTotalAssets").textContent = `${data.total_analyzed || 0} из ${data.total_requested || 0}`;
}'''

new_overview = '''function renderCalculationOverview(data) {
    const rBm = document.getElementById("resultBenchmark");
    if (rBm) rBm.textContent = data.benchmarks ? data.benchmarks.join(", ") : data.benchmark;
    const rPer = document.getElementById("resultPeriod");
    if (rPer) rPer.textContent = data.period ? data.period.toUpperCase() : "1Y";
    const rDate = document.getElementById("resultDateRange");
    if (rDate) rDate.textContent = `${data.period_start || "—"} по ${data.period_end || "—"}`;
    const rTot = document.getElementById("resultTotalAssets");
    if (rTot) rTot.textContent = `${data.total_analyzed || 0} из ${data.total_requested || 0}`;
}'''

if old_overview in content:
    content = content.replace(old_overview, new_overview, 1)
    print("3. Updated renderCalculationOverview with optional chaining.")

# 4. renderScreenerTable and updateScreenerView + applyScreenerFilter
new_screener_code = r'''function renderScreenerTable(data) {
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
    const threshold = thInp ? parseFloat(thInp.value) : 0.50;
    const thresholdMax = thMaxInp ? parseFloat(thMaxInp.value) : 1.00;
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
    if (countEl) countEl.textContent = screenerFilteredData.length;
    if (totalEl) totalEl.textContent = `/ ${calculationResults ? (calculationResults.tickers || []).length : 0}`;

    if (screenerFilteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Нет тикеров, удовлетворяющих условиям фильтра.</td></tr>`;
        return;
    }

    const itemsToDisplay = screenerPageSize === Infinity ? screenerFilteredData : screenerFilteredData.slice(0, screenerPageSize);

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
            applyScreenerFilter();
        });
    }

    if (applyBtn) {
        applyBtn.addEventListener("click", applyScreenerFilter);
    }

    if (thInp) thInp.addEventListener("change", applyScreenerFilter);
    if (thMaxInp) thMaxInp.addEventListener("change", applyScreenerFilter);
    if (searchInp) searchInp.addEventListener("input", debounce(applyScreenerFilter, 200));

    document.querySelectorAll(".screener-preset").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".screener-preset").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const op = btn.dataset.op;
            const val = btn.dataset.val;
            if (opSel) opSel.value = op === "all" ? "none" : op;
            if (maxField) maxField.style.display = op === "between" ? "block" : "none";
            if (thInp && val !== "all") thInp.value = val;
            applyScreenerFilter();
        });
    });

    if (pageSizeSel) {
        pageSizeSel.addEventListener("change", () => {
            screenerPageSize = pageSizeSel.value === "all" ? Infinity : parseInt(pageSizeSel.value) || 50;
            updateScreenerView();
        });
    }

    // Column sorting for Primary Screener
    document.querySelectorAll("#mainBenchmarkTable thead th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (screenerSortCol === col) {
                screenerSortAsc = !screenerSortAsc;
            } else {
                screenerSortCol = col;
                screenerSortAsc = false; // Descending first
            }
            applyScreenerFilter();
        });
    });

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

function initMatrixFilterEvents() {'''

pattern_screener = re.compile(r'function renderScreenerTable\(data\) \{[\s\S]*?function initMatrixFilterEvents\(\) \{', re.MULTILINE)
if pattern_screener.search(content):
    content = pattern_screener.sub(lambda m: new_screener_code, content)
    print("4. Replaced screener code with full filter, sort, and expected_move calculation.")

# 5. Call initScreenerFilterEvents() in DOMContentLoaded
if 'initCalculatorEvents();' in content and 'initScreenerFilterEvents();' not in content:
    content = content.replace('initCalculatorEvents();', 'initCalculatorEvents();\n    initScreenerFilterEvents();', 1)
    print("5. Added initScreenerFilterEvents() call to DOMContentLoaded.")

# 6. renderCorrTableRows in Tab 2
new_corr_rows_code = r'''function renderCorrTableRows() {
    const tbody = document.getElementById("corrTableBody");
    if (!tbody) return;

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

    // Interactive sorting on currentCorrList
    if (corrSortCol) {
        currentCorrList.sort((a, b) => {
            if (corrSortCol === "symbol") {
                const sA = a.symbol || ""; const sB = b.symbol || "";
                return corrSortAsc ? sA.localeCompare(sB) : sB.localeCompare(sA);
            }
            if (corrSortCol === "type") {
                const tA = a.type || ""; const tB = b.type || "";
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
                valA = corrTargetMove; valB = corrTargetMove;
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
            if (icon) icon.textContent = corrSortAsc ? "▲" : "▼";
        } else {
            th.classList.remove("active-sort");
            if (icon) icon.textContent = "⇅";
        }
    });

    tbody.innerHTML = "";
    currentCorrList.forEach(item => {
        const tr = document.createElement("tr");
        const isBenchmark = item.type === "Benchmark";
        const typeBadge = `<span class="group-badge-count">${item.type}</span>`;
        const corrBadge = formatCorrHeatmap(item.correlation);
        const betaStr = item.beta !== null ? Number(item.beta).toFixed(3) : "—";

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

        const removeBtn = `<button class="btn-remove-peer" data-symbol="${item.symbol}" title="Удалить из таблицы">×</button>`;

        // Notice: NO daily volatility column, and editable Target Move input!
        tr.innerHTML = `
            <td><strong><span class="clickable-ticker" data-ticker="${item.symbol}">${item.symbol}</span></strong></td>
            <td>${typeBadge}</td>
            <td>${corrBadge}</td>
            <td>${betaStr}</td>
            <td style="text-align: center;">
                <input type="number" step="0.1" class="custom-move-inline-input corr-peer-move-input" data-symbol="${item.symbol}" value="${peerMove.toFixed(2)}">
            </td>
            <td class="corr-exp-cell"><strong>${expFmt}</strong></td>
            <td style="text-align: center;">
                <input type="number" step="0.1" class="custom-move-inline-input corr-target-move-cell-input" value="${targetMoveVal}" title="Ход ${currentStockTicker} (%)">
            </td>
            <td class="corr-diff-cell">${diffHtml}</td>
            <td class="corr-norm-cell">${normHtml}</td>
            <td>${item.observations || "—"} дн.</td>
            <td style="text-align: center;">${removeBtn}</td>
        `;

        tr.querySelector(".clickable-ticker").addEventListener("click", () => switchToStockAnalytics(item.symbol));

        // Real-time inline peer move change
        const peerInp = tr.querySelector(".corr-peer-move-input");
        if (peerInp) {
            peerInp.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    corrCustomMovesMap[item.symbol] = val;
                }
                renderCorrTableRows();
            });
            peerInp.addEventListener("click", (e) => e.stopPropagation());
        }

        // Real-time inline target move change (user can edit target move directly from any row)
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

function removeCorrTicker(sym, isBenchmark) {'''

pattern_corr_rows = re.compile(r'function renderCorrTableRows\(\) \{[\s\S]*?function removeCorrTicker\(sym, isBenchmark\) \{', re.MULTILINE)
if pattern_corr_rows.search(content):
    content = pattern_corr_rows.sub(lambda m: new_corr_rows_code, content)
    print("6. Replaced renderCorrTableRows.")

# 7. Add correlation table header sorting click listeners in initStockAnalyticsEvents
old_stock_events = '''    // Analytics Sub-Tabs Navigation'''
new_stock_events = '''    // Sortable Headers for Correlation Table (#corrTable)
    document.querySelectorAll("#corrTable thead th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (corrSortCol === col) {
                corrSortAsc = !corrSortAsc;
            } else {
                corrSortCol = col;
                corrSortAsc = false; // Descending first: highest correlation, highest beta, highest normalized
            }
            renderCorrTableRows();
        });
    });

    // Analytics Sub-Tabs Navigation'''

if old_stock_events in content and 'corrTable thead th[data-sort]' not in content:
    content = content.replace(old_stock_events, new_stock_events, 1)
    print("7. Added #corrTable sorting events in initStockAnalyticsEvents.")

with open(r"c:\Users\K009\PycharmProjects\Analysis\static\app.js", "w", encoding="utf-8") as f:
    f.write(content)

print("Finished updating static/app.js.")
