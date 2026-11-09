# Quy Trình Di Chuyển (Migration), Sao Lưu (Backup) & Phục Hồi (Recovery) Cơ Sở Dữ Liệu Cloudflare D1

Tài liệu này mô tả quy trình vận hành và vòng đời cơ sở dữ liệu D1 cho hệ thống **BidaFlow**, đáp ứng chuẩn kiểm soát dữ liệu và phân tách an toàn môi trường.

---

## 1. Cấu Trình Cơ Sở Dữ Liệu & Nguyên Tắc An Toàn

- **Hệ quản trị CSDL:** SQLite (Cloudflare D1 / Drizzle ORM).
- **Quy tắc tuyệt đối:** Không bao giờ chạy các thao tác phá hủy (`DROP`, reset, restore thử nghiệm) trực tiếp trên cơ sở dữ liệu Production.
- **Thư mục Migration:** `drizzle/` chứa snapshot lịch sử và file SQL khởi tạo `0000_natural_silvermane.sql`.

---

## 2. Quy Trình Khởi Tạo & Áp Dụng Migration

### 2.1. Sinh migration mới khi thay đổi schema (`db/schema.ts`)
```bash
npm run db:generate
```
Lệnh này kích hoạt `drizzle-kit generate` dựa trên cấu hình tại `drizzle.config.ts`.

### 2.2. Khởi tạo cơ sở dữ liệu cục bộ (Local D1 Dev)
```bash
# 1. Sinh schema và build
npm run db:generate
npm run build

# 2. Khởi tạo schema trên D1 local state
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_natural_silvermane.sql
```

### 2.3. Áp dụng migration lên Remote D1 (Staging / Production)
```bash
# Áp dụng file migration lên Cloudflare D1
npx wrangler d1 execute <DATABASE_NAME> --remote --file=./drizzle/<migration_file>.sql
```

---

## 3. Quy Trình Sao Lưu (Backup & Export)

### 3.1. Sao lưu tự động (Cloudflare Time Travel)
Cloudflare D1 tích hợp sẵn tính năng Time Travel (hỗ trợ quay lại trạng thái bất kỳ trong vòng 30 ngày):
```bash
# Kiểm tra danh sách bookmark và trạng thái backup
npx wrangler d1 time-travel info <DATABASE_NAME>
```

### 3.2. Sao lưu thủ công / Xuất dữ liệu (SQL Dump)
Xuất toàn bộ schema và dữ liệu thành file SQL:
```bash
# Xuất dữ liệu từ Remote D1
npx wrangler d1 export <DATABASE_NAME> --remote --output=./backup_$(date +%Y%m%d_%H%M%S).sql

# Xuất dữ liệu từ Local D1
npx wrangler d1 export DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --output=./backup_local.sql
```

---

## 4. Quy Trình Phục Hồi (Recovery & Restore)

### 4.1. Phục hồi qua Time Travel (Point-in-time Recovery)
Khi xảy ra sự cố thao tác nhầm, khôi phục về timestamp hoặc bookmark trước đó:
```bash
# Phục hồi về bookmark xác định
npx wrangler d1 time-travel restore <DATABASE_NAME> --bookmark=<BOOKMARK_ID>

# Hoặc phục hồi về mốc thời gian cụ thể
npx wrangler d1 time-travel restore <DATABASE_NAME> --timestamp="2026-11-09T18:00:00Z"
```

### 4.2. Phục hồi từ file SQL Backup vào Database Test/Cứu hộ
Để đảm bảo an toàn, dữ liệu sao lưu luôn được khôi phục vào cơ sở dữ liệu cô lập trước khi chuyển hướng traffic:
```bash
# 1. Tạo database cứu hộ tạm thời
npx wrangler d1 create <DATABASE_NAME_RECOVERY>

# 2. Nạp dữ liệu từ file backup
npx wrangler d1 execute <DATABASE_NAME_RECOVERY> --remote --file=./backup_target.sql

# 3. Kiểm tra tính toàn vẹn (Integrity Check)
npx wrangler d1 execute <DATABASE_NAME_RECOVERY> --remote --command="PRAGMA integrity_check;"
```

---

## 5. Kịch Bản Thử Nghiệm Tự Động (Rehearsal Script)

Dự án cung cấp kịch bản diễn tập tự động độc lập tại `scripts/rehearse-d1.mjs`:
- Khởi tạo SQLite DB rỗng trong thư mục tạm `.test-db-rehearsal`.
- Thực thi toàn bộ DDL migration schema (`drizzle/0000_natural_silvermane.sql`).
- Nạp dữ liệu mẫu (Khu vực, Bàn, Danh mục, Hàng hóa, Khách hàng, Tài khoản).
- Tạo bản sao lưu SQL dump hoàn chỉnh.
- Khởi tạo database khôi phục cô lập và phục hồi dữ liệu từ bản dump.
- Kiểm tra tính toàn vẹn dữ liệu và kiểm tra `PRAGMA integrity_check`.
- Dọn dẹp an toàn các tài nguyên tạm.

**Chạy diễn tập:**
```bash
node scripts/rehearse-d1.mjs
```
Hoặc qua bộ kiểm thử tự động:
```bash
npm test tests/db-lifecycle.test.mjs
```
