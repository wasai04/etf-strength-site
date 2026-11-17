// 兩頁共用的計算核心（2026-11-17 起，共用元件重構第二階段；DESIGN.md「共用檔」）。
// 不碰 DOM，可用 Node 單獨測。註解裡的「基準」：台股頁是 0050，美股頁是各分區的基準。
// 改了這個檔：把兩頁 <script src> 的 ?v= 換成當天日期，並重跑分類比對（DESIGN.md「計算核心與驗證」）。
// 頁面的一般 <script> 直接用這裡的全域函式與常數（DAY、metrics、classify、episodes…），所以要在頁面主程式之前載入。

// 計算核心（不碰 DOM）：算法對應資料腳本的 window_metrics()、label()
const DAY = 864e5;
function friKey(d) { const dow = (d + 4) % 7; return d + ((5 - dow + 7) % 7); }   // d：1970-01-01 起的日數；回傳當週週五
function lastIdxLE(dates, d) { let lo = 0, hi = dates.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function weekly(p, dates, s, e) {
  const lab = [], val = [p[s]];
  for (let i = s + 1; i <= e; i++) {
    const k = friKey(dates[i]);
    if (lab.length && lab[lab.length - 1] === k) val[val.length - 1] = p[i]; else { lab.push(k); val.push(p[i]); }
  }
  const r = []; for (let i = 1; i < val.length; i++) r.push(val[i] / val[i - 1] - 1);
  return { lab, r };
}
function xirr(days, flows) {
  const t = days.map(d => (d - days[0]) / 365.25);
  const npv = r => flows.reduce((a, f, i) => a + f / Math.pow(1 + r, t[i]), 0);
  let lo = -0.99, hi = 10, flo = npv(lo); if (flo * npv(hi) > 0) return null;
  // 二分到區間小於 1e-10 就停（約 37 次），結果和跑滿 200 次在顯示精度上相同
  while (hi - lo > 1e-10) { const m = (lo + hi) / 2, fm = npv(m); if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; } }
  return (lo + hi) / 2;
}
function regress(y, x) {
  const n = y.length; if (n <= 20) return null;
  const my = y.reduce((a, b) => a + b, 0) / n, mx = x.reduce((a, b) => a + b, 0) / n;
  let cxy = 0, cxx = 0, cyy = 0;
  for (let i = 0; i < n; i++) { cxy += (y[i] - my) * (x[i] - mx); cxx += (x[i] - mx) ** 2; cyy += (y[i] - my) ** 2; }
  return { beta: cxy / cxx, r2: cxy * cxy / (cxx * cyy) };
}
// 一檔在 [s, e] 的指標；上市晚於起點超過 7 天的回傳 null
function metrics(p, D, s, e, cache) {
  const dates = D.dates;
  let s0 = s;
  if (p[s] == null) { s0 = -1; for (let i = s + 1; i <= e; i++) if (p[i] != null) { s0 = i; break; } if (s0 < 0 || dates[s0] - dates[s] > 7) return null; }
  const years = (dates[e] - dates[s0]) / 365.25, tot = p[e] / p[s0];
  const cagr = Math.pow(tot, 1 / years) - 1;
  const bd = [dates[s0]]; let units = 1 / p[s0];
  let lastM = new Date(dates[s0] * DAY).getUTCFullYear() * 12 + new Date(dates[s0] * DAY).getUTCMonth();
  for (let i = s0 + 1; i <= e; i++) { const dt = new Date(dates[i] * DAY), m = dt.getUTCFullYear() * 12 + dt.getUTCMonth(); if (m !== lastM) { lastM = m; bd.push(dates[i]); units += 1 / p[i]; } }
  const dca = xirr([...bd, dates[e]], [...bd.map(() => -1), units * p[e]]);
  let peak = p[s0], mdd = 0, trough = s0;
  for (let i = s0; i <= e; i++) { if (p[i] > peak) peak = p[i]; const dd = p[i] / peak - 1; if (dd < mdd) { mdd = dd; trough = i; } }
  let pk = s0; for (let i = s0; i <= trough; i++) if (p[i] > p[pk]) pk = i;
  let rec = null; for (let i = trough; i <= e; i++) if (p[i] >= p[pk]) { rec = Math.round((dates[i] - dates[pk]) / 30.44 * 10) / 10; break; }
  const w = weekly(p, dates, s0, e);
  const key = s0 + ":" + e;
  if (!cache[key]) cache[key] = { b: weekly(D.bench_p, dates, s0, e), m: weekly(D.market_p, dates, s0, e), btot: D.bench_p[e] / D.bench_p[s0] };
  const bw = cache[key].b, mw = cache[key].m;
  const rb = regress(w.r, bw.r), rm = regress(w.r, mw.r);
  // 波動倍數：這檔週報酬的標準差 ÷ 基準同幾週的標準差（漲跌幅度是基準的幾倍；不像 beta 會被「和基準走勢像不像」拉低）
  const sd = a => { const n = a.length, mu = a.reduce((x, y) => x + y, 0) / n; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / (n - 1)); };
  const vr = w.r.length > 20 ? sd(w.r) / sd(bw.r) : null;
  let up = null, dn = null;
  if (rm) { let su = 0, nu = 0, sx = 0, sd = 0, nd = 0, sxd = 0; mw.r.forEach((x, i) => { if (x > 0) { su += w.r[i]; sx += x; nu++; } else if (x < 0) { sd += w.r[i]; sxd += x; nd++; } }); up = (su / nu) / (sx / nu); dn = (sd / nd) / (sxd / nd); }
  return { s0, years, tot, cagr, dca, mdd, rec, rr: mdd < 0 ? cagr / -mdd : null, wr: w.r, bwr: bw.r, btot: cache[key].btot,
    beta: rb && rb.beta, vr, bm: rm && rm.beta, r2: rm && rm.r2, up, dn };
}
// 爆發段：連續 n 週累積 ≥ th，從前往後找、不重疊
function segments(r, n, th) { const sel = []; let i = 0; while (i + n <= r.length) { let m = 1; for (let k = i; k < i + n; k++) m *= 1 + r[k]; if (m - 1 >= th) { for (let k = i; k < i + n; k++) sel.push(k); i += n; } else i += 1; } return sel; }
// 類別：年化相差 ±tie 內「而且」最大回撤相差 ±nearDd 內＝接近基準；其餘用基準報酬線（高或低）和划算線（Calmar 比率＝年化 ÷ 最大回撤幅度和基準相同）切成四類；基準年化 ≤ 0 時改用回撤深淺
// 靠爆發（標記）：贏基準超過 tie，但拿掉爆發段、基準也拿掉同幾週後不贏
function classify(m, B, P) {
  const sel = segments(m.wr, P.weeks, P.burst);
  let pe = 1, pb = 1; for (const k of sel) { pe *= 1 + m.wr[k]; pb *= 1 + m.bwr[k]; }
  const ex = Math.pow(m.tot / pe, 1 / m.years) - 1, bex = Math.pow(m.btot / pb, 1 / m.years) - 1;
  const nb = sel.length / P.weeks, burst = m.cagr - B.cagr > P.tie && ex <= bex;
  let cat;
  if (Math.abs(m.cagr - B.cagr) <= P.tie && Math.abs(m.mdd - B.mdd) <= P.nearDd) cat = "約等於0050";
  else {
    const above = B.cagr > 0 ? m.cagr * -B.mdd >= B.cagr * -m.mdd : m.mdd >= B.mdd;
    cat = m.cagr > B.cagr ? (above ? "穩強" : "猛強") : (above ? "穩但不強" : "弱");
  }
  return { cat, nb, ex, bex, burst };
}
// 空頭驗證（每檔一個值、不分期間）：上市以來（最早資料起點）經歷過已回到高點的大空頭（eps），且年化不輸基準超過 tie
function lifeCheck(p, D) {
  const f = p.findIndex(v => v != null), e = D.dates.length - 1;
  if (f < 0 || e - f < 30) return null;
  const c = {}, m = metrics(p, D, f, e, c), b = metrics(D.bench_p, D, f, e, c);
  return m && b ? { f, diff: m.cagr - b.cagr } : null;
}
const verified = (L, eps, tie) => !!L && L.diff >= -tie && eps.some(ep => ep.rec != null && L.f <= ep.pk);
function windowIdx(D, startDay, endDay) { return { s: lastIdxLE(D.dates, startDay), e: lastIdxLE(D.dates, endDay) }; }
function presetStart(D, endIdx, n) { const d = new Date(D.dates[endIdx] * DAY); d.setUTCFullYear(d.getUTCFullYear() - n); return Math.round(d.getTime() / DAY); }
// 基準的大跌：從高點跌超過 th、之後回到高點（最後一次可能還沒回到）
function episodes(D, th) {
  const p = D.bench_p, out = []; let pk = 0, tr = 0, inDD = false;
  for (let i = 0; i < p.length; i++) {
    if (p[i] >= p[pk]) { if (inDD && p[tr] / p[pk] - 1 <= -th) out.push({ pk, tr, rec: i, depth: p[tr] / p[pk] - 1 }); pk = i; inDD = false; }
    else { if (!inDD || p[i] < p[tr]) tr = i; inDD = true; }
  }
  if (inDD && p[tr] / p[pk] - 1 <= -th) out.push({ pk, tr, rec: null, depth: p[tr] / p[pk] - 1 });
  return out;
}
// 一檔在某次大跌的表現：基準高點那天還沒上市＝null。dd＝基準高點到基準回到高點之間，這檔的最大跌幅（從基準高點那天的價格起算）
function epStats(p, ep, D) {
  if (p[ep.pk] == null) return null;
  const end = ep.rec == null ? p.length - 1 : ep.rec;
  let peak = p[ep.pk], dd = 0, tr = ep.pk;
  for (let i = ep.pk; i <= end; i++) { if (p[i] > peak) peak = p[i]; const d = p[i] / peak - 1; if (d < dd) { dd = d; tr = i; } }
  let pk = ep.pk; for (let i = ep.pk; i <= tr; i++) if (p[i] > p[pk]) pk = i;
  let rec = null; for (let i = tr; i < p.length; i++) if (p[i] >= p[pk]) { rec = Math.round((D.dates[i] - D.dates[pk]) / 30.44 * 10) / 10; break; }
  return { dd, rec };
}
// 和基準交叉：從基準高點那天起算兩邊的累計報酬。基準低點那天這檔領先（lead）→ 找基準追上的日子；
// 落後 → 找這檔追上基準的日子。追上後要連續 hold 個交易日維持（資料到底不足 hold 天也算）。idx＝null 表示到資料截止還沒發生
function epCross(p, ep, D, hold = 20) {
  const b = D.bench_p; if (p[ep.pk] == null) return null;
  const r = i => (p[i] / p[ep.pk]) / (b[i] / b[ep.pk]);
  if (Math.abs(r(ep.tr) - 1) < 0.01) return { tie: true, idx: null };   // 低點那天差不到 1%（例：追蹤同一指數），視為同步
  const lead = r(ep.tr) > 1, last = b.length - 1;
  let start = -1;
  for (let i = ep.tr; i <= last; i++) {
    const ok = lead ? r(i) <= 1 : r(i) >= 1;
    if (!ok) { start = -1; continue; }
    if (start < 0) start = i;
    if (i - start + 1 >= hold || i === last) return { lead, idx: start };
  }
  return { lead, idx: null };
}
if (typeof module !== "undefined") module.exports = { metrics, classify, lifeCheck, verified, segments, windowIdx, presetStart, lastIdxLE, episodes, epStats, epCross };

