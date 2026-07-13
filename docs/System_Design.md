# 系統設計 (SD) - 東寵戰情牆 (Management Dashboard)

## 1. 資料庫設計 (Database Schema)
系統採用 Vercel Postgres，主要利用 PostgreSQL 的 `JSONB` 特性實現半結構化資料的儲存。

### 1.1 `store` 資料表
用於儲存全域設定或靜態資料（例如：門市主管清單）。
- `id` (VARCHAR(50), PRIMARY KEY)：資料識別碼（例如 `'managers'`）。
- `data` (JSONB)：完整的 JSON 資料內容（例如包含多筆主管物件的陣列）。

### 1.2 `visit_records` 資料表
用於儲存巡店與活動紀錄，支援關聯查詢與快速索引。
- `id` (VARCHAR(50), PRIMARY KEY)：紀錄的 UUID。
- `region` (VARCHAR(50))：該紀錄所屬區域（供列表快速過濾使用）。
- `created_at` (TIMESTAMP)：建立時間（台灣時間基準）。
- `data` (JSONB)：完整的巡店紀錄 JSON（對應 `VisitRecord` Schema）。

## 2. API 規格 (API Specifications)

### 2.1 數據總覽
- **`GET /api/summary`**
  - **功能**：取得戰情總覽數據。
  - **參數**：`date` (選填，格式 `YYYY-MM-DD`，預設為抓取今日)。
  - **回傳 (DashboardSummary)**：包含總巡店數 (`totalVisits`)、異常數 (`abnormalIssuesCount`)、總預期停留時間 (`totalExpectedStayMinutes`)、亮點數 (`highlightCount`) 等指標。

### 2.2 巡店紀錄
- **`GET /api/activities`**
  - **功能**：取得巡店紀錄列表 (依時間倒序，上限 100 筆)。
  - **參數**：
    - `time_range` (選填，支援 `day`|`week`|`month`，預設為 `day`)
    - `region` (選填，預設為 `all`)
  - **回傳**：`List[VisitRecord]`。

- **`POST /api/visit-records`**
  - **功能**：手動新增單筆巡店紀錄。
  - **請求本體**：巡店紀錄 JSON 物件。
  - **回傳**：`{ "success": true, "data": { "recordId": string } }`。

### 2.3 主管資料管理
- **`GET /api/managers`**
  - **功能**：取得目前的主管名單資料。
  - **回傳**：`List[Manager]`。

- **`POST /api/managers/import`**
  - **功能**：批次匯入/更新主管名單 (覆蓋寫入)。
  - **請求本體**：`List[Manager]`。
  - **回傳**：`{ "success": true, "count": int }`。

### 2.4 外部整合
- **`POST /api/webhook/google-forms`**
  - **功能**：接收外部 Google Forms 送出的 Webhook 並轉換為巡店紀錄。
  - **請求本體**：Google Forms 回傳的 JSON 負載。
  - **邏輯處理**：系統會自動對應 `areaManagerName`、`expectedStayMinutes`、`defects` 等欄位，並針對有填寫異常缺陷的紀錄自動標記 `abnormalFlag` 並加上 `"發現異常"` 的標籤，寫入 `visit_records`。

## 3. 前端元件架構設計 (Frontend Structure)
前端採用 React 與 Tailwind CSS，建議的設計架構如下：

- **`src/pages/`**：頁面容器，負責處理主要的版面佈局 (Layout) 與路由 (如戰情牆首頁)。
- **`src/components/`**：共用與展示型元件，如 `HeaderBar`、`StatCard`、`ActivityList` 等。
- **`src/api/`**：抽離與後端 FastAPI 介接的非同步請求邏輯 (Axios / fetch API)。
- **`src/types/`**：TypeScript 型別定義，需與後端 Pydantic Models (如 `Manager`, `VisitRecord`, `DashboardSummary`) 保持一致，確保資料介接安全。
