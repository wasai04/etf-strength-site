"""美股 ETF 的「強度檔」分類：沿用台股版 tw_etf_strength.py 的指標與分類（直接引用，不複製），
分區各自對照基準，另算股息預扣稅版本與槓桿耗損。

用法：
    python us_etf_strength.py --list 名單.csv --tags 題材.csv --out 輸出目錄 [--export data.json] [--only SPY,QQQ,...]

輸入：
    --list  名單（lists/us-etf.csv：s,n,inceptionDate,zone,fill_type；分區和補的類型已算好）。
            也接受 stockanalysis.com 篩選頁的原始匯出（s,n,assetClass,aum,etfCategory,issuer,inceptionDate,etfRegion），
            這時用 zone_of() 和晨星分類現算；原始匯出不放進公開的 repo（網站條款不允許轉載），
            規模門檻在匯出時已套用（10 億美元）
    --tags  標的題材（s,主題材,次題材,區域,國家,信心,依據），只有股票區有
輸出（UTF-8）：
    etf_list.csv   名單、分區、排除原因
    metrics.csv    每檔 × 回看期間 × 稅別（0 = 股息全額再投入，0.3 = 扣 30% 後再投入）的指標與類別
    leverage.csv   槓桿 ETF 對 1 倍原型的耗損（各回看期間）
    meta.json      參數、資料日期、抓取失敗、可疑跳動
    cache/         每檔的 Yahoo 日資料（close、adj），重跑時沿用；--refresh 重抓
分區與基準：
    股票   股票類（不含槓桿、反向）＋另類的 Defined Outcome、Derivative Income、Equity Hedged＋資產配置   → SPY
    債券   債券類（不含槓桿）                                                                            → AGG
    原物料 原物料類                                                                                      → GLD
    加密貨幣 貨幣類（不含槓桿）                                                                          → IBIT
    槓桿   晨星分類 Trading--Leveraged*，以及 BITX、ETHU（Trading--Miscellaneous，2 倍）                 → SPY
    排除   反向（Trading--Inverse*），其餘另類（箱型價差、管理期貨、多空、多重策略等）
預扣稅：
    Yahoo 的 adjclose 假設股息全額再投入。每日的股息貢獻 d = adj 報酬 − close 報酬（close 已做分割調整，不含配息），
    扣稅版的日報酬 = adj 報酬 − 稅率 × d。基準也用同一個稅率。
    限制：資本利得分配、合格利息所得（多數債券 ETF 的配息）對非美國居民原則上不預扣，這裡一律扣 30%，
    債券區的扣稅版會偏低；實際扣多少依券商與 1042-S 為準。
定義：
    年化、定投、最大回撤、爆發週、類別、靠爆發、空頭驗證都用 tw_etf_strength 的函式，定義見該檔說明。
    類別名稱「約等於0050」在這裡寫成「接近基準」。
    空頭驗證的大空頭門檻依分區（--crash 股票、原物料、加密貨幣、槓桿；--crash-bond 債券），起點 EXPORT_START。
    槓桿耗損（gap）：同一期間 槓桿 ETF 累積報酬 −（倍數 × 原型累積報酬），單位是百分點；負的代表輸給「把原型報酬直接乘倍數」。
    不用比值：原型報酬接近 0 或為負時，比值會爆掉或變號（測試時 NVDL 1 年比值 22、TMF 3 年 −1.3）。
    原型沒有 1 倍 ETF 的（FNGU）不算。
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib as sr  # noqa: E402
import tw_etf_strength as tw  # noqa: E402  （引用時不會執行台股版的主程式；它的 IPv4 連線設定會一起生效）

EXPORT_START = "1999-01-01"  # 涵蓋 2000 年網路泡沫（類股 SPDR 1998-12、QQQ 1999-03 上市）與 2008 金融海嘯
tw.EXPORT_START = EXPORT_START  # crashes()、verify() 讀的是台股模組的這個值
WINDOWS = tw.WINDOWS
ZONE_BENCH = {"股票": "SPY", "債券": "AGG", "原物料": "GLD", "加密貨幣": "IBIT", "槓桿": "SPY"}
# 各分區的門檻預設（2026-11-16）：依基準的年化波動和 SPY（約 16%）的比例縮放後取整。沒列的分區用命令列的預設。
# 腳本分類照分區套用，並寫進資料檔 zone_defaults，頁面的拉桿預設讀這裡（頁面和腳本的分類才會一致）。
# hv（高波動門檻）、epth（大跌門檻）只有頁面用。
ZONE_DEFAULTS = {"債券": {"tie": 0.005, "near_dd": 0.01, "burst": 0.025, "hv": 0.02, "epth": 0.10},
                 "加密貨幣": {"tie": 0.05, "near_dd": 0.10, "burst": 0.25, "hv": 0.15, "epth": 0.20}}
EQUITY_ALT = {"Defined Outcome", "Derivative Income", "Equity Hedged"}
# 槓桿 ETF：(倍數, 1 倍原型)。原型是同一指數的 ETF 或個股；指數不完全相同的標「近似」。
LEVERAGE = {
    "TQQQ": (3, "QQQ", ""), "QLD": (2, "QQQ", ""), "SSO": (2, "SPY", ""), "SPXL": (3, "SPY", ""),
    "UPRO": (3, "SPY", ""), "SOXL": (3, "SOXX", ""), "USD": (2, "SOXX", "近似：USD 追 DJ 美國半導體指數"),
    "TECL": (3, "XLK", ""), "ROM": (2, "IYW", "近似：ROM 追 DJ 美國科技指數"), "FAS": (3, "XLF", "近似：FAS 追羅素 1000 金融服務指數，XLF 追標普金融類股指數"),
    "TNA": (3, "IWM", ""), "KORU": (3, "EWY", ""), "TMF": (3, "TLT", ""), "TSLL": (2, "TSLA", ""),
    "NVDL": (2, "NVDA", ""), "MUU": (2, "MU", ""), "GGLL": (2, "GOOGL", ""), "BITX": (2, "IBIT", "近似：IBIT 是現貨，BITX 是期貨"),
    "ETHU": (2, "ETHA", "近似：ETHA 是現貨，ETHU 是期貨"), "FNGU": (3, None, "NYSE FANG+ 指數沒有 1 倍 ETF"),
}
# 規模 1～10 億的槓桿 ETF（2026-11-08）：只放槓桿耗損頁，不進總覽。(倍數, 1 倍原型, 說明, 名稱)
# 同一原型有多檔的只取規模最大的；排除反向、VIX、2026 年上市、原油與天然氣（期貨轉倉成本會混進耗損）。
LEV_EXTRA = {
    "AAPU": (2, "AAPL", "", "Direxion Daily AAPL Bull 2X ETF"), "MSFU": (2, "MSFT", "", "Direxion Daily MSFT Bull 2X ETF"),
    "AMZU": (2, "AMZN", "", "Direxion Daily AMZN Bull 2X ETF"), "METU": (2, "META", "", "Direxion Daily META Bull 2X ETF"),
    "TSMX": (2, "TSM", "", "Direxion Daily TSM Bull 2X ETF"), "AMDL": (2, "AMD", "", "GraniteShares 2x Long AMD Daily ETF"),
    "AVL": (2, "AVGO", "", "Direxion Daily AVGO Bull 2X ETF"), "PTIR": (2, "PLTR", "", "GraniteShares 2x Long PLTR Daily ETF"),
    "ORCX": (2, "ORCL", "", "Defiance Daily Target 2X Long ORCL ETF"), "NFXL": (2, "NFLX", "", "Direxion Daily NFLX Bull 2X ETF"),
    "MSTU": (2, "MSTR", "", "T-Rex 2X Long MSTR Daily Target ETF"), "CONL": (2, "COIN", "", "GraniteShares 2x Long COIN Daily ETF"),
    "UDOW": (3, "DIA", "", "ProShares UltraPro Dow30"), "SPUU": (2, "SPY", "", "Direxion Daily S&P 500 Bull 2X ETF"),
    "URTY": (3, "IWM", "", "ProShares UltraPro Russell2000"), "LABU": (3, "XBI", "", "Direxion Daily S&P Biotech Bull 3X ETF"),
    "DFEN": (3, "ITA", "", "Direxion Daily Aerospace & Defense Bull 3X ETF"), "ERX": (2, "XLE", "", "Direxion Daily Energy Bull 2X ETF"),
    "CURE": (3, "XLV", "", "Direxion Daily Healthcare Bull 3X ETF"), "NUGT": (2, "GDX", "", "Direxion Daily Gold Miners Index Bull 2X ETF"),
    "YINN": (3, "FXI", "", "Direxion Daily FTSE China Bull 3X ETF"),
    "AGQ": (2, "SLV", "近似：AGQ 用白銀期貨、交換合約，SLV 持有現貨", "ProShares Ultra Silver"),
    "UGL": (2, "GLD", "近似：UGL 用黃金期貨、交換合約，GLD 持有現貨", "ProShares Ultra Gold"),
    "BITU": (2, "IBIT", "近似：BITU 用比特幣期貨、交換合約，IBIT 是現貨", "ProShares Ultra Bitcoin ETF"),
    "ETHT": (2, "ETHA", "近似：ETHT 用以太幣期貨、交換合約，ETHA 是現貨", "ProShares Ultra Ether ETF"),
}
LEV_ALL = {**LEVERAGE, **{t: v[:3] for t, v in LEV_EXTRA.items()}}
# 倍數改過的：耗損只用這天以後的資料（2026-11-08 用每季日報酬對原型的斜率檢查 45 檔，取最後一個舊倍數季度後約一個月）。
# 1.5 倍改 2 倍的是 Direxion、GraniteShares 2022 年上市的個股型；ERX、NUGT 是 Direxion 2020 年把 3 倍降成 2 倍；
# SPUU 2016～17 年斜率在 1.05～1.7 之間跳（當時成交少），從 2018 年起算。
LEV_SINCE = {
    "NVDL": ("2024-02-01", "1.5 倍"), "CONL": ("2024-02-01", "1.5 倍"),
    "TSLL": ("2024-05-01", "1.5 倍"), "GGLL": ("2024-05-01", "1.5 倍"), "AAPU": ("2024-05-01", "1.5 倍"),
    "MSFU": ("2024-05-01", "1.5 倍"), "AMZU": ("2024-05-01", "1.5 倍"),
    "ERX": ("2020-05-01", "3 倍"), "NUGT": ("2020-05-01", "3 倍"), "SPUU": ("2018-01-01", None),
}


def lev_note(t):
    note = LEV_ALL[t][2]
    if t in LEV_SINCE:
        d, old = LEV_SINCE[t]
        note = "；".join(v for v in (note, f"{d[:7]} 以前是 {old}，耗損只用之後的資料" if old else
                                      f"{d[:4]} 年以前和原型的連動不穩（當時成交少），耗損只用之後的資料") if v)
    return note
LABEL_NAME = {"約等於0050": "接近基準"}
# 屬性：細項是選股因子的，升為風格主項；規模字眼不當細項
FACTOR_UP = {"動能": "動能", "多因子": "多因子", "因子輪動": "多因子", "品質": "品質", "品質成長": "品質"}
# 風格大項（2026-11-08）：英文名稱含這些字、原本只標籠統的規模或成長價值的，改成這個風格（依序比對，先中先用）
STYLE_KW = [(r"Equal Weight", "等權重"), (r"Fundamental|RAFI", "基本面加權"), (r"Cash Flow|Cash Cow", "自由現金流"),
            (r"\bESG\b|Sustainab|Climate|Paris|Low Carbon|\bSRI\b", "ESG"), (r"Momentum", "動能"), (r"Quality", "品質")]
SIZE_WORDS = {"小型股", "中型股", "大型股", "小型價值股", "小型成長股", "中型成長股", "中型價值股"}
# 轉成 ETF 之前是場外交易的信託（溢價折價很大，例：ETHE 2019-06 單日 +400%），只用轉換後的價格。
# 名單的 inceptionDate 對 GBTC 已是轉換日，ETHE 寫的是信託成立日，另外指定。
START_OVERRIDE = {"ETHE": "2024-07-23"}


# 名單保護（2026-11-16）：名單固定、新增靠手動。每次更新比對 Nasdaq Trader 的公開代號檔（美國所有上市代號，每天更新），
# 代號整個不見的（下市、合併、改代號）就從名單剔除，寫進資料檔，發布前檢查會列出。
# 不用「ETF 欄是 N」來判斷：BAR 這類黃金信託在代號檔標成非 ETF，但價格正常。
# 基金改名但代號不變不受影響（網站用代號和自己的中文簡稱）。
NASDAQ_SYMBOLS = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt"


def check_listed(codes):
    """回傳 (要剔除的代號, 說明)。抓不到代號檔、代號檔太小、或不見的超過 5 檔且超過 5%（多半是來源出問題）時不剔除，只回說明。"""
    try:
        raw = sr.http(NASDAQ_SYMBOLS, sr.WEB_UA).decode("utf-8", errors="replace")
        lines = raw.splitlines()
        i = lines[0].split("|").index("Symbol")
        syms = {ln.split("|")[i] for ln in lines[1:] if ln.count("|") > i}
    except Exception as e:  # noqa: BLE001
        return [], f"抓不到 Nasdaq 代號檔（{type(e).__name__}），這次沒檢查名單"
    codes = list(codes)
    gone = sorted(c for c in codes if c not in syms)
    if len(syms) < 5000 or len(gone) > max(5, 0.05 * len(codes)):
        return [], f"Nasdaq 代號檔看起來不完整（{len(syms)} 個代號，名單有 {len(gone)} 檔不在），這次沒剔除"
    return gone, ""


def zone_of(r):
    """回傳 (分區, 排除原因)。"""
    cat, ac, s = r["etfCategory"], r["assetClass"], r["s"]
    if cat.startswith("Trading--Inverse"):
        return None, "反向"
    if cat.startswith("Trading--Leveraged") or s in ("BITX", "ETHU"):
        return "槓桿", ""
    if cat.startswith("Trading"):
        return None, f"交易型（{cat}）"
    if ac == "Equity" or ac == "Asset Allocation":
        return "股票", ""
    if ac == "Alternatives":
        return ("股票", "") if cat in EQUITY_ALT else (None, f"另類（{cat}）")
    return {"Fixed Income": ("債券", ""), "Commodity": ("原物料", ""), "Currency": ("加密貨幣", "")}.get(ac, (None, f"未分類（{ac}）"))


def yahoo_full(t):
    """完整日線（上市以來）。共用的 yahoo() 只能指定 range，20y 以上會變月線，所以這裡用 period1／period2。"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?period1=0&period2={int(time.time())}"
           f"&interval=1d&events=div%2Csplit")
    j = json.loads(sr.http(url, sr.WEB_UA))["chart"]["result"][0]
    tz = j.get("meta", {}).get("exchangeTimezoneName") or "America/New_York"
    ts = pd.to_datetime(j["timestamp"], unit="s", utc=True).tz_convert(tz).tz_localize(None).normalize()
    q = j["indicators"]["quote"][0]
    adj = j["indicators"].get("adjclose", [{}])[0].get("adjclose", q["close"])
    df = pd.DataFrame({"close": q["close"], "adj": adj}, index=ts)
    return df[~df.index.duplicated(keep="last")].dropna()


