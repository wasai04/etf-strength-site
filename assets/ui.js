// 兩頁共用的介面元件（2026-11-20 起，標準化 E 階段；DESIGN.md「元件」）。
// 說明框（tip、showTip、hideTip、hideSoon、bindTips）、進站提醒（showIntro）、側欄收合（sideOff、bindSide）、新手導覽（bindTour，步驟 TOUR 在頁面）、
// 時間軸拉桿（pPos、rangeScale、buildRange、syncRange、crashAlpha、crashMarks、syncPeriod、buildEpPeriod）、拉桿朗讀文字（RT、rangeText）、
// 分享（shareLink、openShared、bindShare；getState／applyState 在頁面）、觀察卡情境列（insBar、markBar、hideBar、insPrev、bindInsBar）。
// 這些直接用頁面的全域變數與函式（D、TOUR、PAGES、mq、st、epView、epState、currentWindow、getState、applyState、showPage、clearSideFilters、render…），兩頁名字一致才放這裡。
// 只宣告函式與常數（tip 是取元素，所以要放在 #tip 之後載入）；監聽器由頁面呼叫 bind…() 才掛上。改了這個檔：把兩頁 <script src> 的 ?v= 換成當天日期。

// ── 說明框（游標、鍵盤焦點、點一下都會開）
const tip = document.getElementById("tip");   // 載入時就取：頁面的 $() 還沒宣告
let tipFor = null;   // 目前提示屬於哪個元素：它帶 aria-describedby，螢幕閱讀器才念得到提示
function showTip(el, text) {
  clearTimeout(hideTip.t);
  if (tipFor && tipFor !== el) tipFor.removeAttribute("aria-describedby");
  tipFor = el; el.setAttribute("aria-describedby", "tip");
  tip.textContent = text; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(300, innerWidth - 24);
  tip.style.maxWidth = w + "px";
  tip.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 12) + "px"; tip.style.top = (r.bottom + 8) + "px";
  const th = tip.getBoundingClientRect().height; if (r.bottom + 8 + th > innerHeight - 8) tip.style.top = Math.max(8, r.top - th - 8) + "px";
}
function hideTip() { clearTimeout(hideTip.t); tip.hidden = true; if (tipFor) { tipFor.removeAttribute("aria-describedby"); tipFor = null; } }
const hideSoon = () => { clearTimeout(hideTip.t); hideTip.t = setTimeout(hideTip, 150); };   // 留 0.15 秒，游標可以移到提示框上
// 說明框的監聽器：頁面載入時在原本的位置呼叫一次（保持和頁面其他監聽器的先後）
function bindTips() {
  document.addEventListener("mouseover", e => { const t = e.target.closest("[data-tip]"); if (t) showTip(t, t.dataset.tip); else if (e.target.closest("#tip")) clearTimeout(hideTip.t); });
  document.addEventListener("mouseout", e => { if (e.target.closest("[data-tip], #tip")) hideSoon(); });
  document.addEventListener("focusin", e => { const t = e.target.closest("[data-tip]"); if (t) showTip(t, t.dataset.tip); });
  document.addEventListener("focusout", hideTip);
  // 點一下：.term 和卡片、格子這類本身不是按鈕的都會開；按鈕、連結、輸入框照原本的動作，不攔
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tip]"), ctl = e.target.closest("button, a, input, select, summary");
    if (t && (t.matches(".term") || !ctl || !t.contains(ctl))) { if (t.matches(".term") && !t.closest("label")) e.preventDefault(); showTip(t, t.dataset.tip); }
    else if (!e.target.closest("#tip, [data-tip]") && !inHover(e.target)) hideTip();   // 點在開著懸浮框的走勢圖上不收（觸控點一下後瀏覽器會補一個 click）
  });
  document.addEventListener("scroll", hideTip, { passive: true, capture: true });   // capture：手機設定抽屜裡捲動也會收起
}

