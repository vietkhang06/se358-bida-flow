import { AppError } from "@/lib/server";

export type ActionPayload = Record<string, unknown>;
export type ActionRequest = { action: string; payload: ActionPayload };

export const directActionPermissions: Readonly<Record<string, string>> = {
  "user.invite": "USERS_MANAGE", "user.update": "USERS_MANAGE", "role.permissions": "ROLES_MANAGE",
  "customer.save": "CUSTOMERS_MANAGE", "tier.save": "MEMBERSHIPS_MANAGE", "membership.save": "MEMBERSHIPS_MANAGE",
  "invoice.create": "INVOICES_MANAGE", "invoice.adjust": "INVOICES_MANAGE", "invoice.pay": "PAYMENTS_MANAGE",
  "invoice.cancel": "INVOICES_MANAGE", "invoice.split": "INVOICES_MANAGE", "invoice.merge": "INVOICES_MANAGE",
  "inventory.move": "INVENTORY_MANAGE", "stock.count": "INVENTORY_MANAGE", "shift.open": "SHIFTS_MANAGE", "shift.close": "SHIFTS_MANAGE",
};

export function parseActionRequest(raw: unknown): ActionRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("Yêu cầu phải là một đối tượng JSON.");
  const data = raw as Record<string, unknown>;
  if (typeof data.action !== "string" || !data.action || data.action.trim() !== data.action || data.action.length > 100) throw new AppError("Tên thao tác không hợp lệ.");
  if (data.payload !== undefined && (!data.payload || typeof data.payload !== "object" || Array.isArray(data.payload))) throw new AppError("Dữ liệu thao tác phải là một đối tượng JSON.");
  return { action: data.action, payload: (data.payload ?? {}) as ActionPayload };
}

function stringField(p: ActionPayload, key: string, limit = 4000) {
  const v = p[key];
  if (v === undefined || v === null || v === "") return; // preserve existing field-specific required errors
  if (typeof v !== "string" || v.length > limit) throw new AppError(`${key} không hợp lệ.`);
}
function numberField(p: ActionPayload, key: string) {
  const v = p[key];
  if (v === undefined || v === null || v === "") return;
  if ((typeof v !== "string" && typeof v !== "number") || (typeof v === "string" && !v.trim()) || !Number.isFinite(Number(v))) throw new AppError(`${key} phải là số hợp lệ.`);
}
function enumField(p: ActionPayload, key: string, allowed: readonly string[]) {
  if (p[key] === undefined || p[key] === null || p[key] === "") return;
  if (typeof p[key] !== "string" || !allowed.includes(p[key])) throw new AppError(`${key} phải thuộc: ${allowed.join(", ")}.`);
}
function stringArray(p: ActionPayload, key: string) {
  const v = p[key];
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > 200 || v.some(x => typeof x !== "string" || !x.trim() || x.length > 120)) throw new AppError(`${key} phải là danh sách mã hợp lệ.`);
}

/** Direct dispatcher only. Delegated operations keep their own validation. */
export function validateDirectActionPayload(action: string, p: ActionPayload) {
  switch (action) {
    case "profile.update": stringField(p, "fullName", 160); stringField(p, "phone", 40); break;
    case "password.change": for (const k of ["currentPassword", "newPassword", "confirmPassword"]) stringField(p, k, 256); break;
    case "user.invite": stringField(p, "roleId", 120); stringField(p, "email", 254); break;
    case "user.update":
      for (const k of ["id", "roleId", "fullName", "phone"]) stringField(p, k, 160);
      enumField(p, "status", ["ACTIVE", "LOCKED"]); break;
    case "role.permissions": stringField(p, "roleId", 120); stringArray(p, "permissionCodes"); break;
    case "customer.save":
      for (const k of ["id", "fullName", "phone", "email", "dateOfBirth", "notes"]) stringField(p, k); break;
    case "tier.save":
      for (const k of ["id", "code", "name"]) stringField(p, k, 160);
      numberField(p, "minPoints"); numberField(p, "discountPercent"); break;
    case "membership.save": stringField(p, "customerId", 120); stringField(p, "tierId", 120); break;
    case "invoice.create": stringField(p, "sessionId", 120); break;
    case "invoice.adjust":
      stringField(p, "invoiceId", 120); stringField(p, "description");
      enumField(p, "type", ["DISCOUNT", "SURCHARGE"]); numberField(p, "amount"); break;
    case "invoice.pay":
      stringField(p, "invoiceId", 120);
      enumField(p, "method", ["CASH", "BANK_TRANSFER", "CARD", "EWALLET"]);
      numberField(p, "amount"); stringField(p, "reference", 255); break;
    case "invoice.cancel": stringField(p, "invoiceId", 120); stringField(p, "reason"); break;
    case "invoice.split": stringField(p, "invoiceId", 120); stringArray(p, "itemIds"); break;
    case "invoice.merge": stringField(p, "targetInvoiceId", 120); stringArray(p, "sourceInvoiceIds"); break;
    case "inventory.move":
      stringField(p, "productId", 120); stringField(p, "reason");
      enumField(p, "type", ["IN", "OUT", "ADJUST"]);
      numberField(p, "quantity"); numberField(p, "unitCost"); break;
    case "stock.count": {
      if (!Array.isArray(p.items) || !p.items.length || p.items.length > 500) throw new AppError("items phải là danh sách kiểm kê không rỗng.");
      const seen = new Set<string>();
      for (const row of p.items) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new AppError("Dòng kiểm kê không hợp lệ.");
        const item = row as ActionPayload;
        stringField(item, "productId", 120); numberField(item, "actualQuantity");
        if (typeof item.productId !== "string" || !item.productId.trim() || item.actualQuantity === undefined || Number(item.actualQuantity) < 0) throw new AppError("Dòng kiểm kê không hợp lệ.");
        if (seen.has(item.productId)) throw new AppError("Hàng hóa bị lặp trong phiếu kiểm kê.");
        seen.add(item.productId);
      }
      break;
    }
    case "shift.open": numberField(p, "openingCash"); stringField(p, "notes"); break;
    case "shift.close": numberField(p, "actualCash"); stringField(p, "notes"); break;
  }
}
