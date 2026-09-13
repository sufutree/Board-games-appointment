# 桌遊揪團站

依照 `桌遊揪團站_建置指導書.md` 建置的純靜態網站。詳細規格、資料模型、驗收標準都在該文件，這裡只記錄「怎麼把它跑起來」與實作時的取捨。

## 本機預覽（不需要真的部署 Apps Script）

`js/api.js` 支援網址參數 `?api=<url>` 暫時覆寫 API 位置。搭配 `scripts/dev-mock-server.mjs`（一個用純 Node 寫的假後端，實作跟 `apps-script/Code.gs` 一樣的 GET/POST 合約，資料存在 `scripts/.dev-mock-data.json`），可以在還沒有真正的 Google Sheet／Apps Script 之前，完整跑一次「開團→投票→定案→報名→可玩清單」流程。

```
# 一個視窗：啟動假後端
node scripts/dev-mock-server.mjs

# 另一個視窗：啟動靜態伺服器
npx serve .   # 或 python -m http.server 8791

# 瀏覽器打開
http://localhost:8791/?api=http://localhost:8788
```

假後端內建 4 個測試成員（測試-Sufu／測試-阿明／測試-阿華／測試-桌遊社）跟 2 個測試場地。主密碼固定是 `sufutree`；「測試-阿明」示範已設個人密碼 `1234`，其他人密碼留空（示範「還沒設密碼」的狀況，見下方權限模型說明）。想重置就刪掉 `scripts/.dev-mock-data.json`。**這整套只是本機測試用，`scripts/` 已被 `.vercelignore` 排除，不會進部署。**

我已經用這套流程實際跑過（Playwright 自動化 + 直接打 API）驗證：首頁空狀態、遊戲庫 181 款（含篩選、持有者標籤、缺資料標示、反查地點/持有者）、開新團表單、投票即時計數、定案自動加入報名名單、可玩清單依 §3.3 規則正確聯集並標示來源、以及下面權限模型的各種密碼情境，全部行為正常，主控台無錯誤。過程中抓到一個真的 CSS bug 並修掉了：`.modal-overlay { display:flex }` 蓋掉了瀏覽器對 `hidden` 屬性的預設隱藏，導致密碼輸入框在首頁一開啟就跳出來；已加上 `.modal-overlay[hidden] { display: none; }` 修正。

## 權限模型（跟原始指導書不同，是後續對話中議定的變更）

指導書 §6.5／§11 原本設計是「全站共用一組密碼」。後來改成：

- **每個成員有自己的密碼**：`members` 分頁新增一欄 `password`（明碼存放，跟指導書 §11「密碼不是真的安全」的既有假設一致，方便朋友自己在 Sheet 上設定/修改）。**這一欄空白 = 這個人還沒設密碼，此時任何輸入（包含空白）都算通過**，這樣還沒設密碼的人不會被卡住，可以陸續請大家自己去 Sheet 補密碼。
- **主密碼固定是 `sufutree`**，只有 Sufu 知道，可以做任何人的任何動作（開團／投票／定案／取消／報名退出，不限本人）。這個值直接寫死在 [apps-script/Code.gs](apps-script/Code.gs) 的 `MASTER_PASSWORD`，**沒有放在指令碼屬性**——這是刻意的取捨（你要求固定值），代價是如果這個 repo 之後變成公開的，原始碼裡看得到這個密碼；只要 repo 維持現在的私有狀態就沒差，之後真的要改主密碼就是直接改這個檔案再重新部署。
- **每個寫入動作都對應一個「本人」member_id**：投票、報名／退出＝操作者自己；開團、定案、**取消**＝該團的發起人 `creator_id`。伺服器端只認「主密碼 或 該 member_id 自己的密碼」兩種，其他一律回 `BAD_SECRET`。
- 前端「點自己的名字」選身分時，會順便問那個人的密碼並記在瀏覽器裡（`localStorage`），之後同一身分的動作（投票、報名）就不用再輸入；操作別人（例如發起人以外的人要取消團）則每次都會跳密碼框。
- **一個重要的安全修正**：`bootstrap` 回傳給所有訪客的資料絕對不能包含密碼欄位（不然任何人打開瀏覽器開發者工具都能看到每個人的密碼），[apps-script/Code.gs](apps-script/Code.gs) 的 `bootstrap()` 跟 `scripts/dev-mock-server.mjs` 都已經在回傳前把 `password` 欄位濾掉，我有直接打 API 驗證過回應裡確實沒有這個欄位。

**members 分頁的表頭因此要改成**：`id | name | type | active | password`（比指導書 §4.2 原本寫的多一欄）。

## 目前的 TODO（§0 動工前需要需求方提供）

- [ ] **Apps Script Web App 部署網址** → 填入 [js/api.js](js/api.js) 的 `DEFAULT_APPS_SCRIPT_URL`（目前是 `TODO_APPS_SCRIPT_URL` 佔位字串）。
- [ ] **成員名單** → 填入 Google 試算表 `members` 分頁，記得包含 `password` 欄（見上面「權限模型」，可先留空）。**注意**：`data/collections.json` 是用 `holder_id: "sufu"` 產生的（見 `scripts/build-games.mjs` 的 `CONFIG.mainListHolderId`），members 分頁一定要有一筆 `id` 剛好是 `sufu`，網站才能正確顯示成真名而不是原始 id。
- [ ] **地點清單** → 填入 Google 試算表 `venues` 分頁。
- [ ] **Google 試算表本體** → 新建或沿用既有檔案，依 §4.2 建立六個分頁與表頭（`members` 多一欄 `password`，見上）。

## 遊戲資料現況（已完成第一階段）