// 進站提醒：localStorage etf-intro-off＝勾了不再顯示；sessionStorage etf-intro-seen＝這次瀏覽已經看過
function showIntro() {
  const dlg = $("intro"), get = (st, k) => { try { return window[st + "Storage"].getItem(k); } catch (e) { return null; } };
  if (get("local", "etf-intro-off") || get("session", "etf-intro-seen") || !dlg.showModal) return;
  const close = tour => { try { sessionStorage.setItem("etf-intro-seen", "1"); if ($("introNo").checked) localStorage.setItem("etf-intro-off", "1"); } catch (e) {}
    dlg.close(); if (tour) $("tourBtn").click(); };
  $("introSkip").onclick = () => close(false); $("introTour").onclick = () => close(true);
  dlg.addEventListener("cancel", () => close(false));
  dlg.showModal();
}
// 側欄收合：sideOff() 讀狀態，sideOff(true/false) 設定（不寫 localStorage；按鈕才寫）
function sideOff(v) {
  const sh = document.querySelector(".shell");
  if (v === undefined) return sh.classList.contains("sideoff");
  sh.classList.toggle("sideoff", v);
  document.querySelectorAll(".sidetog").forEach(b => { b.setAttribute("aria-expanded", !v); b.title = v ? "展開側欄" : "收起側欄"; b.setAttribute("aria-label", b.title); });
}
// 側欄收合按鈕：頁面載入時呼叫一次（套用上次的收合狀態）
function bindSide() {
  document.querySelectorAll(".sidetog").forEach(b => b.onclick = () => { const v = !sideOff(); sideOff(v); try { localStorage.setItem("etf-side-off", v ? "1" : "0"); } catch (e) {} });
  sideOff(sideOff());
}
function bindTour() {
  const hole = $("tourHole"), card = $("tourCard"), block = $("tourBlock");
  const bg = on => [...document.body.children].forEach(e => { if (![hole, card, block].includes(e) && e.tagName !== "SCRIPT") e.inert = on; });   // 導覽時背景加 inert：Tab、朗讀都進不去（挖洞那塊也只是看）
  let k = 0, from = null, sysWas = false, sideWas = false;   // sysWas：導覽前顯示設定有沒有打開，結束時還原
  const place = () => {
    const S = TOUR[k], el = S.sel && document.querySelector(S.sel), pad = 6;
    if (!el) { hole.style.cssText = `top:50%;left:50%;width:0;height:0`; card.style.left = (innerWidth - card.offsetWidth) / 2 + "px"; card.style.top = (innerHeight - card.offsetHeight) / 2 + "px"; return; }
    const r = el.getBoundingClientRect(), top = Math.max(4, r.top - pad), bot = Math.min(innerHeight - 4, r.bottom + pad);
    hole.style.cssText = `top:${top}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${Math.max(0, bot - top)}px`;
    const ch = card.offsetHeight, cw = card.offsetWidth, below = innerHeight - bot, right = innerWidth - r.right;
    let x, y;
    if (below >= ch + 12) { y = bot + 10; x = r.left; } else if (r.top >= ch + 12) { y = top - ch - 10; x = r.left; }
    else if (right >= cw + 16) { x = r.right + pad + 10; y = Math.max(8, Math.min(r.top, innerHeight - ch - 8)); }
    else { x = (innerWidth - cw) / 2; y = innerHeight - ch - 12; }   // 都放不下（手機或區塊很大）：貼在畫面下方
    card.style.left = Math.max(8, Math.min(x, innerWidth - cw - 8)) + "px"; card.style.top = Math.max(8, y) + "px";
  };
  const show = i => {
    k = i; const S = TOUR[k];
    if (S.page && document.body.dataset.page !== S.page) showPage(S.page, true);
    document.body.classList.toggle("drawer", !!S.side && mq.matches);
    $("tourN").textContent = `${k + 1}／${TOUR.length}`; $("tourT").textContent = S.t; $("tourX").innerHTML = S.x.replace(/\n/g, "<br>");
    $("tourPrev").disabled = k === 0; $("tourNext").textContent = k === TOUR.length - 1 ? "完成" : "下一步";
    if (S.open) document.querySelector(S.open).open = true;
    const el = S.sel && document.querySelector(S.sel);
    if (el) el.scrollIntoView({ block: el.offsetHeight > innerHeight * 0.6 ? "start" : "center" });
    requestAnimationFrame(() => requestAnimationFrame(place));
    $("tourNext").focus();
  };
  const end = () => { bg(false); $("sysDet").open = sysWas; sideOff(sideWas); [hole, card, block].forEach(e => { e.hidden = true; }); document.body.classList.remove("drawer"); if (from) showPage(from, true); scrollTo({ top: 0 }); $("tourBtn").focus(); };
  document.addEventListener("click", e => { const d = $("sysDet"); if (d.open && !d.contains(e.target) && $("tourCard").hidden) d.open = false; });   // 置頂欄的顯示設定：點外面就收起
  $("tourBtn").onclick = () => { from = document.body.dataset.page; sysWas = $("sysDet").open; sideWas = sideOff(); sideOff(false); hideTip(); [hole, card, block].forEach(e => { e.hidden = false; }); bg(true); show(0); };
  $("tourNext").onclick = () => k === TOUR.length - 1 ? end() : show(k + 1);
  $("tourPrev").onclick = () => k > 0 && show(k - 1);
  $("tourEnd").onclick = end;
  document.addEventListener("keydown", e => {
    if (card.hidden) return;
    if (e.key === "Tab") { const f = [...card.querySelectorAll("button:not([disabled])")], i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); return; }
    if (e.key === "Escape") { e.stopPropagation(); end(); } else if (e.key === "ArrowRight") $("tourNext").click(); else if (e.key === "ArrowLeft") $("tourPrev").click();
  }, true);
  addEventListener("resize", () => { if (!card.hidden) place(); });
  addEventListener("scroll", () => { if (!card.hidden) place(); }, { passive: true });
}

