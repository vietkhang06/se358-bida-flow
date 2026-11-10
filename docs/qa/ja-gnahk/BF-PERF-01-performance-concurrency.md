# BF-PERF-01 — Performance & Concurrency Validation

> **Lưu ý về ngưỡng nghiệm thu (SLA/SLO):** Trong GitHub issue `#54` (`body: null`) và tài liệu dự án hiện chưa chốt ngưỡng SLA/SLO chính thức (vd p95 mục tiêu hay req/s tối thiểu). Báo cáo dưới đây ghi nhận số liệu **đo baseline trước/sau tối ưu** và kết quả kiểm chứng **tính đúng khi đồng thời / invariant dữ liệu**, không tự suy diễn kết luận đạt ngưỡng SLA chưa chốt.

## 1. Lỗi concurrency phát hiện & khắc phục nguyên nhân gốc

Trước khi sửa, các handler legacy trong `app/api/action/route.ts` dùng mô hình đọc-trước-rồi-ghi (`SELECT` -> tính trong JS -> `INSERT/UPDATE`) khiến nhiều request song song trên cùng bản ghi vượt qua điều kiện kiểm tra khi có độ trễ async D1:

| Handler | Lỗi tái hiện trước khi sửa (async D1 2–3ms) | Khắc phục trong `app/api/action/route.ts` |
|---|---|---|
| `invoice.pay` | 5 request song song thanh toán 100k → **4 request thành công (tổng thu 400k trên HĐ 100k)**, ghi trùng thu chi ca và điểm hội viên | Dùng `db.batch` kiểm tra nguyên tử `status = 'ISSUED'` và `SUM(payments) + amount <= total_amount` khi `INSERT INTO payments`, cập nhật `PAID` theo `EXISTS(payments.id)`, bảo vệ `shift_cash_movements` & `loyalty_transactions` chống trùng |
| `invoice.create` | 5 request song song → **tạo 5 hóa đơn trùng** cho 1 phiên chơi | `INSERT INTO invoices ... SELECT ... WHERE status='CLOSED' AND NOT EXISTS(active invoice) AND NOT EXISTS(pending orders)` + tính lại tổng trong cùng `db.batch` |
| `invoice.adjust` / `cancel` / `split` / `merge` | Có thể mất cập nhật giảm giá/phụ thu (`recalculateInvoice`) hoặc hủy/tách/gộp đè lên hóa đơn vừa thanh toán | Tính tổng hóa đơn nguyên tử trong SQL (`recalculateInvoiceStatement`), thêm guard `status = 'ISSUED'` & số lượng dòng còn lại trong `db.batch` |
| `inventory.move` & `stock.count` | 4 request `IN +5` từ tồn 10 → **tồn còn 15 thay vì 30 (mất 3 lần cộng)** | Tính `before_quantity`, `after_quantity` và `stock_quantity = stock_quantity +/- ?` trực tiếp trên cột DB trong cùng `db.batch`, chặn `OUT` bằng `stock_quantity >= ?` |
| `shift.open` & `shift.close` | 4 request `shift.close` → **4 dòng `CLOSING` trùng** | Điều kiện `WHERE status = 'OPEN'` khi cập nhật đóng ca và `NOT EXISTS(CLOSING)` khi ghi sổ quỹ |

## 2. Tối ưu đọc `/api/app` & đo Before / After

1. **`lib/server.ts` (`currentUser`)**: tránh thực hiện `UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP` trên mọi request đọc `GET /api/app` (chỉ cập nhật khi `last_seen_at` cũ hơn 60 giây), giảm khóa ghi SQLite khi nhiều client poll song song.
2. **`lib/server.ts` + `app/api/app/route.ts` (`sessionTimingsBatch`)**: loại bỏ N+1 query (`2 * N` truy vấn tuần tự qua `sessionTiming` cho từng phiên), gom thành 2 truy vấn theo lô cho các phiên chưa chốt.

### Điều kiện đo

- **Môi trường:** Windows, Node.js `v24.20.0`, `wrangler dev --local` (Miniflare + SQLite/D1 local) trên `http://127.0.0.1:8788` (cấu hình production build từ `vinext build`).
- **Dữ liệu seed mỗi lần chạy:** 1 khu vực, 1 loại bàn, 12 bàn, 1 sản phẩm tồn 100, 1 ca mở, 4 phiên đang chơi (có order), 6 phiên đã chốt & thanh toán đủ (`PAID`).
- **Workload:** `scripts/perf-baseline.mjs` thực hiện 20 request ở `c=1`, 40 request ở `c=5`, 60 request ở `c=15` vào `GET /api/app`, sau đó chạy các burst tranh chấp ghi đồng thời và đối chiếu invariant DB.

### Bảng so sánh Before vs After (`GET /api/app`)

| Mức đồng thời | Metric | Before (`main`) | After (`BF-PERF-01`) | Chênh lệch |
|---|---|---|---|---|
| `c=1` (20 req) | Mean / p50 / p95 (ms) | 158.37 / 153.34 / 202.00 | 128.83 / 129.43 / 141.40 | p50 -15.6%, p95 -30.0% |
| `c=1` (20 req) | Throughput / Error rate | 6.29 req/s / 0% | 7.73 req/s / 0% | +22.9% |
| `c=5` (40 req) | Mean / p50 / p95 (ms) | 653.77 / 658.68 / 820.83 | 554.71 / 565.49 / 718.85 | p50 -14.1%, p95 -12.4% |
| `c=5` (40 req) | Throughput / Error rate | 7.52 req/s / 0% | 8.87 req/s / 0% | +18.0% |
| `c=15` (60 req) | Mean / p50 / p95 / p99 (ms) | 2348.21 / 2255.26 / 4216.56 / 5446.97 | 1638.67 / 1632.82 / 3200.40 / 4100.41 | p50 -27.6%, p95 -24.1% |
| `c=15` (60 req) | Throughput / Error rate | 6.22 req/s / 0% | 8.93 req/s / 0% | +43.6% |

## 3. Kết quả kiểm chứng invariant đồng thời trên Wrangler D1 thật

- `session.start` 8x song song trên 1 bàn: `1` thành công, `7` từ chối tranh chấp.
- `inventory.move IN` +5 (8x song song): `8` thành công, tồn tăng đúng `100 → 140`.
- `inventory.move OUT` -40 (5x song song từ tồn 140): `3` thành công, `2` từ chối âm kho, trừ tiếp `2` khi phục vụ → tồn cuối `18`.
- `invoice.create` 6x song song trên 1 phiên đã chốt: `1` thành công → đúng 1 hóa đơn hợp lệ.
- `invoice.pay` 6x song song trên hóa đơn `41.000 đ`: `1` thành công, đúng 1 payment `41.000 đ`, trạng thái `PAID`.
- `tests/concurrency-invariants.test.mjs`: 8/8 kịch bản song song (mô phỏng trễ async D1 3ms) PASS.
