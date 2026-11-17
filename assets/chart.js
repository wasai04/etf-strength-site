// 兩頁共用的圖表程式（2026-11-17 起，共用元件重構第三階段；DESIGN.md「共用檔」「圖表規格」）。
// 通用的：svgPt、clampSc、panZoom（散布圖縮放拖曳）、zoomButtons。
// 兩頁同結構的：總覽散布圖 drawChart／markLabels／toggleMark、空頭走勢圖 drawEpChart／epHover／epFocus／epLeave／epZoom／bindEpZoom。
//   這些直接用頁面的全域變數與函式（D、BN、marks、picks、scState、scView、epState、epView、epDrag、tip、hideTip、LINE_COLORS、CAT_NAME、colorOf、
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
// o.view(v)：設新範圍並重畫（null＝回到預設範圍）；o.late：點本身有說明的圖，拖動超過 3px 才鎖定指標（點一下照常開說明）；
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
  return { zoom: f => zoom(f), reset: () => { if (o.state()) o.view(null); } };
}
// 縮放按鈕：data-zc="圖:in／out／reset"，圖的代號對應 h 裡的 { zoom, reset }
function zoomButtons(h) {
  document.querySelectorAll("[data-zc]").forEach(b => b.onclick = () => {
    const [t, a] = b.dataset.zc.split(":"), z = h[t]; if (!z) return;
    if (a === "reset") z.reset(); else z.zoom(a === "in" ? 0.8 : 1.25);
  });
}