def fetch(t, cache_dir, refresh):
    """Yahoo 日資料（close、adj），存成 cache/{t}.csv；有快取且沒有 --refresh 時直接讀。回傳 (DataFrame, 是否新抓)。
    20 年的資料起點落在 20 年邊界上（上市更早、被截掉）而且早於 EXPORT_START 需要的時，用 yahoo_full() 補抓接縫以前的歷史，
    接縫以後沿用 yahoo() 的 20 年資料（它有處理盤中、空收盤等邊界情況）。
    補抓後發現沒有更早資料的（上市日剛好在 20 年邊界附近），記在 cache/_no_older.txt，之後不再重抓。"""
    p = os.path.join(cache_dir, f"{t}.csv")
    mark = os.path.join(cache_dir, "_no_older.txt")
    no_older = set(open(mark, encoding="utf-8").read().split()) if os.path.exists(mark) else set()
    if os.path.exists(p) and not refresh:
        df, new = pd.read_csv(p, index_col=0, parse_dates=True), False
    else:
        df, new = tw.yahoo_deadline(t)[["close", "adj"]].dropna(), True
    if (t not in no_older and df.index[0] > pd.Timestamp(EXPORT_START)
            and abs((df.index[0] - (df.index[-1] - pd.DateOffset(years=20))).days) < 15):
        full = yahoo_full(t)
        # 兩邊的 adj 基準可能不同（配息調整的時間點），用重疊期間的比例接起來
        ov = df.index.intersection(full.index)
        k = float((df.loc[ov, "adj"] / full.loc[ov, "adj"]).median())
        old = full[full.index < df.index[0]].copy()
        old["adj"] *= k
        if len(old):
            df, new = pd.concat([old, df]), True
        else:
            with open(mark, "a", encoding="utf-8") as f:
                f.write(t + "\n")
    if new:
        df.to_csv(p)
    # 價格 ≤ 0 的列是 Yahoo 的壞點（例：XT 2015-03-23 收盤 0），丟掉
    return df[(df["close"] > 0) & (df["adj"] > 0)], new


