# BF-REPORT-01 — KPI Semantics & Timezone-Aware Report Filters

> **Trạng thái nghiệm thu tài liệu:** Triển khai kỹ thuật đầy đủ trên code (`lib/reporting.ts`, `app/api/app/route.ts`, `components/reports-view.tsx`) và kiểm thử đơn vị/tích hợp đạt. Vì repo hiện chưa có biên bản ký duyệt KPI chính thức từ PM/Product Owner (`docs/REPORTING_KPI_CATALOG_DRAFT.md`), định nghĩa KPI dưới đây chuẩn hóa nhất quán với schema, billing logic và business timezone `Asia/Ho_Chi_Minh` của hệ thống, sẵn sàng cho PM/PO ký xác nhận.

## 1. Quy ước thời gian và múi giờ nghiệp vụ

- **Lưu trữ DB:**
  - `invoices.paid_at`, `inventory_transactions.created_at`: mặc định SQLite `CURRENT_TIMESTAMP` (UTC `YYYY-MM-DD HH:MM:SS`).
  - `play_sessions.started_at`, `play_sessions.ended_at`, `reservations.starts_at`: ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SS.sssZ`).
- **Múi giờ nghiệp vụ mặc định:** `Asia/Ho_Chi_Minh` (UTC+07:00, không có DST).
- **Bộ lọc API (`GET /api/app`):**
  - `reportFrom` (hoặc `from`): `YYYY-MM-DD` (mặc định: 29 ngày trước hôm nay theo `reportTz`, tạo cửa sổ 30 ngày gồm hôm nay).
  - `reportTo` (hoặc `to`): `YYYY-MM-DD` (mặc định: hôm nay theo `reportTz`). Nếu chỉ truyền một đầu ngày, đầu còn lại lấy cùng ngày để lọc 1 ngày an toàn.
  - `reportTz` (hoặc `tz`): IANA timezone hợp lệ (mặc định `Asia/Ho_Chi_Minh`).
  - **Ranh giới truy vấn:** quy đổi nửa đêm `[00:00:00.000 local(from), 00:00:00.000 local(to + 1 day))` thành `[startUtc, endExclusiveUtc)` để lọc chính xác sát nửa đêm (`16:59:59.999Z` thuộc ngày N, `17:00:00.000Z` thuộc ngày N+1 tại `Asia/Ho_Chi_Minh`).
  - **Validation đầu vào (HTTP 400):** ngày không tồn tại (vd `2025-02-29`, `2026-04-31`), `from > to`, khoảng ngày > 366 ngày, hoặc `tz` không phải IANA timezone hợp lệ.

## 2. Định nghĩa KPI chính thức

| KPI / Báo cáo | Công thức & nguồn dữ liệu | Đơn vị | Trạng thái tính / loại trừ |
|---|---|---|---|
| `summary.today_revenue` | `SUM(invoices.total_amount)` với `paid_at` nằm trong ngày hôm nay theo `reportTz` | VND | Chỉ tính `status = 'PAID'`; loại trừ `DRAFT`, `ISSUED` (kể cả mới trả 1 phần), `CANCELLED`. |
| `summary.reservation_count` | `COUNT(reservations.id)` với `starts_at` nằm trong ngày hôm nay theo `reportTz` | Lịch | Chỉ tính `PENDING`, `CONFIRMED`; loại trừ `SEATED`, `CANCELLED`, `NO_SHOW`. |
| `report.revenue[]` | Gom nhóm theo ngày `paid_at` quy đổi về `reportTz`: `revenue = SUM(total_amount)` (thực thu sau giảm giá/phụ thu), `table_revenue = SUM(table_amount)`, `service_revenue = SUM(service_amount)`, `discount_amount = SUM(discount_amount)`, `surcharge_amount = SUM(surcharge_amount)`, `invoice_count = COUNT(*)` | VND, Hóa đơn | Chỉ tính `invoices.status = 'PAID'`; loại trừ `DRAFT`, `ISSUED`, `CANCELLED`. UI hiển thị `SUM(revenue)` là doanh thu thực thu (khắc phục lỗi cũ cộng gộp `table_revenue + service_revenue` bỏ qua giảm giá/phụ thu). |
| `report.tables[]` | Với các phiên `play_sessions.status = 'CLOSED'` có `ended_at` trong kỳ: `session_count`, `revenue = SUM(table_amount)`, `minutes` = tổng phút tính phí (`billableSeconds / 60`, đã loại trừ `session_pauses`), `elapsed_minutes` = tổng phút wall-clock (`ended_at - started_at`) | Phiên, Phút, VND | Loại trừ phiên `ACTIVE`/`PAUSED` chưa chốt và phiên ngoài kỳ lọc. |
| `report.products[]` | Top 20 theo doanh thu từ `invoice_items` (`PRODUCT`, `SERVICE`) thuộc hóa đơn `PAID` trong kỳ, nhóm theo `COALESCE(oi.product_id, ii.description)` | Số lượng, VND | Loại trừ hóa đơn hủy/chưa thanh toán và món hủy (không có trong `invoice_items`). |
| `report.inventory[]` | `stock_quantity` hiện tại, `min_stock` hiện tại; `imported = SUM(IN)`, `exported = SUM(OUT + SALE)`, `adjusted = SUM(after_quantity - before_quantity)` với `type = 'ADJUST'` lọc theo `inventory_transactions.created_at` trong kỳ | Đơn vị tồn | Hiển thị sản phẩm đang hoạt động hoặc có phát sinh giao dịch kho trong kỳ. |

## 3. Quyền truy cập & tương thích ngược

- `report` và `reportMeta` chỉ trả về khi user có `REPORTS_VIEW` (hoặc `ADMIN`); role khác nhận `report: null`, `reportMeta: null` và `summary.today_revenue: undefined`.
- `Object.keys(report)` giữ nguyên 4 khóa `["inventory", "products", "revenue", "tables"]` để tương thích với contract cũ và `tests/reporting-access.test.mjs`.

## 4. Điểm cần PM/PO xác nhận ký duyệt (nếu cần thay đổi chính sách)

1. Ký xác nhận dùng doanh thu ghi nhận khi hóa đơn chuyển `PAID` (`total_amount`) thay vì cộng dồn từng giao dịch thanh toán một phần trên hóa đơn `ISSUED`.
2. Ký xác nhận `report.tables.minutes` dùng thời gian tính phí đã trừ tạm dừng thay vì tổng thời gian chiếm bàn.