`自然樹的桌遊清單.xlsx` 與 `桌遊資料庫.xlsx` 已經放進專案根目錄，`scripts/build-games.mjs` 也已對照實際欄位名稱修正過。**目前 `data/games.json`／`data/collections.json` 是用 `--offline` 模式產生的**：180 款遊戲、177 筆 Sufu 收藏，中文名／英文名／分類／代理商售價都是真的，但**人數／時長／複雜度／縮圖是空的**，因為還沒有向 BGG 抓資料。

- 主檔裡有 **36 款遊戲沒有 BGG 連結**（多為台灣原創作品，如台灣製茶錄、國家兩廳院、台大松鼠…），因為資料模型以 `bgg_id` 為主鍵，這些遊戲目前不會出現在網站上。腳本執行時會把名單印出來，需要的話要自己去 BGG 找連結補上 xlsx。

補齊 BGG 資料的步驟：
```
cd scripts
node build-games.mjs        # 不加 --offline，會真的呼叫 BGG API
```
**這一步我在這個環境跑不了**：BGG 的 Cloudflare 防護擋掉了這個 sandbox 的對外連線（首頁都是 403），要在你自己的電腦上執行。跑完後 `data/games.json` 會補上人數/時長/複雜度/縮圖，其餘資料不變。

若要一併把朋友收藏裡缺資料的 bgg_id 補齊，先把 Sheets `collections` 分頁匯出成 CSV，再加參數：
```
node build-games.mjs --collections-csv=./collections-export.csv
```

## 建置步驟（正式上線用）

1. **建立 Google 試算表**：新增一個空白試算表即可，分頁跟表頭不用手動打。

2. **部署 Apps Script**：
   - 開啟該試算表 → 擴充功能 → Apps Script，把 [apps-script/Code.gs](apps-script/Code.gs) 的內容整個貼進去。
   - 在編輯器上方的函式下拉選單選 `setupSheets`，按「執行」（▶）。第一次執行會跳出授權畫面，全部同意即可。跑完回去試算表看，七個分頁（`members`／`venues`／`collections`／`events`／`slots`／`votes`／`signups`）跟表頭列會自動建好。這個函式可以重複執行，不會清掉既有資料。
   - 主密碼已經固定寫在檔案裡的 `MASTER_PASSWORD`（見上面「權限模型」），不用額外設定指令碼屬性；要換主密碼就直接改這個常數再重新部署。
   - 部署 → 新增部署作業 → 類型選 Web app，Execute as「我」，Who has access 選「Anyone」。
   - 複製部署網址，貼到 [js/api.js](js/api.js) 的 `DEFAULT_APPS_SCRIPT_URL`。

3. **在自己電腦上跑一次沒有 `--offline` 的建置腳本**，補齊 BGG 資料（見上一節）。

4. **部署到 Vercel**：把這個 repo 接到 Vercel，Build Command 留空，Output Directory 設為根目錄（`.`）。`.vercelignore` 已排除 `scripts/` 與 `apps-script/`。

## CORS 實作取捨（§5.2）—— 已對著真正的 Apps Script 網址實測過

採用**方案一**：寫入用 `POST`＋`Content-Type: text/plain;charset=utf-8`（避開 preflight），並直接讀取回應 JSON（[js/api.js](js/api.js) 的 `postOnce()`）。**已經對著真正部署的 Apps Script 網址實測 `bootstrap`（GET）跟 `createEvent`／`cancelEvent`（POST）都成功**，不需要 `no-cors` 備援方案。

實測過程中發現並修好兩個跟正式部署有關的坑，記錄下來給以後參考：

1. **部署設定「誰可以存取」沒有真的套用，一直被導去 Google 登入頁**：換了好幾次新部署都一樣，最後換一個全新的部署（不是編輯舊的）才生效。如果你之後也遇到匿名存取一直被導去登入頁，別只改設定重存，試著直接建一個全新的部署（部署 → 新增部署作業，不是編輯管理既有的）。
2. **中文字透過 POST 傳過去會變亂碼**：Apps Script 的 `e.postData.contents` 對 `text/plain` 內容的 UTF-8 多位元組字元（中文）解碼不可靠，實測建立的團標題「【API測試...】」整個變成亂碼存進 Sheet。已修正為用 `e.postData.getBlob().getDataAsString('UTF-8')` 明確指定編碼（見 [apps-script/Code.gs](apps-script/Code.gs) 的 `doPost`）。**這個修正還沒部署**——你需要把最新的 `Code.gs` 貼回編輯器，「管理部署作業」→ 編輯現有部署 → 版本選「新版本」→ 部署，網址不會變。改完跟我說，我會再送一次含中文的測試資料確認修好了。

實測時建立了 4 筆標題亂碼的測試團（`event_id`: `4be6cb1f`、`417767cd`、`9eacd7fb`、`e554cbae`），已經呼叫 `cancelEvent` 把它們都設成「已取消」，不會出現在首頁的進行中清單，但列還留在 Sheet 裡；如果想要完全乾淨可以自己去 `events`／`slots` 分頁手動刪掉這幾列，不刪也不影響網站運作。

## 已知限制 / 未完成事項

- `data/games.json` 目前沒有 BGG 統計資料（人數/時長/複雜度/縮圖皆為空），需在有網路的機器上重跑 `node build-games.mjs`（不加 `--offline`）。
- 36 款無 BGG 連結的遊戲目前無法上架，見上方名單。
- `members`／`venues` 分頁目前沒有真實資料，需求方提供名單前網站會顯示空清單（可先用 `?api=` 本機模擬後端預覽介面行為）。
- 尚未對著真正部署的 Apps Script 網址跑過 §9 的 12 項驗收標準（本機模擬後端已驗證過對應的互動邏輯）。
