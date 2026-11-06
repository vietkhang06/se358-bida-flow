import { billableSeconds, segmentAmount } from "@/lib/play-time";
import { env } from "cloudflare:workers";

export type AppUser = {
  id: string;
  email: string;
  username: string | null;
  fullName: string;
  phone: string | null;
  roleCode: string;
  roleName: string;
  status: string;
  permissions: string[];
};

export const PERMISSIONS = [
  ["USERS_MANAGE", "Quản lý tài khoản", "accounts"],
  ["ROLES_MANAGE", "Phân quyền", "accounts"],
  ["TABLES_VIEW", "Xem sơ đồ bàn", "tables"],
  ["TABLES_MANAGE", "Quản lý bàn và khu vực", "tables"],
  ["TABLE_STATUS", "Cập nhật trạng thái bàn", "tables"],
  ["SESSIONS_MANAGE", "Quản lý phiên chơi", "sessions"],
  ["RESERVATIONS_MANAGE", "Quản lý đặt bàn", "reservations"],
  ["PRICES_MANAGE", "Quản lý loại bàn và bảng giá", "pricing"],
  ["PRODUCTS_MANAGE", "Quản lý sản phẩm và dịch vụ", "products"],
  ["ORDERS_MANAGE", "Quản lý order", "orders"],
  ["CUSTOMERS_MANAGE", "Quản lý khách hàng", "customers"],
  ["MEMBERSHIPS_MANAGE", "Quản lý hội viên", "customers"],
  ["INVOICES_VIEW", "Xem hóa đơn", "billing"],
  ["INVOICES_MANAGE", "Lập và điều chỉnh hóa đơn", "billing"],
  ["PAYMENTS_MANAGE", "Thanh toán hóa đơn", "billing"],
  ["INVENTORY_MANAGE", "Quản lý kho", "inventory"],
  ["SHIFTS_MANAGE", "Mở và chốt ca", "shifts"],
  ["SHIFTS_HISTORY", "Xem lịch sử ca", "shifts"],
  ["REPORTS_VIEW", "Xem báo cáo", "reports"],
  ["AUDIT_VIEW", "Xem nhật ký hoạt động", "audit"],
  ["PROFILE_MANAGE", "Quản lý hồ sơ cá nhân", "profile"],
] as const;

const ROLES = [
  ["role_admin", "ADMIN", "Quản trị hệ thống", "Toàn quyền hệ thống"],
  ["role_manager", "MANAGER", "Quản lý", "Quản lý vận hành và báo cáo"],
  ["role_cashier", "CASHIER", "Thu ngân", "Bàn, đặt bàn, hóa đơn và ca"],
  ["role_service", "SERVICE", "Nhân viên phục vụ", "Bàn, phiên chơi và order"],
  ["role_warehouse", "WAREHOUSE", "Nhân viên kho", "Nhập, xuất và kiểm kê kho"],
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: PERMISSIONS.map(([code]) => code),
  MANAGER: PERMISSIONS.map(([code]) => code),
  CASHIER: ["TABLES_VIEW", "TABLE_STATUS", "SESSIONS_MANAGE", "RESERVATIONS_MANAGE", "ORDERS_MANAGE", "CUSTOMERS_MANAGE", "INVOICES_VIEW", "INVOICES_MANAGE", "PAYMENTS_MANAGE", "SHIFTS_MANAGE", "PROFILE_MANAGE"],
  SERVICE: ["TABLES_VIEW", "TABLE_STATUS", "SESSIONS_MANAGE", "ORDERS_MANAGE", "INVOICES_VIEW", "PROFILE_MANAGE"],
  WAREHOUSE: ["PRODUCTS_MANAGE", "INVENTORY_MANAGE", "PROFILE_MANAGE"],
};

export function getRawDb(): D1Database {
  if (!env.DB) throw new Error("Cơ sở dữ liệu chưa được cấu hình.");
  return env.DB;
}

export async function queryAll<T = Record<string, unknown>>(sql: string, ...values: unknown[]): Promise<T[]> {
  const result = await getRawDb().prepare(sql).bind(...values).all<T>();
  return result.results ?? [];
}

export async function queryOne<T = Record<string, unknown>>(sql: string, ...values: unknown[]): Promise<T | null> {
  return (await getRawDb().prepare(sql).bind(...values).first<T>()) ?? null;
}

export function nowIso() { return new Date().toISOString(); }
export function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
export function code(prefix: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  return `${prefix}-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const PBKDF2_ITERATIONS = 100_000;

export function randomToken(size = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(size))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, existingSalt?: string) {
  const saltBytes = existingSalt ? base64ToBytes(existingSalt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(saltBytes) };
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const actual = (await hashPassword(password, salt)).hash;
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
export function validatePassword(value: string) {
  return value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export async function ensureSystemCatalog() {
  const db = getRawDb();
  const existingRoles = new Set((await queryAll<{ id: string }>("SELECT id FROM roles")).map((role) => role.id));
  const statements: D1PreparedStatement[] = [];
  for (const [roleId, roleCode, name, description] of ROLES) {
    statements.push(db.prepare("INSERT OR IGNORE INTO roles (id, code, name, description, is_system) VALUES (?, ?, ?, ?, 1)").bind(roleId, roleCode, name, description));
  }
  for (const [permissionCode, name, module] of PERMISSIONS) {
    statements.push(db.prepare("INSERT OR IGNORE INTO permissions (id, code, name, module) VALUES (?, ?, ?, ?)").bind(`perm_${permissionCode.toLowerCase()}`, permissionCode, name, module));
  }
  for (const [roleId, roleCode] of ROLES) {
    if (existingRoles.has(roleId)) continue;
    for (const permissionCode of ROLE_PERMISSIONS[roleCode]) {
      statements.push(db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)").bind(roleId, `perm_${permissionCode.toLowerCase()}`));
    }
  }
  await db.batch(statements);
}

function cookieValue(request: Request, name: string) {
  const pair = (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  try { return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null; } catch { return null; }
}

export function authCookie(token: string) {
  return `bidaflow_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
}

