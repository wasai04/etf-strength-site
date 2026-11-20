// 兩頁共用的圖表程式（2026-11-17 起，共用元件重構第三階段；DESIGN.md「共用檔」「圖表規格」）。
// 通用的：svgPt、clampSc、panZoom（散布圖縮放拖曳）、zoomButtons；固定樣式 CHART 和零件 axes、refLines、emptyState、fitChartText（標準化 A 階段）。
// 走勢圖的 lineChart、timeGrid、lineCursor、xZoom（標準化 B 階段）。
// 兩頁同結構的：總覽散布圖 drawChart／markLabels／toggleMark、空頭走勢圖 drawEpChart／epTip／bindEpCursor／epFocus／epLeave／bindEpZoom。
//   這些直接用頁面的全域變數與函式（D、BN、marks、picks、scState、scView、epState、epView、computeEps、tip、tipFor、hideTip、LINE_COLORS、CAT_NAME、colorOf、
//   drawTable、syncRange、crashAlpha、$ 等）和元素（#chart、#epchart…），兩頁名字一致才放這裡；頁面改這些名字前先搜這個檔。
// 只宣告函式、不在載入時執行，所以可以在頁面主程式之前載入。改了這個檔：把兩頁 <script src> 的 ?v= 換成當天日期。

// ── 縮放與拖曳（DESIGN「圖表規格」）：Ctrl（Mac 用 ⌘）＋滾輪以游標為中心縮放、按住拖曳移動；按鈕給觸控用
function svgPt(svg, e) { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }
// 散布圖的範圍限制：預設範圍（包住所有點）外各留 10% 當邊界，縮小不超過邊界、拖曳不出邊界；放大最多到預設範圍的 5%
function clampSc(v, b) {
  const fit = (a0, a1, lo, hi) => {
    const pad = (hi - lo) * 0.1, L = lo - pad, R = hi + pad, w = Math.max(Math.min(a1 - a0, R - L), (hi - lo) * 0.05);
    const c = (a0 + a1) / 2, s = Math.min(Math.max(c - w / 2, L), R - w); return [s, s + w];
  };
  const [x0, x1] = fit(v.x0, v.x1, b.x0, b.x1), [y0, y1] = fit(v.y0, v.y1, b.y0, b.y1);
  return { x0, x1, y0, y1 };
}
// 散布圖的縮放與拖曳。o.state()：目前畫面（資料範圍 x0／x1／y0／y1、邊界 m、寬 Wd、高 H），還沒畫就是 null；
// o.view(v)：設新範圍並重畫（null＝回到預設範圍；圖空著時 state 是 null，view 只記範圍、不畫）；o.late：點本身有說明的圖，拖動超過 3px 才鎖定指標（點一下照常開說明）；
// o.click(e)：沒拖動就放開＝點一下。回傳 { zoom(f), reset() } 給縮放按鈕用（f < 1 放大）
function panZoom(svg, o) {
  let drag = null;
  const zoom = (f, cx, cy) => {
    const S = o.state(); if (!S) return;
    if (cx == null) { cx = (S.x0 + S.x1) / 2; cy = (S.y0 + S.y1) / 2; }
    o.view({ x0: cx - (cx - S.x0) * f, x1: cx + (S.x1 - cx) * f, y0: cy - (cy - S.y0) * f, y1: cy + (S.y1 - cy) * f });
  };
  svg.addEventListener("wheel", e => {
    const S = o.state(); if (!(e.ctrlKey || e.metaKey) || !S) return; e.preventDefault();
    const p = svgPt(svg, e);
    zoom(e.deltaY > 0 ? 1.25 : 0.8, S.x0 + (p.x - S.m.l) / (S.Wd - S.m.l - S.m.r) * (S.x1 - S.x0), S.y0 + (S.H - S.m.b - p.y) / (S.H - S.m.t - S.m.b) * (S.y1 - S.y0));
  }, { passive: false });
  svg.addEventListener("pointerdown", e => {
    const S = o.state(); if (e.button !== 0 || !S) return;
    drag = { id: e.pointerId, p: svgPt(svg, e), v: { x0: S.x0, x1: S.x1, y0: S.y0, y1: S.y1 }, moved: false };
    if (!o.late) { e.preventDefault(); svg.setPointerCapture(e.pointerId); }
  });
  svg.addEventListener("pointermove", e => {
    if (!drag) return; const S = o.state(), p = svgPt(svg, e), v = drag.v;
    if (!drag.moved && Math.abs(p.x - drag.p.x) + Math.abs(p.y - drag.p.y) < 3) return;
    if (!drag.moved) { drag.moved = true; if (o.late) svg.setPointerCapture(drag.id); }
    hideTip();
    const dx = (p.x - drag.p.x) / (S.Wd - S.m.l - S.m.r) * (v.x1 - v.x0), dy = (p.y - drag.p.y) / (S.H - S.m.t - S.m.b) * (v.y1 - v.y0);
    o.view({ x0: v.x0 - dx, x1: v.x1 - dx, y0: v.y0 + dy, y1: v.y1 + dy });
  });
  svg.addEventListener("pointerup", e => { if (drag && !drag.moved && o.click) o.click(e); drag = null; });
  svg.addEventListener("pointercancel", () => { drag = null; });
  return { zoom: f => zoom(f), reset: () => o.view(null) };   // 重設不看 state：圖空著時也要清掉縮放範圍
}
// 縮放按鈕：data-zc="圖:in／out／reset"，圖的代號對應 h 裡的 { zoom, reset }
function zoomButtons(h) {
  document.querySelectorAll("[data-zc]").forEach(b => b.onclick = () => {
    const [t, a] = b.dataset.zc.split(":"), z = h[t]; if (!z) return;
    if (a === "reset") z.reset(); else z.zoom(a === "in" ? 0.8 : 1.25);
  });
}