// 資料檔的價格整數差值還原（enc: "d1"；DESIGN.md「載入加速」）：每檔乘 10^pk 存差值，這裡累加後除回去。沒有 pk 的舊格式不動
function decP(o) { if (o.pk == null) return; const sc = 10 ** o.pk; let a = 0; o.p = o.p.map(v => v == null ? null : (a += v) / sc); delete o.pk; }

// 數字、日期的格式化（兩頁共用）
const pct = (x, d = 1) => { if (x == null) return "—"; const t = (x * 100).toFixed(d); return (/^-0(\.0+)?$/.test(t) ? t.slice(1) : t.replace("-", "−")) + "%"; };   // 浮點誤差的 −0 寫成 0
const num = (x, d = 2) => x == null ? "—" : x.toFixed(d).replace("-", "−");
const iso = d => new Date(d * DAY).toISOString().slice(0, 10);
const ym = d => iso(d).slice(0, 7);
const toDay = s => Math.round(Date.parse(s + "T00:00:00Z") / DAY);
// 有正負號的數字上色：up＝比較好、dn＝比較差；顏色由 --up／--dn 決定（預設紅漲綠跌，美股模式對調）
const ud = x => x == null || Math.abs(x) < 5e-4 ? "" : x > 0 ? "up" : "dn";
const sgn = x => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(1) + "%";
const f1 = x => { const v = Math.round(x * 10000) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(Math.round(v * 100) % 10 ? 2 : 1); };