// ── 總覽散布圖
function drawChart(rows, B) {
  const svg = $("chart"), Wd = 900, H = 420, m = { l: 56, r: 16, t: 14, b: 40 };
  if (!rows.length) { scState = null; svg.innerHTML = `<text x="450" y="210" text-anchor="middle">沒有符合篩選的 ETF</text>`; return; }   // scState 清掉：縮放、拖曳才不會拿上一輪的點重畫
  const xs = rows.map(r => r.m.mdd), ys = rows.map(r => r.m.cagr);
  // 預設範圍包住所有點；縮放／拖曳後用 scView 的範圍（換期間或篩選不重設，按「重設」才回預設）
  const base0 = { x0: Math.min(-0.1, Math.floor(Math.min(...xs, B.mdd) * 10) / 10), x1: 0,
    y0: Math.floor(Math.min(...ys, B.cagr, 0) * 10) / 10, y1: Math.ceil(Math.max(...ys, B.cagr, 0.1) * 10) / 10 };
  if (scView) scView = clampSc(scView, base0);
  const { x0, x1, y0, y1 } = scView || base0;
  const sx = v => m.l + (v - x0) / (x1 - x0) * (Wd - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  scState = { rows, B, base0, x0, x1, y0, y1, m, Wd, H };
  const nice = r => [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].find(s => r / s <= 8) || 1;
  const xstep = nice(x1 - x0), ystep = nice(y1 - y0);
  let g = `<clipPath id="scClip"><rect x="${m.l}" y="${m.t}" width="${Wd - m.l - m.r}" height="${H - m.t - m.b}"/></clipPath>`;
  for (let v = Math.ceil(y0 / ystep - 1e-9) * ystep; v <= y1 + 1e-9; v += ystep)
    g += `<line x1="${m.l}" x2="${Wd - m.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${sy(v) + 4}" text-anchor="end">${pct(v, 0)}</text>`;
  for (let v = Math.ceil(x0 / xstep - 1e-9) * xstep; v <= x1 + 1e-9; v += xstep)
    g += `<line y1="${m.t}" y2="${H - m.b}" x1="${sx(v)}" x2="${sx(v)}" stroke="var(--line)"/><text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle">${pct(v, 0)}</text>`;
  g += `<text x="${(m.l + Wd - m.r) / 2}" y="${H - 6}" text-anchor="middle">最大回撤</text><text transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">年化報酬</text>`;
  g += `<g clip-path="url(#scClip)"><rect x="${sx(B.mdd)}" y="${sy(y1 + 10)}" width="${Math.max(0, sx(x1 + 10) - sx(B.mdd))}" height="${Math.max(0, sy(B.cagr) - sy(y1 + 10))}" fill="var(--quad)"/>`;
  const negB = !(B.rr > 0);   // 基準年化 ≤ 0：划算線改成基準回撤這條直線，畫成綠色
  $("negnote").hidden = !negB;
  let refL = `<line x1="${sx(B.mdd)}" x2="${sx(B.mdd)}" y1="${m.t}" y2="${H - m.b}" stroke="${negB ? "var(--calmar)" : "var(--fg)"}" stroke-dasharray="${negB ? "6 5" : "4 4"}" stroke-width="${negB ? 1.6 : 1}" opacity="${negB ? 1 : .55}"/><line x1="${m.l}" x2="${Wd - m.r}" y1="${sy(B.cagr)}" y2="${sy(B.cagr)}" stroke="var(--fg)" stroke-dasharray="4 4" opacity=".55"/>`;
  // 和基準一樣划算的線：年化 = 基準的報酬／回撤 × 回撤幅度；線上方比基準划算
  if (B.rr > 0) {
    refL += `<line x1="${sx(-2)}" y1="${sy(B.rr * 2)}" x2="${sx(0)}" y2="${sy(0)}" stroke="var(--calmar)" stroke-dasharray="6 5" stroke-width="1.4"/>`;
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
    const tipText = `${r.x.c} ${r.x.n}｜${isB ? "標竿" : CAT_NAME(r.cat)}${ch ? `（預設：${CAT_NAME(r.def)}）` : ""}${tags ? `｜${tags}` : ""}&#10;年化 ${pct(r.m.cagr)}&#10;最大回撤 ${pct(r.m.mdd)}${isB ? "" : `&#10;上市以來 vs ${BN} ${r.life == null ? "—" : sgn(r.life)}`}`;
    const cx = sx(r.m.mdd), cy = sy(r.m.cagr);
    if (ch && !isB) g += `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`;
    g += isB
      ? `<circle cx="${cx}" cy="${cy}" r="8" fill="var(--fg)"/><circle cx="${cx}" cy="${cy}" r="5.5" fill="var(--panel)"/><circle cx="${cx}" cy="${cy}" r="3" fill="var(--fg)"/><circle cx="${cx}" cy="${cy}" r="9" fill="transparent" data-c="${r.x.c}" data-tip="${tipText}"></circle>`
      : hollow
      ? `<circle cx="${cx}" cy="${cy}" r="4.5" fill="var(--panel)" stroke="${colorOf(r.cat)}" stroke-width="2" data-c="${r.x.c}" data-tip="${tipText}"></circle>`
      : `<circle cx="${cx}" cy="${cy}" r="5" fill="${colorOf(r.cat)}" fill-opacity=".85" data-c="${r.x.c}" data-tip="${tipText}"></circle>`;
  });
  g += `</g>`;
  // 參考線（基準的十字虛線、划算線）畫在點的上面，底下墊同寬的背景色線（DESIGN「圖表規格」，2026-11-17）；不接滑鼠
  g += `<g clip-path="url(#scClip)" pointer-events="none">${refL.replace(/ stroke-dasharray="[^"]*"| opacity="[^"]*"/g, "").replace(/stroke="[^"]*"/g, 'stroke="var(--panel)"')}${refL}</g>`;
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

// ── 空頭走勢圖
function drawEpChart(ep) {
  const svg = $("epchart"), Wd = 900, H = 360, m = { l: 48, r: 16, t: 14, b: 32 };
  // 顯示區間：預設是這次大跌前後各約一個月；手動選了起迄就用手動的（0% 基準仍是基準高點那天）
  const last = D.dates.length - 1;
  let i0 = Math.max(0, ep.pk - 20), i1 = Math.min(last, (ep.rec == null ? last : ep.rec) + 20);
  if (epView) { const a = Math.max(0, lastIdxLE(D.dates, toDay(epView.from))), b = lastIdxLE(D.dates, toDay(epView.to)); if (b > a + 5) { i0 = a; i1 = b; } }
  $("epFrom").value = iso(D.dates[i0]); $("epTo").value = iso(D.dates[i1]); syncRange("eS", "eE", "epfill", i0, i1);
  const sel = [BN, ...[...picks].filter(c => c !== BN)].map(c => D.etfs.find(x => x.c === c)).filter(x => x && x.p[ep.pk] != null);
  let lo = 100, hi = 100;
  const series = sel.map(x => { const v = []; for (let i = i0; i <= i1; i++) v.push(x.p[i] == null ? null : x.p[i] / x.p[ep.pk] * 100); v.forEach(y => { if (y != null) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }); return { x, v }; });
  lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
  const sx = i => m.l + (i - i0) / (i1 - i0) * (Wd - m.l - m.r), sy = v => H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b);
  const bx0 = Math.min(Math.max(sx(ep.pk), m.l), Wd - m.r), bx1 = Math.min(Math.max(sx(ep.tr), m.l), Wd - m.r);
  let g = `<rect x="${bx0}" y="${m.t}" width="${bx1 - bx0}" height="${H - m.t - m.b}" fill="var(--dn)" fill-opacity="${crashAlpha(ep.depth, .1, .3)}"/>`;
  const step = (hi - lo) > 120 ? 40 : (hi - lo) > 60 ? 20 : 10;
  for (let v = lo; v <= hi; v += step) g += `<line x1="${m.l}" x2="${Wd - m.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
  g += `<line x1="${m.l}" x2="${Wd - m.r}" y1="${sy(100)}" y2="${sy(100)}" stroke="var(--fg)" stroke-dasharray="3 4" opacity=".5"/>`;
  const nTicks = 5; for (let k = 0; k <= nTicks; k++) { const i = Math.round(i0 + (i1 - i0) * k / nTicks); g += `<text x="${sx(i)}" y="${H - 10}" text-anchor="${k === 0 ? "start" : k === nTicks ? "end" : "middle"}">${ym(D.dates[i])}</text>`; }
  const leg = [];
  series.forEach((s, k) => {
    const col = s.x.c === BN ? "var(--fg)" : `var(${LINE_COLORS[(k - 1) % LINE_COLORS.length]})`;
    let d = "", pen = false; s.v.forEach((y, j) => { if (y == null) { pen = false; return; } d += (pen ? "L" : "M") + sx(i0 + j).toFixed(1) + " " + sy(y).toFixed(1); pen = true; });
    g += `<path class="epl" data-s="${k}" d="${d}" fill="none" stroke="${col}" stroke-width="${s.x.c === BN ? 2.6 : 1.6}" stroke-linejoin="round"/>`;
    leg.push(`<span data-s="${k}"><span class="swatch" style="--c:${col}"></span>${s.x.c} ${s.x.n}</span>`);
  });
  // 游標對準的那一天：直線、各線的點、底部日期（放在最後才會蓋在線上面）
  g += `<g id="ephover" visibility="hidden"><line id="ephl" y1="${m.t}" y2="${H - m.b}" stroke="var(--fg)" stroke-width="1" opacity=".6"/><g id="ephdots"></g><rect id="ephbg" y="${H - m.b + 4}" height="18" rx="3" fill="var(--panel)" stroke="var(--line)"/><text id="ephd" class="hd" y="${H - m.b + 17}" text-anchor="middle"></text></g>`;
  svg.innerHTML = g;
  $("eplegend").innerHTML = leg.join("");
  epState = { i0, i1, sx, sy, series, m, Wd, H, ep };
}
// 走勢圖的游標互動：對準最近的交易日，顯示日期和各檔相對基準高點那天的漲跌
function epHover(e) {
  if (!epState || epDrag) return;
  const svg = $("epchart"), S = epState, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  if (p.x < S.m.l || p.x > S.Wd - S.m.r) { epLeave(); return; }
  const i = Math.max(S.i0, Math.min(S.i1, Math.round(S.i0 + (p.x - S.m.l) / (S.Wd - S.m.l - S.m.r) * (S.i1 - S.i0)))), j = i - S.i0, x = S.sx(i);
  $("ephover").setAttribute("visibility", "visible");
  $("ephl").setAttribute("x1", x); $("ephl").setAttribute("x2", x);
  const label = iso(D.dates[i]); $("ephd").textContent = label; $("ephd").setAttribute("x", Math.min(Math.max(x, S.m.l + 40), S.Wd - S.m.r - 40));
  $("ephbg").setAttribute("x", +$("ephd").getAttribute("x") - 40); $("ephbg").setAttribute("width", 80);
  // 游標上下離哪條線最近（18 單位以內）就突顯那條，其他變淡
  let near = null, best = 18;
  S.series.forEach((s, k) => { const v = s.v[j]; if (v != null && Math.abs(S.sy(v) - p.y) < best) { best = Math.abs(S.sy(v) - p.y); near = k; } });
  epFocus(near);
  const lines = []; let dots = "";
  S.series.forEach((s, k) => {
    const v = s.v[j]; if (v == null) return;
    const col = s.x.c === BN ? "var(--fg)" : `var(${LINE_COLORS[(k - 1) % LINE_COLORS.length]})`;
    dots += `<circle cx="${x}" cy="${S.sy(v)}" r="${k === near ? 5 : 3.5}" fill="${col}" stroke="var(--panel)" stroke-width="1.5" opacity="${near == null || k === near ? 1 : .25}"/>`;
    lines.push({ c: s.x.c, n: s.x.n, v, col, on: k === near });
  });
  $("ephdots").innerHTML = dots;
  lines.sort((a, b) => b.v - a.v);
  const bv = (lines.find(l => l.c === BN) || {}).v;   // 顏色看「這檔 − 基準」：正數＝這時候比基準好（全站上色原則）；數字照舊是這檔自己的漲跌
  tip.innerHTML = `<strong>${label}</strong>（相對 ${iso(D.dates[S.ep.pk])} 高點）<br>` + lines.map(l => `<span class="${near == null ? "" : l.on ? "ep-on" : "ep-dim"}"><span class="swatch" style="--c:${l.col}"></span> ${l.c} ${l.n}　<span class="${bv == null || l.c === BN ? "" : ud((l.v - bv) / 100)}" style="font-family:var(--f-num)">${pct(l.v / 100 - 1)}</span></span>`).join("<br>");
  tipAt(e);
}
// 走勢圖的懸浮框：放在游標右邊（放不下就放左邊），上下置中、不超出視窗。內容先寫進 tip.innerHTML（空頭、槓桿頁走勢圖共用）
function tipAt(e) {
  clearTimeout(hideTip.t);   // 剛離開某個說明元素時 hideSoon 排了收起，不清掉懸浮框會被收走（稽核 2026-11-17）
  tip.style.maxWidth = Math.min(300, innerWidth - 24) + "px";   // 和 showTip 同一個上限，寬度才不看先前開過什麼
  tip.hidden = false;
  const w = tip.getBoundingClientRect().width, h = tip.getBoundingClientRect().height;
  tip.style.left = (e.clientX + 16 + w > innerWidth - 8 ? e.clientX - w - 16 : e.clientX + 16) + "px";
  tip.style.top = Math.min(Math.max(8, e.clientY - h / 2), innerHeight - h - 8) + "px";
}
function epFocus(k) {
  const on = el => k != null && +el.dataset.s === k, dim = el => k != null && +el.dataset.s !== k;
  document.querySelectorAll("#epchart .epl, #eplegend [data-s]").forEach(el => { el.classList.toggle("on", on(el)); el.classList.toggle("dim", dim(el)); });
  const f = k != null && document.querySelector(`#epchart .epl[data-s="${k}"]`); if (f) $("epchart").insertBefore(f, $("ephover"));   // 移到其他線上面
}
function epLeave() { const g = $("ephover"); if (g) g.setAttribute("visibility", "hidden"); epFocus(null); hideTip(); }
function epZoom(f, ci) {
  const S = epState; if (!S) return;
  const last = D.dates.length - 1; if (ci == null) ci = (S.i0 + S.i1) / 2;
  const a = Math.max(0, Math.round(ci - (ci - S.i0) * f)), b = Math.min(last, Math.round(ci + (S.i1 - ci) * f));
  if (b - a < 10) return;
  epView = { from: iso(D.dates[a]), to: iso(D.dates[b]) }; drawEpChart(S.ep);
}
// 空頭走勢圖的縮放與拖曳：只橫向（日期範圍 epView）；觸控不拖，留給捲動頁面
function bindEpZoom() {
  const ec = $("epchart");
  ec.addEventListener("wheel", e => {
    if (!(e.ctrlKey || e.metaKey) || !epState) return; e.preventDefault();
    const S = epState, p = svgPt(ec, e);
    epZoom(e.deltaY > 0 ? 1.25 : 0.8, S.i0 + (p.x - S.m.l) / (S.Wd - S.m.l - S.m.r) * (S.i1 - S.i0));
  }, { passive: false });
  ec.addEventListener("pointerdown", e => { if (e.button !== 0 || e.pointerType === "touch" || !epState) return; e.preventDefault(); epDrag = { x: svgPt(ec, e).x, i0: epState.i0, i1: epState.i1 }; ec.setPointerCapture(e.pointerId); });
  ec.addEventListener("pointermove", e => {
    if (!epDrag) return; const S = epState, last = D.dates.length - 1;
    let di = Math.round(-(svgPt(ec, e).x - epDrag.x) / (S.Wd - S.m.l - S.m.r) * (epDrag.i1 - epDrag.i0));
    di = Math.max(-epDrag.i0, Math.min(last - epDrag.i1, di)); if (!di) return; epLeave();
    epView = { from: iso(D.dates[epDrag.i0 + di]), to: iso(D.dates[epDrag.i1 + di]) }; drawEpChart(S.ep);
  });
  ["pointerup", "pointercancel"].forEach(t => ec.addEventListener(t, () => { epDrag = null; }));
  return { zoom: f => epZoom(f), reset: () => { epView = null; if (epState) drawEpChart(epState.ep); } };
}
