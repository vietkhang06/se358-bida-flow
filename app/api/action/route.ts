import { executeOperation, operationPermissions } from "@/lib/operations";
import {
  AppError, assertSameOrigin, audit, code, getRawDb,
  hashPassword, id, normalizeEmail, nowIso, queryAll, queryOne, randomToken, requireUser,
  responseError, sha256Hex, validatePassword, verifyPassword,
} from "@/lib/server";

type Body = { action: string; payload?: Record<string, unknown> };
const value = (data: Record<string, unknown>, key: string) => String(data[key] ?? "").trim();
const numberValue = (data: Record<string, unknown>, key: string) => Number(data[key] ?? 0);
const optional = (data: Record<string, unknown>, key: string) => value(data, key) || null;
const required = (data: Record<string, unknown>, key: string, label: string) => {
  const result = value(data, key);
  if (!result) throw new AppError(`${label} là bắt buộc.`);
  return result;
};
const hasPermission = (user: Awaited<ReturnType<typeof requireUser>>, permission: string) => user.roleCode === "ADMIN" || user.permissions.includes(permission);
const requireAny = (user: Awaited<ReturnType<typeof requireUser>>, permissions: string[]) => {
  if (!permissions.some((permission) => hasPermission(user, permission))) throw new AppError("Bạn không có quyền thực hiện thao tác này.", 403);
};

