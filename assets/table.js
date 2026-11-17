// 兩頁共用的表格程式（2026-11-17 起，共用元件重構第四階段；DESIGN.md「共用檔」）。
// 通用的：sortRows、headCells（表頭排序＋▾篩選）、表頭篩選選單（passHead、hfClose、bindHeadFilter、hfPlace）、syncTopScroll（表格上方捲軸）、colMenu（顯示欄位選單）。
// 兩頁同結構的：總覽明細表 cellVal／drawTable、空頭表 drawEpTable。
//   這些直接用頁面的全域變數與元素（D、BN、COLS、TIPS、visible、TEXT_COLS、hfCat、HF_TYPE、enName、nbMark、flagTip、flagName、#tbl、#eptbl、#hfbox…），兩頁名字一致才放這裡。
// 只宣告函式與不執行頁面程式的常數，所以可以在頁面主程式之前載入；監聽器由頁面呼叫 bindHeadFilter() 才掛上（保持和其他監聽器的先後）。
// 改了這個檔：把兩頁 <script src> 的 ?v= 換成當天日期。

// ── 排序與表頭
function sortRows(rows, key, dir, getter) {
  return rows.slice().sort((a, b) => { const va = getter(a, key), vb = getter(b, key); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * dir; });
}
// 表頭：點文字排序；「類別」「類型」旁多一個 ▾ 開篩選（scope：ov＝總覽表、ep＝空頭表）
function headCells(cols, sk, sd, tips, scope) {
  return cols.map(([k, t]) => {
    const sort = `<button type="button" data-k="${k}" ${tips[k] ? `data-tip="${tips[k]}"` : ""}>${t}${sk === k ? (sd < 0 ? " ▼" : " ▲") : ""}</button>`;
    const n = HF_OPTS[k] ? hfSel(scope, k).length : 0, all = HF_OPTS[k] && n === HF_OPTS[k]().length;
    const filt = HF_OPTS[k] ? `<button type="button" class="hf${all ? "" : " on"}" data-hf="${scope}:${k}" aria-label="篩選${t}" aria-haspopup="true">${all ? "▾" : n + " ▾"}</button>` : "";
    return `<th scope="col" class="${TEXT_COLS.has(k) || k === "pick" || k === "mk" ? "left" : ""}" aria-sort="${sk === k ? (sd < 0 ? "descending" : "ascending") : "none"}">${filt ? `<span class="thf">${sort}${filt}</span>` : sort}</th>`;
  }).join("");
}
// 表頭篩選：類別各表自己一組（頁面的 hfCat）；「類型／屬性」和側欄篩選是同一組勾選，套用時呼叫頁面的 HF_TYPE.set
const HF_OPTS = { cat: () => CATS.map(c => c[0]), t: () => TYPES };
const hfSel = (scope, k) => k === "t" ? TYPES.filter(t => $("t-" + t).checked) : [...hfCat[scope]];
function passHead(scope, x, cat) {
  if (hfCat[scope].size === CATS.length) return true;
  if (cat === undefined) { const o = ovMap.get(x.c); cat = o ? o.cat : null; }
  return cat != null && hfCat[scope].has(cat);
}
// 勾選先不生效：按「套用」、點選單外面或再按一次 ▾ 才套用；Esc 放棄這次的勾選
let hfApply = null;
function hfClose(apply) { const box = $("hfbox"); if (box.hidden) return; box.hidden = true; if (apply && hfApply) hfApply(); hfApply = null; }
// 捲動或表格重畫時，選單跟著表頭的 ▾ 移動；▾ 捲出畫面就收起
const hfPlace = () => {
  const box = $("hfbox"); if (box.hidden) return;
  const b = document.querySelector(`[data-hf="${box.dataset.anchor}"]`), r = b && b.getBoundingClientRect();
  if (!r || r.bottom < 0 || r.top > innerHeight) { hfClose(true); return; }
  box.style.left = Math.min(r.left, innerWidth - box.offsetWidth - 8) + "px"; box.style.top = (r.bottom + 6) + "px";
};
// 表頭篩選選單的監聽器：點 ▾ 開關、點外面套用；捲動時選單跟著 ▾ 移動。頁面在原本的位置呼叫一次
function bindHeadFilter() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-hf]"), box = $("hfbox");
    if (!b) { if (!box.hidden && !box.contains(e.target)) hfClose(true); return; }
    if (!box.hidden && box.dataset.anchor === b.dataset.hf) { hfClose(true); return; }
    hfClose(true);
    const [scope, k] = b.dataset.hf.split(":"), sel = new Set(hfSel(scope, k));
    box.dataset.anchor = b.dataset.hf;
    box.innerHTML = HF_OPTS[k]().map(v => `<label><input type="checkbox" value="${v}" ${sel.has(v) ? "checked" : ""}> ${k === "cat" ? CAT_NAME(v) : v}</label>`).join("")
      + `<span class="row" style="gap:10px"><button type="button" class="linkbtn" data-set="1">全選</button><button type="button" class="linkbtn" data-set="0">全不選</button><button type="button" class="btn btn-fill" data-ok style="margin-left:auto;padding:3px 12px">套用</button></span>`
      + (k === "t" ? `<span class="foot">和側欄的「${HF_TYPE.name}」篩選同步</span>` : `<span class="foot">只篩這張表，散布圖和檔數不變</span>`);
    box.hidden = false;
    const r = b.getBoundingClientRect(); box.style.left = Math.min(r.left, innerWidth - box.offsetWidth - 8) + "px"; box.style.top = (r.bottom + 6) + "px";
    hfApply = () => {
      const on = [...box.querySelectorAll("input")].filter(i => i.checked).map(i => i.value);
      if (on.length === sel.size && on.every(v => sel.has(v))) return;   // 沒改就不重畫
      if (k === "t") HF_TYPE.set(on); else { hfCat[scope].clear(); on.forEach(v => hfCat[scope].add(v)); }
      if (scope === "ep" && k === "cat") renderEps(); else render();
    };
    box.querySelectorAll("[data-set]").forEach(x => x.onclick = () => box.querySelectorAll("input").forEach(i => { i.checked = x.dataset.set === "1"; }));
    box.querySelector("[data-ok]").onclick = () => hfClose(true);
  });
  addEventListener("scroll", hfPlace, { passive: true }); document.addEventListener("scroll", hfPlace, { capture: true, passive: true });
}