def drop_spikes(df, spy_r, leg=0.12, back=0.08, calm=0.015, mkt=0.02):
    """單日壞點：某天相對前後兩天一跌一漲（或一漲一跌）都超過 leg、兩天合計回到前一天的 ±back 以內，
    而且這檔平常很平穩（前 60 天日漲跌幅的中位數 < calm）、那兩天 SPY 也平穩（|日報酬| < mkt），
    才當成 Yahoo 的錯價丟掉（例：IMTM 2015-02-12 收 21.09，前一天 25.07、後一天 26.50）。
    後兩個條件是為了保留真實的劇烈波動：2008、2020-03 的大跌大漲，以及槓桿、加密貨幣、個股的正常波動
    （第一版沒有這兩個條件，抓出 190 幾天，幾乎都是真的）。回傳 (DataFrame, 丟掉的日期)。"""
    a = df["adj"]
    r1, r2 = a / a.shift(1) - 1, a.shift(-1) / a - 1
    typ = (a.pct_change().abs()).rolling(60, min_periods=10).median().shift(1)
    s = spy_r.reindex(a.index)
    quiet = (s.abs() < mkt) & (s.shift(-1).abs() < mkt)
    bad = ((r1.abs() > leg) & (r2.abs() > leg) & (r1 * r2 < 0) & ((1 + r1) * (1 + r2) - 1).abs().lt(back)
           & typ.lt(calm) & quiet)
    return df[~bad], [d.date().isoformat() for d in df.index[bad]]


