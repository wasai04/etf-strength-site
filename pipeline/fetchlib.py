"""網站資料腳本共用的下載函式：HTTP 下載（逾時、重試）與 Yahoo 日線。

連線強制 IPv4：部分網路環境經 IPv6 連 Yahoo 很慢、偶爾整個卡住。
"""
import json
import socket
import time
import urllib.error
import urllib.request
from http.client import IncompleteRead

import pandas as pd

_getaddrinfo = socket.getaddrinfo
socket.getaddrinfo = lambda host, port, family=0, *a, **k: _getaddrinfo(host, port, socket.AF_INET, *a, **k)

WEB_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def _fetch(open_fn, req, tries=3, total=90):
    """下載一個網址：單次讀取逾時 30 秒、整份下載超過 total 秒就中斷；
    斷線、逾時、IncompleteRead、5xx、429 重試，最多 tries 次。其他 HTTP 錯誤（404 等）直接拋出。"""
    last = None
    for k in range(tries):
        t0 = time.monotonic()
        try:
            with open_fn(req, timeout=30) as r:
                buf = bytearray()
                while True:
                    b = r.read(1 << 16)
                    if not b:
                        return bytes(buf)
                    buf += b
                    if time.monotonic() - t0 > total:
                        raise TimeoutError(f"下載超過 {total} 秒：{req.full_url}")
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (IncompleteRead, urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout) as e:
            last = e
        time.sleep(2 * (k + 1))
    raise last


def http(url, headers):
    return _fetch(urllib.request.urlopen, urllib.request.Request(url, headers=headers))


def yahoo(ticker, rng="20y"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range={rng}&interval=1d&events=div%2Csplit"
    j = json.loads(http(url, WEB_UA))["chart"]["result"][0]
    # 日期用交易所時區標（TWD=X 是倫敦時間；用 UTC 標會在夏令時間差一天）
    tz = j.get("meta", {}).get("exchangeTimezoneName") or "UTC"
    ts = pd.to_datetime(j["timestamp"], unit="s", utc=True).tz_convert(tz).tz_localize(None).normalize()
    q = j["indicators"]["quote"][0]
    adj = j["indicators"].get("adjclose", [{}])[0].get("adjclose", q["close"])
    df = pd.DataFrame({"close": q["close"], "adj": adj, "volume": q["volume"]}, index=ts)
    df = df[~df.index.duplicated(keep="last")]
    # 收盤後執行時，當天那根 K 棒的收盤常是空的；meta 的 regularMarketPrice 是同一天收盤後的價格，用它補上
    meta = j.get("meta", {})
    # 收盤時刻用交易所時區（美股 16:00、台股 13:30），取自 currentTradingPeriod；沒有時當成美股
    reg_end = meta.get("currentTradingPeriod", {}).get("regular", {}).get("end")
    close_min = 16 * 60
    if reg_end:
        e = pd.Timestamp(reg_end, unit="s", tz="UTC").tz_convert(tz)
        close_min = e.hour * 60 + e.minute
    df.attrs["close_source"] = "chart"
    if len(df) and pd.isna(df["close"].iloc[-1]) and meta.get("regularMarketPrice") and meta.get("regularMarketTime"):
        mt = pd.Timestamp(meta["regularMarketTime"], unit="s", tz="UTC").tz_convert(tz)
        if mt.date() == df.index[-1].date() and mt.hour * 60 + mt.minute >= close_min:
            df.iloc[-1, df.columns.get_loc("close")] = df.iloc[-1, df.columns.get_loc("adj")] = meta["regularMarketPrice"]
            df.attrs["close_source"] = "meta.regularMarketPrice（當天 K 棒收盤為空）"
    # 近 10 根裡收盤為空的（不只最後一根），用 1 小時 K 棒當天最後一根的收盤補；更早的空值直接丟掉，日期列出
    gaps = [d for d in df.index[-10:] if pd.isna(df.at[d, "close"])]
    if gaps:
        try:
            h = json.loads(http(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=1mo&interval=1h", WEB_UA))["chart"]["result"][0]
            hs = pd.Series(h["indicators"]["quote"][0]["close"],
                           index=pd.to_datetime(h["timestamp"], unit="s", utc=True).tz_convert("America/New_York")).dropna()
            last = hs.groupby(hs.index.date).last()
            filled = [d for d in gaps if d.date() in last.index]
            for d in filled:
                df.at[d, "close"] = df.at[d, "adj"] = float(last[d.date()])
            if filled:
                df.attrs["filled_from_1h"] = [d.date().isoformat() for d in filled]
        except Exception:
            pass
    df.attrs["dropped_null_close"] = [d.date().isoformat() for d in df.index[df["close"].isna()]][-10:]
    df = df.dropna(subset=["close"])
    # 停市日 Yahoo 會沿用前一天收盤、成交量 0（例：台股 2026-10-23）；平常有成交量的標的，近 10 根裡這種 K 棒丟掉並列出
    vol = df["volume"].fillna(0)
    if len(df) > 15 and (vol.iloc[-70:-10] > 0).mean() > 0.9:
        stale = [d for d in df.index[-10:] if vol[d] == 0]
        df.attrs["dropped_zero_volume"] = [d.date().isoformat() for d in stale]
        df = df.drop(stale)
    # 盤中執行時，最後一根是當天的即時價，不是收盤價；交易所收盤 5 分鐘內（含）以前把它拿掉。
    # 用交易所時區判斷（舊版一律用美東時間，台北晚上跑上櫃 .TWO 時會把當天已收盤的 K 棒丟掉）
    now_ex = pd.Timestamp.now(tz=tz)
    if len(df) and df.index[-1].date() == now_ex.date() and now_ex.hour * 60 + now_ex.minute < close_min + 5:
        df = df.iloc[:-1]
        df.attrs["dropped_intraday"] = now_ex.date().isoformat()
    return df