// ── 表格上方的左右捲軸：和表格本身的捲軸同步；表格不夠寬就藏起來
function syncTopScroll() {
  document.querySelectorAll(".tblwrap").forEach(w => {
    const top = w.previousElementSibling; if (!top || !top.classList.contains("topscroll")) return;
    top.firstElementChild.style.width = w.scrollWidth + "px";
    top.hidden = w.scrollWidth <= w.clientWidth + 1;
    if (!w.dataset.bound) {
      w.dataset.bound = 1;
      top.addEventListener("scroll", () => { if (w.scrollLeft !== top.scrollLeft) w.scrollLeft = top.scrollLeft; });
      w.addEventListener("scroll", () => { if (top.scrollLeft !== w.scrollLeft) top.scrollLeft = w.scrollLeft; });
      if (window.ResizeObserver) new ResizeObserver(syncTopScroll).observe(w);
    }
  });
}

// 顯示欄位選單（總覽、空頭表共用）
// 「顯示欄位」選單：一定顯示的欄位不列出；勾選存在這個瀏覽器
function colMenu(boxId, resetId, cols, locked, vis, defs, key, redraw) {
  const box = $(boxId), save = () => { try { localStorage.setItem(key, JSON.stringify([...vis])); } catch (err) {} };
  box.innerHTML = cols.filter(([k]) => !locked.has(k)).map(([k, t]) => `<label><input type="checkbox" data-k="${k}" ${vis.has(k) ? "checked" : ""}> ${t}</label>`).join("");
  box.addEventListener("change", e => { const k = e.target.dataset.k; if (!k) return; e.target.checked ? vis.add(k) : vis.delete(k); save(); redraw(); });
  $(resetId).onclick = () => {
    vis.clear(); defs().forEach(k => vis.add(k)); try { localStorage.removeItem(key); } catch (err) {}
    box.querySelectorAll("input[data-k]").forEach(i => { i.checked = vis.has(i.dataset.k); });
    redraw();
  };
}