export function clearAuthCookie() {
  return "bidaflow_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export async function createSession(userId: string) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await getRawDb().prepare("INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").bind(id("ses"), userId, tokenHash, expires).run();
  return token;
}

export async function deleteSession(request: Request) {
  const token = cookieValue(request, "bidaflow_session");
  if (token) await getRawDb().prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export async function currentUser(request: Request): Promise<AppUser | null> {
  const token = cookieValue(request, "bidaflow_session");
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await queryOne<Record<string, string | null>>(`
    SELECT u.id, u.email, u.username, u.full_name, u.phone, u.status,
           r.code AS role_code, r.name AS role_name,
           GROUP_CONCAT(p.code) AS permission_codes
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now') AND u.status = 'ACTIVE'
    GROUP BY u.id, r.id
  `, tokenHash);
  if (!row) return null;
  await getRawDb().prepare("UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?").bind(tokenHash).run();
  return {
    id: row.id!, email: row.email!, username: row.username, fullName: row.full_name!, phone: row.phone,
    roleCode: row.role_code!, roleName: row.role_name!, status: row.status!,
    permissions: row.role_code === "ADMIN" ? PERMISSIONS.map(([value]) => value) : (row.permission_codes ?? "").split(",").filter(Boolean),
  };
}

export async function requireUser(request: Request, permission?: string) {
  const user = await currentUser(request);
  if (!user) throw new AppError("Bạn cần đăng nhập để tiếp tục.", 401);
  if (permission && user.roleCode !== "ADMIN" && !user.permissions.includes(permission)) {
    throw new AppError("Bạn không có quyền thực hiện thao tác này.", 403);
  }
  return user;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AppError("Yêu cầu không hợp lệ.", 403);
}

export async function audit(request: Request, actorId: string | null, action: string, entityType: string, entityId: string | null, summary: string, metadata?: unknown) {
  await getRawDb().prepare(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, summary, metadata_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id("log"), actorId, action, entityType, entityId, summary,
      metadata ? JSON.stringify(metadata) : null, request.headers.get("cf-connecting-ip")).run();
}

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function responseError(error: unknown) {
  if (error instanceof AppError) {
    const codes: Record<number, string> = { 400: "VALIDATION_ERROR", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "VALIDATION_ERROR", 429: "RATE_LIMITED" };
    return Response.json({ error: error.message, code: codes[error.status] ?? "REQUEST_ERROR" }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Hệ thống đang bận. Vui lòng thử lại.", code: "INTERNAL_ERROR" }, { status: 500 });
}

export async function activeHourlyRate(tableId: string, at = new Date()) {
  const table = await queryOne<{ table_type_id: string; base_hourly_rate: number }>(`
    SELECT bt.table_type_id, tt.base_hourly_rate FROM billiard_tables bt JOIN table_types tt ON tt.id = bt.table_type_id WHERE bt.id = ? AND bt.active = 1
  `, tableId);
  if (!table) throw new AppError("Không tìm thấy bàn đang hoạt động.", 404);
  const vietnam = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const weekday = vietnam.find((part) => part.type === "weekday")?.value ?? "Sun";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const hour = Number(vietnam.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(vietnam.find((part) => part.type === "minute")?.value ?? 0);
  const minuteOfDay = hour * 60 + minute;
  const rules = await queryAll<{ hourly_rate: number; days_mask: number; start_minute: number; end_minute: number }>(`
    SELECT hourly_rate, days_mask, start_minute, end_minute FROM price_rules
    WHERE table_type_id = ? AND active = 1
      AND (effective_from IS NULL OR julianday(effective_from) <= julianday(?)) AND (effective_to IS NULL OR julianday(effective_to) > julianday(?))
    ORDER BY priority DESC, created_at DESC
  `, table.table_type_id, at.toISOString(), at.toISOString());
  const matching = rules.find((rule) => (rule.days_mask & (1 << dayIndex)) !== 0 && minuteOfDay >= rule.start_minute && minuteOfDay < rule.end_minute);
  return matching?.hourly_rate ?? table.base_hourly_rate;
}

export async function sessionTiming(sessionId: string, endAt = new Date()) {
  const segments = await queryAll<{ id: string; started_at: string; ended_at: string | null; hourly_rate: number }>(
    "SELECT id, started_at, ended_at, hourly_rate FROM session_segments WHERE session_id = ? ORDER BY started_at", sessionId,
  );
  const pauses = await queryAll<{ segment_id: string; started_at: string; ended_at: string | null }>(
    "SELECT segment_id, started_at, ended_at FROM session_pauses WHERE session_id = ?", sessionId,
  );
  let seconds = 0, amount = 0;
  for (const segment of segments) {
    const active = billableSeconds(segment, pauses.filter((pause) => pause.segment_id === segment.id), endAt);
    seconds += active;
    amount += segmentAmount(active, segment.hourly_rate);
  }
  return { seconds, amount, sampledAt: endAt.toISOString() };
}

export async function calculateSessionAmount(sessionId: string, endAt = new Date()) {
  return (await sessionTiming(sessionId, endAt)).amount;
}
