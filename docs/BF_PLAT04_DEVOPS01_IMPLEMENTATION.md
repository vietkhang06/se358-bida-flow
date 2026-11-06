# BF-PLAT-04 / BF-DEVOPS-01 — Tiến độ triển khai

- Bổ sung kiểm tra envelope và payload runtime cho các action xử lý trực tiếp; delegated actions giữ validation tại từng module.
- Thống nhất response lỗi: `{ "error": "thông báo tiếng Việt", "code": "VALIDATION_ERROR" }`; các client cũ tiếp tục đọc `error` như trước.
- HTTP 401 → `UNAUTHENTICATED`, 403 → `FORBIDDEN`, 404 → `NOT_FOUND`, 409 → `CONFLICT`, 500 → `INTERNAL_ERROR`.
- Bổ sung GitHub Actions chạy cài đặt từ lockfile, typecheck, lint, Node tests, build (không có dependency mới).
- KHÔNG thêm migration và không sửa code VNPay/UI.
- Hệ thống cần kiểm chứng tại source local mới nhất và GitHub CI; branch protection/required checks và approvals vẫn phải thực hiện bởi maintainer.
- Các task #43/#45 chỉ Done khi typecheck, lint, build, CI, review và error contract UI/backend đều được nghiệm thu.