// ── 總覽明細表
function cellVal(r, k) {
  if (k === "cat") return CATS.findIndex(x => x[0] === r.cat);
  if (k === "mk") return marks.has(r.x.c) ? 1 : 0;
  if (k === "lead") return r.ex == null || r.m.cagr <= base.B.cagr ? null : r.ex - r.bex;
  if (k === "av") return r.av == null ? null : -r.av;   // 顯示成「跌幅 vs 基準」：正數＝跌得比基準淺
  if (k === "nb" || k === "life") return r[k];
  if (TEXT_COLS.has(k)) return r.x[k];
  return r.m[k];
}
function drawTable(rows) {
  const cols = COLS.filter(c => visible.has(c[0]));
  rows = rows.filter(r => passHead("ov", r.x, r.cat));
  $("tbl").querySelector("thead").innerHTML = "<tr>" + headCells(cols, sortKey, sortDir, TIPS, "ov") + "</tr>";
  const cell = (r, k) => {
    const x = r.x, m = r.m;
    switch (k) {
      case "t": return `<td class="txt left">${x.t}${x.t2 ? ` › <span class="t2">${x.t2}</span>` : ""}</td>`;
      case "c": return `<td class="txt left">${x.c}${nbMark(x)}</td>`;
      case "r": return `<td class="txt left">${x.r}</td>`;
      case "mk": return `<td class="left"><input type="checkbox" data-mk="${x.c}" aria-label="在散布圖標出 ${x.c}" ${marks.has(x.c) ? "checked" : ""}></td>`;
      case "n": return `<td class="txt left">${enName(x)}${FORCE.has(x.c) && !passFilters(x, r.m, true) ? ` <span class="flag nv term" tabindex="0" data-tip="${FLAG_TIP.fo}">篩選外</span>` : ""}${isHV(x.c) ? ` <span class="flag term" tabindex="0" data-tip="${flagTip("hv", x)}">${flagName("hv", x)}</span>` : ""}${r.burst ? ` <span class="flag bu term" tabindex="0" data-tip="${flagTip("bu", x)}">${flagName("bu", x)}</span>` : ""}${(r.cat === "穩強" || r.cat === "猛強") && !r.ok ? ` <span class="flag nv term" tabindex="0" data-tip="${FLAG_TIP.nv}">未經空頭驗證</span>` : ""}</td>`;
      case "life": return `<td class="${ud(r.life)}">${r.life == null ? "—" : sgn(r.life)}</td>`;
      case "cat": return `<td class="txt left"><span class="pill" style="--c:${colorOf(r.cat)}">${CAT_NAME(r.cat)}</span>${r.cat !== r.def ? `<span class="was">預設：${CAT_NAME(r.def)}</span>` : ""}</td>`;
      case "rec": return `<td>${m.rec == null ? "未回復" : Math.round(m.rec) + " 個月"}</td>`;
      case "nb": return `<td>${r.nb == null ? "—" : r.nb}</td>`;
      case "av": { const v = cellVal(r, "av"); return `<td class="${ud(v)}">${v == null ? "—" : sgn(v)}</td>`; }
      case "lead": { const v = cellVal(r, "lead"); return `<td class="${ud(v)}" ${v == null ? "" : `data-tip="拿掉爆發段後：年化 ${pct(r.ex)}；${BN} 同樣條件下 ${pct(r.bex)}"`}>${v == null ? "—" : sgn(v)}</td>`; }
      case "cagr": case "dca": case "mdd": return `<td>${pct(m[k])}</td>`;
      default: return `<td>${num(m[k])}</td>`;
    }
  };
  $("tbl").querySelector("tbody").innerHTML = sortRows(rows, sortKey, sortDir, cellVal).map(r => `<tr data-row="${r.x.c}" data-cat style="--c:${colorOf(r.cat)}" class="${r.cat !== r.def ? "changed" : ""} ${r.x.c === BN ? "bench" : ""} ${marks.has(r.x.c) ? "marked" : ""}">${cols.map(([k]) => cell(r, k)).join("")}</tr>`).join("");
  $("tbl").querySelectorAll("input[data-mk]").forEach(cb => cb.onchange = () => toggleMark(cb.dataset.mk));
  $("mkClear").hidden = !marks.size;
  $("tbl").querySelectorAll("th button[data-k]").forEach(b => b.onclick = () => {
    const k = b.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = TEXT_COLS.has(k) ? 1 : -1; }
    render();
  });
}

