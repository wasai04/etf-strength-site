"""台股掛牌 ETF 的「強度檔」分類：報酬、回調深度、漲勢集中度（爆發週），各回看期間對照 0050。

用法：
    python tw_etf_strength.py --asof 2026-10-31 --out 輸出目錄
    python tw_etf_strength.py --asof 2026-10-31 --burst-scan --out 輸出目錄   # 只列各門檻下的爆發週數，用來挑門檻

輸出（UTF-8）：
    etf_list.csv     名單與分類（含被排除的與排除原因）
    metrics.csv      每檔 × 每個回看期間的指標與類別
    meta.json        執行參數、資料日期、資料檢查（疑似錯價、資料不足）
資料來源：
    名單   證交所 ISIN 公開頁 https://isin.twse.com.tw/isin/C_public.jsp?strMode=2（上市）、strMode=4（上櫃），取「ETF」段
    地區   證交所開放資料 t187ap47_L 的「基金類型」「是否包含國外成分股」；上櫃沒有官方欄位，用 REGION_OVERRIDE 人工標記
    價格   Yahoo chart（含息還原價 adjclose），用 fetchlib.yahoo()
定義：
    - 回看期間 1／3／5 年，終點是 --asof 當天或之前最後一個 0050 交易日；起點是終點往前 N 年當天或之前最後一個交易日。
      ETF 第一筆價格晚於起點 7 天以上，該期間不算（標 n/a）。
    - 一次投入年化：還原價終點÷起點，開 N 次方根。
    - 定投年化（XIRR）：起點日投入 1 元，之後每月第一個交易日各投入 1 元（起點所在月份不重複投），
      終點市值對各筆投入的實際日期解年化內部報酬率。
    - 最大回撤：期間內日還原價相對前高的最大跌幅；回復月數是那次回撤的前高到重新站上前高的月數（沒回到標「未回復」）。
    - 爆發週：週五收盤對週五收盤（W-FRI；第一週從起點算到第一個週五）的週報酬 ≥ --burst（預設 7.5%）。
      beta_weekly 是週報酬對 0050 的迴歸斜率；beta > 1 的 ETF 更容易被標成「靠爆發」。
    - 大盤判讀（--market，預設加權指數 ^TWII，不含息）：beta_mkt、r2_mkt、up_capture、down_capture，不影響分類。
      ETF 是含息報酬、指數不含息，捕獲率略偏高；R² 低的檔，捕獲率沒有意義。爆發週貢獻＝爆發週的對數報酬合計÷期間總對數報酬；
      扣爆發週年化＝把爆發週的報酬當 0 重算的年化。
    - 類別（label，對同一期間的 0050）：
        年化相差在 --tie（預設 1.5 個百分點，5 年累積約差 7%）以內，而且最大回撤相差在 --near-dd（預設 3 個百分點）以內 → 約等於0050（頁面顯示「接近 0050」）
        其餘用兩條線切：
        划算線：年化報酬 ÷ 最大回撤幅度（Calmar 比率）和 0050 相同的線；不低於 0050 的算在線上方。
        0050 年化 ≤ 0 時 Calmar 比率沒有意義，改用「最大回撤不比 0050 深」當線上方。
        報酬高於 0050：線上方 → 穩強，線下方 → 猛強
        報酬不高於 0050：線上方 → 穩但不強，線下方 → 弱
      （2026-11-01 前只看年化 ±1%，0052 這種年化差不多、回撤深很多的也算約等於；改成要回撤也接近。）
    - 靠爆發（burst，標記不是類別）：報酬高於 0050 超過 --tie，但扣爆發週年化 ≤ 0050 扣「同幾週」後的年化。
      「同幾週」是為了排除機械效果：波動大的 ETF 在 0050 大漲的週更容易超過門檻，只扣它自己的會偏向標成靠爆發。
      對照：burst_4w（連續 4 週累積 ≥ 20% 的區段，不重疊）、burst_own_weeks（扣自己的爆發週，和 0050 完整年化比）。
    - 空頭驗證（verified，標記，每檔一個值、不分期間）：從 EXPORT_START 或上市日起，經歷過至少一次 0050 跌 ≥ --crash
      （預設 20%）且回到高點的大空頭，而且這段「上市以來」的年化不輸 0050 超過 --verify-tie（預設 1%，和 --tie 分開，
      2026-11-03 --tie 從 1% 改 1.5% 時，驗證的定義維持不變）。life_cagr_diff 是上市以來年化減 0050。
限制：
    - 名單只有目前掛牌的 ETF；已下市的不在裡面（存活者偏差）。
    - region 是「未定」的（新掛牌的上櫃 ETF），補進 REGION_OVERRIDE。
    - 用的是市價，不是淨值；溢價暴衝（例：00887 2024-10）會算進報酬和爆發週。
    - Yahoo 沒調整的分割由 fix_splits() 校正，紀錄在 meta.json 的 split_fixes。
    - Yahoo 對少數 ETF 有上市前的孤立價格（例：00637L 2015-02-05 一筆 9.13，下一筆是上市日 2015-05-06 的 20）。
      第一筆和下一筆相隔超過 20 天、價差超過 5% 的，第一筆丟掉（drop_prelisting()），紀錄在 meta.json 的 prelisting_drops。
      一般新 ETF 開頭 5～9 天固定在發行價附近的不動（沒有漲跌，不影響報酬）。
    - 單日還原價漲跌超過 25%（槓桿型 45%）列在 meta.json 的 suspect_jumps，通常是分割或配息調整錯誤，要查。
    - Yahoo 的價格會有壞點（例：00631L 2015-08-24 Yahoo 是 −33.6%，證交所是 −10.6%）。suspects() 挑出可疑的日子
      （暴漲暴跌又回來、國內 ETF 超過漲跌幅限制、國內正 2 偏離 2 倍指數），check_prices() 拿證交所／櫃買中心的官方漲跌幅核對，
      差超過 2% 的改用官方的。每一筆核對結果記在 meta.json 的 price_checks（改用官方／官方一致，保留／官方資料抓不到）。
"""
import argparse
import datetime as dt
import io
import json
import math
import os
import socket
import sys
import threading
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetchlib import WEB_UA, http, yahoo  # noqa: E402