async function recalculateInvoice(invoiceId: string) {
  const items = await queryOne<{ amount: number }>("SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_items WHERE invoice_id = ?", invoiceId);
  const adjustments = await queryOne<{ discount: number; surcharge: number }>(`SELECT
    COALESCE(SUM(CASE WHEN type IN ('DISCOUNT','MEMBER_BENEFIT') THEN amount ELSE 0 END),0) AS discount,
    COALESCE(SUM(CASE WHEN type='SURCHARGE' THEN amount ELSE 0 END),0) AS surcharge
    FROM invoice_adjustments WHERE invoice_id = ?`, invoiceId);
  const tableAmount = await queryOne<{ amount: number }>("SELECT COALESCE(SUM(amount),0) AS amount FROM invoice_items WHERE invoice_id = ? AND source_type = 'TABLE'", invoiceId);
  const serviceAmount = Math.max(0, Number(items?.amount ?? 0) - Number(tableAmount?.amount ?? 0));
  const total = Math.max(0, Number(items?.amount ?? 0) - Number(adjustments?.discount ?? 0) + Number(adjustments?.surcharge ?? 0));
  await getRawDb().prepare(`UPDATE invoices SET table_amount=?, service_amount=?, discount_amount=?, surcharge_amount=?, total_amount=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(Number(tableAmount?.amount ?? 0), serviceAmount, Number(adjustments?.discount ?? 0), Number(adjustments?.surcharge ?? 0), total, invoiceId).run();
  return total;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    let body: Body;
    try { body = await request.json() as Body; } catch { throw new AppError("JSON không hợp lệ."); }
    if (!body || typeof body.action !== "string" || (body.payload !== undefined && (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)))) throw new AppError("Yêu cầu không hợp lệ.");
    const payload = body.payload ?? {};
    const db = getRawDb();
    let result: unknown = null;

    if (Object.hasOwn(operationPermissions, body.action)) {
      return Response.json({ ok: true, data: await executeOperation(body.action, payload, user, request) });
    }
    switch (body.action) {
      case "profile.update": {
        const fullName = required(payload, "fullName", "Họ tên");
        const phone = optional(payload, "phone");
        await db.prepare("UPDATE users SET full_name=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(fullName, phone, user.id).run();
        await audit(request, user.id, "PROFILE_UPDATED", "USER", user.id, "Cập nhật hồ sơ cá nhân");
        break;
      }
      case "password.change": {
        const currentPassword = required(payload, "currentPassword", "Mật khẩu hiện tại");
        const newPassword = required(payload, "newPassword", "Mật khẩu mới");
        if (value(payload, "confirmPassword") !== newPassword) throw new AppError("Hai mật khẩu mới không trùng nhau.");
        if (!validatePassword(newPassword)) throw new AppError("Mật khẩu mới cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.");
        const account = await queryOne<{ password_hash: string; password_salt: string }>("SELECT password_hash, password_salt FROM users WHERE id=?", user.id);
        if (!account || !(await verifyPassword(currentPassword, account.password_salt, account.password_hash))) throw new AppError("Mật khẩu hiện tại không đúng.");
        const hashed = await hashPassword(newPassword);
        await db.prepare("UPDATE users SET password_hash=?, password_salt=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hashed.hash, hashed.salt, user.id).run();
        await audit(request, user.id, "PASSWORD_CHANGED", "USER", user.id, "Đổi mật khẩu");
        break;
      }
      case "user.invite": {
        requireAny(user, ["USERS_MANAGE"]);
        const roleId = required(payload, "roleId", "Vai trò");
        if (!await queryOne("SELECT id FROM roles WHERE id=?", roleId)) throw new AppError("Vai trò không hợp lệ.");
        const rawCode = randomToken(12);
        const invitationId = id("inv");
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
        await db.prepare("INSERT INTO invitations (id, code_hash, email, role_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(invitationId, await sha256Hex(rawCode), optional(payload, "email") ? normalizeEmail(value(payload, "email")) : null, roleId, expiresAt, user.id).run();
        await audit(request, user.id, "INVITATION_CREATED", "INVITATION", invitationId, "Tạo mã mời nhân viên", { roleId });
        result = { invitationCode: rawCode, expiresAt };
        break;
      }
      case "user.update": {
        requireAny(user, ["USERS_MANAGE"]);
        const targetId = required(payload, "id", "Tài khoản");
        if (targetId === user.id && value(payload, "status") === "LOCKED") throw new AppError("Bạn không thể tự khóa tài khoản của mình.");
        const roleId = required(payload, "roleId", "Vai trò");
        const status = value(payload, "status") === "LOCKED" ? "LOCKED" : "ACTIVE";
        await db.prepare("UPDATE users SET full_name=?, phone=?, role_id=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(required(payload, "fullName", "Họ tên"), optional(payload, "phone"), roleId, status, targetId).run();
        if (status === "LOCKED") await db.prepare("DELETE FROM user_sessions WHERE user_id=?").bind(targetId).run();
        await audit(request, user.id, "USER_UPDATED", "USER", targetId, "Cập nhật tài khoản nhân viên", { roleId, status });
        break;
      }
      case "role.permissions": {
        requireAny(user, ["ROLES_MANAGE"]);
        const roleId = required(payload, "roleId", "Vai trò");
        if (roleId === "role_admin") throw new AppError("Không thể giảm quyền của vai trò quản trị hệ thống.");
        const permissionCodes = Array.isArray(payload.permissionCodes) ? payload.permissionCodes.map(String) : [];
        const permissions = permissionCodes.length ? await queryAll<{ id: string }>(`SELECT id FROM permissions WHERE code IN (${permissionCodes.map(() => "?").join(",")})`, ...permissionCodes) : [];
        const statements = [db.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(roleId), ...permissions.map((item) => db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)").bind(roleId, item.id))];
        await db.batch(statements);
        await audit(request, user.id, "ROLE_PERMISSIONS_UPDATED", "ROLE", roleId, "Cập nhật quyền vai trò", { permissionCodes });
        break;
      }
      case "customer.save": {
        requireAny(user, ["CUSTOMERS_MANAGE"]);
        const customerId = optional(payload, "id") ?? id("cus");
        const name = required(payload, "fullName", "Tên khách hàng");
        const args = [name, optional(payload, "phone"), optional(payload, "email") ? normalizeEmail(value(payload, "email")) : null, optional(payload, "dateOfBirth"), optional(payload, "notes")];
        if (payload.id) await db.prepare("UPDATE customers SET full_name=?, phone=?, email=?, date_of_birth=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...args, customerId).run();
        else await db.prepare("INSERT INTO customers (id, code, full_name, phone, email, date_of_birth, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(customerId, code("KH"), ...args).run();
        await audit(request, user.id, "CUSTOMER_SAVED", "CUSTOMER", customerId, `Lưu khách hàng ${name}`);
        break;
      }
      case "tier.save": {
        requireAny(user, ["MEMBERSHIPS_MANAGE"]);
        const tierId = optional(payload, "id") ?? id("tier");
        const discount = numberValue(payload, "discountPercent");
        if (discount < 0 || discount > 100) throw new AppError("Mức giảm giá phải từ 0 đến 100%.");
        const args = [required(payload, "code", "Mã hạng").toUpperCase(), required(payload, "name", "Tên hạng"), numberValue(payload, "minPoints"), discount];
        if (payload.id) await db.prepare("UPDATE membership_tiers SET code=?, name=?, min_points=?, discount_percent=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...args, tierId).run();
        else await db.prepare("INSERT INTO membership_tiers (id, code, name, min_points, discount_percent) VALUES (?, ?, ?, ?, ?)").bind(tierId, ...args).run();
        await audit(request, user.id, "MEMBERSHIP_TIER_SAVED", "MEMBERSHIP_TIER", tierId, "Lưu hạng hội viên");
        break;
      }
      case "membership.save": {
        requireAny(user, ["MEMBERSHIPS_MANAGE"]);
        const customerId = required(payload, "customerId", "Khách hàng");
        const tierId = required(payload, "tierId", "Hạng hội viên");
        const existing = await queryOne<{ id: string }>("SELECT id FROM memberships WHERE customer_id=?", customerId);
        if (existing) await db.prepare("UPDATE memberships SET tier_id=?, active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(tierId, existing.id).run();
        else await db.prepare("INSERT INTO memberships (id, customer_id, tier_id) VALUES (?, ?, ?)").bind(id("member"), customerId, tierId).run();
        await audit(request, user.id, "MEMBERSHIP_UPDATED", "CUSTOMER", customerId, "Cập nhật hội viên");
        break;
      }
      case "invoice.create": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const sessionId = required(payload, "sessionId", "Phiên chơi");
        const session = await queryOne<{ id: string; status: string; table_amount: number; customer_id: string | null; code: string }>("SELECT id, status, table_amount, customer_id, code FROM play_sessions WHERE id=?", sessionId);
        if (!session || session.status !== "CLOSED") throw new AppError("Cần kết thúc phiên chơi trước khi lập hóa đơn.");
        if (await queryOne("SELECT id FROM invoices WHERE session_id=? AND status<>'CANCELLED'", sessionId)) throw new AppError("Phiên chơi đã có hóa đơn.");
        if (await queryOne("SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.session_id=? AND oi.status IN ('PENDING','PREPARING') LIMIT 1", sessionId)) throw new AppError("Còn món chưa hoàn thành. Phục vụ hoặc hủy món trước khi lập hóa đơn.");
        const invoiceId = id("bill");
        const items = await queryAll<{ id: string; product_id: string; product_name: string; quantity: number; unit_price: number; kind: string }>(`
          SELECT oi.id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, p.kind FROM order_items oi
          JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
          WHERE o.session_id=? AND oi.status<>'CANCELLED'`, sessionId);
        const statements = [
          db.prepare("INSERT INTO invoices (id, code, session_id, customer_id, status, issued_at, created_by) VALUES (?, ?, ?, ?, 'ISSUED', ?, ?)").bind(invoiceId, code("HD"), sessionId, session.customer_id, nowIso(), user.id),
          db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES (?, ?, 'TABLE', ?, ?, 1, ?, ?)").bind(id("line"), invoiceId, sessionId, `Tiền bàn - ${session.code}`, session.table_amount, session.table_amount),
          ...items.map((item) => db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id("line"), invoiceId, item.kind, item.id, item.product_name, item.quantity, item.unit_price, Math.round(item.quantity * item.unit_price))),
        ];
        await db.batch(statements);
        if (session.customer_id) {
          const member = await queryOne<{ discount_percent: number; tier_name: string }>(`SELECT mt.discount_percent, mt.name AS tier_name FROM memberships m JOIN membership_tiers mt ON mt.id=m.tier_id WHERE m.customer_id=? AND m.active=1`, session.customer_id);
          if (member && member.discount_percent > 0) {
            const subtotal = session.table_amount + items.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_price), 0);
            await db.prepare("INSERT INTO invoice_adjustments (id, invoice_id, type, description, amount, approved_by) VALUES (?, ?, 'MEMBER_BENEFIT', ?, ?, ?)")
              .bind(id("adj"), invoiceId, `Ưu đãi hội viên ${member.tier_name} (${member.discount_percent}%)`, Math.round(subtotal * member.discount_percent / 100), user.id).run();
          }
        }
        const total = await recalculateInvoice(invoiceId);
        await audit(request, user.id, "INVOICE_CREATED", "INVOICE", invoiceId, "Tạo hóa đơn", { sessionId, total });
        result = { invoiceId, total };
        break;
      }
      case "invoice.adjust": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const invoice = await queryOne<{ status: string }>("SELECT status FROM invoices WHERE id=?", invoiceId);
        if (!invoice || invoice.status !== "ISSUED") throw new AppError("Chỉ có thể điều chỉnh hóa đơn đang chờ thanh toán.");
        const type = value(payload, "type") === "SURCHARGE" ? "SURCHARGE" : "DISCOUNT";
        const amount = numberValue(payload, "amount");
        if (amount <= 0) throw new AppError("Số tiền điều chỉnh phải lớn hơn 0.");
        await db.prepare("INSERT INTO invoice_adjustments (id, invoice_id, type, description, amount, approved_by) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id("adj"), invoiceId, type, required(payload, "description", "Lý do"), amount, user.id).run();
        const total = await recalculateInvoice(invoiceId);
        await audit(request, user.id, "INVOICE_ADJUSTED", "INVOICE", invoiceId, "Điều chỉnh hóa đơn", { type, amount, total });
        result = { total };
        break;
      }
      case "invoice.pay": {
        requireAny(user, ["PAYMENTS_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const invoice = await queryOne<{ status: string; total_amount: number; customer_id: string | null }>("SELECT status, total_amount, customer_id FROM invoices WHERE id=?", invoiceId);
        if (!invoice || invoice.status !== "ISSUED") throw new AppError("Hóa đơn không ở trạng thái chờ thanh toán.");
        const alreadyPaid = Number((await queryOne<{ total: number }>("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id=?", invoiceId))?.total ?? 0);
        const amount = numberValue(payload, "amount") || invoice.total_amount - alreadyPaid;
        if (amount <= 0 || alreadyPaid + amount > invoice.total_amount) throw new AppError("Số tiền thanh toán không hợp lệ.");
        const method = required(payload, "method", "Phương thức thanh toán");
        const ALLOWED_METHODS = new Set(["CASH", "BANK_TRANSFER", "CARD", "EWALLET"]);
        if (!ALLOWED_METHODS.has(method)) throw new AppError("Phương thức thanh toán không hợp lệ.");
        const shift = await queryOne<{ id: string }>("SELECT id FROM work_shifts WHERE cashier_id=? AND status='OPEN'", user.id);
        if (method === "CASH" && !shift) throw new AppError("Bạn cần mở ca trước khi nhận thanh toán tiền mặt.");
        const paymentId = id("pay");
        const statements = [db.prepare("INSERT INTO payments (id, invoice_id, method, amount, reference, received_by) VALUES (?, ?, ?, ?, ?, ?)").bind(paymentId, invoiceId, method, amount, optional(payload, "reference"), user.id)];
        const isPaid = alreadyPaid + amount === invoice.total_amount;
        if (isPaid) statements.push(db.prepare("UPDATE invoices SET status='PAID', paid_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(invoiceId));
        if (method === "CASH" && shift) statements.push(db.prepare("INSERT INTO shift_cash_movements (id, shift_id, type, amount, reference_type, reference_id, notes, created_by) VALUES (?, ?, 'PAYMENT', ?, 'INVOICE', ?, ?, ?)").bind(id("cash"), shift.id, amount, invoiceId, "Thu tiền hóa đơn", user.id));
        await db.batch(statements);
        if (isPaid && invoice.customer_id) {
          const membership = await queryOne<{ id: string }>("SELECT id FROM memberships WHERE customer_id=? AND active=1", invoice.customer_id);
          if (membership) {
            const points = Math.floor(invoice.total_amount / 10000);
            await db.batch([
              db.prepare("UPDATE memberships SET points=points+?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(points, membership.id),
              db.prepare("INSERT INTO loyalty_transactions (id, membership_id, points, reason, reference_type, reference_id) VALUES (?, ?, ?, ?, 'INVOICE', ?)").bind(id("point"), membership.id, points, "Tích điểm thanh toán", invoiceId),
            ]);
          }
        }
        await audit(request, user.id, "INVOICE_PAID", "INVOICE", invoiceId, isPaid ? "Thanh toán hoàn tất" : "Thanh toán một phần", { method, amount });
        break;
      }
      case "invoice.cancel": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const reason = required(payload, "reason", "Lý do hủy");
        const invoice = await queryOne<{ status: string }>("SELECT status FROM invoices WHERE id=?", invoiceId);
        if (!invoice || !["DRAFT", "ISSUED"].includes(invoice.status)) throw new AppError("Chỉ có thể hủy hóa đơn chưa thanh toán.");
        await db.prepare("UPDATE invoices SET status='CANCELLED', cancelled_at=CURRENT_TIMESTAMP, cancel_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reason, invoiceId).run();
        await audit(request, user.id, "INVOICE_CANCELLED", "INVOICE", invoiceId, "Hủy hóa đơn", { reason });
        break;
      }
      case "invoice.split": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const invoiceId = required(payload, "invoiceId", "Hóa đơn");
        const itemIds = Array.isArray(payload.itemIds) ? payload.itemIds.map(String) : [];
        if (!itemIds.length) throw new AppError("Cần chọn ít nhất một dòng để tách.");
        const invoice = await queryOne<{ status: string; customer_id: string | null }>("SELECT status, customer_id FROM invoices WHERE id=?", invoiceId);
        if (!invoice || invoice.status !== "ISSUED") throw new AppError("Chỉ tách được hóa đơn chờ thanh toán.");
        const totalItems = Number((await queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM invoice_items WHERE invoice_id=?", invoiceId))?.count ?? 0);
        if (itemIds.length >= totalItems) throw new AppError("Hóa đơn gốc phải còn ít nhất một dòng.");
        const newId = id("bill");
        await db.prepare("INSERT INTO invoices (id, code, customer_id, status, issued_at, created_by) VALUES (?, ?, ?, 'ISSUED', ?, ?)").bind(newId, code("HD"), invoice.customer_id, nowIso(), user.id).run();
        await db.prepare(`UPDATE invoice_items SET invoice_id=? WHERE invoice_id=? AND id IN (${itemIds.map(() => "?").join(",")})`).bind(newId, invoiceId, ...itemIds).run();
        await recalculateInvoice(invoiceId); await recalculateInvoice(newId);
        await audit(request, user.id, "INVOICE_SPLIT", "INVOICE", invoiceId, "Tách hóa đơn", { newInvoiceId: newId, itemIds });
        result = { invoiceId: newId };
        break;
      }
      case "invoice.merge": {
        requireAny(user, ["INVOICES_MANAGE"]);
        const targetId = required(payload, "targetInvoiceId", "Hóa đơn đích");
        const sourceIds = Array.isArray(payload.sourceInvoiceIds) ? payload.sourceInvoiceIds.map(String).filter((item) => item !== targetId) : [];
        if (!sourceIds.length) throw new AppError("Cần chọn hóa đơn để gộp.");
        const valid = await queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM invoices WHERE status='ISSUED' AND id IN (${sourceIds.map(() => "?").join(",")})`, ...sourceIds);
        if (Number(valid?.count ?? 0) !== sourceIds.length || !await queryOne("SELECT id FROM invoices WHERE id=? AND status='ISSUED'", targetId)) throw new AppError("Chỉ gộp được các hóa đơn chờ thanh toán.");
        await db.batch([
          ...sourceIds.map((sourceId) => db.prepare("UPDATE invoice_items SET invoice_id=? WHERE invoice_id=?").bind(targetId, sourceId)),
          ...sourceIds.map((sourceId) => db.prepare("UPDATE invoices SET status='CANCELLED', cancelled_at=CURRENT_TIMESTAMP, cancel_reason='Đã gộp vào hóa đơn khác' WHERE id=?").bind(sourceId)),
        ]);
        await recalculateInvoice(targetId);
        await audit(request, user.id, "INVOICES_MERGED", "INVOICE", targetId, "Gộp hóa đơn", { sourceIds });
        break;
      }
      case "inventory.move": {
        requireAny(user, ["INVENTORY_MANAGE"]);
        const productId = required(payload, "productId", "Hàng hóa");
        const type = required(payload, "type", "Loại giao dịch");
        if (!new Set(["IN", "OUT", "ADJUST"]).has(type)) throw new AppError("Loại giao dịch kho không hợp lệ.");
        const product = await queryOne<{ stock_quantity: number; name: string }>("SELECT stock_quantity, name FROM products WHERE id=? AND active=1", productId);
        if (!product) throw new AppError("Không tìm thấy hàng hóa.");
        const quantity = numberValue(payload, "quantity");
        if (quantity < 0 || (type !== "ADJUST" && quantity <= 0)) throw new AppError("Số lượng không hợp lệ.");
        const after = type === "IN" ? product.stock_quantity + quantity : type === "OUT" ? product.stock_quantity - quantity : quantity;
        if (after < 0) throw new AppError("Không thể xuất kho làm tồn kho âm.");
        const transactionId = id("stock");
        await db.batch([
          db.prepare("UPDATE products SET stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(after, productId),
          db.prepare("INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, unit_cost, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(transactionId, code(type === "IN" ? "NK" : type === "OUT" ? "XK" : "DC"), productId, type, type === "ADJUST" ? Math.abs(after - product.stock_quantity) : quantity, product.stock_quantity, after, optional(payload, "unitCost") ? numberValue(payload, "unitCost") : null, required(payload, "reason", "Lý do"), user.id),
        ]);
        await audit(request, user.id, "INVENTORY_MOVED", "PRODUCT", productId, `${type} kho ${product.name}`, { before: product.stock_quantity, after });
        break;
      }
      case "stock.count": {
        requireAny(user, ["INVENTORY_MANAGE"]);
        const rows = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
        if (!rows.length) throw new AppError("Phiếu kiểm kê chưa có hàng hóa.");
        const countId = id("count");
        const statements = [db.prepare("INSERT INTO stock_counts (id, code, status, notes, counted_by, approved_by, completed_at) VALUES (?, ?, 'COMPLETED', ?, ?, ?, CURRENT_TIMESTAMP)").bind(countId, code("KK"), optional(payload, "notes"), user.id, user.id)];
        for (const row of rows) {
          const productId = required(row, "productId", "Hàng hóa");
          const product = await queryOne<{ stock_quantity: number; name: string }>("SELECT stock_quantity, name FROM products WHERE id=?", productId);
          if (!product) throw new AppError("Có hàng hóa kiểm kê không hợp lệ.");
          const actual = numberValue(row, "actualQuantity");
          if (actual < 0) throw new AppError("Tồn thực tế không được âm.");
          const difference = actual - product.stock_quantity;
          statements.push(db.prepare("INSERT INTO stock_count_items (id, stock_count_id, product_id, system_quantity, actual_quantity, difference, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("countline"), countId, productId, product.stock_quantity, actual, difference, optional(row, "notes")));
          if (difference !== 0) {
            statements.push(db.prepare("UPDATE products SET stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actual, productId));
            statements.push(db.prepare("INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reference_type, reference_id, reason, created_by) VALUES (?, ?, ?, 'ADJUST', ?, ?, ?, 'STOCK_COUNT', ?, ?, ?)").bind(id("stock"), code("DC"), productId, Math.abs(difference), product.stock_quantity, actual, countId, "Điều chỉnh sau kiểm kê", user.id));
          }
        }
        await db.batch(statements);
        await audit(request, user.id, "STOCK_COUNT_COMPLETED", "STOCK_COUNT", countId, "Hoàn tất kiểm kê kho", { itemCount: rows.length });
        break;
      }
      case "shift.open": {
        requireAny(user, ["SHIFTS_MANAGE"]);
        if (await queryOne("SELECT id FROM work_shifts WHERE cashier_id=? AND status='OPEN'", user.id)) throw new AppError("Bạn đã có một ca đang mở.");
        const openingCash = numberValue(payload, "openingCash");
        if (openingCash < 0) throw new AppError("Tiền đầu ca không được âm.");
        const shiftId = id("shift");
        await db.batch([
          db.prepare("INSERT INTO work_shifts (id, code, cashier_id, opening_cash, notes) VALUES (?, ?, ?, ?, ?)").bind(shiftId, code("CA"), user.id, openingCash, optional(payload, "notes")),
          db.prepare("INSERT INTO shift_cash_movements (id, shift_id, type, amount, notes, created_by) VALUES (?, ?, 'OPENING', ?, 'Tiền đầu ca', ?)").bind(id("cash"), shiftId, openingCash, user.id),
        ]);
        await audit(request, user.id, "SHIFT_OPENED", "WORK_SHIFT", shiftId, "Mở ca làm việc", { openingCash });
        break;
      }
      case "shift.close": {
        requireAny(user, ["SHIFTS_MANAGE"]);
        const shift = await queryOne<{ id: string; opening_cash: number }>("SELECT id, opening_cash FROM work_shifts WHERE cashier_id=? AND status='OPEN'", user.id);
        if (!shift) throw new AppError("Bạn không có ca đang mở.");
        const cashFlow = Number((await queryOne<{ total: number }>("SELECT COALESCE(SUM(CASE WHEN type IN ('OPENING','PAYMENT','CASH_IN') THEN amount ELSE -amount END),0) AS total FROM shift_cash_movements WHERE shift_id=?", shift.id))?.total ?? 0);
        const actual = numberValue(payload, "actualCash");
        if (actual < 0) throw new AppError("Tiền thực tế không được âm.");
        await db.batch([
          db.prepare("UPDATE work_shifts SET status='CLOSED', closed_at=CURRENT_TIMESTAMP, expected_cash=?, actual_cash=?, difference=?, notes=COALESCE(?,notes), closed_by=? WHERE id=?").bind(cashFlow, actual, actual - cashFlow, optional(payload, "notes"), user.id, shift.id),
          db.prepare("INSERT INTO shift_cash_movements (id, shift_id, type, amount, notes, created_by) VALUES (?, ?, 'CLOSING', ?, 'Tiền thực tế chốt ca', ?)").bind(id("cash"), shift.id, actual, user.id),
        ]);
        await audit(request, user.id, "SHIFT_CLOSED", "WORK_SHIFT", shift.id, "Chốt ca làm việc", { expected: cashFlow, actual, difference: actual - cashFlow });
        result = { expectedCash: cashFlow, difference: actual - cashFlow };
        break;
      }
      default: throw new AppError("Thao tác không được hỗ trợ.", 404);
    }
    return Response.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) return responseError(new AppError("Dữ liệu bị trùng hoặc trạng thái đã thay đổi. Vui lòng tải lại."));
    if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) return responseError(new AppError("Dữ liệu liên quan không hợp lệ hoặc vẫn đang được sử dụng."));
    return responseError(error);
  }
}