// ── 空頭表
function drawEpTable(E, ep) {
  const rows = D.etfs.filter(x => E.per[x.c].s[epSel] && passFilters(x, (base && base.list.find(r => r.x === x) || {}).m) && passHead("ep", x)).map(x => {
    const P = E.per[x.c], s = P.s[epSel];
    const ov = ovMap.get(x.c);
    const cr = x.c === BN ? null : epCross(x.p, ep, D);
    // vs、av：跌幅 vs 基準（正數＝跌得比基準淺）；computeEps 存的 more 是相反方向
    return { x, ov, cr, sel: s.dd, vs: -s.more, rec: s.rec, n_: P.n, av: P.av == null ? null : -P.av, slow: P.anyOpen ? null : P.slow, open: P.anyOpen, hv: isHV(x.c) };
  });
  // 追趕：月份從基準高點起算。排序值：這檔領先、被基準追上的為正（愈晚被追上愈大），落後、追上基準的為負（愈晚追上愈小），同步＝0
  const chaseMo = r => {
    if (!r.cr) return null; if (r.cr.tie) return 0;
    const m = r.cr.idx == null ? Infinity : Math.round((D.dates[r.cr.idx] - D.dates[ep.pk]) / 30.44);
    return r.cr.lead ? m : -m;
  };
  const chaseCell = r => {
    if (!r.cr) return "—"; if (r.cr.tie) return "同步";
    const v = chaseMo(r), m = Math.abs(v);
    return r.cr.lead ? (m === Infinity ? "還沒被追上" : `${m} 個月後被追上`) : (m === Infinity ? "還沒追上" : `${m} 個月後追上`);
  };
  const get = (r, k) => k === "c" || k === "n" || k === "t" ? r.x[k] : k === "pick" ? (picks.has(r.x.c) ? 1 : 0) : k === "sel" ? -r.sel
    : k === "chase" ? chaseMo(r) : k === "cat" ? (r.ov ? CATS.findIndex(c => c[0] === r.ov.cat) : null) : r[k];
  const cell = (r, k) => {
    const b = r.x.c === BN;
    switch (k) {
      case "t": return `<td class="txt left">${r.x.t}${r.x.t2 ? ` › <span class="t2">${r.x.t2}</span>` : ""}</td>`;
      case "c": return `<td class="txt left">${r.x.c}${nbMark(r.x)}</td>`;
      case "n": return `<td class="txt left">${enName(r.x)}${r.hv ? ` <span class="flag term" tabindex="0" data-tip="${flagTip("hv", r.x)}">${flagName("hv", r.x)}</span>` : ""}</td>`;
      case "cat": return `<td class="txt left">${r.ov ? `<span class="pill" style="--c:${colorOf(r.ov.cat)}">${CAT_NAME(r.ov.cat)}</span>` : "—"}</td>`;
      case "pick": return `<td class="left"><input type="checkbox" data-c="${r.x.c}" aria-label="把 ${r.x.c} 畫進走勢圖" ${picks.has(r.x.c) ? "checked" : ""} ${b ? "disabled" : ""}></td>`;
      case "sel": return `<td>${pct(r.sel)}</td>`;
      case "vs": return `<td class="${b ? "" : ud(r.vs)}">${b ? "—" : sgn(r.vs)}</td>`;
      case "av": return `<td class="${b ? "" : ud(r.av)}">${b ? "—" : `${sgn(r.av)} <span class="was">（${r.n_} 次）</span>`}</td>`;
      case "rec": return `<td>${r.rec == null ? "未回復" : Math.round(r.rec) + " 個月"}</td>`;
      case "chase": return `<td>${chaseCell(r)}</td>`;
      case "slow": return `<td>${r.open ? "有一次未回復" : Math.round(r.slow) + " 個月"}</td>`;
    }
  };
  const cols = EPCOLS.filter(c => epVisible.has(c[0]));
  $("eptbl").querySelector("thead").innerHTML = "<tr>" + headCells(cols, epSort, epDir, EPTIPS, "ep") + "</tr>";
  $("eptbl").querySelector("tbody").innerHTML = sortRows(rows, epSort, epDir, get).map(r => `<tr data-row="${r.x.c}" ${r.ov ? `data-cat style="--c:${colorOf(r.ov.cat)}"` : ""} class="${r.x.c === BN ? "bench" : ""}">${cols.map(([k]) => cell(r, k)).join("")}</tr>`).join("");
  $("eptbl").querySelectorAll("th button[data-k]").forEach(b => b.onclick = () => { const k = b.dataset.k; if (epSort === k) epDir = -epDir; else { epSort = k; epDir = ["c", "n", "t", "sel", "rec", "slow"].includes(k) ? 1 : -1; } renderEps(); });
  $("eptbl").querySelectorAll("tbody input").forEach(cb => cb.onchange = () => {
    const c = cb.dataset.c, drawn = [...picks].filter(k => { const x = D.etfs.find(y => y.c === k); return x && x.p[ep.pk] != null; }).length;
    if (cb.checked) { if (drawn >= 8) { cb.checked = false; $("epnote").insertAdjacentHTML("beforeend", "<br><strong>走勢圖最多 8 條，先取消幾條再加。</strong>"); return; } picks.add(c); } else picks.delete(c);
    drawEpChart(ep);
  });
}
