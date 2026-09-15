# 桌遊揪團站

純靜態前端（部署在 Vercel）＋ Google Apps Script + Google Sheets 後端。詳細功能規格見 `桌遊揪團站_建置指導書.md`；本文件只記錄實際上線的版本跟指導書不同、或指導書沒寫的地方。

## 權限模型

- 每個成員在 `members` 分頁有自己的 `password`（明碼存放）。欄位留空＝該成員還沒設密碼，此時任何密碼（含空字串）都算通過。
- `MASTER_PASSWORD` 固定寫在 [apps-script/Code.gs](apps-script/Code.gs)（不放指令碼屬性），可以做任何人的任何動作；換密碼要直接改這個常數再重新部署。
- 每個寫入動作對應一個「本人」member_id：投票／報名退出＝操作者自己；開團／定案／取消／編輯地點與指定遊戲＝該團發起人 `creator_id`。伺服器只認「主密碼 或 該 member_id 自己的密碼」，其他一律回 `BAD_SECRET`。
- 前端選定「自己」跟密碼快取是分開存的（[js/api.js](js/api.js) 的 `bgt_self_id` / `bgt_known_secrets`）：任一 member_id 的密碼在裝置上驗證成功過一次，之後任何動作只要需要那個 id 的密碼就不再問。
- `bootstrap` 回傳給前端的 `members` 一律濾掉 `password` 欄位。

## 資料模型

Google 試算表分頁與欄位（`setupSheets()` 會自動建好表頭）：

- `members`: `id | name | type | active | password`
- `venues`: `id | name | unlock_member_ids | note | active`（`unlock_member_ids` 是逗號分隔的 member id 名單，代表誰能開這個場地；只在前端提示，不擋操作）
- `collections`: `holder_id | bgg_id | name_zh | note`（`holder_id` 可以是成員 id，也可以直接是場地 id）
- `games`: `bgg_id | name_zh | name_en | thumbnail | min_players | max_players | playing_time | min_playtime | max_playtime | weight | year | category | is_expansion | parent_bgg_id`
- `events`: `event_id | created_at | creator_id | title | status | venue_id | venue_free_text | confirmed_slot_id | game_bgg_ids | note`
- `slots`: `slot_id | event_id | date | period | label`
- `votes`: `event_id | slot_id | member_id | ok | updated_at`
- `signups`: `event_id | member_id | joined_at`

`games`／`collections` 直接在 Sheet 上維護，不用重跑建置腳本、不用 push、不用等 Vercel 重新部署。可玩清單規則＝「這團地點自己的收藏」∪「這團參與者各自的收藏」。候選時段可以只開一個（上限 4 個）。

## Apps Script 效能

[apps-script/Code.gs](apps-script/Code.gs) 有兩層快取，避免每次請求都對 Sheets API 重複讀取：

- `bootstrap`（GET）用 `CacheService` 快取 20 秒，所有訪客共用；任何寫入動作成功後會呼叫 `invalidateBootstrapCache()` 主動清掉，所以自己剛做的操作不會被快取蓋掉。
- 同一次 `doGet`/`doPost` 執行內，對同一分頁的 `readAll` 重複呼叫只會真的打一次 Sheets API，寫入該分頁後快取立即失效。

## 部署

1. **建立 Google 試算表**：新增空白試算表即可，分頁跟表頭不用手動打。
2. **部署 Apps Script**：
   - 該試算表 → 擴充功能 → Apps Script，貼入 [apps-script/Code.gs](apps-script/Code.gs) 全部內容。
   - 執行一次 `setupSheets`（第一次會跳授權畫面，全部同意），建好所有分頁與表頭。可重複執行，不會清掉既有資料。
   - 部署 → 新增部署作業 → 類型 Web app，Execute as「我」，Who has access「Anyone」。**改完 `Code.gs` 要更新既有部署（管理部署作業 → 編輯 → 版本選「新版本」→ 部署），網址不變；只存檔不會讓正式網址生效。**
   - 複製部署網址，貼到 [js/api.js](js/api.js) 的 `DEFAULT_APPS_SCRIPT_URL`。
3. 在 `members`／`venues`／`games`／`collections` 分頁填入實際資料。
4. **部署到 Vercel**：接上這個 repo，Build Command 留空，Output Directory 設為根目錄（`.`）。`.vercelignore` 已排除 `scripts/`、`apps-script/`、試算表跟指導書檔案。

## 已知限制

- `venues.unlock_member_ids` 只在前端提醒，不會擋任何操作。
- `bootstrap` 快取最長 20 秒，非操作者本人的其他訪客可能延遲最多 20 秒看到別人剛做的變更。