# 連線一律走 IPv4：部分網路環境經 IPv6 連 Yahoo，Python 下載一檔 20 年日線要約 30 秒、偶爾整個卡住；IPv4 約 0.2 秒（2026-11-01 實測）
_getaddrinfo = socket.getaddrinfo
socket.getaddrinfo = lambda host, port, family=0, *args, **kw: _getaddrinfo(host, port, socket.AF_INET, *args, **kw)

ISIN_URL = "https://isin.twse.com.tw/isin/C_public.jsp?strMode={m}"
BENCH = "0050.TW"  # 預設基準；--bench 可換（Yahoo 代號）
WINDOWS = (1, 3, 5)
EXPORT_START = "2015-01-01"  # 拉桿頁面自訂期間的最早起點：2015 年底已上市 25 檔，涵蓋 2015、2018、2020、2022 的回檔
FUND_TYPE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap47_L"
# 上櫃 ETF 沒有官方的國內／海外欄位，人工標記（2026-11-01；名稱看不出來的三檔查過投信資料：
# 009822 全球未來金融指數、美國約 87%；00998A 全球金融股主動式；00411A 全球科技主動式、美國約 70%）。
# 00416A 是上市但不在 t187ap47_L 裡。新掛牌的上櫃 ETF 會標「未定」，要補進來。
REGION_OVERRIDE = {
    "006201": "國內", "00888": "國內", "00928": "國內", "00416A": "國內",
    "00858": "海外", "00877": "海外", "00886": "海外", "00887": "海外", "00955": "海外", "009806": "海外",
    "009807": "海外", "009814": "海外", "009815": "海外", "009822": "海外", "009823": "海外", "009825": "海外",
    "00998A": "海外", "00411A": "海外",
}


def isin_etfs():
    rows = []
    for m, sfx in ((2, ".TW"), (4, ".TWO")):
        # 上市那頁約 10 MB，從 GitHub Actions（美國）下載常超過 90 秒（2026-11-16 排程失敗），放寬到 300 秒
        raw = http(ISIN_URL.format(m=m), WEB_UA, total=300).decode("cp950", errors="replace")
        t = pd.read_html(io.StringIO(raw))[0]
        t.columns = t.iloc[0]
        t = t[1:]
        c0, c1 = t.columns[0], t.columns[1]
        sec = None
        for _, r in t.iterrows():
            if r[c0] == r[c1]:
                sec = r[c0]
                continue
            if sec != "ETF":
                continue
            code, _, name = str(r[c0]).partition("　")
            rows.append({"code": code.strip(), "name": name.strip(), "yahoo": code.strip() + sfx,
                         "list_date": r[t.columns[2]], "cfi": r[t.columns[5]]})
    return pd.DataFrame(rows)


def classify(r):
    """回傳 (kind, region, excluded_reason)。kind：股票型／槓桿型；排除反向、債券、商品期貨、外幣、平衡型。"""
    code, name, cfi = r["code"], r["name"], r["cfi"]
    if code.endswith("K"):
        return None, None, "外幣交易單位（同一檔 ETF 的另一個代號）"
    if code.endswith("R") or "反" in name:
        return None, None, "反向型"
    if code.endswith(("B", "D")) or "債" in name:
        return None, None, "債券型"
    if code.endswith("T") or name.startswith("平衡"):
        return None, None, "平衡型"
    if code.endswith(("U", "C")) or name.startswith("期") or "美元" in name or "黃金" in name or "石油" in name:
        return None, None, "商品／期貨／外幣"
    if cfi.startswith("CEOGB") or cfi.startswith("CEOIB") or cfi.startswith("CEOJB") or cfi.startswith("CEOIR"):
        return None, None, "債券／不動產（CFI）"
    if "不動產" in name or "REITs" in name or "特別股" in name:
        return None, None, "不動產／特別股"
    kind = "槓桿型" if code.endswith("L") or "正2" in name else "股票型"
    return kind, None, ""


