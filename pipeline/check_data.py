"""發布前檢查：新產生的資料檔和上一版比，有大問題就擋下（結束碼 1），小問題只列出來。

用法：
    python check_data.py --new 新版目錄 [--prev 上一版目錄] --report 報告.md

目錄裡要有 data.json（台股）和 us-data.json（美股）。沒有上一版（第一次）時只做基本檢查。

擋下（任一項）：
    - 資料截止日沒有比上一版新，或晚於今天
    - 檔數比上一版少超過 5%
    - 檔案大小和上一版差超過 30%
    - 和上一版截止日相比漲跌異常的檔數超過 2%（一般 ETF 超過 ±40%，槓桿、加密貨幣超過 ±80%）
只列出：
    - 抓不到、被跳過的代號（skipped）
    - 漲跌異常的檔（不到 2% 時）
    - 和上一版相比消失或新出現的代號
"""
import argparse
import datetime as dt
import json
import os
import sys

DAY = 86400


def load(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        return None, 0
    with open(p, encoding="utf-8") as f:
        return json.load(f), os.path.getsize(p)


def price_at(x, dates, day):
    """這檔在某一天（日數）的價格；那天不在資料裡或還沒上市時回 None。"""
    try:
        i = dates.index(day)
    except ValueError:
        return None
    k = i - x.get("i0", 0)
    p = x["p"]
    return p[k] if 0 <= k < len(p) and p[k] is not None else None


def is_wild(x, market):
    if market == "tw":
        return x.get("t") == "槓桿"
    return bool(x.get("x")) or x.get("z") == "加密貨幣"


def check(market, new, nsize, prev, psize, hard, soft):
    tag = {"tw": "台股", "us": "美股"}[market]
    if new is None:
        hard.append(f"{tag}：新版資料檔不存在")
        return
    today = dt.date.today().isoformat()
    n_new = len(new["etfs"])
    soft.append(f"{tag}：資料截至 {new['end']}，{n_new} 檔，{nsize / 1e6:.1f} MB")
    if new["end"] > today:
        hard.append(f"{tag}：資料截止日 {new['end']} 晚於今天 {today}")
    if new.get("skipped"):
        soft.append(f"{tag}：抓不到或跳過的代號：{'、'.join(new['skipped'])}")
    if prev is None:
        return
    if new["end"] <= prev["end"]:
        hard.append(f"{tag}：資料截止日 {new['end']} 沒有比上一版 {prev['end']} 新")
    n_prev = len(prev["etfs"])
    if n_new < n_prev * 0.95:
        hard.append(f"{tag}：檔數 {n_new} 比上一版 {n_prev} 少超過 5%")
    if psize and abs(nsize / psize - 1) > 0.30:
        hard.append(f"{tag}：檔案大小 {nsize / 1e6:.1f} MB，上一版 {psize / 1e6:.1f} MB，差超過 30%")
    pc, nc = {x["c"] for x in prev["etfs"]}, {x["c"] for x in new["etfs"]}
    if pc - nc:
        soft.append(f"{tag}：這版少了：{'、'.join(sorted(pc - nc))}")
    if nc - pc:
        soft.append(f"{tag}：這版新出現：{'、'.join(sorted(nc - pc))}")
    # 從上一版的截止日到這一版的截止日，漲跌異常的檔
    pend = (dt.date.fromisoformat(prev["end"]) - dt.date(1970, 1, 1)).days
    nend = new["dates"][-1]
    wild = []
    for x in new["etfs"]:
        a, b = price_at(x, new["dates"], pend), price_at(x, new["dates"], nend)
        if a is None or b is None or a <= 0:
            continue
        r = b / a - 1
        if abs(r) > (0.80 if is_wild(x, market) else 0.40):
            wild.append(f"{x['c']} {r * 100:+.1f}%")
    if wild:
        msg = f"{tag}：上一版截止日到這一版漲跌異常的有 {len(wild)} 檔：{'、'.join(wild[:30])}" + ("…" if len(wild) > 30 else "")
        (hard if len(wild) > n_new * 0.02 else soft).append(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--new", required=True)
    ap.add_argument("--prev")
    ap.add_argument("--report", required=True)
    a = ap.parse_args()
    hard, soft = [], []
    for market, name in [("tw", "data.json"), ("us", "us-data.json")]:
        new, ns = load(a.new, name)
        prev, ps = load(a.prev, name) if a.prev else (None, 0)
        check(market, new, ns, prev, ps, hard, soft)
    lines = ["## 結果：" + ("擋下，網站維持上一版" if hard else "通過"), ""]
    if hard:
        lines += ["### 擋下的原因", ""] + [f"- {h}" for h in hard] + [""]
    lines += ["### 紀錄", ""] + [f"- {s}" for s in soft]
    with open(a.report, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(1 if hard else 0)


if __name__ == "__main__":
    main()