// 時間軸（總覽的回看期間、空頭的走勢圖區間共用）：兩個重疊的拉桿共用一條軌道，把手位置＝交易日序號
const pPos = i => i / (D.dates.length - 1) * 100;
// 中間的色段（fillId）可以整段拖：長度不變、整段往前或往後移，用來看「固定 1 年」這種窗口一路滑過去的變化
// 刻度與把手範圍：載入時和換分區時（各區資料起點不同）都要重算
function rangeScale(sId, eId, ticksId) {
  const N = D.dates.length - 1, y0 = +iso(D.dates[0]).slice(0, 4), y1 = +iso(D.dates[N]).slice(0, 4);
  [sId, eId].forEach(id => { $(id).min = 0; $(id).max = N; });
  const step = [1, 2, 5, 10].find(k => (y1 - y0) / k <= 6) || 10;
  let t = ""; for (let y = y0 + 1; y <= y1; y++) if (y % step === 0) t += `<span style="left:${pPos(lastIdxLE(D.dates, toDay(y + "-01-01")))}%">${y}</span>`;
  $(ticksId).innerHTML = t;
}
function buildRange(sId, eId, ticksId, gap, onMove, fillId) {
  rangeScale(sId, eId, ticksId);
  const NN = () => D.dates.length - 1;
  let raf = 0;
  const frame = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; onMove.draw(); }); };
  [sId, eId].forEach(id => $(id).addEventListener("input", () => {
    let s = +$(sId).value, e = +$(eId).value; const N = NN();
    if (e - s < gap) { if (id === sId) s = e - gap; else e = s + gap; if (s < 0) { s = 0; e = gap; } if (e > N) { e = N; s = N - gap; } $(sId).value = s; $(eId).value = e; }
    onMove(s, e); frame();
  }));
  const fill = $(fillId); let drag = null;
  fill.addEventListener("pointerdown", e => { e.preventDefault(); drag = { x: e.clientX, s: +$(sId).value, e: +$(eId).value, w: fill.parentElement.getBoundingClientRect().width }; try { fill.setPointerCapture(e.pointerId); } catch (err) {} });
  fill.addEventListener("pointermove", ev => {
    if (!drag) return;
    const N = NN(), di = Math.max(-drag.s, Math.min(N - drag.e, Math.round((ev.clientX - drag.x) / drag.w * N)));
    onMove(drag.s + di, drag.e + di); frame();
  });
  fill.addEventListener("pointerup", () => { if (drag && onMove.end) onMove.end(); drag = null; });
  fill.addEventListener("pointercancel", () => { drag = null; });
  // 往前／往後一格（約 1 個月＝21 個交易日），長度不變
  onMove.step = di => { let s = +$(sId).value, e = +$(eId).value; const N = NN(); di = Math.max(-s, Math.min(N - e, di)); if (!di) return; onMove(s + di, e + di); onMove.draw(); if (onMove.end) onMove.end(); };
}
function syncRange(sId, eId, fillId, s, e) {
  $(sId).value = s; $(eId).value = e;
  $(sId).setAttribute("aria-valuetext", iso(D.dates[s])); $(eId).setAttribute("aria-valuetext", iso(D.dates[e]));   // 朗讀念日期，不念交易日序號
  $(sId).style.zIndex = s > (D.dates.length - 1) / 2 ? 4 : "";   // 兩個把手疊在右半邊時，起日要在上面才拉得回來
  $(fillId).style.left = pPos(s) + "%"; $(fillId).style.width = (pPos(e) - pPos(s)) + "%";
}
// 跌幅越深顏色越深（美股換分區時頁面把 crashMax 清掉重算）
// 2026-11-20 稽核 3 第 8 條：跌幅剛好等於門檻（th）最淺、這一區基準最深的那次最深（原本固定從 15% 起算、上限至少 30%，債券區兩次大跌一樣淡）
let crashMax = null;
const crashAlpha = (depth, lo, hi, th) => { if (crashMax == null) crashMax = Math.max(0.01, ...episodes(D, 0.05).map(e => Math.abs(e.depth))); return lo + (hi - lo) * Math.min(1, Math.max(0, (Math.abs(depth) - th) / (crashMax - th || 1))); };
// 軌道上的色塊：基準從高點跌到低點；sel 以外的變淡（sel 沒給就全部一樣深）
function crashMarks(trackId, eps, sel, label, th) {   // th：這些大跌用的門檻（色塊深淺從它算起）
  $(trackId).querySelectorAll(".pcrash").forEach(el => el.remove());
  $(trackId).insertAdjacentHTML("beforeend", eps.map((ep, i) => `<div class="pcrash${sel != null && i !== sel ? " dim" : ""}" style="opacity:${crashAlpha(ep.depth, .4, 1, th) * (sel != null && i !== sel ? .55 : 1)};left:${pPos(ep.pk)}%;width:${pPos(ep.tr) - pPos(ep.pk)}%"></div>`).join(""));
}

