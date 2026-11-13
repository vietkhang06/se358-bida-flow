# BF-PROD-01 — Operational Dashboard & Live Table State Refresh

## 1. Thay đổi triển khai

- **`lib/live-sync.ts`**:
  - `createLatestSyncGuard()`: điều phối các lần gọi `/api/app` bằng sequence tăng đơn điệu + `AbortController`:
    - Bỏ qua poll nền trùng lặp khi đang có request chạy (`force = false`).
    - Hủy request cũ và loại bỏ response cũ khi người dùng làm mới thủ công, thực hiện thao tác ghi, hoặc tab trở lại hoạt động (`force = true`).
    - `invalidate()` hủy toàn bộ request đang chờ khi đăng xuất hoặc unmount.
  - `classifySyncError()`: phân biệt `abort`, `unauthorized` (401 -> tự thoát phiên sạch), `offline` (mất mạng), và `server` (lỗi máy chủ tạm thời).
  - `summarizeTableStatuses()`: tính tổng `available`, `playing`, `reserved`, `maintenance` trực tiếp từ trạng thái thực tế (`effectiveTableStatus`).
- **`app/api/app/route.ts`**:
  - Đồng bộ `summary` (`table_count`, `playing_count`, `available_count`, `reserved_count`, `maintenance_count`, `open_orders_count`, `snapshot_at`) theo đúng `effectiveTableStatus` và kiểm soát quyền RBAC từng trường.
  - Gắn header `Cache-Control: no-store` cho dữ liệu dashboard trực tiếp.
- **`components/bidaflow-app.tsx`**:
  - Tách màn hình `ConnectionErrorScreen` khi khởi tạo thất bại (sửa lỗi trước đây rơi nhầm vào màn hình thiết lập hệ thống lần đầu).
  - Auto-poll mỗi 10s khi tab hiển thị & trực tuyến; tự đồng bộ lại khi `visibilitychange`, `focus`, `online`; hiển thị trạng thái trực tiếp (`Trực tiếp · HH:MM:SS`, `Đang đồng bộ...`, `Mất kết nối`, `Lỗi đồng bộ`) và banner phục hồi có nút `Thử lại`.
  - Phân biệt trạng thái rỗng chưa cấu hình bàn với trạng thái rỗng do bộ lọc trong `TablesView` (thêm nút `Xóa bộ lọc`).

## 2. Kiểm thử đã chạy

- `tests/live-dashboard.test.mjs`: kiểm thử unit guard chống stale overwrite/duplicate poll/cleanup, phân loại lỗi, và integration test đồng bộ đa phiên qua `/api/app` + RBAC scoping.
- `tsc --noEmit --incremental false`, `pnpm lint`, `pnpm build`, và kiểm thử runtime thực tế trên local Wrangler Worker + D1.