def div_part(df):
    """每日的股息貢獻 d = adj 報酬 − close 報酬。沒配息的日子只有浮點雜訊（約 ±1.3e-6），d < 1e-5（含負值）當 0。"""
    d = df["adj"].pct_change() - df["close"].pct_change()
    return d.where(d >= 1e-5, 0.0).fillna(0.0)


def taxed(df, rate):
    """扣稅版的價格序列（起點同 adj）。rate = 0 時就是 adj。"""
    if rate == 0:
        return df["adj"]
    r = df["adj"].pct_change().fillna(0.0) - rate * div_part(df)
    return df["adj"].iloc[0] * (1 + r).cumprod()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True)
    ap.add_argument("--tags", required=True)
    ap.add_argument("--names", help="中文簡稱、細題材、區域（lists/us-etf-names.csv）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--export")
    ap.add_argument("--only", help="只跑這幾檔（逗號分隔，測試用）；基準與原型會自動加入")
    ap.add_argument("--refresh", action="store_true", help="忽略快取重抓")
    ap.add_argument("--asof", default=dt.date.today().isoformat())
    ap.add_argument("--tax", type=float, default=0.30, help="股息預扣稅率（台灣居民 30%）")
    ap.add_argument("--burst", type=float, default=0.075)
    ap.add_argument("--tie", type=float, default=0.015)
    ap.add_argument("--near-dd", type=float, default=0.03)
    ap.add_argument("--verify-tie", type=float, default=0.01)
    ap.add_argument("--crash", type=float, default=0.20, help="空頭驗證的大空頭門檻（股票、原物料、加密貨幣、槓桿區）；2026-11-08 從 25%% 改 20%%（熊市的慣用定義）")
    ap.add_argument("--crash-bond", type=float, default=0.10, help="債券區的大空頭門檻（AGG 史上最大回撤約 18%，25% 會永遠沒有空頭）")
    ap.add_argument("--hv", type=float, default=0.05)
    ap.add_argument("--epth", type=float, default=0.15)
    ap.add_argument("--sleep", type=float, default=0.3)
    a = ap.parse_args()
    cache_dir = os.path.join(a.out, "cache")
    os.makedirs(cache_dir, exist_ok=True)

    lst = pd.read_csv(a.list, encoding="utf-8-sig", dtype=str, keep_default_na=False)
    raw_export = "etfCategory" in lst.columns   # stockanalysis 的原始匯出（只在本機用）；公開的名單只有代號、名稱、成立日和算好的分區
    if raw_export:
        zx = lst.apply(zone_of, axis=1, result_type="expand")
        lst["zone"], lst["excluded"] = zx[0], zx[1]
    else:
        lst["excluded"] = ""
    a.list_gone, a.list_note = gone, list_note = check_listed(lst["s"])
    if gone:
        lst = lst[~lst["s"].isin(gone)].reset_index(drop=True)
    print("名單檢查：剔除", gone or "無", list_note, flush=True)
    # 名單本身的更新日（和價格分開）：lists/us-etf-asof.txt，手動更新名單時一起改
    asof_file = os.path.splitext(a.list)[0] + "-asof.txt"
    a.list_asof = open(asof_file, encoding="utf-8").read().strip() if os.path.exists(asof_file) else None
    tags = pd.read_csv(a.tags, encoding="utf-8-sig", dtype=str).set_index("s")
    for c_src, c_dst in (("主題材", "theme"), ("次題材", "theme2"), ("區域", "region"), ("國家", "country"), ("信心", "tag_conf")):
        lst[c_dst] = lst["s"].map(tags[c_src]).fillna("")
    # 股票區沒有題材標籤的（緩衝型、目標收益、資產配置），用晨星分類補一個類型
    alt_type = {"Defined Outcome": "緩衝型", "Derivative Income": "選擇權收益", "Equity Hedged": "避險型"}
    fill = (lst["zone"] == "股票") & (lst["theme"] == "")
    lst.loc[fill, "theme"] = ([alt_type.get(c, "股債配置") for c in lst.loc[fill, "etfCategory"]] if raw_export
                              else lst.loc[fill, "fill_type"].replace("", "股債配置").tolist())
    # 中文簡稱、細題材、重標的區域（lists/us-etf-names.csv）：
    # 細題材有填就取代次題材；區域只用在股票區（其他區不分地區），國際拆成「國際已開發」「國際含新興」
    names = pd.read_csv(a.names, encoding="utf-8-sig", dtype=str, keep_default_na=False).set_index("s") if a.names else None
    lst["cn"] = lst["s"].map(names["簡稱"]).fillna("") if names is not None else ""
    lst["note"] = lst["s"].map(names["備註"]).fillna("") if names is not None and "備註" in names.columns else ""
    if names is not None:
        fine = lst["s"].map(names["細題材"]).fillna("")
        lst["theme2"] = fine.where(fine != "", lst["theme2"])
        # 風格只留一層（2026-11-08）：規模、成長價值底下的因子細項升為主項；
        # 細項是另一個主項的名稱、規模字眼，或和主項重疊（例：緩衝型／緩衝）的不留
        up = lst["theme"].isin(["大型", "中小型", "成長", "價值"]) & lst["theme2"].isin(FACTOR_UP)
        lst.loc[up, "theme"] = lst.loc[up, "theme2"].map(FACTOR_UP)
        lst.loc[up, "theme2"] = ""
        for pat, sty in STYLE_KW:
            hit = (lst["zone"] == "股票") & lst["theme"].isin(["大型", "中小型", "成長", "價值"]) & lst["n"].str.contains(pat, case=False, regex=True)
            lst.loc[hit, "theme"] = sty
        # 人工核對過的屬性（names 的「屬性」欄，2026-11-08 稽核）最後套用，蓋過上面的關鍵字規則
        if "屬性" in names.columns:
            man = lst["s"].map(names["屬性"]).fillna("")
            lst["theme"] = man.where(man != "", lst["theme"])
        mains = set(lst.loc[lst["zone"] == "股票", "theme"])
        # 細項「中小型」掛在風格、因子、股利等主項底下時保留（2026-11-08）
        # 重複判斷只看股票區（槓桿區的細項是原型，例「半導體」，和股票區屬性同名但要留）
        ov = [z == "股票" and b != "" and not (b == "中小型" and a not in ("中小型", "大型"))
              and (b in mains or b in SIZE_WORDS or (a != "" and (a in b or b in a)))
              for z, a, b in zip(lst["zone"], lst["theme"], lst["theme2"])]
        lst.loc[ov, "theme2"] = ""
        stock = lst["zone"] == "股票"
        lst.loc[stock, "region"] = lst.loc[stock, "s"].map(names["區域"]).fillna(lst.loc[stock, "region"])
        lst.loc[stock, "country"] = lst.loc[stock, "s"].map(names["國家"]).fillna("")
    lst["lev_x"] = lst["s"].map(lambda s: LEVERAGE.get(s, (None,))[0])
    lst["lev_under"] = lst["s"].map(lambda s: LEVERAGE.get(s, (None, None))[1])
    lst["lev_note"] = lst["s"].map(lambda s: LEVERAGE.get(s, (None, None, ""))[2])
    keep = lst[lst["excluded"] == ""].copy()
    if a.only:
        keep = keep[keep["s"].isin(a.only.split(","))]

    need = list(dict.fromkeys(list(ZONE_BENCH.values()) + keep["s"].tolist()
                              + [u for u in keep["lev_under"].dropna() if u]
                              + [x for t, v in LEV_EXTRA.items() for x in (t, v[1])]))
    raw, fails, fetched, trimmed, spikes = {}, {}, 0, {}, {}
    inception = dict(zip(lst["s"], lst["inceptionDate"]))
    t0 = time.time()
    for i, t in enumerate(need):
        try:
            raw[t], new = fetch(t, cache_dir, a.refresh)
            # 名單上的成立日之前的價格丟掉（信託轉 ETF 的那幾檔）；原型個股不在名單裡，不受影響
            st = START_OVERRIDE.get(t) or inception.get(t)
            if st and raw[t].index[0] < pd.Timestamp(st) - pd.Timedelta(days=7):
                raw[t] = raw[t][raw[t].index >= pd.Timestamp(st)]
                trimmed[t] = st
            if new:
                fetched += 1
                time.sleep(a.sleep)
        except Exception as e:  # noqa: BLE001
            fails[t] = str(e)[:120]
            if "429" in str(e):
                print(f"Yahoo 回 429，停在第 {i + 1}/{len(need)} 檔；重跑會從快取接著抓", flush=True)
                break
        if (i + 1) % 100 == 0:
            print(f"{i + 1}/{len(need)}，新抓 {fetched}，失敗 {len(fails)}，{time.time() - t0:.0f} 秒", flush=True)
    print(f"抓取完成：{len(raw)}/{len(need)}，新抓 {fetched}，失敗 {len(fails)}，{time.time() - t0:.0f} 秒", flush=True)
    spy_r = raw["SPY"]["adj"].pct_change()
    for t in list(raw):
        raw[t], sp = drop_spikes(raw[t], spy_r)
        if sp:
            spikes[t] = sp

    jumps = []
    for t, df in raw.items():
        lim = 0.6 if t in LEV_ALL or lst.loc[lst["s"] == t, "zone"].eq("加密貨幣").any() else 0.25
        r = df["adj"].pct_change().dropna()
        jumps += [{"ticker": t, "date": d.date().isoformat(), "ret": round(float(v), 4)} for d, v in r[r.abs() > lim].items()]

    spy = raw["SPY"]["adj"]
    end = spy[spy.index <= pd.Timestamp(a.asof)].index[-1]
    starts = {n: spy[spy.index <= end - pd.DateOffset(years=n)].index[-1] for n in WINDOWS}

    rows, lev_rows, ver = [], [], {}
    for rate in (0.0, a.tax):
        px = {t: taxed(df, rate) for t, df in raw.items()}
        for zone, bt in ZONE_BENCH.items():
            if bt not in px:
                continue
            b = px[bt]
            eps = tw.crashes(b, a.crash_bond if zone == "債券" else a.crash)
            zd = ZONE_DEFAULTS.get(zone, {})
            z_burst, z_tie, z_near = zd.get("burst", a.burst), zd.get("tie", a.tie), zd.get("near_dd", a.near_dd)
            zk = keep[keep["zone"] == zone]
            for _, r in zk.iterrows():
                if r["s"] in px:
                    ver[(r["s"], rate)] = tw.verify(px[r["s"]], b, end, eps, a.verify_tie)
            for n in WINDOWS:
                bm = tw.window_metrics(b, starts[n], end, z_burst)
                if bm is None:  # 基準在這個期間還沒上市（例：IBIT 2024-01，加密貨幣區沒有 3、5 年）
                    continue
                for _, r in zk.iterrows():
                    t = r["s"]
                    if t not in px:
                        continue
                    m = tw.window_metrics(px[t], starts[n], end, z_burst, bench=b, mkt=px["SPY"])
                    if m is None:
                        continue
                    lab = tw.label(m, bm, z_tie, z_near)
                    m.update({"ticker": t, "name": r["n"], "zone": zone, "bench": bt, "theme": r["theme"],
                              "region": r["region"], "window": n, "tax": rate,
                              "bench_cagr": bm["cagr"], "bench_mdd": bm["mdd"], "label": LABEL_NAME.get(lab, lab),
                              "burst": tw.burst(m, bm, z_tie), "verified": ver[(t, rate)][0],
                              "life_cagr_diff": ver[(t, rate)][1]})
                    rows.append(m)
        if rate == 0.0:
            for t, (x, u, _) in LEV_ALL.items():
                if t not in px or (u and u not in px):
                    continue
                note, first = lev_note(t), px[t].index[0]
                if t in LEV_SINCE:
                    first = max(first, pd.Timestamp(LEV_SINCE[t][0]))
                for n in WINDOWS:
                    s0 = starts[n]
                    if not u or first > s0 + pd.Timedelta(days=7) or px[u].index[0] > s0 + pd.Timedelta(days=7):
                        lev_rows.append({"ticker": t, "x": x, "under": u, "window": n, "note": "；".join(v for v in (note, "期間內資料不足" if u else "") if v)})
                        continue
                    def tot(s):
                        p = s[(s.index >= s[s.index <= s0].index[-1]) & (s.index <= end)]
                        return p.iloc[-1] / p.iloc[0] - 1
                    lr, ur = tot(px[t]), tot(px[u])
                    lev_rows.append({"ticker": t, "x": x, "under": u, "window": n, "lev_ret": lr, "under_ret": ur,
                                     "gap": lr - x * ur, "note": note})

    out = pd.DataFrame(rows)
    out.to_csv(os.path.join(a.out, "metrics.csv"), index=False, encoding="utf-8-sig")
    pd.DataFrame(lev_rows).to_csv(os.path.join(a.out, "leverage.csv"), index=False, encoding="utf-8-sig")
    lst["first_price"] = lst["s"].map(lambda t: raw[t].index[0].date().isoformat() if t in raw else None)
    lst.to_csv(os.path.join(a.out, "etf_list.csv"), index=False, encoding="utf-8-sig")
    if a.export:
        export(a, keep, raw, end)
    meta = {"asof_requested": a.asof, "end": end.date().isoformat(),
            "starts": {str(k): v.date().isoformat() for k, v in starts.items()},
            "zone_bench": ZONE_BENCH, "tax": a.tax, "burst": a.burst, "tie": a.tie, "near_dd": a.near_dd,
            "crash": a.crash, "crash_bond": a.crash_bond, "verify_tie": a.verify_tie, "export_start": EXPORT_START,
            "n_list": int(len(lst)), "n_kept": int(len(keep)),
            "excluded_counts": lst[lst["excluded"] != ""]["excluded"].value_counts().to_dict(),
            "zone_counts": keep["zone"].value_counts().to_dict(),
            "n_rows": {f"tax{k[0]}_{k[1]}y": int(v) for k, v in out.groupby(["tax", "window"]).size().items()} if len(out) else {},
            "fetch_fail": fails, "trimmed_before_inception": trimmed, "spikes_dropped": spikes, "suspect_jumps": jumps, "generated": dt.datetime.now().isoformat(timespec="seconds")}
    with open(os.path.join(a.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1, default=str)
    print(json.dumps({k: meta[k] for k in ("end", "starts", "n_kept", "zone_counts", "excluded_counts", "n_rows")},
                     ensure_ascii=False, default=str))
    print("fetch_fail", len(fails), "suspect_jumps", len(jumps))


def export(a, keep, raw, end):
    """網站用的資料：EXPORT_START 起每個 SPY 交易日的 adj（含息全額再投入），各檔對齊 SPY 的交易日；
    另存配息日的股息貢獻 dv = [[位置, d], ...]，頁面用它即時算扣稅版（日報酬 − 稅率 × d）。
    基準、原型（不在名單裡的個股）放 ref。格式沿用台股版 export_page_data()，多了 z（分區）、dv、槓桿欄位。"""
    spy = raw["SPY"]["adj"]
    dates = spy[(spy.index >= pd.Timestamp(EXPORT_START)) & (spy.index <= end)].index
    sig = lambda x: None if x is None or (isinstance(x, float) and math.isnan(x)) else float(f"{x:.5g}")

    def pack(df):
        df = df[df.index <= end]
        p = df["adj"].reindex(dates).ffill()
        p[p.index < df.index[0]] = np.nan
        vals = [sig(x) for x in p.values]
        i0 = next((i for i, v in enumerate(vals) if v is not None), None)
        if i0 is None:
            return None
        # 股息貢獻對齊到 SPY 交易日：同一個交易日內的配息貢獻加總
        d = div_part(df)
        d = d[(d != 0) & (d.index >= dates[i0])]
        pos = dates.searchsorted(d.index)
        agg = {}
        for i, v in zip(pos, d.values):
            if i < len(dates):
                agg[int(i - i0)] = agg.get(int(i - i0), 0.0) + float(v)
        dv = [[i, round(v, 6)] for i, v in sorted(agg.items())]
        return {"first": df.index[0].date().isoformat(), "i0": i0, "p": vals[i0:], "dv": dv}

    etfs, skipped = [], []
    for _, r in keep.iterrows():
        t = r["s"]
        pk = pack(raw[t]) if t in raw else None
        if pk is None:
            skipped.append(t)
            continue
        e = {"c": t, "n": r["n"], "cn": r["cn"], "z": r["zone"], "t": r["theme"], "t2": r["theme2"], "r": r["region"], "k": r["country"], **pk}
        if r.get("note"):   # 特殊結構的短說明（names 的「備註」欄），網頁在代號旁顯示「*」
            e["nb"] = r["note"]
        if pd.notna(r["lev_x"]):
            e.update({"x": int(r["lev_x"]), "u": r["lev_under"] if isinstance(r["lev_under"], str) and r["lev_under"] else None,
                      "nt": lev_note(t)})
            if t in LEV_SINCE:
                e["ls"] = LEV_SINCE[t][0]
        etfs.append(e)
    in_list = {e["c"] for e in etfs}
    # 只在槓桿耗損頁出現的（規模 1～10 億），和總覽的 etfs 分開放
    lev_extra = []
    cn = (dict(pd.read_csv(a.names, encoding="utf-8-sig", dtype=str, keep_default_na=False)[["s", "簡稱"]].values)
          if a.names else {})
    for t, (x, u, note, name) in LEV_EXTRA.items():
        pk = pack(raw[t]) if t in raw else None
        if pk is None:
            skipped.append(t)
            continue
        lev_extra.append({"c": t, "n": name, "cn": cn.get(t, ""), "x": x, "u": u, "nt": lev_note(t), **pk,
                          **({"ls": LEV_SINCE[t][0]} if t in LEV_SINCE else {})})
    ref_t = set(ZONE_BENCH.values()) | {u for u in keep["lev_under"].dropna() if u} | {v[1] for v in LEV_EXTRA.values()}
    ref = {t: pack(raw[t]) for t in sorted(ref_t - in_list) if t in raw}
    data = {"end": end.date().isoformat(), "zone_bench": ZONE_BENCH, "market": "SPY", "export_start": EXPORT_START,
            "defaults": {"weeks": 1, "burst": a.burst, "tie": a.tie, "near_dd": a.near_dd, "crash": a.crash,
                         "crash_bond": a.crash_bond, "verify_tie": a.verify_tie, "hv": a.hv, "epth": a.epth, "tax": a.tax},
            "dates": [int((d - pd.Timestamp("1970-01-01")).days) for d in dates],
            "zone_defaults": ZONE_DEFAULTS,
            "ref": ref, "skipped": skipped, "etfs": etfs, "lev_extra": lev_extra,
            "list_asof": a.list_asof, "list_gone": a.list_gone, "list_note": a.list_note}
    os.makedirs(os.path.dirname(os.path.abspath(a.export)), exist_ok=True)
    with open(a.export, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    print(f"export：{len(etfs)} 檔，{os.path.getsize(a.export) / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