def region_of(code, fund_types):
    """上市：證交所 t187ap47_L 的「基金類型」（槓桿型看「是否包含國外成分股」）；上櫃：REGION_OVERRIDE。"""
    if code in REGION_OVERRIDE:
        return REGION_OVERRIDE[code]
    f = fund_types.get(code)
    if f is None:
        return "未定"
    if "國內" in f["基金類型"]:
        return "國內"
    if "國外" in f["基金類型"] or "境外" in f["基金類型"]:
        return "海外"
    return "海外" if f["是否包含國外成分股"] == "是" else "國內"


def fix_splits(s, lev):
    """Yahoo 偶爾沒把分割前的價格調整（例：0052 2025-11-17 1 拆 7）。單日漲跌接近 1/n 或 n 倍（n=2～20），
    取殘差最小的 n；殘差在 ±5%（槓桿型 ±10%）以內，而且前後各 10 個交易日價格平穩（最高÷最低 < 1.3；排除 00887
    2024-10 那種溢價暴衝），就當成分割，把前面的價格乘上 1/n 或 n。回傳 (序列, 修正紀錄)。"""
    tol = 0.10 if lev else 0.05
    fixes = []
    r = s / s.shift(1)
    for d, x in r.dropna().items():
        if abs(x - 1) <= 0.45:
            continue
        prev, nxt = s[s.index < d].iloc[-10:], s[s.index > d].iloc[:10]
        if len(prev) < 5 or len(nxt) < 5 or prev.max() / prev.min() >= 1.3 or nxt.max() / nxt.min() >= 1.3:
            continue
        f = min([1 / n for n in range(2, 21)] + list(range(2, 21)), key=lambda c: abs(x / c - 1))
        if abs(x / f - 1) > tol:
            continue
        s = s.copy()
        s[s.index < d] = s[s.index < d] * f
        fixes.append({"date": d.date().isoformat(), "factor": f if f >= 1 else f"1/{round(1 / f)}",
                      "residual_ret": round(float(x / f - 1), 4)})
    return s, fixes


