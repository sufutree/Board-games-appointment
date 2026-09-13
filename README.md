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
- 前端「點自己的名字」選身分時，會順便問那個人的密碼並記在瀏覽器裡（`localStorage`）。**密碼快取跟「目前選定的自己」是分開存的**（[js/api.js](js/api.js) 的 `bgt_self_id` / `bgt_known_secrets`）：只要某個人的密碼在這台裝置上曾經驗證成功過一次，之後不管誰被選為畫面上的「自己」，任何動作只要需要那個人的密碼（包含發起人才能做的定案／取消），都不會再問——不再是「只有目前選定的自己」才免問。
- **一個重要的安全修正**：`bootstrap` 回傳給所有訪客的資料絕對不能包含密碼欄位（不然任何人打開瀏覽器開發者工具都能看到每個人的密碼），[apps-script/Code.gs](apps-script/Code.gs) 的 `bootstrap()` 跟 `scripts/dev-mock-server.mjs` 都已經在回傳前把 `password` 欄位濾掉，我有直接打 API 驗證過回應裡確實沒有這個欄位。

## 資料模型異動（跟原始指導書不同）

- **遊戲資料／收藏改成 Sheet 手動維護**：指導書 §4.1 原本設計是 repo 內的 `data/games.json`／`data/collections.json`，由本機腳本產生後 push。這兩個檔案已經拿掉，改成跟指導書 §4.2 的其他分頁一樣，直接維護在 Google 試算表新增的 `games` 分頁（欄位見上方「遊戲資料與收藏改為 Sheet 手動維護」一節），`collections` 分頁功能不變，但現在**所有持有者**（包含 Sufu、包含場地自己）都在這個分頁維護，不再區分「Sufu 用靜態檔、其他人用 Sheet」。
- **場地可以直接擁有收藏，不用透過人**：指導書 §3.3 的可玩清單規則原本是「地點的持有者的收藏」，現在把場地自己的 `id` 直接當成 `collections.holder_id` 使用，可玩清單＝「這團地點自己的收藏」∪「這團參與者各自的收藏」，不再繞一層「這個地點屬於哪個人」。
- **`venues.holder_id` 改名成 `unlock_member_ids`，語意完全不同**：指導書 §4.2 原本的 `holder_id` 是「這個場地屬於誰」；現在改成「誰能開這個場地」的名單，可以填多個 member id（逗號分隔，例如社辦填 `阿明,阿華,桌遊社`，代表這幾人任一在團裡就符合資格）。**這只是前端的提醒，不會擋任何操作**：開團當下只看發起人是否符合，定案時看目前投了「可以」的人裡有沒有人符合，不符合一樣可以選、可以送出，只是畫面上會多一行提示。
- **候選時段允許只開一個**：指導書 §6.2 沒有明講最少要幾個時段，先前的實作寫死至少 2 個，現在改成 1 個以上即可（上限維持 4 個）。

**members 分頁的表頭因此要改成**：`id | name | type | active | password`（比指導書 §4.2 原本寫的多一欄）。

## 目前的 TODO（§0 動工前需要需求方提供）

- [ ] **Apps Script Web App 部署網址** → 填入 [js/api.js](js/api.js) 的 `DEFAULT_APPS_SCRIPT_URL`（目前是 `TODO_APPS_SCRIPT_URL` 佔位字串）。
- [ ] **成員名單** → 填入 Google 試算表 `members` 分頁，記得包含 `password` 欄（見上面「權限模型」，可先留空）。
- [ ] **地點清單** → 填入 Google 試算表 `venues` 分頁。
- [ ] **Google 試算表本體** → 新建或沿用既有檔案，依 §4.2 建立分頁與表頭（`members` 多一欄 `password`，見上）。

## 遊戲資料與收藏改為 Sheet 手動維護

`data/games.json`／`data/collections.json` 這兩個 repo 內的靜態檔已經拿掉，不再由網站讀取。遊戲後設資料（人數/時長/複雜度/分類…）跟收藏一樣，改成直接維護在 Google 試算表的 `games`／`collections` 分頁——想加新遊戲、改資料，直接在 Sheet 上編輯即可，不用重跑建置腳本、不用 push、不用等 Vercel 重新部署。

`games` 分頁欄位（`setupSheets()` 會自動建好表頭）：`bgg_id | name_zh | name_en | thumbnail | min_players | max_players | playing_time | min_playtime | max_playtime | weight | year | category | is_expansion | parent_bgg_id`。代理商/售價/BGG連結這幾欄網站已經不顯示，所以沒有放進這個分頁。

