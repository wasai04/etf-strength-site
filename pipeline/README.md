# pipeline：網站資料怎麼產生

網站的兩個資料檔（台股 `data.json`、美股 `us/data.json`）不放在 repo 裡，由 GitHub Actions（`.github/workflows/update-data.yml`）每週產生、存成 Release，再和網頁一起發布到 GitHub Pages。

## 檔案

- `tw_etf_strength.py`：台股。名單從證交所 ISIN 公開頁抓，價格用 Yahoo 含息還原價，可疑的價格拿證交所／櫃買中心的官方漲跌幅核對。
- `us_etf_strength.py`：美股。名單、題材、中文簡稱在 `lists/`；分類的計算沿用台股版的函式。
- `fetchlib.py`：兩支共用的下載函式（逾時、重試、Yahoo 日線）。
- `check_data.py`：發布前檢查，和上一版比，有大問題就不發布。
- `lists/`：美股名單（`us-etf.csv`：代號、名稱、成立日和算好的分區；名單取自 stockanalysis.com 規模 10 億美元以上，原始匯出不放進 repo）、題材、中文簡稱與屬性。

## 每週自動更新

- 每週六台北早上 9 點跑（週五美股、台股都收盤後），資料截至最近一個週五。
- 檢查沒過或抓取失敗：網站維持上一版，開一張標籤 `data-update` 的 Issue；週日、週一同一時間自動重試。成功後自動關掉那張 Issue。
- 網頁的「說明」頁會寫資料截至哪天、幾天前；超過 10 天沒更新會加一句提示。

## 手動操作

在 Actions 頁 → update-data → Run workflow：

- **重抓**：mode 選 `update`。
- **退回某一版**：mode 選 `redeploy`，tag 填那一版（例如 `data-2026-11-13`）。
- **自己修正後發布**：本機跑腳本、修好，`gh release create data-2026-11-13-fix data.json us-data.json`，再用 `redeploy` 填這個 tag。
- **暫停自動更新**：Actions 頁把 update-data 停用（Disable workflow）。

## 本機執行

```
pip install -r requirements.txt
python -X utf8 tw_etf_strength.py --asof 2026-11-13 --out ../out/tw --export ../new/data.json
python -X utf8 us_etf_strength.py --asof 2026-11-13 --list lists/us-etf.csv --tags lists/us-etf-tags.csv --names lists/us-etf-names.csv --out ../out/us --export ../new/us-data.json
python -X utf8 check_data.py --new ../new --prev 上一版目錄 --report ../report.md
```

美股版有快取（`--out` 底下的 `cache/`），要抓新價格加 `--refresh`。