def xirr(dates, flows):
    """依實際日期解年化內部報酬率（投入為負、終值為正），二分法。"""
    t = np.array([(d - dates[0]).days / 365.25 for d in dates])
    f = np.asarray(flows, float)

    def npv(r):
        return (f / (1 + r) ** t).sum()
    lo, hi = -0.99, 10.0
    if npv(lo) * npv(hi) > 0:
        return float("nan")
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(lo) * npv(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def weekly(p):
    """週報酬：起點價格，接上之後每週五（W-FRI）的收盤；起點不是週五時，第一週是起點到那個週五。"""
    w = pd.concat([p.iloc[:1], p.iloc[1:].resample("W-FRI").last().dropna()])
    return w.pct_change().dropna()


def market_stats(wr, mkt, start, end):
    """對大盤指數（預設加權指數 ^TWII，不含息）的週報酬：beta、R²、上漲／下跌捕獲率。
    捕獲率＝大盤上漲（下跌）的週，這檔平均週報酬 ÷ 大盤平均週報酬（算術平均）。"""
    mw = weekly(mkt[(mkt.index >= start) & (mkt.index <= end)])
    j = pd.concat([wr, mw], axis=1, join="inner").dropna()
    if len(j) <= 20:
        return {}
    e, x = j.iloc[:, 0], j.iloc[:, 1]
    up, dn = x > 0, x < 0
    return {"beta_mkt": float(np.cov(e, x)[0, 1] / np.var(x, ddof=1)), "r2_mkt": float(e.corr(x) ** 2),
            "up_capture": float(e[up].mean() / x[up].mean()), "down_capture": float(e[dn].mean() / x[dn].mean())}


def window_metrics(adj, start, end, burst, seg_burst=0.20, bench=None, mkt=None):
    if len(adj) == 0 or (adj.index[0] - start).days > 7:
        return None
    first = adj[adj.index <= start].index[-1] if (adj.index <= start).any() else adj.index[0]
    p = adj[(adj.index >= first) & (adj.index <= end)]
    years = (p.index[-1] - p.index[0]).days / 365.25
    cagr = (p.iloc[-1] / p.iloc[0]) ** (1 / years) - 1
    # 定投：起點日投 1，之後每月第一個交易日各投 1（起點所在月份不重複投）；終點以市值贖回，依實際日期算 XIRR
    firsts = p.groupby(p.index.to_period("M")).head(1)
    buys = pd.concat([p.iloc[:1], firsts[firsts.index.to_period("M") > p.index[0].to_period("M")]])
    units = (1 / buys).sum()
    dca = xirr(list(buys.index) + [p.index[-1]], [-1.0] * len(buys) + [units * p.iloc[-1]])
    # 最大回撤與回復
    peak = p.cummax()
    dd = p / peak - 1
    trough = dd.idxmin()
    mdd = float(dd.min())
    peak_date = p[:trough].idxmax()
    after = p[trough:]
    rec = after[after >= p[peak_date]]
    rec_months = round((rec.index[0] - peak_date).days / 30.44, 1) if len(rec) else None
    # 爆發週
    wr = weekly(p)
    bw = wr[wr >= burst]
    tot_log = math.log(p.iloc[-1] / p.iloc[0])
    b_log = float(np.log1p(bw).sum())
    ex = (p.iloc[-1] / p.iloc[0]) / float(np.prod(1 + bw.values)) if len(bw) else p.iloc[-1] / p.iloc[0]
    cagr_ex = ex ** (1 / years) - 1
    # 敏感度對照：連續 4 週累積 ≥ seg_burst 的區段，從前往後找、找到就跳過那 4 週（不重疊）
    g = (1 + wr).values
    i, segs, seg_mult, seg_weeks = 0, 0, 1.0, []
    while i + 4 <= len(g):
        m4 = float(np.prod(g[i:i + 4]))
        if m4 - 1 >= seg_burst:
            segs, seg_mult = segs + 1, seg_mult * m4
            seg_weeks += list(wr.index[i:i + 4])
            i += 4
        else:
            i += 1
    cagr_ex4 = ((p.iloc[-1] / p.iloc[0]) / seg_mult) ** (1 / years) - 1
    # 同週對照：0050 在「這檔的爆發週（或 4 週區段）」那幾週的報酬也當 0，剩下的時間兩邊比
    # beta：週報酬對 0050 週報酬的迴歸斜率。爆發週是用絕對門檻選的，beta > 1 的 ETF 在大盤大漲週更容易過門檻，
    # 所以「靠爆發」同時反映漲勢集中和高 beta，解讀時要一起看
    bench_ex_same = bench_ex_same4 = beta = None
    if bench is not None:
        bw_ = bench[(bench.index >= p.index[0]) & (bench.index <= p.index[-1])]
        bwr = weekly(bw_)
        tot_b = bw_.iloc[-1] / bw_.iloc[0]
        bench_ex_same = (tot_b / float(np.prod(1 + bwr[bwr.index.isin(bw.index)].values))) ** (1 / years) - 1
        bench_ex_same4 = (tot_b / float(np.prod(1 + bwr[bwr.index.isin(seg_weeks)].values))) ** (1 / years) - 1
        j = pd.concat([wr, bwr], axis=1, join="inner").dropna()
        if len(j) > 20:
            beta = float(np.cov(j.iloc[:, 0], j.iloc[:, 1])[0, 1] / np.var(j.iloc[:, 1], ddof=1))
    ms = market_stats(wr, mkt, p.index[0], p.index[-1]) if mkt is not None else {}
    return {**ms, "burst4_segments": segs, "cagr_ex_burst4": cagr_ex4, "beta_weekly": beta,
            "bench_ex_same_weeks": bench_ex_same, "bench_ex_same_4w": bench_ex_same4, "start": p.index[0].date().isoformat(), "end": p.index[-1].date().isoformat(), "years": round(years, 2),
            "cagr": cagr, "dca_irr": dca, "mdd": mdd, "mdd_peak": peak_date.date().isoformat(),
            "mdd_trough": trough.date().isoformat(), "recovery_months": rec_months,
            "burst_weeks": int(len(bw)), "burst_share": b_log / tot_log if tot_log > 0 else None,
            "cagr_ex_burst": cagr_ex, "max_week": float(wr.max()) if len(wr) else None}


def label(m, b, tie, near_dd):
    if abs(m["cagr"] - b["cagr"]) <= tie and abs(m["mdd"] - b["mdd"]) <= near_dd:
        return "約等於0050"
    # 划算線上方：Calmar 比率不低於 0050（交叉相乘，避免回撤為 0 時除以 0）
    above = m["cagr"] * -b["mdd"] >= b["cagr"] * -m["mdd"] if b["cagr"] > 0 else m["mdd"] >= b["mdd"]
    if m["cagr"] > b["cagr"]:
        return "穩強" if above else "猛強"
    return "穩但不強" if above else "弱"


def burst(m, b, tie, ex_key="cagr_ex_burst", bex_key="bench_ex_same_weeks"):
    """靠爆發的標記。bex_key=None 時是原比法（和 0050 完整年化比），只留作對照。"""
    if m["cagr"] - b["cagr"] <= tie:
        return False
    return bool(m[ex_key] <= (m[bex_key] if bex_key else b["cagr"]))


def crashes(b, th):
    """0050 的大空頭（EXPORT_START 起）：從高點跌超過 th、之後回到高點。回傳 (高點日, 回到高點日或 None)。算法同頁面的 episodes()。"""
    p = b[b.index >= pd.Timestamp(EXPORT_START)]
    out, pk, tr, in_dd = [], 0, 0, False
    for i in range(len(p)):
        if p.iloc[i] >= p.iloc[pk]:
            if in_dd and p.iloc[tr] / p.iloc[pk] - 1 <= -th:
                out.append((p.index[pk], p.index[i]))
            pk, in_dd = i, False
        else:
            if not in_dd or p.iloc[i] < p.iloc[tr]:
                tr = i
            in_dd = True
    if in_dd and p.iloc[tr] / p.iloc[pk] - 1 <= -th:
        out.append((p.index[pk], None))
    return out


def verify(adj, b, end, eps, tie):
    """空頭驗證：上市以來（最早 EXPORT_START）經歷過已回到高點的大空頭，且年化不輸 0050 超過 tie。"""
    start = max(adj.index[0], b[b.index >= pd.Timestamp(EXPORT_START)].index[0])
    if ((b.index >= start) & (b.index <= end)).sum() - 1 < 30:  # 同頁面 lifeCheck：不到 30 個交易日不算
        return None, None
    m, bm =window_metrics(adj, start, end, 1.0), window_metrics(b, start, end, 1.0)
    if m is None or bm is None:
        return None, None
    diff = m["cagr"] - bm["cagr"]
    had = any(rec is not None and start <= pk for pk, rec in eps)
    return bool(had and diff >= -tie), diff


def drop_prelisting(s, gap_days=20, jump=0.05):
    """開頭孤立的假價格：第一筆和下一筆相隔超過 gap_days 天、價格差超過 jump，第一筆丟掉。回傳 (序列, 紀錄或 None)。
    （例：00637L 2015-02-05 一筆 9.13，下一筆是上市日 2015-05-06 的 20；匯出時往前補值會變成 54 天固定價。）"""
    if len(s) > 1 and (s.index[1] - s.index[0]).days > gap_days and abs(s.iloc[1] / s.iloc[0] - 1) > jump:
        return s.iloc[1:], {"dropped": s.index[0].date().isoformat(), "price": float(s.iloc[0]),
                            "first_real": s.index[1].date().isoformat()}
    return s, None


def official_month(t, month, cache):
    """證交所（.TW）或櫃買中心（.TWO）一個月的官方日成交資料。回傳 {日期: 對參考價的漲跌幅}；沒成交的日子不列。
    漲跌幅＝收盤 ÷（收盤 − 漲跌價差）− 1；漲跌價差是對「參考價」算的，除息、分割日的參考價已調整，所以和含息還原價的日報酬可比。"""
    key = (t, month)
    if key in cache:
        return cache[key]
    code, ex = t.split(".")
    y, m = month.year, month.month
    if ex == "TW":
        url = f"https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date={y}{m:02d}01&stockNo={code}&response=json"
    else:
        url = f"https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code={code}&date={y}/{m:02d}/01&response=json"
    out = {}
    try:
        js = json.loads(http(url, WEB_UA).decode("utf-8"))
        rows = js.get("data") or ((js.get("tables") or [{}])[0].get("data") or [])
        for row in rows:
            yy, mm, dd = row[0].split("/")
            if "X" in row[7].upper():
                continue  # X＝除權息當天不比價，漲跌價差不能用（2011～2012 有幾筆這樣，換算出來會變 0%）
            close, chg = row[6].replace(",", ""), "".join(ch for ch in row[7] if ch in "+-.0123456789")
            try:
                c, d = float(close), float(chg or 0)
            except ValueError:
                continue  # 沒成交（--）
            if c - d > 0:
                out[pd.Timestamp(int(yy) + 1911, int(mm), int(dd))] = c / (c - d) - 1
    except Exception as e:  # noqa: BLE001
        out = {"error": str(e)[:120]}
    cache[key] = out
    time.sleep(1.5)  # 交易所對連續請求會擋
    return out


def suspects(s, domestic, lev, ref):
    """Yahoo 還原價裡可疑的日子（回傳日期清單）：
    1. 暴漲暴跌又回來：單日 ≥12%，隔天反向回吐六成以上（單筆壞價或一次性溢價都會這樣）。
    2. 國內 ETF 超過漲跌幅限制：一般 10%、槓桿 20%（2015-06-01 以前 7%、14%）。海外成分的 ETF 沒有漲跌幅限制，不查這條。
    3. 國內正 2 和 2 倍標的指數的日報酬差超過 4%（ref：台灣50 系列對 0050、加權系列對加權指數）。
    只比 Yahoo 連續兩筆相隔不超過 5 天的；中間缺好幾天的不算。"""
    r = s.pct_change()
    gap = s.index.to_series().diff().dt.days
    out = set()
    for i in range(1, len(s)):
        d, x = s.index[i], r.iloc[i]
        if gap.iloc[i] > 5 or pd.isna(x):
            continue
        if abs(x) >= 0.12 and i + 1 < len(s) and x * r.iloc[i + 1] < 0 and abs(r.iloc[i + 1]) >= 0.6 * abs(x) / (1 + abs(x)):
            out.update([d, s.index[i + 1]])
        if domestic:
            lim = (0.07 if d < pd.Timestamp("2015-06-01") else 0.10) * (2 if lev else 1) + 0.005
            if abs(x) > lim:
                out.add(d)
        if ref is not None and s.index[i - 1] in ref.index and d in ref.index:
            rr = ref[d] / ref[s.index[i - 1]] - 1
            if abs(x - 2 * rr) > 0.04:
                out.add(d)
    return sorted(out)


def check_prices(t, s, domestic, lev, ref, cache, log):
    """可疑的日子拿官方漲跌幅核對：和 Yahoo 的日報酬差超過 2% 就改用官方的，再依序連乘重建價格，
    最後整條等比例縮放，讓最後一天和 Yahoo 一樣（只動錯的那幾天，其他日子的漲跌不變）。
    核對過但兩邊一致的（例：00887 2024-10 的溢價暴衝是真的成交價）照樣保留，也記在 log。"""
    days = suspects(s, domestic, lev, ref)
    if not days:
        return s
    months = sorted({pd.Timestamp(d.year, d.month, 1) for d in days})
    off = {}
    for mth in months:
        got = official_month(t, mth, cache)
        if "error" in got:
            log.append({"ticker": t, "month": mth.strftime("%Y-%m"), "action": "官方資料抓不到", "error": got["error"]})
            continue
        off.update(got)
    r = s.pct_change()
    fixed = r.copy()
    # 可疑日所在的月份整月都比（00631L 2015 年這種一整段錯的，單看可疑日會漏）
    for i in range(1, len(s)):
        d = s.index[i]
        if pd.Timestamp(d.year, d.month, 1) not in months or d not in off:
            continue
        before = [k for k in off if k < d]
        if not before or max(before) != s.index[i - 1]:
            continue  # Yahoo 的前一筆要剛好是官方的前一個成交日，兩邊的漲跌才是同一段
        diff = r.iloc[i] - off[d]
        if abs(diff) > 0.02:
            fixed.iloc[i] = off[d]
            log.append({"ticker": t, "date": d.date().isoformat(), "yahoo_ret": round(float(r.iloc[i]), 4),
                        "official_ret": round(float(off[d]), 4), "action": "改用官方"})
        elif d in days:
            log.append({"ticker": t, "date": d.date().isoformat(), "yahoo_ret": round(float(r.iloc[i]), 4),
                        "official_ret": round(float(off[d]), 4), "action": "官方一致，保留"})
    if (fixed.iloc[1:] == r.iloc[1:]).all():
        return s
    v = (1 + fixed.fillna(0)).cumprod()
    return v * (s.iloc[-1] / v.iloc[-1])


def yahoo_deadline(t, limit=90, tries=3):
    """yahoo() 只有單次讀取的逾時；對方斷續送資料時會卡住不動（2026-11-01 一檔卡過 20 分鐘以上）。
    這裡每次限總時間 limit 秒，逾時就放棄那次再試，最多 tries 次。用 daemon 執行緒，卡住的那條不會擋住程式結束。"""
    for k in range(tries):
        box = {}

        def run():
            try:
                box["r"] = yahoo(t, rng="20y")  # max 會回傳月線
            except Exception as e:  # noqa: BLE001
                box["e"] = e
        th = threading.Thread(target=run, daemon=True)
        th.start()
        th.join(limit)
        if "r" in box:
            return box["r"]
        if "e" in box:
            raise box["e"]
        print(f"{t} 第 {k + 1} 次下載超過 {limit} 秒，重試", flush=True)
    raise TimeoutError(f"{t} 下載 {tries} 次都超過 {limit} 秒")


def etype(code, name, kind):
    """頁面篩選用的類型，每檔只屬一種：槓桿 → 主動式（代號 A 結尾）→ 高股息（名稱含「息」或「收益」）→ 市值／主題。"""
    if kind == "槓桿型":
        return "槓桿"
    if code.endswith("A"):
        return "主動式"
    if "息" in name or "收益" in name:
        return "高股息"
    return "市值／主題"


def export_page_data(a, keep, px, b, mkt, end, out):
    """拉桿頁面的資料：EXPORT_START 起每個 0050 交易日的含息還原價（各檔對齊到 0050 的交易日，上市前為 null、
    中間缺的日子沿用前一天），加上大盤指數。頁面用它算任意期間的報酬、回撤、定投、beta 和分類，
    算法和 window_metrics()、label() 相同；1／3／5 年在預設門檻下應重現 metrics.csv 的 label。"""
    dates = b[(b.index >= pd.Timestamp(EXPORT_START)) & (b.index <= end)].index
    sig = lambda x: None if x is None or (isinstance(x, float) and math.isnan(x)) else float(f"{x:.7g}")

    def aligned(s):
        s = s[s.index <= end]
        r = s.reindex(dates).ffill()
        r[r.index < s.index[0]] = np.nan
        return [sig(x) for x in r.values]

    etfs, skipped = [], []
    for _, r in keep.iterrows():
        t = r["yahoo"]
        if t not in px or px[t].index[-1] < dates[0] or px[t].index[0] > end:
            skipped.append(t)
            continue
        # 上市前的 null 不存（約占一半），改存第一筆價格的位置 i0；頁面載入時補回 null
        p = aligned(px[t])
        i0 = next(i for i, v in enumerate(p) if v is not None)
        etfs.append({"c": r["code"], "n": r["name"], "r": r["region"], "t": etype(r["code"], r["name"], r["kind"]),
                     "first": px[t].index[0].date().isoformat(), "i0": i0, "p": p[i0:]})
    data = {"end": end.date().isoformat(), "bench": a.bench, "market": a.market, "export_start": EXPORT_START,
            "defaults": {"weeks": 1, "burst": a.burst, "tie": a.tie, "near_dd": a.near_dd, "crash": a.crash, "verify_tie": a.verify_tie,
                         "hv": a.hv, "epth": a.epth},
            "dates": [int((d - pd.Timestamp("1970-01-01")).days) for d in dates],
            "bench_p": aligned(b), "market_p": aligned(mkt), "skipped": skipped, "etfs": etfs}
    os.makedirs(os.path.dirname(os.path.abspath(a.export)), exist_ok=True)
    with open(a.export, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asof", default=dt.date.today().isoformat())
    ap.add_argument("--burst", type=float, default=0.075, help="爆發週門檻（週報酬）")
    ap.add_argument("--crash", type=float, default=0.20, help="空頭驗證用的大空頭門檻（0050 從高點的跌幅）")
    ap.add_argument("--bench", default=BENCH, help="基準的 Yahoo 代號（類別名稱仍寫 0050，換基準時自行解讀）")
    ap.add_argument("--market", default="^TWII", help="判讀用的大盤指數（Yahoo 代號）；只算 beta、R²、捕獲率，不影響分類")
    ap.add_argument("--tie", type=float, default=0.015, help="年化和 0050 相差在這以內、且回撤也接近的，標「約等於0050」；靠爆發也要贏超過這個")
    ap.add_argument("--verify-tie", type=float, default=0.01, help="空頭驗證：上市以來年化輸 0050 不超過這個")
    ap.add_argument("--near-dd", type=float, default=0.03, help="「約等於0050」還要最大回撤和 0050 相差在這以內（百分點，小數）")
    ap.add_argument("--hv", type=float, default=0.05, help="網站的高波動門檻預設（歷次大跌平均比 0050 多跌幾個百分點）；腳本本身不用")
    ap.add_argument("--epth", type=float, default=0.15, help="網站空頭頁的大跌門檻預設（0050 從高點的跌幅）；腳本本身不用")
    ap.add_argument("--burst-scan", action="store_true")
    ap.add_argument("--export", help="另外輸出網站用的 data.json 到這個路徑")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    lst = isin_etfs()
    cls = lst.apply(classify, axis=1, result_type="expand")
    lst[["kind", "region", "excluded"]] = cls
    fund_types = {x["基金代號"]: x for x in json.loads(http(FUND_TYPE_URL, WEB_UA).decode("utf-8"))}
    lst["region"] = [region_of(c, fund_types) if e == "" else None for c, e in zip(lst["code"], lst["excluded"])]
    lst["fund_type"] = lst["code"].map(lambda c: fund_types.get(c, {}).get("基金類型"))
    keep = lst[lst["excluded"] == ""].copy()

    px, fails, jumps, splits, prelist, checks, ocache = {}, {}, [], {}, {}, [], {}
    mkt = yahoo_deadline(a.market)["close"].dropna()
    info = {r["yahoo"]: r for _, r in keep.iterrows()}
    for t in [a.bench] + keep["yahoo"].tolist():
        if t in px:
            continue
        try:
            df = yahoo_deadline(t)
            lev = t.split(".")[0].endswith("L")
            px[t], fx = fix_splits(df["adj"].dropna(), lev)
            px[t], pre = drop_prelisting(px[t])
            if pre:
                prelist[t] = pre
            if fx:
                splits[t] = fx
            # 可疑的價格拿官方資料核對（國內正 2：台灣50 系列對 0050、加權系列對加權指數）
            r0 = info.get(t)
            name, dom = (r0["name"], r0["region"] == "國內") if r0 is not None else ("", True)
            ref = (px.get(a.bench) if "50" in name else mkt if "加權" in name else None) if lev and dom else None
            px[t] = check_prices(t, px[t], dom, lev, ref, ocache, checks)
            lim = 0.45 if lev else 0.25
            r = px[t].pct_change().dropna()
            for d, v in r[r.abs() > lim].items():
                jumps.append({"ticker": t, "date": d.date().isoformat(), "ret": round(float(v), 4)})
        except Exception as e:
            fails[t] = str(e)[:120]
        time.sleep(0.3)
    lst["first_price"] = lst["yahoo"].map(lambda t: px[t].index[0].date().isoformat() if t in px else None)
    # 國內／海外的交叉檢查：近一年日報酬和 0050 的相關係數（海外標的有時差，同日相關通常低）
    br = px[a.bench].pct_change().iloc[-250:]
    lst["corr_0050_1y"] = lst["yahoo"].map(
        lambda t: round(float(px[t].pct_change().iloc[-250:].corr(br)), 2) if t in px and len(px[t]) > 120 else None)
    lst.to_csv(os.path.join(a.out, "etf_list.csv"), index=False, encoding="utf-8-sig")

    b = px[a.bench]
    end = b[b.index <= pd.Timestamp(a.asof)].index[-1]
    starts = {n: b[b.index <= end - pd.DateOffset(years=n)].index[-1] for n in WINDOWS}

    if a.burst_scan:
        scan = []
        for t, s in px.items():
            p = s[(s.index > starts[5] - pd.Timedelta(days=10)) & (s.index <= end)]
            wr = weekly(p)
            row = {"ticker": t, "weeks": len(wr)}
            for th in (0.05, 0.075, 0.10, 0.15, 0.20):
                row[f">={th:.3g}"] = int((wr >= th).sum())
            scan.append(row)
        pd.DataFrame(scan).to_csv(os.path.join(a.out, "burst_scan.csv"), index=False, encoding="utf-8-sig")

    eps = crashes(b, a.crash)
    ver = {t: verify(px[t], b, end, eps, a.verify_tie) for t in keep["yahoo"] if t in px}
    rows = []
    for n in WINDOWS:
        bm = window_metrics(b, starts[n], end, a.burst)
        for _, r in keep.iterrows():
            if r["yahoo"] not in px:
                continue
            m = window_metrics(px[r["yahoo"]], starts[n], end, a.burst, bench=b, mkt=mkt)
            if m is None:
                continue
            m.update({"code": r["code"], "name": r["name"], "kind": r["kind"], "region": r["region"], "window": n,
                      "etype": etype(r["code"], r["name"], r["kind"]),
                      "bench_cagr": bm["cagr"], "bench_mdd": bm["mdd"],
                      "label": label(m, bm, a.tie, a.near_dd), "burst": burst(m, bm, a.tie),
                      "burst_4w": burst(m, bm, a.tie, "cagr_ex_burst4", "bench_ex_same_4w"),
                      "burst_own_weeks": burst(m, bm, a.tie, bex_key=None),
                      "verified": ver[r["yahoo"]][0], "life_cagr_diff": ver[r["yahoo"]][1]})
            rows.append(m)
    out = pd.DataFrame(rows)
    out.to_csv(os.path.join(a.out, "metrics.csv"), index=False, encoding="utf-8-sig")
    if a.export:
        export_page_data(a, keep, px, b, mkt, end, out)
    meta = {"asof_requested": a.asof, "end": end.date().isoformat(),
            "starts": {str(k): v.date().isoformat() for k, v in starts.items()},
            "burst": a.burst, "tie": a.tie, "verify_tie": a.verify_tie, "near_dd": a.near_dd, "crash": a.crash,
            "crashes": [[pk.date().isoformat(), rec.date().isoformat() if rec is not None else None] for pk, rec in eps],
            "n_listed": int(len(lst)), "n_kept": int(len(keep)),
            "excluded_counts": lst[lst["excluded"] != ""]["excluded"].value_counts().to_dict(),
            "n_per_window": out.groupby("window").size().to_dict(), "fetch_fail": fails, "split_fixes": splits, "prelisting_drops": prelist,
            "suspect_jumps": jumps, "price_checks": checks,
            "generated": dt.datetime.now().isoformat(timespec="seconds")}
    with open(os.path.join(a.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1, default=str)
    print(json.dumps({k: meta[k] for k in ("end", "starts", "n_listed", "n_kept", "excluded_counts", "n_per_window")},
                     ensure_ascii=False, default=str))
    print("fetch_fail", len(fails), "suspect_jumps", len(jumps),
          "price_fixed", sum(c["action"] == "改用官方" for c in checks), "price_confirmed", sum(c["action"] == "官方一致，保留" for c in checks))


if __name__ == "__main__":
    main()