`自然樹的桌遊清單.xlsx`、`桌遊資料庫.xlsx` 跟 `scripts/build-games.mjs`（向 BGG 抓資料、輸出 JSON 的本機腳本）都還留在 repo 裡，但**網站已經不會讀它們的輸出了**。如果之後想省事，一次幫多款遊戲抓好 BGG 的人數/時長/複雜度/縮圖，仍然可以參考這支腳本的邏輯，抓完再手動貼進 `games` 分頁；不需要也可以完全不管這支腳本，直接在 Sheet 上一筆一筆手動輸入。

## 建置步驟（正式上線用）

1. **建立 Google 試算表**：新增一個空白試算表即可，分頁跟表頭不用手動打。

2. **部署 Apps Script**：
   - 開啟該試算表 → 擴充功能 → Apps Script，把 [apps-script/Code.gs](apps-script/Code.gs) 的內容整個貼進去。
   - 在編輯器上方的函式下拉選單選 `setupSheets`，按「執行」（▶）。第一次執行會跳出授權畫面，全部同意即可。跑完回去試算表看，`members`／`venues`／`collections`／`games`／`events`／`slots`／`votes`／`signups` 這些分頁跟表頭列會自動建好。這個函式可以重複執行，不會清掉既有資料（但會把表頭列覆寫成最新的欄位名稱，例如 `venues` 的 `holder_id` 會被改名成 `unlock_member_ids`）。
   - 主密碼已經固定寫在檔案裡的 `MASTER_PASSWORD`（見上面「權限模型」），不用額外設定指令碼屬性；要換主密碼就直接改這個常數再重新部署。
   - 部署 → 新增部署作業 → 類型選 Web app，Execute as「我」，Who has access 選「Anyone」。
   - 複製部署網址，貼到 [js/api.js](js/api.js) 的 `DEFAULT_APPS_SCRIPT_URL`。

3. **在 `games` 分頁手動輸入想上架的遊戲資料**（見上一節的欄位說明），`collections` 分頁手動輸入每個持有者（含場地自己）的收藏。

4. **部署到 Vercel**：把這個 repo 接到 Vercel，Build Command 留空，Output Directory 設為根目錄（`.`）。`.vercelignore` 已排除 `scripts/` 與 `apps-script/`。

## CORS 實作取捨（§5.2）—— 已對著真正的 Apps Script 網址實測過

採用**方案一**：寫入用 `POST`＋`Content-Type: text/plain;charset=utf-8`（避開 preflight），並直接讀取回應 JSON（[js/api.js](js/api.js) 的 `postOnce()`）。**已經對著真正部署的 Apps Script 網址實測 `bootstrap`（GET）跟 `createEvent`／`cancelEvent`（POST）都成功**，不需要 `no-cors` 備援方案。

實測過程中發現並修好兩個跟正式部署有關的坑，記錄下來給以後參考：

1. **部署設定「誰可以存取」沒有真的套用，一直被導去 Google 登入頁**：換了好幾次新部署都一樣，最後換一個全新的部署（不是編輯舊的）才生效。如果你之後也遇到匿名存取一直被導去登入頁，別只改設定重存，試著直接建一個全新的部署（部署 → 新增部署作業，不是編輯管理既有的）。
2. **中文字透過 POST 傳過去會變亂碼**：Apps Script 的 `e.postData.contents` 對 `text/plain` 內容的 UTF-8 多位元組字元（中文）解碼不可靠。已修正為用 `e.postData.getBlob().getDataAsString('UTF-8')` 明確指定編碼（見 [apps-script/Code.gs](apps-script/Code.gs) 的 `doPost`）。**這個網站的成員 id 直接就是中文名字**，代表投票/報名/定案/取消/開團這些寫入動作，如果這個修正沒有真的部署上去，幾乎每個動作都會因為 `member_id` 傳到後端變亂碼、比對不到成員而失敗，畫面上就會一直跳出「請重新輸入密碼」——這其實不是密碼錯，是這個編碼問題。**每次改完 `Code.gs` 都要記得「管理部署作業」→ 編輯現有部署 → 版本選「新版本」→ 部署，網址不會變**，光是儲存編輯器裡的檔案不會讓正式網址生效。

實測時建立了 4 筆標題亂碼的測試團（`event_id`: `4be6cb1f`、`417767cd`、`9eacd7fb`、`e554cbae`），已經呼叫 `cancelEvent` 把它們都設成「已取消」，不會出現在首頁的進行中清單，但列還留在 Sheet 裡；如果想要完全乾淨可以自己去 `events`／`slots` 分頁手動刪掉這幾列，不刪也不影響網站運作。

## 已知限制 / 未完成事項

- `games` 分頁目前是空的（沒有搬移舊的 `data/games.json` 資料），需要自己陸續在 Sheet 上輸入想上架的遊戲。
- 場地的 `unlock_member_ids`（誰能開這個場地）只在前端提醒，不會擋任何操作。