function syncPeriod() { const { s, e } = currentWindow(); syncRange("pS", "pE", "pfill", s, e); }
// 空頭走勢圖的區間：拖把手＝改 epView（和起迄日期、縮放、拖曳是同一個狀態）
function buildEpPeriod() {
  const move = (s, e) => { epView = { from: iso(D.dates[s]), to: iso(D.dates[e]) }; syncRange("eS", "eE", "epfill", s, e); };
  move.draw = () => { if (epState) drawEpChart(epState.ep); };
  move.end = () => {};
  buildRange("eS", "eE", "epticks", 10, move, "epfill");
  document.querySelectorAll("[data-estep]").forEach(b => b.onclick = () => move.step(+b.dataset.estep));
}

// 拉桿的朗讀文字（aria-valuetext）：念出單位，不只念數字；rticks 登記格式，render 每次更新
const RT = {};
const rangeText = () => Object.entries(RT).forEach(([id, f]) => { const v = +$(id).value; $(id).setAttribute("aria-valuetext", id === "vmax" && v < 3 ? v + " 倍" : String(f(v))); });

// 分享：把目前畫面做成連結、複製起來；網址列不跟著變
function shareLink() {
  const q = getState().toString().replace(/%2C/g, ",");
  return location.origin + location.pathname + "#" + (document.body.dataset.page || "overview") + (q ? "?" + q : "");
}
// 開別人分享的連結：套用設定，再把網址列清回只有分頁
function openShared() {
  const [p, qs] = location.hash.slice(1).split("?");
  applyState(new URLSearchParams(qs || "")); showPage(p, false);
  try { history.replaceState(null, "", "#" + (PAGES.includes(p) ? p : "overview")); } catch (e) {}
}
function bindShare() {
  $("shareBtn").onclick = async () => {
    const url = shareLink(), msg = $("shareMsg");
    msg.hidden = false;
    try { await navigator.clipboard.writeText(url); msg.textContent = "已複製連結。貼給別人，打開就是同樣的期間、門檻、篩選和標註（主題、漲跌顏色、文字大小照對方自己的）。"; }
    catch (e) { msg.innerHTML = `複製不了，請手動複製：<input type="text" readonly value="${url.replace(/"/g, "&quot;")}" style="width:100%" onfocus="this.select()">`; msg.querySelector("input").focus(); }
    clearTimeout(msg._t); msg._t = setTimeout(() => { msg.hidden = true; }, 8000);
  };
  // 觀察頁：套用那一則的設定，切到對應分頁並捲到圖或表
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-ins]"); if (!b) return;
    const inBar = !!b.closest("#insBar"), card = b.closest(".ins");
    if (card) insPrev = getState();   // 從觀察卡進來：記住原本的設定，情境列的「還原設定」用（稽核 2 M1）
    const q = new URLSearchParams(b.dataset.ins); applyState(q);
    showPage(q.get("p") || "overview", true);
    if (card) insBar(card, b.dataset.ins); else if (inBar) markBar(b.dataset.ins); else hideBar();
    if (inBar && (q.get("p") || "overview") === document.body.dataset.page) return;   // 情境列裡切換：留在原位，方便對照
    const to = b.dataset.to && $(b.dataset.to); if (to) to.scrollIntoView({ block: "start" }); else scrollTo({ top: 0 });
  });
}
// 情境列：把那張卡的標題和按鈕複製過來，點了哪個就標亮
function insBar(card, cur) {
  const bar = $("insBar"), btns = [...card.querySelectorAll("[data-ins]")];
  bar.innerHTML = `<span class="ib-t"><small>觀察</small>${card.querySelector("h3").textContent}</span>`
    + (btns.length > 1 ? `<span class="ib-go">${btns.map(x => `<button type="button" class="btn" data-ins="${x.dataset.ins.replace(/&/g, "&amp;")}" data-to="${x.dataset.to || ""}">${x.textContent}</button>`).join("")}</span>` : "")
    + `<span class="ib-end"><button type="button" class="btn" data-insback>回觀察頁</button>${insPrev ? `<button type="button" class="btn" data-insundo aria-label="關閉情境列，設定還原成點觀察卡之前的樣子">還原設定</button>` : ""}<button type="button" class="btn" id="insX" aria-label="關閉情境列（設定留著）">×</button></span>`;
  bar.hidden = false; markBar(cur);
}
function markBar(cur) { $("insBar").querySelectorAll(".ib-go [data-ins]").forEach(x => x.setAttribute("aria-pressed", x.dataset.ins === cur)); }
function hideBar() { $("insBar").hidden = true; }
let insPrev = null;
// 情境列的 ×、還原設定，和「清除篩選」連結：頁面載入時呼叫一次
function bindInsBar() {
  document.addEventListener("click", e => { if (e.target.closest("#insX")) hideBar(); if (e.target.closest("[data-insundo]") && insPrev) { const q = insPrev; insPrev = null; hideBar(); applyState(q); } if (e.target.closest("[data-clrside]")) { clearSideFilters(); render(); } if (e.target.closest("[data-insback]")) { showPage("notes", true); scrollTo({ top: 0 }); } });
}