// ── 圖表的固定樣式與零件（標準化 A 階段，2026-11-20；_local/plan-ui-standardization-20261117.md）
// JC 的標準：資料進來，會變的只有點／線本身和座標範圍；格線、刻度、軸標題、基準線、參考線、裁切、空狀態都從這裡來，圖本身不再自己寫
const CHART = {
  grid: "var(--line)",                                     // 格線
  base: { stroke: "var(--fg)", opacity: ".5" },             // 0（或 100）的基準線：細實線（JC 2026-11-20：實線＝座標的基準、虛線＝拿來比的參考）
  ref: { stroke: "var(--fg)", dash: "4 4", opacity: ".55" },   // 拿來比的參考線（基準十字）
  good: { stroke: "var(--calmar)", dash: "6 5" },          // 划算線
  cursor: { stroke: "var(--fg)", opacity: ".6" },           // 走勢圖游標的豎線
  tickPad: 6, xTickDy: 16, titleDy: 6,                     // y 刻度字離繪圖區、x 刻度字在底線下、x 軸標題離圖底
  scatterM: { l: 56, r: 16, t: 26, b: 40 },                // 散布圖的邊界（上方留給左上角的 Y 軸標題）
};
// 線性百分比的刻度間距：0.01～1 裡取格數不超過 8 的最小間距
const pctStep = span => [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find(s => span / s <= 8) || 10;   // 槓桿散布圖會到幾百 %
// 座標軸：s = { W, H, m（邊界）, x: [lo, hi], y: [lo, hi], xStep, yStep（跨度 → 間距）, fmt（刻度字，預設整數百分比）, yPad（y 刻度字離繪圖區）,
//   zero（0 那條用基準線）, clip（clipPath 的 id）, xTitle, yTitle（一律在繪圖區左上角上方橫寫，JC 2026-11-20） }
// 回傳 { g, sx, sy }：g 是 clipPath＋格線＋刻度字＋軸標題，sx／sy 是值 → 座標
function axes(s) {
  const { W, H, m } = s, [x0, x1] = s.x, [y0, y1] = s.y, fmt = s.fmt || (v => pct(v, 0)), pad = s.yPad ?? CHART.tickPad;
  const sx = v => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  const gl = v => s.zero && Math.abs(v) < 1e-9 ? `stroke="${CHART.base.stroke}" opacity="${CHART.base.opacity}"` : `stroke="${CHART.grid}"`, xs = s.xStep(x1 - x0), ys = s.yStep(y1 - y0);
  let g = s.clip ? `<clipPath id="${s.clip}"><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/></clipPath>` : "";
  for (let v = Math.ceil(y0 / ys - 1e-9) * ys; v <= y1 + 1e-9; v += ys)
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" ${gl(v)}/><text x="${m.l - pad}" y="${sy(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  for (let v = Math.ceil(x0 / xs - 1e-9) * xs; v <= x1 + 1e-9; v += xs)
    g += `<line y1="${m.t}" y2="${H - m.b}" x1="${sx(v)}" x2="${sx(v)}" ${gl(v)}/><text x="${sx(v)}" y="${H - m.b + CHART.xTickDy}" text-anchor="middle">${fmt(v)}</text>`;
  if (s.xTitle) g += `<text x="${(m.l + W - m.r) / 2}" y="${H - CHART.titleDy}" text-anchor="middle">${s.xTitle}</text>`;
  if (s.yTitle) g += `<text x="${m.l}" y="${m.t - 9}">${s.yTitle}</text>`;
  return { g, sx, sy };
}
// 參考線（拿來比的線：基準十字、划算線、以為的 N 倍）：畫在點的上面、不接滑鼠，底下墊同寬的背景色線，虛線的空隙才不透出點（DESIGN「圖表規格」）
// list 每條 { x1, y1, x2, y2, stroke, dash, width, opacity }；先畫全部的底線再畫線
function refLines(list, clip) {
  const ln = (o, bg) => `<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${bg ? "var(--panel)" : o.stroke}"${o.width ? ` stroke-width="${o.width}"` : ""}${!bg && o.dash ? ` stroke-dasharray="${o.dash}"` : ""}${!bg && o.opacity != null ? ` opacity="${o.opacity}"` : ""}/>`;
  return `<g${clip ? ` clip-path="url(#${clip})"` : ""} pointer-events="none">${list.map(o => ln(o, true)).join("")}${list.map(o => ln(o)).join("")}</g>`;
}
// 圖上的字跟著圖實際畫出來的寬度放大（稽核 2 M4：寬 601～900px 時 viewBox 900 縮到約 540px，字只剩約 6px）。
// --fk＝字級倍數：桌機原寬時是 1（不變），愈窄愈大；CSS 的 svg.chart text 用它。頁面載入後呼叫一次
function fitChartText() {
  const ro = new ResizeObserver(es => es.forEach(e => { const w = e.contentRect.width; if (w) e.target.style.setProperty("--fk", Math.max(1, e.target.viewBox.baseVal.width / w * 0.85).toFixed(3)); }));
  document.querySelectorAll("svg.chart").forEach(s => ro.observe(s));
}
// 空狀態：圖中央一行字（大小照 viewBox）
function emptyState(svg, text) { const v = svg.viewBox.baseVal; svg.innerHTML = `<text x="${v.width / 2}" y="${v.height / 2}" text-anchor="middle">${text}</text>`; }

// ── 總覽散布圖
function drawChart(rows, B) {
  const svg = $("chart"), Wd = 900, H = 420, m = CHART.scatterM;
  if (!rows.length) { scState = null; emptyState(svg, "沒有符合篩選的 ETF"); return; }   // scState 清掉：縮放、拖曳才不會拿上一輪的點重畫
  const xs = rows.map(r => r.m.mdd), ys = rows.map(r => r.m.cagr);
  // 預設範圍包住所有點；縮放／拖曳後用 scView 的範圍（換期間或篩選不重設，按「重設」才回預設）
  const base0 = { x0: Math.min(-0.1, Math.floor(Math.min(...xs, B.mdd) * 10) / 10), x1: 0,
    y0: Math.floor(Math.min(...ys, B.cagr, 0) * 10) / 10, y1: Math.ceil(Math.max(...ys, B.cagr, 0.1) * 10) / 10 };
  if (scView) scView = clampSc(scView, base0);
  const { x0, x1, y0, y1 } = scView || base0;
  const A = axes({ W: Wd, H, m, x: [x0, x1], y: [y0, y1], xStep: pctStep, yStep: pctStep, zero: true, clip: "scClip", xTitle: "最大回撤", yTitle: "年化報酬 ↑" }), { sx, sy } = A;
  scState = { rows, B, base0, x0, x1, y0, y1, m, Wd, H };
  let g = A.g;
  g += `<g clip-path="url(#scClip)"><rect x="${sx(B.mdd)}" y="${sy(y1 + 10)}" width="${Math.max(0, sx(x1 + 10) - sx(B.mdd))}" height="${Math.max(0, sy(B.cagr) - sy(y1 + 10))}" fill="var(--quad)"/>`;
  const negB = !(B.rr > 0);   // 基準年化 ≤ 0：划算線改成基準回撤這條直線，畫成綠色
  $("negnote").hidden = !negB;
  // 基準的十字（直線在基準年化 ≤ 0 時兼當划算線）
  const refs = [{ x1: sx(B.mdd), y1: m.t, x2: sx(B.mdd), y2: H - m.b, ...(negB ? { ...CHART.good, width: 1.6, opacity: 1 } : { ...CHART.ref, width: 1 }) },
    { x1: m.l, y1: sy(B.cagr), x2: Wd - m.r, y2: sy(B.cagr), ...CHART.ref }];
  // 和基準一樣划算的線：年化 = 基準的報酬／回撤 × 回撤幅度；線上方比基準划算
  if (B.rr > 0) {
    refs.push({ x1: sx(-2), y1: sy(B.rr * 2), x2: sx(0), y2: sy(0), ...CHART.good, width: 1.4 });
    // 線名標在線進入畫面的那一端（左邊或上緣）
    let xl = Math.max(x0, -y1 / B.rr) + (x1 - x0) * 0.06;
    // 有象限說明時（沒縮放），字至少放在上緣往下 40px 的位置，避開左上角「報酬更高、跌得更深」
    if (!scView) { const vTop = y0 + (H - m.b - (m.t + 40)) / (H - m.t - m.b) * (y1 - y0); xl = Math.max(xl, -vTop / B.rr); }
    const yl = B.rr * -xl;
    if (yl > y0 && yl < y1) g += `<text class="q" x="${sx(xl) + 6}" y="${Math.max(sy(yl) - 6, m.t + 12)}" style="fill:var(--calmar)">划算線</text>`;
  }
  // 基準年化是負的：年化 ÷ 回撤沒有意義，划算線不畫，改用「回撤有沒有比基準深」（就是那條直的虛線）
  if (negB) g += `<text class="q" x="${sx(B.mdd) + 6}" y="${m.t + 34}" style="fill:var(--calmar)">划算線（${BN} 年化是負的，只看回撤）</text>`;
  g += `</g>`;
  if (!scView) {
    g += `<text class="q4" x="${Wd - m.r - 6}" y="${m.t + 16}" text-anchor="end">報酬更高、跌得更少</text><text class="q4" x="${m.l + 6}" y="${m.t + 16}">報酬更高、跌得更深</text>`;
    g += `<text class="q4" x="${Wd - m.r - 6}" y="${H - m.b - 8}" text-anchor="end">跌得少、報酬也少</text><text class="q4" x="${m.l + 6}" y="${H - m.b - 8}">報酬少、跌得也深</text>`;
  }
  g += `<g clip-path="url(#scClip)">`;
  // 基準最後畫（不被蓋住），畫成全圖唯一的靶心：深色外圈、淺色環、深色中心，不用類別色
  rows.filter(r => r.x.c !== BN).concat(rows.filter(r => r.x.c === BN)).forEach(r => {
    const isB = r.x.c === BN, ch = r.cat !== r.def, hollow = !isB && (r.cat === "穩強" || r.cat === "猛強") && !r.ok;
    const tags = [r.burst ? flagName("bu", r.x) : "", hollow ? "未經空頭驗證" : ""].filter(Boolean).join("・");
    const tipText = `${r.x.c} ${r.x.n}｜${isB ? "基準" : CAT_NAME(r.cat)}${ch ? `（預設：${CAT_NAME(r.def)}）` : ""}${tags ? `｜${tags}` : ""}&#10;年化 ${pct(r.m.cagr)}&#10;最大回撤 ${pct(r.m.mdd)}${isB ? "" : `&#10;上市以來 vs ${BN} ${r.life == null ? "—" : sgn(r.life)}`}`;
    const cx = sx(r.m.mdd), cy = sy(r.m.cagr);
    if (ch && !isB) g += `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`;
    g += isB
      ? `<circle cx="${cx}" cy="${cy}" r="8" fill="var(--fg)"/><circle cx="${cx}" cy="${cy}" r="5.5" fill="var(--panel)"/><circle cx="${cx}" cy="${cy}" r="3" fill="var(--fg)"/><circle cx="${cx}" cy="${cy}" r="9" fill="transparent" data-c="${r.x.c}" data-tip="${tipText}"></circle>`
      : hollow
      ? `<circle cx="${cx}" cy="${cy}" r="4.5" fill="var(--panel)" stroke="${colorOf(r.cat)}" stroke-width="2" data-c="${r.x.c}" data-tip="${tipText}"></circle>`
      : `<circle cx="${cx}" cy="${cy}" r="5" fill="${colorOf(r.cat)}" fill-opacity=".85" data-c="${r.x.c}" data-tip="${tipText}"></circle>`;
  });
  g += `</g>`;
  g += refLines(refs, "scClip");   // 參考線畫在點的上面（DESIGN「圖表規格」，2026-11-17）
  // 基準不另畫方框標籤（靶心本身就是基準；JC 不要圖中間出現基準的代號）
  const boxes = [];
  g += markLabels(rows.filter(r => marks.has(r.x.c) && r.x.c !== BN).map(r => ({ c: r.x.c, x: sx(r.m.mdd), y: sy(r.m.cagr) })), boxes, { x0: m.l, y0: m.t, x1: Wd - m.r, y1: H - m.b });
  svg.innerHTML = g;
}

// 標註的標籤：和基準一樣的深色方框，自動找不重疊的位置。
// 由近到遠、繞著點試 8 個方向，第一個不壓到其他標籤、基準方框、標註點，又在圖內的就用；離點比較遠的拉一條引線
function markLabels(pts, boxes, area) {
  pts = pts.filter(p => p.x >= area.x0 && p.x <= area.x1 && p.y >= area.y0 && p.y <= area.y1);   // 縮放後在畫面外的不標
  const hit = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;
  pts.forEach(p => boxes.push({ x: p.x - 6, y: p.y - 6, w: 12, h: 12 }));
  const dirs = [[1, -1], [1, 0], [1, 1], [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1]];
  let out = "";
  pts.slice().sort((a, b) => a.y - b.y).forEach(p => {
    const w = p.c.length * 7 + 10, h = 17;
    let best = null;
    for (const d of [10, 26, 42, 58, 76]) {
      for (const [dx, dy] of dirs) {
        const bx = dx > 0 ? p.x + d : dx < 0 ? p.x - d - w : p.x - w / 2, by = dy > 0 ? p.y + d : dy < 0 ? p.y - d - h : p.y - h / 2;
        const b = { x: bx, y: by, w, h };
        if (bx < area.x0 || by < area.y0 || bx + w > area.x1 || by + h > area.y1 || boxes.some(o => hit(b, o))) continue;
        best = { ...b, d }; break;
      }
      if (best) break;
    }
    if (!best) best = { x: Math.min(p.x + 10, area.x1 - w), y: Math.max(p.y - 10 - h, area.y0), w, h, d: 10 };   // 都擠滿了就放右上
    boxes.push(best);
    const lx = Math.max(best.x, Math.min(p.x, best.x + w)), ly = Math.max(best.y, Math.min(p.y, best.y + h));
    out += `<g pointer-events="none"><line x1="${p.x}" y1="${p.y}" x2="${lx}" y2="${ly}" stroke="var(--fg)" stroke-width="1"/><circle cx="${p.x}" cy="${p.y}" r="7" fill="none" stroke="var(--fg)" stroke-width="2"/>`
      + `<rect x="${best.x}" y="${best.y}" width="${w}" height="${h}" fill="var(--fg)"/><text x="${best.x + w / 2}" y="${best.y + 12.5}" text-anchor="middle" style="fill:var(--panel);font-weight:700;font-size:11px">${p.c}</text></g>`;
  });
  return out;
}

// 標註：表格勾選或點散布圖的點都走這裡；只重畫圖和表，不重算
function toggleMark(c) {
  marks.has(c) ? marks.delete(c) : marks.add(c);
  if (scState) { drawChart(scState.rows, scState.B); drawTable(scState.rows); }
}

// ── 走勢圖（標準化 B 階段，2026-11-20）：lineChart 畫格線、刻度、陰影、線；lineCursor 管游標；xZoom 管只橫向的縮放與拖曳。
// 空頭走勢圖、槓桿頁走勢圖都用這一套；新的走勢圖照用，不要再自己畫格線、游標（DESIGN「圖表規格」）。
// spec = {
//   W, m: { l, r, t }, bottom（底部日期列的高）, clip（clipPath 的 id）,
//   n（點數）, day: k => 第 k 點的日期（日數，同 D.dates）,
//   panels: [{ h, gap（和上一格的距離）, title（左上角的小標）, y: { log, lo, hi, ticks: [值], fmt, base（基準線的值） } }],   多格時上下共用 X 軸
//   series: [{ key, cls, parts: [{ p（第幾格）, v: [值或 null], col, w（線寬，沒給就不畫線）, area（往基準線填的顏色） }] }],
//   shade: [{ p, k0, k1, fill, opacity }]（畫在線底下，例如大跌段）
// }
// 回傳 state：{ W, m, n, day, sx, panels（各格 y0、y1、sy）, series }，給 lineCursor、xZoom 用
function lineChart(svg, s) {
  const { W, m, n } = s, sx = k => m.l + k / (n - 1 || 1) * (W - m.l - m.r);
  let y = m.t;
  const P = s.panels.map((p, j) => {
    if (j) y += p.gap || 0;
    const y0 = y, y1 = y + p.h, lg = p.y.log ? Math.log10 : v => v, lo = lg(p.y.lo), hi = lg(p.y.hi);
    y = y1;
    return { ...p, y0, y1, sy: v => y0 + (hi - lg(v)) / (hi - lo || 1) * p.h };
  });
  const bot = P[P.length - 1].y1, f1 = v => v.toFixed(1);
  let g = `<clipPath id="${s.clip}"><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${bot - m.t}"/></clipPath>`;
  // 陰影（大跌段）：超出畫面的部分夾在繪圖區內
  (s.shade || []).forEach(d => { const p = P[d.p], a = Math.min(Math.max(sx(d.k0), m.l), W - m.r), b = Math.min(Math.max(sx(d.k1), m.l), W - m.r);
    g += `<rect x="${a}" y="${p.y0}" width="${b - a}" height="${p.h}" fill="${d.fill}" fill-opacity="${d.opacity}"/>`; });
  // 橫的格線、刻度字、各格的小標；基準線（0 或 100）用細實線，畫在格線上面
  P.forEach(p => {
    const fmt = p.y.fmt || (v => v);
    p.y.ticks.forEach(v => { if (v !== p.y.base) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${p.sy(v)}" y2="${p.sy(v)}" stroke="${CHART.grid}"/>`; g += `<text x="${m.l - CHART.tickPad}" y="${p.sy(v) + 4}" text-anchor="end">${fmt(v)}</text>`; });
    if (p.title) g += `<text x="${m.l}" y="${p.y0 - 8}">${p.title}</text>`;
  });
  // 直的格線：期間 3 年以上標年份（超過 12 年隔年），以下標月份（最多約 12 條）；淡色實線，上下各格一起（JC 2026-11-20 決定 2）
  const fk = parseFloat(getComputedStyle(svg).getPropertyValue("--fk")) || 1, grid = timeGrid(n, s.day);
  let lastX = -Infinity;
  grid.forEach(t => { const x = sx(t.k);
    g += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${bot}" stroke="${CHART.grid}"/>`;
    const half = t.label.length * 3.4 * fk;   // 字寬的一半（約略）：太擠、或會超出繪圖區兩端的不寫字
    if (x - half >= m.l && x + half <= W - m.r && x - lastX >= half * 2 + 12 * fk) { g += `<text x="${x}" y="${bot + 22}" text-anchor="middle">${t.label}</text>`; lastX = x; } });
  if (!grid.length) for (let j = 0; j <= 4; j++) { const k = Math.round((n - 1) * j / 4); g += `<text x="${sx(k)}" y="${bot + 22}" text-anchor="${j === 0 ? "start" : j === 4 ? "end" : "middle"}">${ym(s.day(k))}</text>`; }   // 不到一個月：只寫頭尾和中間的年月
  P.forEach(p => { if (p.y.base != null && p.y.base >= Math.min(p.y.lo, p.y.hi) && p.y.base <= Math.max(p.y.lo, p.y.hi))
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${p.sy(p.y.base)}" y2="${p.sy(p.y.base)}" stroke="${CHART.base.stroke}" opacity="${CHART.base.opacity}"/>`; });
  // 線（每組一個 <g>，突顯、淡化以組為單位）；面積往基準線填
  s.series.forEach(se => {
    g += `<g class="${se.cls || ""}" data-s="${se.key}" clip-path="url(#${s.clip})">`;
    se.parts.forEach(pt => { const p = P[pt.p];
      if (pt.area) { const b = f1(p.sy(p.y.base)); g += `<path d="M${f1(sx(0))} ${b}${pt.v.map((v, k) => "L" + f1(sx(k)) + " " + f1(p.sy(v))).join("")}L${f1(sx(n - 1))} ${b}Z" fill="${pt.area}" opacity=".5"/>`; }
      if (pt.w) { let d = "", pen = false; pt.v.forEach((v, k) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + f1(sx(k)) + " " + f1(p.sy(v)); pen = true; });
        g += `<path d="${d}" fill="none" stroke="${pt.col}" stroke-width="${pt.w}" stroke-linejoin="round"/>`; } });
    g += `</g>`;
  });
  // 游標（放在最後才蓋在線上面）：豎線、各線的點、底部日期（DESIGN「走勢圖的懸浮框」的游標樣式）
  g += `<g data-cursor pointer-events="none" visibility="hidden"><line class="vl" y1="${m.t}" y2="${bot}" stroke="${CHART.cursor.stroke}" stroke-width="1" opacity="${CHART.cursor.opacity}"/><g class="dots"></g>`
    + `<rect class="db" y="${bot + 4}" height="18" rx="3" fill="var(--panel)" stroke="var(--line)"/><text class="hd" y="${bot + 17}" text-anchor="middle"></text></g>`;
  svg.innerHTML = g;
  return { W, m, n, day: s.day, sx, panels: P, series: s.series };
}
// 時間軸的直格線位置：k＝第幾點、label＝年份或年月
function timeGrid(n, day) {
  if (n < 2) return [];
  const yrs = (day(n - 1) - day(0)) / 365.25, out = [];
  if (yrs >= 3) { const st = yrs > 12 ? 2 : 1; for (let k = 1; k < n; k++) { const a = iso(day(k - 1)).slice(0, 4), b = iso(day(k)).slice(0, 4); if (a !== b && +b % st === 0) out.push({ k, label: b }); } return out; }
  const st = [1, 2, 3, 6].find(s => yrs * 12 / s <= 12) || 6;
  for (let k = 1; k < n; k++) { const a = iso(day(k - 1)).slice(0, 7), b = iso(day(k)).slice(0, 7); if (a !== b && (+b.slice(5) - 1) % st === 0) out.push({ k, label: b }); }
  return out;
}
// 走勢圖的游標：o.state()＝lineChart 回傳的 state（還沒畫就是 null）；o.focus(key)＝突顯那組（null＝全部恢復）；o.tip(k, key)＝懸浮框內容。
// 游標在哪一格就比哪一格的值，離哪條線 18 單位以內就突顯那條。頁面載入後對每張走勢圖呼叫一次
function lineCursor(svg, o) {
  const cur = () => svg.querySelector("[data-cursor]");
  const leave = () => { const c = cur(); if (c) c.setAttribute("visibility", "hidden"); o.focus(null); hideTip(); hoverClose(svg); };
  const move = e => {
    const S = o.state(); if (!S || svg.dataset.drag) return;
    const p = svgPt(svg, e), m = S.m; if (p.x < m.l || p.x > S.W - m.r) { leave(); return; }   // 繪圖區外（刻度區）收起
    const k = Math.max(0, Math.min(S.n - 1, Math.round((p.x - m.l) / (S.W - m.l - m.r) * (S.n - 1)))), x = S.sx(k);
    let pi = 0; S.panels.forEach((P, j) => { if (j && p.y >= (S.panels[j - 1].y1 + P.y0) / 2) pi = j; });   // 游標在哪一格：以兩格中間為界
    let near = null, best = 18;
    S.series.forEach(se => se.parts.forEach(pt => { const v = pt.v[k]; if (pt.p !== pi || v == null) return; const d = Math.abs(S.panels[pi].sy(v) - p.y); if (d < best) { best = d; near = se.key; } }));
    o.focus(near);
    const c = cur(); c.setAttribute("visibility", "visible");
    const vl = c.querySelector(".vl"); vl.setAttribute("x1", x); vl.setAttribute("x2", x);
    let dots = "";
    S.series.forEach(se => se.parts.forEach(pt => { const v = pt.v[k]; if (v == null) return;
      dots += `<circle cx="${x}" cy="${S.panels[pt.p].sy(v)}" r="${se.key === near ? 5 : 3.5}" fill="${pt.area || pt.col}" stroke="var(--panel)" stroke-width="1.5" opacity="${near == null || se.key === near ? 1 : .25}"/>`; }));
    c.querySelector(".dots").innerHTML = dots;
    // 底部日期：框寬照字寬（手機上字放大也裝得下），靠邊時夾在圖內
    const t = c.querySelector("text.hd"); t.textContent = iso(S.day(k));
    const bw = Math.ceil(t.getComputedTextLength()) + 16, dx = Math.min(Math.max(x, m.l + bw / 2), S.W - m.r - bw / 2);
    t.setAttribute("x", dx); const r = c.querySelector("rect.db"); r.setAttribute("x", dx - bw / 2); r.setAttribute("width", bw);
    tip.innerHTML = o.tip(k, near); tipAt(e); hoverOpen(svg, leave);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", e => { if (e.pointerType !== "touch") leave(); });   // 觸控：手指抬起不收，點圖外面或捲動才收（bindHoverDismiss）
  svg.addEventListener("pointerdown", e => { if (e.pointerType === "touch") move(e); });   // 觸控點一下就顯示
  svg._leave = leave;
}
// 只橫向的縮放與拖曳（走勢圖）：o.state()＝{ a, b（目前畫面頭尾在整段資料裡的位置）, max（整段最後一點）, m, W } 或 null；
// o.view(a, b)：設新範圍並重畫（a＝null 回到預設）。Ctrl（⌘）＋滾輪以游標為中心縮放；滑鼠拖曳移動，觸控不拖（留給捲動頁面）。回傳 { zoom, reset } 給縮放按鈕
function xZoom(svg, o) {
  let drag = null;
  const zoom = (f, c) => {
    const S = o.state(); if (!S) return; if (c == null) c = (S.a + S.b) / 2;
    const a = Math.max(0, Math.round(c - (c - S.a) * f)), b = Math.min(S.max, Math.round(c + (S.b - c) * f));
    if (b - a >= 10) o.view(a, b);
  };
  svg.addEventListener("wheel", e => {
    const S = o.state(); if (!(e.ctrlKey || e.metaKey) || !S) return; e.preventDefault();
    zoom(e.deltaY > 0 ? 1.25 : 0.8, S.a + (svgPt(svg, e).x - S.m.l) / (S.W - S.m.l - S.m.r) * (S.b - S.a));
  }, { passive: false });
  svg.addEventListener("pointerdown", e => { const S = o.state(); if (e.button !== 0 || e.pointerType === "touch" || !S) return; e.preventDefault();
    drag = { x: svgPt(svg, e).x, a: S.a, b: S.b }; svg.dataset.drag = "1"; try { svg.setPointerCapture(e.pointerId); } catch (err) {} });
  svg.addEventListener("pointermove", e => {
    if (!drag) return; const S = o.state(); if (!S) return;
    let di = Math.round(-(svgPt(svg, e).x - drag.x) / (S.W - S.m.l - S.m.r) * (drag.b - drag.a));
    di = Math.max(-drag.a, Math.min(S.max - drag.b, di)); if (!di) return;
    if (svg._leave) svg._leave(); o.view(drag.a + di, drag.b + di);
  });
  ["pointerup", "pointercancel"].forEach(t => svg.addEventListener(t, () => { drag = null; delete svg.dataset.drag; }));
  return { zoom: f => zoom(f), reset: () => o.view(null) };
}

// ── 空頭走勢圖：以基準高點那天＝100，各檔怎麼跌、怎麼回來
const epCol = (s, k) => s.x.c === BN ? "var(--fg)" : `var(${LINE_COLORS[(k - 1) % LINE_COLORS.length]})`;
function drawEpChart(ep) {
  const svg = $("epchart"), W = 900, H = 360, m = { l: 48, r: 16, t: 14 }, bottom = 32;
  // 顯示區間：預設是這次大跌前後各約一個月；手動選了起迄就用手動的（0% 基準仍是基準高點那天）
  const last = D.dates.length - 1;
  let i0 = Math.max(0, ep.pk - 20), i1 = Math.min(last, (ep.rec == null ? last : ep.rec) + 20);
  if (epView) { const a = Math.max(0, lastIdxLE(D.dates, toDay(epView.from))), b = lastIdxLE(D.dates, toDay(epView.to)); if (b > a + 5) { i0 = a; i1 = b; } }
  $("epFrom").value = iso(D.dates[i0]); $("epTo").value = iso(D.dates[i1]); syncRange("eS", "eE", "epfill", i0, i1);
  const sel = [BN, ...[...picks].filter(c => c !== BN)].map(c => D.etfs.find(x => x.c === c)).filter(x => x && x.p[ep.pk] != null);
  let lo = 100, hi = 100;
  const series = sel.map(x => { const v = []; for (let i = i0; i <= i1; i++) v.push(x.p[i] == null ? null : x.p[i] / x.p[ep.pk] * 100); v.forEach(y => { if (y != null) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }); return { x, v }; });
  lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
  const step = (hi - lo) > 120 ? 40 : (hi - lo) > 60 ? 20 : 10, ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
  const S = lineChart(svg, { W, m, bottom, clip: "epClip", n: i1 - i0 + 1, day: k => D.dates[i0 + k],
    panels: [{ h: H - m.t - bottom, y: { lo, hi, ticks, base: 100 } }],
    shade: [{ p: 0, k0: ep.pk - i0, k1: ep.tr - i0, fill: "var(--dn)", opacity: crashAlpha(ep.depth, .1, .3, computeEps().th) }],
    series: series.map((s, k) => ({ key: k, cls: "epl", parts: [{ p: 0, v: s.v, col: epCol(s, k), w: s.x.c === BN ? 2.6 : 1.6 }] })) });
  $("eplegend").innerHTML = series.map((s, k) => `<span data-s="${k}"><span class="swatch" style="--c:${epCol(s, k)}"></span>${s.x.c} ${s.x.n}</span>`).join("");
  epState = { ...S, i0, i1, epSeries: series, ep };
}
// 空頭走勢圖的懸浮框：日期和各檔相對基準高點那天的漲跌，高的在上
function epTip(k, near) {
  const S = epState, label = iso(D.dates[S.i0 + k]), lines = [];
  S.epSeries.forEach((s, j) => { const v = s.v[k]; if (v != null) lines.push({ c: s.x.c, n: s.x.n, v, col: epCol(s, j), on: j === near }); });
  lines.sort((a, b) => b.v - a.v);
  const bv = (lines.find(l => l.c === BN) || {}).v;   // 顏色看「這檔 − 基準」：正數＝這時候比基準好（全站上色原則）；數字照舊是這檔自己的漲跌
  return `<strong>${label}</strong>（相對 ${iso(D.dates[S.ep.pk])} 高點）<br>` + lines.map(l => tipRow(near == null ? "" : l.on ? "ep-on" : "ep-dim", l.col, `${l.c} ${l.n}`, [[bv == null || l.c === BN ? "" : ud((l.v - bv) / 100), pct(l.v / 100 - 1)]])).join("<br>");
}
// 頁面載入後呼叫一次：空頭走勢圖的游標
function bindEpCursor() { lineCursor($("epchart"), { state: () => epState, focus: epFocus, tip: epTip }); }
// 懸浮框的一列：色票＋名稱＋數字格；state 是 ep-on（突顯）／ep-dim（淡化）／空字串；cells 每格 [上色 class, 文字, 前綴]（空頭、槓桿頁走勢圖共用）
function tipRow(state, col, label, cells) {
  return `<span class="${state}"><span class="swatch" style="--c:${col}"></span> ${label}` + cells.map(([cls, txt, pre]) => `　${pre || ""}<span class="${cls}" style="font-family:var(--f-num)">${txt}</span>`).join("") + "</span>";
}
// 目前開著懸浮框的走勢圖（el）和收起它的方法（leave）。觸控時「點圖外面收起」、捲動時連十字線一起收，都靠這個，新的走勢圖照用 hoverOpen／hoverClose 就好
let hoverOwner = null;
function hoverOpen(el, leave) { if (hoverOwner && hoverOwner.el !== el) hoverOwner.leave(); hoverOwner = { el, leave }; }
function hoverClose(el) { if (hoverOwner && hoverOwner.el === el) hoverOwner = null; }
const inHover = t => !!(hoverOwner && t && hoverOwner.el.contains(t));   // 點在開著懸浮框的圖上：頁面的 click 監聽不收說明框
// 頁面載入後呼叫一次：觸控點到別處收起；捲動收起（全站的 scroll 只收說明框，十字線、淡化會留著）
function bindHoverDismiss() {
  document.addEventListener("pointerdown", e => { if (e.pointerType === "touch" && hoverOwner && !hoverOwner.el.contains(e.target)) hoverOwner.leave(); });
  document.addEventListener("scroll", () => { if (hoverOwner) hoverOwner.leave(); }, { passive: true, capture: true });
}
// 走勢圖的懸浮框：放在游標右邊（放不下就放左邊），上下置中、不超出視窗。內容先寫進 tip.innerHTML（空頭、槓桿頁走勢圖共用）
function tipAt(e) {
  clearTimeout(hideTip.t);   // 剛離開某個說明元素時 hideSoon 排了收起，不清掉懸浮框會被收走（稽核 2026-11-17）
  if (tipFor) { tipFor.removeAttribute("aria-describedby"); tipFor = null; }   // 說明框改給走勢圖用，原本的元素不再指向它
  tip.style.maxWidth = Math.min(300, innerWidth - 24) + "px";   // 和 showTip 同一個上限，寬度才不看先前開過什麼
  tip.hidden = false;
  const w = tip.getBoundingClientRect().width, h = tip.getBoundingClientRect().height;
  tip.style.left = (e.clientX + 16 + w > innerWidth - 8 ? e.clientX - w - 16 : e.clientX + 16) + "px";
  tip.style.top = Math.min(Math.max(8, e.clientY - h / 2), innerHeight - h - 8) + "px";
}
function epFocus(k) {
  const on = el => k != null && +el.dataset.s === k, dim = el => k != null && +el.dataset.s !== k;
  document.querySelectorAll("#epchart .epl, #eplegend [data-s]").forEach(el => { el.classList.toggle("on", on(el)); el.classList.toggle("dim", dim(el)); });
  const f = k != null && document.querySelector(`#epchart .epl[data-s="${k}"]`); if (f) $("epchart").insertBefore(f, $("epchart").querySelector("[data-cursor]"));   // 移到其他線上面
}
function epLeave() { const l = $("epchart")._leave; if (l) l(); }
// 空頭走勢圖的縮放與拖曳：只橫向（日期範圍 epView），做法在 xZoom
function bindEpZoom() {
  return xZoom($("epchart"), { state: () => epState && { a: epState.i0, b: epState.i1, max: D.dates.length - 1, m: epState.m, W: epState.W },
    view: (a, b) => { epView = a == null ? null : { from: iso(D.dates[a]), to: iso(D.dates[b]) }; if (epState) drawEpChart(epState.ep); } });
}
