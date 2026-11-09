"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import {
  Activity, Archive, BarChart3, CalendarClock, Check,
  CircleDollarSign, ClipboardList, Clock3, Coffee, CreditCard, DoorOpen, History,
  LockKeyhole, LogOut, PackagePlus, Printer, Pause, Pencil, Play, Plus,
  ReceiptText, RefreshCw, Search, Settings2, ShieldCheck, Sparkles,
  Table2, TimerReset, UserRound, UsersRound, Warehouse, Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
  SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

declare global {
  interface Document {
    readonly modelContext?: {
      registerTool: (tool: {
        name: string; title?: string; description: string; inputSchema: object;
        annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
        execute: (input: unknown) => unknown | Promise<unknown>;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

type Row = Record<string, any>;
type User = { id: string; email: string; fullName: string; phone?: string | null; roleCode: string; roleName: string; permissions: string[] };
type AppData = Record<string, any> & { user: User; summary: Row };
type Option = { value: string; label: string };
type Field = {
  key: string; label: string; type?: "text" | "email" | "password" | "number" | "select" | "textarea" | "datetime-local" | "date" | "color";
  options?: Option[]; placeholder?: string; required?: boolean; min?: number; step?: number; value?: string | number | null;
};
type FormConfig = { title: string; description?: string; submitLabel?: string; fields: Field[]; onSubmit: (values: Record<string, any>) => Promise<void> };

const money = (amount: unknown) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(amount ?? 0));
const dateTime = (value: unknown) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(String(value))) : "-";
const localInput = (value?: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

const playingDuration = (session: Row) => {
  const delta = session.status === "ACTIVE" ? Math.max(0, (Date.now() - Date.parse(session.sampled_at)) / 1000) : 0;
  const seconds = Math.floor(Number(session.billable_seconds ?? 0) + delta);
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((v) => String(v).padStart(2, "0")).join(":");
};

const STATUS: Record<string, { label: string; className: string }> = {
  AVAILABLE: { label: "Sẵn sàng", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  PLAYING: { label: "Đang chơi", className: "bg-sky-100 text-sky-800 border-sky-200" },
  RESERVED: { label: "Đã đặt", className: "bg-amber-100 text-amber-800 border-amber-200" },
  MAINTENANCE: { label: "Bảo trì", className: "bg-slate-200 text-slate-700 border-slate-300" },
  ACTIVE: { label: "Đang chạy", className: "bg-sky-100 text-sky-800" },
  PAUSED: { label: "Tạm dừng", className: "bg-amber-100 text-amber-800" },
  CLOSED: { label: "Đã kết thúc", className: "bg-slate-100 text-slate-700" },
  PENDING: { label: "Chờ xác nhận", className: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Đã xác nhận", className: "bg-sky-100 text-sky-800" },
  SEATED: { label: "Đã nhận bàn", className: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Đã hủy", className: "bg-rose-100 text-rose-700" },
  NO_SHOW: { label: "Không đến", className: "bg-slate-100 text-slate-700" },
  ISSUED: { label: "Chờ thanh toán", className: "bg-amber-100 text-amber-800" },
  PAID: { label: "Đã thanh toán", className: "bg-emerald-100 text-emerald-800" },
  COMPLETED: { label: "Hoàn thành", className: "bg-emerald-100 text-emerald-800" },
  OPEN: { label: "Đang mở", className: "bg-emerald-100 text-emerald-800" },
  LOCKED: { label: "Đã khóa", className: "bg-rose-100 text-rose-700" },
};

function StatusBadge({ value }: { value: string }) {
  const status = STATUS[value] ?? { label: value, className: "bg-slate-100 text-slate-700" };
  return <Badge variant="outline" className={cn("font-medium", status.className)}>{status.label}</Badge>;
}

async function requestJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const json = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) throw new Error(json.error || "Không thể hoàn tất yêu cầu.");
  return json;
}

function AuthScreen({ initialized, onSuccess }: { initialized: boolean; onSuccess: () => void }) {
  const [mode, setMode] = React.useState<"login" | "register">(initialized ? "login" : "register");
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ fullName: "", email: "", password: "", setupCode: "", invitationCode: "" });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login" ? { identity: form.email, password: form.password } : form;
      await requestJson(path, { method: "POST", body: JSON.stringify(payload) });
      toast.success(mode === "login" ? "Đăng nhập thành công" : "Tài khoản đã sẵn sàng"); onSuccess();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra"); }
    finally { setBusy(false); }
  };
  return (
    <main className="min-h-screen overflow-hidden bg-[#08251f] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60 [background:radial-gradient(circle_at_18%_20%,#1c8b70_0,transparent_32%),radial-gradient(circle_at_85%_72%,#d49b3d_0,transparent_24%)]" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_.95fr] lg:px-10">
        <section className="soft-in hidden lg:block">
          <div className="mb-8 flex items-center gap-3"><Logo /><span className="text-xl font-semibold tracking-tight">BidaFlow</span></div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[.2em] text-emerald-300">Vận hành liền mạch</p>
          <h1 className="max-w-xl text-5xl font-semibold leading-[1.08] tracking-tight">Nhìn rõ từng bàn.<br />Nắm chắc từng ca.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-emerald-50/70">Một không gian làm việc thống nhất cho quản lý, thu ngân, phục vụ và nhân viên kho — từ lúc khách đặt bàn đến khi chốt doanh thu.</p>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {[['12','phân hệ'],['47','nghiệp vụ'],['5','vai trò']].map(([number, label]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"><div className="text-2xl font-semibold text-amber-300">{number}</div><div className="mt-1 text-sm text-emerald-50/60">{label}</div></div>)}
          </div>
        </section>
        <Card className="soft-in border-white/10 bg-white/96 text-slate-900 shadow-2xl shadow-black/30">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3 lg:hidden"><Logo dark /><span className="font-semibold">BidaFlow</span></div>
            <div><CardTitle className="text-2xl">{mode === "login" ? "Chào mừng trở lại" : initialized ? "Tham gia đội ngũ" : "Thiết lập hệ thống"}</CardTitle>
            <CardDescription className="mt-2">{mode === "login" ? "Đăng nhập bằng tài khoản nội bộ của quán." : initialized ? "Dùng mã mời do quản lý cung cấp." : "Tạo tài khoản quản trị đầu tiên để bắt đầu."}</CardDescription></div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {mode === "register" && <FieldInput label="Họ và tên" value={form.fullName} onChange={(fullName) => setForm({ ...form, fullName })} placeholder="Nguyễn Minh Anh" />}
              <FieldInput label={mode === "login" ? "Email hoặc tên đăng nhập" : "Email"} type={mode === "login" ? "text" : "email"} value={form.email} onChange={(email) => setForm({ ...form, email })} placeholder="ban@quanbida.vn" />
              <FieldInput label="Mật khẩu" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} placeholder={mode === "register" ? "Tối thiểu 10 ký tự mạnh" : "Nhập mật khẩu"} />
              {mode === "register" && <FieldInput label={initialized ? "Mã mời" : "Mã thiết lập ban đầu"} type="password" value={initialized ? form.invitationCode : form.setupCode} onChange={(next) => setForm(initialized ? { ...form, invitationCode: next } : { ...form, setupCode: next })} placeholder={initialized ? "Mã dùng một lần" : "Mã cấu hình triển khai"} />}
              <Button className="h-11 w-full rounded-xl bg-[#0b6b55] hover:bg-[#075744]" disabled={busy}>{busy && <RefreshCw className="animate-spin" />}{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Button>
              {initialized && <Button type="button" variant="ghost" className="w-full" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Đã có mã mời? Đăng ký" : "Đã có tài khoản? Đăng nhập"}</Button>}
            </form>
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900"><ShieldCheck className="size-5 shrink-0" /><span>Mật khẩu được băm và phiên đăng nhập lưu bằng cookie bảo mật; không dùng tài khoản ChatGPT.</span></div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function FieldInput({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  const inputId = React.useId();
  return <div className="space-y-2"><Label htmlFor={inputId}>{label}</Label><Input id={inputId} required type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 rounded-xl" /></div>;
}

function Logo({ dark = false }: { dark?: boolean }) {
  return <div className={cn("relative grid size-10 place-items-center rounded-2xl", dark ? "bg-[#0b2f27]" : "bg-white/10")}><span className="absolute size-3 -translate-x-2 rounded-full bg-amber-300" /><span className="absolute size-3 translate-x-2 -translate-y-2 rounded-full bg-emerald-300" /><span className="absolute size-3 translate-x-2 translate-y-2 rounded-full bg-white" /></div>;
}

function QuickForm({ config, onClose }: { config: FormConfig | null; onClose: () => void }) {
  return <Dialog open={Boolean(config)} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[88vh] overflow-y-auto rounded-2xl sm:max-w-xl">
    {config && <QuickFormBody key={`${config.title}-${config.fields.map((field) => field.key).join("-")}`} config={config} onClose={onClose} />}
  </DialogContent></Dialog>;
}

function QuickFormBody({ config, onClose }: { config: FormConfig; onClose: () => void }) {
  const [values, setValues] = React.useState<Record<string, any>>(() => Object.fromEntries(config.fields.map((field) => [field.key, field.value ?? ""])));
  const [busy, setBusy] = React.useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await config.onSubmit(values); onClose(); } catch { /* toast handled upstream */ } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-5"><DialogHeader><DialogTitle>{config.title}</DialogTitle>{config.description && <DialogDescription>{config.description}</DialogDescription>}</DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">{config.fields.map((field) => <div key={field.key} className={cn("space-y-2", field.type === "textarea" && "sm:col-span-2")}><Label htmlFor={`field-${field.key}`}>{field.label}</Label>
        {field.type === "select" ? <NativeSelect id={`field-${field.key}`} required={field.required} value={String(values[field.key] ?? "")} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} className="w-full"><NativeSelectOption value="">Chọn...</NativeSelectOption>{field.options?.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect>
        : field.type === "textarea" ? <Textarea id={`field-${field.key}`} value={String(values[field.key] ?? "")} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} placeholder={field.placeholder} />
        : <Input id={`field-${field.key}`} required={field.required} type={field.type ?? "text"} min={field.min} step={field.step} value={String(values[field.key] ?? "")} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} placeholder={field.placeholder} />}</div>)}</div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Hủy</Button><Button disabled={busy}>{busy && <RefreshCw className="animate-spin" />}{config.submitLabel ?? "Lưu"}</Button></DialogFooter>
    </form>;
}

export function BidaFlowApp() {
  const [auth, setAuth] = React.useState<{ initialized: boolean; user: User | null } | null>(null);
  const [data, setData] = React.useState<AppData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState("tables");
  const [form, setForm] = React.useState<FormConfig | null>(null);
  const loadData = React.useCallback(async () => { const next = await requestJson("/api/app"); setData(next); setAuth((current) => current ? { ...current, user: next.user } : { initialized: true, user: next.user }); }, []);
  const loadAuth = React.useCallback(async () => { try { const next = await requestJson("/api/auth/status"); setAuth(next); if (next.user) await loadData(); } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể kết nối hệ thống"); } finally { setLoading(false); } }, [loadData]);
  React.useEffect(() => { queueMicrotask(() => { void loadAuth(); }); }, [loadAuth]);
  React.useEffect(() => { if (!auth?.user) return; const timer = window.setInterval(() => loadData().catch(() => undefined), 30000); return () => window.clearInterval(timer); }, [auth?.user, loadData]);
  const run = React.useCallback(async (action: string, payload: Record<string, any> = {}, refresh = true) => {
    try { const response = await requestJson("/api/action", { method: "POST", body: JSON.stringify({ action, payload }) }); if (refresh) await loadData(); toast.success("Đã cập nhật"); return response.data; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Không thể hoàn tất thao tác"); throw error; }
  }, [loadData]);
  React.useEffect(() => {
    if (!auth?.user || !data || !document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const register = document.modelContext.registerTool.bind(document.modelContext);
    const tools = [
      {
        name: "refresh_bidaflow_dashboard", title: "Làm mới BidaFlow", description: "Tải lại dữ liệu vận hành mới nhất và trả về chỉ số tổng quan.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async () => { await loadData(); return { status: "refreshed" }; },
      },
      {
        name: "start_billiards_session", title: "Mở bàn bida", description: "Bắt đầu phiên chơi thật cho một bàn đang sẵn sàng.",
        inputSchema: { type: "object", properties: { tableId: { type: "string" }, customerId: { type: "string" }, notes: { type: "string" } }, required: ["tableId"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => { const value = input as Row; if (!value?.tableId || typeof value.tableId !== "string") throw new Error("tableId là bắt buộc"); const response = await run("session.start", value); return { status: "started", sessionId: response?.sessionId }; },
      },
      {
        name: "create_billiards_reservation", title: "Tạo lịch đặt bàn", description: "Tạo lịch đặt thật sau khi kiểm tra xung đột bàn và thời gian.",
        inputSchema: { type: "object", properties: { tableId: { type: "string" }, customerName: { type: "string" }, customerPhone: { type: "string" }, startsAt: { type: "string" }, endsAt: { type: "string" }, guestCount: { type: "number" } }, required: ["tableId", "customerName", "customerPhone", "startsAt", "endsAt"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => { const value = input as Row; for (const key of ["tableId", "customerName", "customerPhone", "startsAt", "endsAt"]) if (typeof value?.[key] !== "string" || !value[key]) throw new Error(`${key} là bắt buộc`); await run("reservation.save", { ...value, status: "PENDING" }); return { status: "created" }; },
      },
    ];
    tools.forEach((tool) => { try { void Promise.resolve(register(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* unsupported implementation */ } });
    return () => lifecycle.abort();
  }, [auth?.user, data, loadData, run]);
  const logout = async () => { await requestJson("/api/auth/logout", { method: "POST", body: "{}" }); setData(null); setAuth({ initialized: true, user: null }); };
  if (loading) return <LoadingScreen />;
  if (!auth?.user) return <><AuthScreen initialized={auth?.initialized ?? false} onSuccess={loadAuth} /><Toaster richColors /></>;
  if (!data) return <LoadingScreen />;
  return <SidebarProvider><AppShell data={data} page={page} setPage={setPage} run={run} openForm={setForm} reload={loadData} logout={logout} /><QuickForm config={form} onClose={() => setForm(null)} /><Toaster richColors /></SidebarProvider>;
}

function LoadingScreen() {
  return <div className="grid min-h-screen place-items-center bg-[#f2f6f4]"><div className="space-y-4 text-center"><Logo dark /><div className="flex items-center gap-2 text-sm text-slate-500"><RefreshCw className="size-4 animate-spin" />Đang chuẩn bị không gian làm việc...</div></div></div>;
}

type ShellProps = { data: AppData; page: string; setPage: (page: string) => void; run: (action: string, payload?: Record<string, any>, refresh?: boolean) => Promise<any>; openForm: (form: FormConfig) => void; reload: () => Promise<void>; logout: () => Promise<void> };

function AppShell(props: ShellProps) {
  const { setOpenMobile } = useSidebar();
  const permission = (code: string) => props.data.user.roleCode === "ADMIN" || props.data.user.permissions.includes(code);
  const nav = [
    { id: "tables", label: "Sơ đồ bàn", icon: Table2, show: permission("TABLES_VIEW") },
    { id: "reservations", label: "Đặt bàn", icon: CalendarClock, show: permission("RESERVATIONS_MANAGE") || permission("SESSIONS_MANAGE") },
    { id: "orders", label: "Order & phục vụ", icon: Coffee, show: permission("ORDERS_MANAGE") },
    { id: "customers", label: "Khách hàng", icon: UsersRound, show: permission("CUSTOMERS_MANAGE") || permission("MEMBERSHIPS_MANAGE") },
    { id: "billing", label: "Hóa đơn", icon: ReceiptText, show: permission("INVOICES_VIEW") },
    { id: "inventory", label: "Kho hàng", icon: Warehouse, show: permission("INVENTORY_MANAGE") },
    { id: "shifts", label: "Ca làm việc", icon: Clock3, show: permission("SHIFTS_MANAGE") || permission("SHIFTS_HISTORY") },
    { id: "reports", label: "Báo cáo", icon: BarChart3, show: permission("REPORTS_VIEW") },
    { id: "admin", label: "Quản trị", icon: Settings2, show: permission("USERS_MANAGE") || permission("ROLES_MANAGE") || permission("TABLES_MANAGE") || permission("PRICES_MANAGE") || permission("PRODUCTS_MANAGE") || permission("MEMBERSHIPS_MANAGE") },
    { id: "audit", label: "Nhật ký", icon: History, show: permission("AUDIT_VIEW") },
    { id: "profile", label: "Hồ sơ", icon: UserRound, show: true },
  ].filter((item) => item.show);
  const current = nav.find((item) => item.id === props.page) ?? nav[0];
  const selectPage = (id: string) => { props.setPage(id); setOpenMobile(false); };
  return <>
    <Sidebar collapsible="icon" className="border-none"><SidebarHeader className="p-4"><div className="flex items-center gap-3"><Logo /><div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="font-semibold tracking-tight">BidaFlow</p><p className="text-xs text-emerald-100/55">Không gian vận hành</p></div></div></SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupLabel className="text-emerald-100/45">Điều hành</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{nav.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={props.page === item.id} tooltip={item.label} onClick={() => selectPage(item.id)}><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
      <SidebarFooter className="p-3"><button onClick={() => selectPage("profile")} className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2 text-left transition hover:bg-white/10"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-300 font-semibold text-emerald-950">{props.data.user.fullName.slice(0, 1).toUpperCase()}</div><div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium">{props.data.user.fullName}</p><p className="truncate text-xs text-emerald-100/55">{props.data.user.roleName}</p></div></button></SidebarFooter>
    </Sidebar>
    <SidebarInset className="min-w-0 bg-[#f2f6f4]"><header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-emerald-950/5 bg-[#f2f6f4]/90 px-4 backdrop-blur-xl sm:px-6"><SidebarTrigger className="md:hidden" /><div className="min-w-0"><h1 className="truncate text-lg font-semibold tracking-tight">{current.label}</h1><p className="hidden text-xs text-muted-foreground sm:block">{new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())}</p></div><div className="ml-auto flex items-center gap-2"><Button variant="ghost" size="icon" onClick={() => props.reload()} aria-label="Làm mới"><RefreshCw /></Button><Badge variant="outline" className="hidden bg-white sm:flex">{props.data.user.roleName}</Badge></div></header>
      <div className="soft-in mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8"><PageContent {...props} page={current.id} permission={permission} /></div>
    </SidebarInset>
  </>;
}

function PageContent(props: ShellProps & { permission: (code: string) => boolean }) {
  if (props.page === "tables") return <TablesView {...props} />;
  if (props.page === "reservations") return <ReservationsView {...props} />;
  if (props.page === "orders") return <OrdersView {...props} />;
  if (props.page === "customers") return <CustomersView {...props} />;
  if (props.page === "billing") return <BillingView {...props} />;
  if (props.page === "inventory") return <InventoryView {...props} />;
  if (props.page === "shifts") return <ShiftsView {...props} />;
  if (props.page === "reports") return <ReportsView {...props} />;
  if (props.page === "admin") return <AdminView {...props} />;
  if (props.page === "audit") return <AuditView {...props} />;
  return <ProfileView {...props} />;
}

function SectionHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>;
}

function EmptyState({ icon: Icon = ClipboardList, title, description, action }: { icon?: React.ElementType; title: string; description: string; action?: React.ReactNode }) {
  return <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed bg-white/60 p-8 text-center"><div><div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Icon /></div><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>{action && <div className="mt-4">{action}</div>}</div></div>;
}

function SummaryCards({ data }: { data: AppData }) {
  const cards = [
    { label: "Bàn đang chơi", value: `${data.summary.playing_count ?? 0}/${data.summary.table_count ?? 0}`, icon: Play, tint: "bg-sky-50 text-sky-700" },
    { label: "Lịch đặt hôm nay", value: data.summary.reservation_count ?? 0, icon: CalendarClock, tint: "bg-amber-50 text-amber-700" },
    { label: "Doanh thu hôm nay", value: data.summary.today_revenue === undefined ? "—" : money(data.summary.today_revenue), icon: CircleDollarSign, tint: "bg-emerald-50 text-emerald-700" },
    { label: "Hàng sắp hết", value: data.summary.low_stock_count ?? "—", icon: Archive, tint: "bg-rose-50 text-rose-700" },
  ];
  return <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <Card key={card.label} className="gap-3 border-0 py-4 shadow-[0_8px_30px_rgba(13,49,39,.05)]"><CardContent className="flex items-center gap-3 px-4"><div className={cn("grid size-11 place-items-center rounded-2xl", card.tint)}><card.icon className="size-5" /></div><div><p className="text-xs font-medium text-muted-foreground">{card.label}</p><p className="mt-1 text-xl font-semibold tracking-tight">{card.value}</p></div></CardContent></Card>)}</div>;
}

function TablesView(props: ShellProps) {
  const [area, setArea] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [, setTick] = React.useState(0);
  React.useEffect(() => { const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000); return () => window.clearInterval(timer); }, []);
  const allowed = (permission: string) => props.data.user.roleCode === "ADMIN" || props.data.user.permissions.includes(permission);
  const canPause = allowed("SESSIONS_MANAGE") && ["ADMIN", "MANAGER", "CASHIER"].includes(props.data.user.roleCode);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const tables = (props.data.tables as Row[]).filter((table) => (area === "all" || table.area_id === area) && (statusFilter === "all" || table.status === statusFilter) && `${table.name} ${table.code}`.toLowerCase().includes(query.toLowerCase()));
  const activeSessions = (props.data.sessions as Row[]).filter((session) => ["ACTIVE", "PAUSED"].includes(session.status));
  const customerOptions = (props.data.customers as Row[]).map((customer) => ({ value: customer.id, label: `${customer.full_name}${customer.phone ? ` · ${customer.phone}` : ""}` }));
  const startSession = (table: Row) => props.openForm({ title: `Mở ${table.name}`, description: `Đơn giá hiện tại được chốt khi bắt đầu phiên.`, submitLabel: "Bắt đầu tính giờ", fields: [{ key: "customerId", label: "Khách hàng (không bắt buộc)", type: "select", options: customerOptions }, { key: "notes", label: "Ghi chú", type: "textarea" }], onSubmit: (values) => props.run("session.start", { ...values, tableId: table.id }) });
  const transfer = (session: Row) => props.openForm({ title: "Chuyển bàn", description: "Hệ thống chốt đoạn tính giờ tại bàn cũ và mở đoạn mới theo giá bàn đích.", submitLabel: "Chuyển bàn", fields: [{ key: "toTableId", label: "Bàn đích", type: "select", required: true, options: (props.data.tables as Row[]).filter((item) => item.status === "AVAILABLE" && item.id !== session.table_id).map((item) => ({ value: item.id, label: `${item.name} · ${item.type_name}` })) }, { key: "reason", label: "Lý do", type: "textarea" }], onSubmit: (values) => props.run("session.transfer", { ...values, sessionId: session.id }) });
  const addOrder = (session: Row) => props.openForm({ title: `Thêm món cho ${session.table_name}`, submitLabel: "Thêm vào order", fields: [{ key: "productId", label: "Sản phẩm / dịch vụ", type: "select", required: true, options: (props.data.products as Row[]).map((product) => ({ value: product.id, label: `${product.name} · ${money(product.sale_price)}` })) }, { key: "quantity", label: "Số lượng", type: "number", min: 1, step: 1, required: true, value: 1 }, { key: "notes", label: "Ghi chú", type: "textarea" }], onSubmit: (values) => props.run("order.add", { ...values, sessionId: session.id }) });
  const endSession = (session: Row) => {
    const orderIds = new Set((props.data.orders as Row[]).filter((order) => order.session_id === session.id).map((order) => order.id));
    const pending = (props.data.orderItems as Row[]).some((item) => orderIds.has(item.order_id) && ["PENDING", "PREPARING"].includes(item.status));
    props.openForm({ title: `Kết thúc ${session.table_name}`, description: pending ? "Còn món chưa hoàn thành. Tiền bàn sẽ được chốt; các món vẫn cần phục vụ hoặc hủy trước khi lập hóa đơn." : "Chốt thời gian và tiền bàn cho phiên chơi này.", submitLabel: "Xác nhận kết thúc", fields: [], onSubmit: () => props.run("session.end", { sessionId: session.id, confirmPendingOrders: pending }) });
  };
  return <>
    <SummaryCards data={props.data} />
    <SectionHeader title="Sơ đồ bàn trực tiếp" description="Trạng thái, thời gian và tiền tạm tính được cập nhật liên tục." actions={<><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bàn..." className="w-44 bg-white pl-9" /></div><NativeSelect value={area} onChange={(event) => setArea(event.target.value)} className="bg-white"><NativeSelectOption value="all">Tất cả khu vực</NativeSelectOption>{(props.data.areas as Row[]).map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="Lọc trạng thái bàn" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><NativeSelectOption value="all">Mọi trạng thái</NativeSelectOption>{["AVAILABLE","PLAYING","RESERVED","MAINTENANCE"].map((status) => <NativeSelectOption key={status} value={status}>{STATUS[status].label}</NativeSelectOption>)}</NativeSelect></>} />
    <div className="mb-5 flex flex-wrap gap-2 text-xs">{["AVAILABLE", "PLAYING", "RESERVED", "MAINTENANCE"].map((status) => <StatusBadge key={status} value={status} />)}</div>
    {!tables.length ? <EmptyState icon={Table2} title="Chưa có bàn để hiển thị" description="Quản lý cần tạo khu vực, loại bàn và bàn trong phần Quản trị." action={allowed("TABLES_MANAGE") ? <Button onClick={() => props.setPage("admin")}><Settings2 />Mở cấu hình</Button> : undefined} /> :
      <div className="space-y-7">{(props.data.areas as Row[]).filter((item) => area === "all" || item.id === area).map((item) => { const areaTables = tables.filter((table) => table.area_id === item.id); if (!areaTables.length) return null; return <section key={item.id}><div className="mb-3 flex items-center gap-2"><h3 className="font-semibold">{item.name}</h3><Badge variant="secondary">{areaTables.length} bàn</Badge></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{areaTables.map((table) => {
        const session = activeSessions.find((candidate) => candidate.table_id === table.id);
        const cardTone = table.status === "PLAYING" ? "border-sky-200 bg-gradient-to-br from-white to-sky-50" : table.status === "RESERVED" ? "border-amber-200 bg-gradient-to-br from-white to-amber-50" : table.status === "MAINTENANCE" ? "border-slate-200 bg-slate-50" : "border-emerald-100 bg-gradient-to-br from-white to-emerald-50/60";
        return <Card key={table.id} className={cn("group gap-4 overflow-hidden py-4 shadow-[0_8px_28px_rgba(14,54,43,.05)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(14,54,43,.1)]", cardTone)}><CardHeader className="px-4"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">{table.name}</CardTitle><CardDescription className="mt-1">{table.type_name} · {money(table.base_hourly_rate)}/giờ</CardDescription></div><StatusBadge value={table.status} /></div></CardHeader><CardContent className="space-y-4 px-4">
          {session ? <><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-white/75 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Thời gian</p><p className="mt-1 font-mono text-lg font-semibold">{playingDuration(session)}</p></div><div className="rounded-xl bg-white/75 p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tạm tính</p><p className="mt-1 text-lg font-semibold">{money(session.live_table_amount)}</p></div></div>{session.customer_name && <p className="text-sm text-muted-foreground"><UserRound className="mr-1 inline size-4" />{session.customer_name}</p>}<div className="flex flex-wrap gap-2">
            {canPause && (session.status === "ACTIVE" ? <Button size="sm" variant="outline" onClick={() => props.openForm({ title: "Tạm dừng tính giờ", fields: [{ key: "reason", label: "Lý do", type: "textarea", required: true }], onSubmit: (values) => props.run("session.pause", { sessionId: session.id, ...values }) })}><Pause />Tạm dừng</Button> : <Button size="sm" variant="outline" onClick={() => props.run("session.resume", { sessionId: session.id })}><Play />Tiếp tục</Button>)}
            <Button disabled={!allowed("ORDERS_MANAGE")} size="sm" variant="outline" onClick={() => addOrder(session)}><Coffee />Thêm món</Button><Button disabled={!canPause} size="sm" variant="outline" onClick={() => transfer(session)}><TimerReset />Chuyển bàn</Button><Button disabled={!allowed("SESSIONS_MANAGE")} size="sm" onClick={() => endSession(session)}><Check />Kết thúc</Button>
          </div></> : <div className="flex min-h-24 flex-col justify-between"><p className="text-sm text-muted-foreground">{table.status === "AVAILABLE" ? "Bàn sẵn sàng nhận khách." : table.status === "RESERVED" ? "Có lịch đặt đang chờ nhận bàn." : "Bàn đang được bảo trì."}</p><div className="mt-4 flex gap-2">{table.status === "AVAILABLE" && <Button disabled={!allowed("SESSIONS_MANAGE")} size="sm" onClick={() => startSession(table)}><DoorOpen />Mở bàn</Button>}{table.status === "RESERVED" && allowed("SESSIONS_MANAGE") && <Button size="sm" onClick={() => props.setPage("reservations")}>Xem lịch đặt</Button>}<Button disabled={!allowed("TABLE_STATUS")} size="sm" variant="outline" onClick={() => props.openForm({ title: `Cập nhật ${table.name}`, fields: [{ key: "status", label: "Trạng thái", type: "select", required: true, value: table.status, options: [{ value: "AVAILABLE", label: "Sẵn sàng" }, { value: "RESERVED", label: "Đã đặt" }, { value: "MAINTENANCE", label: "Bảo trì" }] }], onSubmit: (values) => props.run("table.status", { id: table.id, ...values }) })}><Wrench />Trạng thái</Button></div></div>}
        </CardContent></Card>;
      })}</div></section>; })}</div>}
  </>;
}

function ReservationsView(props: ShellProps) {
  const allowed = (permission: string) => props.data.user.roleCode === "ADMIN" || props.data.user.permissions.includes(permission);
  const canManage = allowed("RESERVATIONS_MANAGE");
  const [filter, setFilter] = React.useState({ date: "", table: "all", status: "all" });
  const tableOptions = (props.data.tables as Row[]).filter((table) => table.status !== "MAINTENANCE").map((table) => ({ value: table.id, label: `${table.name} · ${table.area_name}` }));
  const rows = (props.data.reservations as Row[]).filter((row) =>
    (filter.date === "" || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(row.starts_at)) === filter.date) &&
    (filter.table === "all" || row.table_id === filter.table) && (filter.status === "all" || row.status === filter.status));
  const create = (row?: Row) => props.openForm({ title: row ? "Cập nhật lịch đặt" : "Tạo lịch đặt", description: "Một bàn không thể có hai lịch đặt chồng lấn.", fields: [
    { key: "customerName", label: "Tên khách", required: true, value: row?.customer_name }, { key: "customerPhone", label: "Số điện thoại", required: true, value: row?.customer_phone },
    { key: "tableId", label: "Bàn", type: "select", required: true, value: row?.table_id, options: tableOptions },
    { key: "startsAt", label: "Bắt đầu", type: "datetime-local", required: true, value: localInput(row?.starts_at) }, { key: "endsAt", label: "Kết thúc dự kiến", type: "datetime-local", required: true, value: localInput(row?.ends_at) },
    { key: "guestCount", label: "Số khách", type: "number", min: 1, step: 1, value: row?.guest_count ?? 1 },
    { key: "notes", label: "Ghi chú", type: "textarea", value: row?.notes },
  ], onSubmit: (values) => props.run("reservation.save", { ...values, id: row?.id, customerId: row?.customer_id, status: row?.status ?? "PENDING", startsAt: new Date(values.startsAt).toISOString(), endsAt: new Date(values.endsAt).toISOString() }) });
  return <>
    <SectionHeader title="Lịch đặt bàn" description={canManage ? "Xác nhận, chỉnh sửa và theo dõi lịch đặt." : "Nhận bàn từ các lịch đã xác nhận."} actions={canManage && <Button onClick={() => create()}><Plus />Tạo lịch đặt</Button>} />
    <div className="mb-4 flex flex-wrap gap-2">
      <Input aria-label="Lọc ngày đặt" type="date" className="w-44 bg-white" value={filter.date} onChange={(e) => setFilter({ ...filter, date: e.target.value })} />
      <NativeSelect aria-label="Lọc bàn đặt" value={filter.table} onChange={(e) => setFilter({ ...filter, table: e.target.value })}><NativeSelectOption value="all">Tất cả bàn</NativeSelectOption>{tableOptions.map((o) => <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Lọc trạng thái đặt" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><NativeSelectOption value="all">Mọi trạng thái</NativeSelectOption>{["PENDING","CONFIRMED","SEATED","CANCELLED","NO_SHOW"].map((status) => <NativeSelectOption key={status} value={status}>{STATUS[status].label}</NativeSelectOption>)}</NativeSelect>
    </div>
    {!rows.length ? <EmptyState icon={CalendarClock} title="Không có lịch đặt phù hợp" description="Đổi bộ lọc hoặc tạo lịch đặt mới." /> :
      <Card className="gap-0 overflow-hidden py-0"><Table><TableHeader><TableRow><TableHead>Mã</TableHead><TableHead>Khách hàng</TableHead><TableHead>Bàn</TableHead><TableHead>Thời gian</TableHead><TableHead>Trạng thái</TableHead><TableHead>Thao tác</TableHead></TableRow></TableHeader><TableBody>
        {rows.map((row) => <TableRow key={row.id}><TableCell className="font-mono text-xs">{row.code}</TableCell><TableCell><div>{row.customer_name}</div><div className="text-xs text-muted-foreground">{row.customer_phone}</div></TableCell><TableCell>{row.table_name}</TableCell><TableCell><div>{dateTime(row.starts_at)}</div><div className="text-xs text-muted-foreground">đến {dateTime(row.ends_at)}</div></TableCell><TableCell><StatusBadge value={row.status} /></TableCell><TableCell><div className="flex flex-wrap gap-1">
          {canManage && ["PENDING","CONFIRMED"].includes(row.status) && <>
            <Button size="icon-sm" variant="ghost" onClick={() => create(row)} aria-label="Chỉnh sửa lịch đặt"><Pencil /></Button>
            {row.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => props.run("reservation.status", { id: row.id, status: "CONFIRMED" })}>Xác nhận</Button>}
            <Button size="sm" variant="outline" onClick={() => props.run("reservation.status", { id: row.id, status: "CANCELLED" })}>Hủy lịch</Button>
            <Button size="sm" variant="ghost" onClick={() => props.run("reservation.status", { id: row.id, status: "NO_SHOW" })}>Không đến</Button>
          </>}
          {row.status === "CONFIRMED" && allowed("SESSIONS_MANAGE") && <Button size="sm" onClick={() => props.run("reservation.seat", { reservationId: row.id })}>Nhận bàn</Button>}
        </div></TableCell></TableRow>)}
      </TableBody></Table></Card>}
  </>;
}

function OrdersView(props: ShellProps) {
  const [filter, setFilter] = React.useState({ table: "all", status: "OPEN", date: "" });
  const sessions = (props.data.sessions as Row[]).filter((session) => ["ACTIVE", "PAUSED"].includes(session.status));
  const orders = (props.data.orders as Row[]).filter((order) =>
    (filter.table === "all" || order.table_id === filter.table) && (filter.status === "all" || order.status === filter.status) &&
    (!filter.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(order.created_at.endsWith("Z") ? order.created_at : order.created_at.replace(" ", "T") + "Z")) === filter.date));
  const add = () => props.openForm({ title: "Thêm món vào bàn", fields: [
    { key: "sessionId", label: "Bàn đang chơi", type: "select", required: true, options: sessions.map((session) => ({ value: session.id, label: session.table_name })) },
    { key: "productId", label: "Sản phẩm / dịch vụ", type: "select", required: true, options: (props.data.products as Row[]).map((product) => ({ value: product.id, label: `${product.name} · ${money(product.sale_price)}` })) },
    { key: "quantity", label: "Số lượng", type: "number", min: 0.01, step: 0.01, required: true, value: 1 }, { key: "notes", label: "Ghi chú", type: "textarea" },
  ], onSubmit: (values) => props.run("order.add", values) });
  const edit = (item: Row) => props.openForm({ title: `Sửa món · ${item.product_name}`, fields: [
    { key: "quantity", label: "Số lượng", type: "number", min: 0.01, step: 0.01, required: true, value: item.quantity },
    { key: "notes", label: "Ghi chú", type: "textarea", value: item.notes },
  ], onSubmit: (values) => props.run("order.item.update", { ...values, itemId: item.id }) });
  const itemLabels: Record<string, string> = { PENDING: "Mới gọi", PREPARING: "Đang làm", SERVED: "Đã phục vụ", CANCELLED: "Đã hủy" };
  const transitions: Record<string, string[]> = { PENDING: ["PENDING","PREPARING","SERVED","CANCELLED"], PREPARING: ["PREPARING","SERVED","CANCELLED"], SERVED: ["SERVED"], CANCELLED: ["CANCELLED"] };
  return <>
    <SectionHeader title="Order & phục vụ" description="Theo dõi món, chỉnh sửa số lượng và hoàn tất phục vụ." actions={<Button onClick={add} disabled={!sessions.length}><Plus />Thêm món</Button>} />
    <div className="mb-4 flex flex-wrap gap-2">
      <NativeSelect aria-label="Lọc bàn order" value={filter.table} onChange={(e) => setFilter({ ...filter, table: e.target.value })}><NativeSelectOption value="all">Tất cả bàn</NativeSelectOption>{(props.data.tables as Row[]).map((table) => <NativeSelectOption key={table.id} value={table.id}>{table.name}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Lọc trạng thái order" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><NativeSelectOption value="all">Mọi trạng thái</NativeSelectOption>{["OPEN","COMPLETED","CANCELLED"].map((status) => <NativeSelectOption key={status} value={status}>{STATUS[status].label}</NativeSelectOption>)}</NativeSelect>
      <Input aria-label="Lọc ngày order" type="date" className="w-44 bg-white" value={filter.date} onChange={(e) => setFilter({ ...filter, date: e.target.value })} />
    </div>
    {!orders.length ? <EmptyState icon={Coffee} title="Không có order phù hợp" description="Đổi bộ lọc hoặc thêm món cho bàn đang chơi." /> :
      <div className="grid gap-4 xl:grid-cols-2">{orders.map((order) => {
        const items = (props.data.orderItems as Row[]).filter((item) => item.order_id === order.id);
        const locked = order.status !== "OPEN" || (props.data.invoices as Row[]).some((invoice) => invoice.session_id === order.session_id && invoice.status !== "CANCELLED");
        return <Card key={order.id} className="gap-4"><CardHeader><div className="flex justify-between gap-3"><div><CardTitle>{order.table_name}</CardTitle><CardDescription className="mt-1">{order.code} · {dateTime(order.created_at)}</CardDescription><StatusBadge value={order.status} /></div><Badge variant="secondary">{money(items.filter((item) => item.status !== "CANCELLED").reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0))}</Badge></div></CardHeader>
          <CardContent className="space-y-2">{items.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.product_name} × {item.quantity}</p><p className="text-xs text-muted-foreground">{money(item.quantity * item.unit_price)}{item.notes ? ` · ${item.notes}` : ""}</p></div>
            {!locked && ["PENDING","PREPARING"].includes(item.status) && <Button aria-label={`Sửa ${item.product_name}`} size="icon-sm" variant="ghost" onClick={() => edit(item)}><Pencil /></Button>}
            <NativeSelect aria-label={`Trạng thái ${item.product_name}`} disabled={locked || ["SERVED","CANCELLED"].includes(item.status)} size="sm" value={item.status} onChange={(e) => props.run("order.item.status", { itemId: item.id, status: e.target.value })} className="w-32">
              {transitions[item.status].map((status) => <NativeSelectOption key={status} value={status}>{itemLabels[status]}</NativeSelectOption>)}
            </NativeSelect>
          </div>)}</CardContent>
        </Card>;
      })}</div>}
  </>;
}

function CustomersView(props: ShellProps) {
  const [query, setQuery] = React.useState("");
  const customers = (props.data.customers as Row[]).filter((customer) => `${customer.full_name} ${customer.phone ?? ""} ${customer.code}`.toLowerCase().includes(query.toLowerCase()));
  const edit = (row?: Row) => props.openForm({ title: row ? "Cập nhật khách hàng" : "Thêm khách hàng", fields: [{ key: "fullName", label: "Họ tên", required: true, value: row?.full_name }, { key: "phone", label: "Số điện thoại", value: row?.phone }, { key: "email", label: "Email", type: "email", value: row?.email }, { key: "dateOfBirth", label: "Ngày sinh", type: "date", value: row?.date_of_birth }, { key: "notes", label: "Ghi chú", type: "textarea", value: row?.notes }], onSubmit: (values) => props.run("customer.save", { ...values, id: row?.id }) });
  const membership = (row: Row) => props.openForm({ title: `Hội viên · ${row.full_name}`, fields: [{ key: "tierId", label: "Hạng thành viên", type: "select", required: true, options: (props.data.tiers as Row[]).map((tier) => ({ value: tier.id, label: `${tier.name} · giảm ${tier.discount_percent}%` })) }], onSubmit: (values) => props.run("membership.save", { ...values, customerId: row.id }) });
  return <><SectionHeader title="Khách hàng & hội viên" description="Hồ sơ, hạng thành viên, điểm và ưu đãi thanh toán." actions={<><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="w-52 bg-white pl-9" placeholder="Tìm khách hàng..." /></div><Button onClick={() => edit()}><Plus />Thêm khách</Button></>} />
    {!customers.length ? <EmptyState icon={UsersRound} title="Chưa có khách hàng" description="Tạo hồ sơ để liên kết lịch sử chơi, hội viên và ưu đãi." action={<Button onClick={() => edit()}><Plus />Thêm khách hàng</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{customers.map((customer) => <Card key={customer.id} className="gap-4 py-5"><CardHeader className="px-5"><div className="flex items-start justify-between"><div className="flex min-w-0 items-center gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 font-semibold text-emerald-800">{customer.full_name.slice(0, 1).toUpperCase()}</div><div className="min-w-0"><CardTitle className="truncate">{customer.full_name}</CardTitle><CardDescription className="mt-1">{customer.code}</CardDescription></div></div>{customer.tier_name && <Badge className="bg-amber-100 text-amber-800">{customer.tier_name}</Badge>}</div></CardHeader><CardContent className="space-y-3 px-5"><div className="text-sm text-muted-foreground"><p>{customer.phone || "Chưa có số điện thoại"}</p><p>{customer.email || "Chưa có email"}</p></div>{customer.membership_id && <div><div className="mb-1 flex justify-between text-xs"><span>Điểm hội viên</span><span className="font-semibold">{customer.points}</span></div><Progress value={Math.min(100, Number(customer.points) % 100)} /></div>}<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => edit(customer)}><Pencil />Cập nhật</Button><Button size="sm" onClick={() => membership(customer)}><Sparkles />{customer.membership_id ? "Đổi hạng" : "Kích hoạt"}</Button></div></CardContent></Card>)}</div>}
  </>;
}

function BillingView(props: ShellProps) {
  const unbilled = (props.data.sessions as Row[]).filter((session) => session.status === "CLOSED");
  const invoices = props.data.invoices as Row[];
  const create = (sessionId?: string) => props.openForm({ title: "Tạo hóa đơn", description: "Hệ thống lấy tiền bàn, order và tự áp dụng ưu đãi hội viên.", fields: [{ key: "sessionId", label: "Phiên đã kết thúc", type: "select", required: true, value: sessionId, options: unbilled.map((session) => ({ value: session.id, label: `${session.code} · ${session.table_name} · ${money(session.table_amount)}` })) }], onSubmit: (values) => props.run("invoice.create", values) });
  const pay = (invoice: Row) => props.openForm({ title: `Thanh toán ${invoice.code}`, description: `Còn lại ${money(Number(invoice.total_amount) - Number(invoice.paid_amount))}`, submitLabel: "Ghi nhận thanh toán", fields: [{ key: "method", label: "Phương thức", type: "select", required: true, value: "CASH", options: [{ value: "CASH", label: "Tiền mặt" }, { value: "BANK_TRANSFER", label: "Chuyển khoản" }, { value: "CARD", label: "Thẻ" }, { value: "EWALLET", label: "Ví điện tử" }] }, { key: "amount", label: "Số tiền", type: "number", min: 1, required: true, value: Number(invoice.total_amount) - Number(invoice.paid_amount) }, { key: "reference", label: "Mã tham chiếu" }], onSubmit: (values) => props.run("invoice.pay", { ...values, invoiceId: invoice.id }) });
  const adjust = (invoice: Row) => props.openForm({ title: `Điều chỉnh ${invoice.code}`, fields: [{ key: "type", label: "Loại", type: "select", required: true, value: "DISCOUNT", options: [{ value: "DISCOUNT", label: "Giảm giá" }, { value: "SURCHARGE", label: "Phụ phí" }] }, { key: "amount", label: "Số tiền", type: "number", min: 1, required: true }, { key: "description", label: "Lý do", type: "textarea", required: true }], onSubmit: (values) => props.run("invoice.adjust", { ...values, invoiceId: invoice.id }) });
  const split = (invoice: Row) => { const items = (props.data.invoiceItems as Row[]).filter((item) => item.invoice_id === invoice.id); props.openForm({ title: `Tách dòng khỏi ${invoice.code}`, description: "Dòng được chọn sẽ chuyển sang một hóa đơn mới để thanh toán riêng.", submitLabel: "Tách hóa đơn", fields: [{ key: "itemId", label: "Dòng cần tách", type: "select", required: true, options: items.map((item) => ({ value: item.id, label: `${item.description} · ${money(item.amount)}` })) }], onSubmit: (values) => props.run("invoice.split", { invoiceId: invoice.id, itemIds: [values.itemId] }) }); };
  const cancel = (invoice: Row) => props.openForm({ title: `Hủy ${invoice.code}`, description: "Hóa đơn bị hủy sẽ không được tính vào báo cáo.", submitLabel: "Xác nhận hủy", fields: [{ key: "reason", label: "Lý do hủy", type: "textarea", required: true }], onSubmit: (values) => props.run("invoice.cancel", { ...values, invoiceId: invoice.id }) });
  return <><SectionHeader title="Hóa đơn & thanh toán" description="Lập hóa đơn, áp dụng giảm giá, tách/gộp và ghi nhận giao dịch." actions={<Button onClick={() => create()} disabled={!unbilled.length}><Plus />Tạo hóa đơn</Button>} />
    {unbilled.length > 0 && <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start gap-3"><ReceiptText className="mt-0.5 size-5 text-amber-700" /><div className="flex-1"><p className="font-medium text-amber-950">{unbilled.length} phiên đã kết thúc chưa có hóa đơn</p><div className="mt-3 flex flex-wrap gap-2">{unbilled.map((session) => <Button key={session.id} size="sm" variant="outline" className="bg-white" onClick={() => create(session.id)}>{session.table_name} · {money(session.table_amount)}</Button>)}</div></div></div></div>}
    {!invoices.length ? <EmptyState icon={ReceiptText} title="Chưa có hóa đơn" description="Kết thúc một phiên chơi rồi tạo hóa đơn từ tiền bàn và order." /> : <Card className="gap-0 overflow-hidden py-0"><Table><TableHeader><TableRow><TableHead>Mã hóa đơn</TableHead><TableHead>Bàn / khách</TableHead><TableHead>Tổng tiền</TableHead><TableHead>Đã thu</TableHead><TableHead>Trạng thái</TableHead><TableHead className="text-right">Thao tác</TableHead></TableRow></TableHeader><TableBody>{invoices.map((invoice) => { const itemCount = (props.data.invoiceItems as Row[]).filter((item) => item.invoice_id === invoice.id).length; return <TableRow key={invoice.id}><TableCell><p className="font-mono text-xs font-semibold">{invoice.code}</p><p className="text-xs text-muted-foreground">{dateTime(invoice.created_at)}</p></TableCell><TableCell><p>{invoice.table_name || "Hóa đơn tách/gộp"}</p><p className="text-xs text-muted-foreground">{invoice.customer_name || "Khách lẻ"}</p></TableCell><TableCell className="font-semibold">{money(invoice.total_amount)}</TableCell><TableCell>{money(invoice.paid_amount)}</TableCell><TableCell><StatusBadge value={invoice.status} /></TableCell><TableCell><div className="flex justify-end gap-1">{invoice.status === "ISSUED" && <>{itemCount > 1 && <Button size="sm" variant="ghost" onClick={() => split(invoice)}>Tách dòng</Button>}<Button size="sm" variant="outline" onClick={() => adjust(invoice)}>Điều chỉnh</Button><Button size="sm" variant="ghost" onClick={() => cancel(invoice)}>Hủy</Button><Button size="sm" onClick={() => pay(invoice)}><CreditCard />Thanh toán</Button></>}<Button size="sm" variant="ghost" title="In hóa đơn" onClick={() => window.print()}><Printer className="size-4" /></Button></div></TableCell></TableRow>; })}</TableBody></Table></Card>}
    {invoices.filter((invoice) => invoice.status === "ISSUED").length >= 2 && <Card className="mt-6 gap-3 border-dashed py-4"><CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Tách / gộp hóa đơn</p><p className="text-sm text-muted-foreground">Hỗ trợ thanh toán chung nhiều bàn hoặc chia theo dòng dịch vụ.</p></div><Button variant="outline" onClick={() => { const options = invoices.filter((item) => item.status === "ISSUED").map((item) => ({ value: item.id, label: `${item.code} · ${money(item.total_amount)}` })); props.openForm({ title: "Gộp hóa đơn", fields: [{ key: "targetInvoiceId", label: "Hóa đơn đích", type: "select", required: true, options }, { key: "sourceInvoiceId", label: "Hóa đơn cần gộp", type: "select", required: true, options }], onSubmit: (values) => props.run("invoice.merge", { targetInvoiceId: values.targetInvoiceId, sourceInvoiceIds: [values.sourceInvoiceId] }) }); }}>Gộp hóa đơn</Button></CardContent></Card>}
  </>;
}

function InventoryView(props: ShellProps) {
  const products = (props.data.products as Row[]).filter((product) => product.track_stock);
  const move = (type: "IN" | "OUT" | "ADJUST") => props.openForm({ title: type === "IN" ? "Nhập kho" : type === "OUT" ? "Xuất kho" : "Điều chỉnh tồn", description: type === "ADJUST" ? "Nhập số lượng tồn thực tế mới." : undefined, fields: [{ key: "productId", label: "Hàng hóa", type: "select", required: true, options: products.map((product) => ({ value: product.id, label: `${product.name} · tồn ${product.stock_quantity} ${product.unit}` })) }, { key: "quantity", label: type === "ADJUST" ? "Tồn thực tế" : "Số lượng", type: "number", min: 0, step: 0.01, required: true }, ...(type === "IN" ? [{ key: "unitCost", label: "Giá nhập", type: "number" as const, min: 0 }] : []), { key: "reason", label: "Lý do / chứng từ", type: "textarea" as const, required: true }], onSubmit: (values) => props.run("inventory.move", { ...values, type }) });
  const count = () => props.openForm({ title: "Kiểm kê nhanh", description: "Chọn một hàng hóa và nhập tồn thực tế. Hệ thống tự tạo bút toán điều chỉnh.", fields: [{ key: "productId", label: "Hàng hóa", type: "select", required: true, options: products.map((product) => ({ value: product.id, label: `${product.name} · hệ thống ${product.stock_quantity}` })) }, { key: "actualQuantity", label: "Tồn thực tế", type: "number", min: 0, step: 0.01, required: true }, { key: "notes", label: "Ghi chú", type: "textarea" }], onSubmit: (values) => props.run("stock.count", { items: [{ productId: values.productId, actualQuantity: values.actualQuantity, notes: values.notes }] }) });
  return <><SectionHeader title="Kho & hàng hóa" description="Nhập, xuất, kiểm kê và cảnh báo tồn dưới định mức." actions={<><Button variant="outline" onClick={() => move("IN")}><PackagePlus />Nhập kho</Button><Button variant="outline" onClick={() => move("OUT")}><Archive />Xuất kho</Button><Button onClick={count}><ClipboardList />Kiểm kê</Button></>} />
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{products.map((product) => { const low = Number(product.stock_quantity) <= Number(product.min_stock); return <Card key={product.id} className={cn("gap-3 py-4", low && "border-rose-200 bg-rose-50/60")}><CardContent className="px-4"><div className="flex items-start justify-between"><div><p className="text-sm font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.code} · {product.unit}</p></div>{low && <Badge variant="destructive">Sắp hết</Badge>}</div><p className="mt-4 text-2xl font-semibold">{product.stock_quantity}</p><p className="text-xs text-muted-foreground">Tồn tối thiểu: {product.min_stock}</p></CardContent></Card>; })}</div>
    <Card className="gap-0 overflow-hidden py-0"><div className="border-b px-5 py-4"><h3 className="font-semibold">Lịch sử nhập xuất</h3></div><Table><TableHeader><TableRow><TableHead>Thời gian</TableHead><TableHead>Mã</TableHead><TableHead>Hàng hóa</TableHead><TableHead>Loại</TableHead><TableHead>Số lượng</TableHead><TableHead>Sau giao dịch</TableHead><TableHead>Người thực hiện</TableHead></TableRow></TableHeader><TableBody>{(props.data.inventory as Row[]).map((row) => <TableRow key={row.id}><TableCell>{dateTime(row.created_at)}</TableCell><TableCell className="font-mono text-xs">{row.code}</TableCell><TableCell>{row.product_name}</TableCell><TableCell><Badge variant="outline">{row.type}</Badge></TableCell><TableCell>{row.quantity}</TableCell><TableCell>{row.after_quantity}</TableCell><TableCell>{row.created_by_name}</TableCell></TableRow>)}</TableBody></Table></Card>
  </>;
}

function ShiftsView(props: ShellProps) {
  const openShift = (props.data.shifts as Row[]).find((shift) => shift.cashier_id === props.data.user.id && shift.status === "OPEN");
  const open = () => props.openForm({ title: "Mở ca làm việc", fields: [{ key: "openingCash", label: "Tiền đầu ca", type: "number", min: 0, required: true, value: 0 }, { key: "notes", label: "Ghi chú", type: "textarea" }], onSubmit: (values) => props.run("shift.open", values) });
  const close = () => props.openForm({ title: "Chốt ca", description: "Nhập tiền mặt thực tế. Hệ thống sẽ đối chiếu với số dự kiến.", fields: [{ key: "actualCash", label: "Tiền mặt thực tế", type: "number", min: 0, required: true }, { key: "notes", label: "Ghi chú bàn giao", type: "textarea" }], onSubmit: async (values) => { const result = await props.run("shift.close", values); toast.info(`Chênh lệch: ${money(result?.difference)}`); } });
  return <><SectionHeader title="Ca làm việc" description="Mở ca, theo dõi tiền mặt và chốt đối soát cuối ca." actions={openShift ? <Button onClick={close}><LockKeyhole />Chốt ca</Button> : <Button onClick={open}><DoorOpen />Mở ca</Button>} />
    <Card className={cn("mb-6 overflow-hidden border-0 text-white", openShift ? "bg-gradient-to-br from-[#0b6b55] to-[#123f35]" : "bg-gradient-to-br from-slate-600 to-slate-800")}><CardContent className="grid gap-6 px-6 py-7 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="mb-3 flex items-center gap-2"><Activity className="size-5" /><span className="text-sm font-medium text-white/70">Trạng thái cá nhân</span></div><h3 className="text-3xl font-semibold">{openShift ? "Ca đang mở" : "Chưa mở ca"}</h3><p className="mt-2 text-sm text-white/65">{openShift ? `Bắt đầu ${dateTime(openShift.opened_at)} · tiền đầu ca ${money(openShift.opening_cash)}` : "Mở ca trước khi nhận thanh toán tiền mặt."}</p></div>{openShift && <div className="rounded-2xl bg-white/10 px-5 py-4 text-right"><p className="text-xs text-white/60">Mã ca</p><p className="mt-1 font-mono font-semibold">{openShift.code}</p></div>}</CardContent></Card>
    <Card className="gap-0 overflow-hidden py-0"><Table><TableHeader><TableRow><TableHead>Mã ca</TableHead><TableHead>Thu ngân</TableHead><TableHead>Mở ca</TableHead><TableHead>Chốt ca</TableHead><TableHead>Dự kiến</TableHead><TableHead>Thực tế</TableHead><TableHead>Chênh lệch</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader><TableBody>{(props.data.shifts as Row[]).map((row) => <TableRow key={row.id}><TableCell className="font-mono text-xs">{row.code}</TableCell><TableCell>{row.cashier_name}</TableCell><TableCell>{dateTime(row.opened_at)}</TableCell><TableCell>{dateTime(row.closed_at)}</TableCell><TableCell>{row.expected_cash == null ? "-" : money(row.expected_cash)}</TableCell><TableCell>{row.actual_cash == null ? "-" : money(row.actual_cash)}</TableCell><TableCell className={cn(Number(row.difference) !== 0 && "font-semibold text-rose-600")}>{row.difference == null ? "-" : money(row.difference)}</TableCell><TableCell><StatusBadge value={row.status} /></TableCell></TableRow>)}</TableBody></Table></Card>
  </>;
}

function ReportsView(props: ShellProps) {
  const report = props.data.report ?? { revenue: [], tables: [], products: [], inventory: [] };
  const revenue = report.revenue as Row[];
  const maxRevenue = Math.max(1, ...revenue.map((item) => Number(item.revenue)));
  return <><SectionHeader title="Báo cáo & thống kê" description="Chỉ tổng hợp hóa đơn đã thanh toán và giao dịch kho hợp lệ." actions={<Button variant="outline" size="sm" onClick={() => window.print()}><Printer />In báo cáo</Button>} />
    <div className="grid gap-5 xl:grid-cols-[1.4fr_.6fr]"><Card className="gap-4"><CardHeader><CardTitle>Doanh thu 30 ngày</CardTitle><CardDescription>Phân tách tiền bàn và sản phẩm/dịch vụ</CardDescription></CardHeader><CardContent><div className="flex h-64 items-end gap-2 overflow-x-auto pb-2">{revenue.length ? revenue.map((item) => <div key={item.day} className="group flex h-full min-w-8 flex-1 flex-col justify-end gap-1"><div className="relative flex min-h-1 flex-col justify-end overflow-hidden rounded-t-lg bg-emerald-100" style={{ height: `${Math.max(4, Number(item.revenue) / maxRevenue * 100)}%` }} title={`${item.day}: ${money(item.revenue)}`}><div className="bg-amber-400" style={{ height: `${Number(item.service_revenue) / Math.max(1, Number(item.revenue)) * 100}%` }} /><div className="bg-emerald-600" style={{ height: `${Number(item.table_revenue) / Math.max(1, Number(item.revenue)) * 100}%` }} /></div><span className="truncate text-center text-[10px] text-muted-foreground">{String(item.day).slice(5)}</span></div>) : <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">Chưa có doanh thu trong kỳ</div>}</div><div className="mt-4 flex gap-4 text-xs"><span className="flex items-center gap-2"><i className="size-2.5 rounded-full bg-emerald-600" />Tiền bàn</span><span className="flex items-center gap-2"><i className="size-2.5 rounded-full bg-amber-400" />Dịch vụ</span></div></CardContent></Card>
      <Card className="gap-4"><CardHeader><CardTitle>Cơ cấu kỳ này</CardTitle><CardDescription>Từ các giao dịch hợp lệ</CardDescription></CardHeader><CardContent className="space-y-5">{(() => { const tableRevenue = revenue.reduce((sum, item) => sum + Number(item.table_revenue), 0); const serviceRevenue = revenue.reduce((sum, item) => sum + Number(item.service_revenue), 0); const total = tableRevenue + serviceRevenue; return <><div><p className="text-sm text-muted-foreground">Tổng doanh thu</p><p className="mt-1 text-3xl font-semibold">{money(total)}</p></div><div className="space-y-3"><div><div className="mb-1 flex justify-between text-xs"><span>Tiền bàn</span><span>{total ? Math.round(tableRevenue / total * 100) : 0}%</span></div><Progress value={total ? tableRevenue / total * 100 : 0} /></div><div><div className="mb-1 flex justify-between text-xs"><span>Sản phẩm / dịch vụ</span><span>{total ? Math.round(serviceRevenue / total * 100) : 0}%</span></div><Progress value={total ? serviceRevenue / total * 100 : 0} /></div></div></>; })()}</CardContent></Card></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><ReportTable title="Hiệu suất bàn" columns={["Bàn", "Số phiên", "Thời gian", "Doanh thu"]} rows={(report.tables as Row[]).map((item) => [item.name, item.session_count, `${Math.round(Number(item.minutes))} phút`, money(item.revenue)])} /><ReportTable title="Sản phẩm bán chạy" columns={["Sản phẩm", "Số lượng", "Doanh thu"]} rows={(report.products as Row[]).map((item) => [item.name, item.quantity, money(item.revenue)])} /><ReportTable title="Nhập - xuất - tồn" columns={["Hàng hóa", "Nhập", "Xuất", "Tồn"]} rows={(report.inventory as Row[]).map((item) => [item.name, item.imported, item.exported, item.stock_quantity])} /></div>
  </>;
}

function ReportTable({ title, columns, rows }: { title: string; columns: string[]; rows: any[][] }) {
  return <Card className="gap-0 overflow-hidden py-0"><div className="border-b px-5 py-4"><h3 className="font-semibold">{title}</h3></div><Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.map((row, index) => <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-28 text-center text-muted-foreground">Chưa có dữ liệu</TableCell></TableRow>}</TableBody></Table></Card>;
}

function AdminView(props: ShellProps) {
  const [tab, setTab] = React.useState("accounts");
  const allowed = (permission: string) => props.data.user.roleCode === "ADMIN" || props.data.user.permissions.includes(permission);
  const tabs = [
    { id: "accounts", title: "Tài khoản", show: allowed("USERS_MANAGE") },
    { id: "roles", title: "Phân quyền", show: allowed("ROLES_MANAGE") },
    { id: "floor", title: "Bàn & giá", show: allowed("TABLES_MANAGE") || allowed("PRICES_MANAGE") },
    { id: "catalog", title: "Danh mục", show: allowed("PRODUCTS_MANAGE") || allowed("MEMBERSHIPS_MANAGE") },
  ].filter((t) => t.show);
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  const areaOptions = (props.data.areas as Row[]).map((row) => ({ value: row.id, label: row.name }));
  const typeOptions = (props.data.tableTypes as Row[]).map((row) => ({ value: row.id, label: row.name }));
  const categoryOptions = (props.data.categories as Row[]).map((row) => ({ value: row.id, label: row.name }));
  const editArea = (row?: Row) => props.openForm({ title: row ? "Cập nhật khu vực" : "Thêm khu vực", fields: [{ key: "code", label: "Mã khu vực", required: true, value: row?.code }, { key: "name", label: "Tên khu vực", required: true, value: row?.name }, { key: "sortOrder", label: "Thứ tự", type: "number", value: row?.sort_order ?? 0 }, { key: "description", label: "Mô tả", type: "textarea", value: row?.description }], onSubmit: (values) => props.run("area.save", { ...values, id: row?.id }) });
  const editType = (row?: Row) => props.openForm({ title: row ? "Cập nhật loại bàn" : "Thêm loại bàn", fields: [{ key: "code", label: "Mã loại", required: true, value: row?.code }, { key: "name", label: "Tên loại bàn", required: true, value: row?.name }, { key: "baseHourlyRate", label: "Giá cơ bản / giờ", type: "number", min: 0, required: true, value: row?.base_hourly_rate ?? 0 }, { key: "color", label: "Màu nhận diện", type: "color", value: row?.color ?? "#16a085" }, { key: "description", label: "Mô tả", type: "textarea", value: row?.description }], onSubmit: (values) => props.run("tableType.save", { ...values, id: row?.id }) });
  const editTable = (row?: Row) => props.openForm({ title: row ? "Cập nhật bàn" : "Thêm bàn", fields: [{ key: "code", label: "Mã bàn", required: true, value: row?.code }, { key: "name", label: "Tên bàn", required: true, value: row?.name }, { key: "areaId", label: "Khu vực", type: "select", required: true, value: row?.area_id, options: areaOptions }, { key: "tableTypeId", label: "Loại bàn", type: "select", required: true, value: row?.table_type_id, options: typeOptions }, { key: "sortOrder", label: "Thứ tự", type: "number", value: row?.sort_order ?? 0 }, { key: "notes", label: "Ghi chú", type: "textarea", value: row?.notes }], onSubmit: (values) => props.run("table.save", { ...values, id: row?.id }) });
  const editPrice = (row?: Row) => props.openForm({ title: row ? "Cập nhật bảng giá" : "Thêm khung giá", description: "Ngày áp dụng dùng bitmask: CN=1, T2=2, ... T7=64; tất cả ngày=127.", fields: [{ key: "name", label: "Tên khung giá", required: true, value: row?.name }, { key: "tableTypeId", label: "Loại bàn", type: "select", required: true, value: row?.table_type_id, options: typeOptions }, { key: "daysMask", label: "Mặt nạ ngày", type: "number", min: 1, required: true, value: row?.days_mask ?? 127 }, { key: "startMinute", label: "Phút bắt đầu trong ngày", type: "number", min: 0, value: row?.start_minute ?? 0 }, { key: "endMinute", label: "Phút kết thúc", type: "number", min: 1, value: row?.end_minute ?? 1440 }, { key: "hourlyRate", label: "Đơn giá / giờ", type: "number", min: 0, required: true, value: row?.hourly_rate }, { key: "priority", label: "Độ ưu tiên", type: "number", value: row?.priority ?? 0 }, { key: "effectiveFrom", label: "Hiệu lực từ", type: "datetime-local", value: localInput(row?.effective_from) }, { key: "effectiveTo", label: "Hiệu lực đến", type: "datetime-local", value: localInput(row?.effective_to) }], onSubmit: (values) => props.run("price.save", { ...values, id: row?.id, effectiveFrom: values.effectiveFrom ? new Date(values.effectiveFrom).toISOString() : null, effectiveTo: values.effectiveTo ? new Date(values.effectiveTo).toISOString() : null }) });
  const editCategory = (row?: Row) => props.openForm({ title: row ? "Cập nhật nhóm sản phẩm" : "Thêm nhóm sản phẩm", fields: [{ key: "code", label: "Mã nhóm", required: true, value: row?.code }, { key: "name", label: "Tên nhóm", required: true, value: row?.name }, { key: "sortOrder", label: "Thứ tự", type: "number", value: row?.sort_order ?? 0 }], onSubmit: (values) => props.run("category.save", { ...values, id: row?.id }) });
  const editProduct = (row?: Row) => props.openForm({ title: row ? "Cập nhật sản phẩm / dịch vụ" : "Thêm sản phẩm / dịch vụ", fields: [{ key: "code", label: "Mã", required: true, value: row?.code }, { key: "name", label: "Tên", required: true, value: row?.name }, { key: "categoryId", label: "Nhóm", type: "select", value: row?.category_id, options: categoryOptions }, { key: "kind", label: "Loại", type: "select", value: row?.kind ?? "PRODUCT", options: [{ value: "PRODUCT", label: "Hàng hóa" }, { value: "SERVICE", label: "Dịch vụ" }] }, { key: "unit", label: "Đơn vị", value: row?.unit ?? "phần" }, { key: "salePrice", label: "Giá bán", type: "number", min: 0, required: true, value: row?.sale_price ?? 0 }, { key: "costPrice", label: "Giá vốn", type: "number", min: 0, value: row?.cost_price ?? 0 }, { key: "minStock", label: "Tồn tối thiểu", type: "number", min: 0, step: 0.01, value: row?.min_stock ?? 0 }], onSubmit: (values) => props.run("product.save", { ...values, id: row?.id, trackStock: values.kind !== "SERVICE" }) });
  const editTier = (row?: Row) => props.openForm({ title: row ? "Cập nhật hạng hội viên" : "Thêm hạng hội viên", fields: [{ key: "code", label: "Mã hạng", required: true, value: row?.code }, { key: "name", label: "Tên hạng", required: true, value: row?.name }, { key: "minPoints", label: "Điểm tối thiểu", type: "number", min: 0, value: row?.min_points ?? 0 }, { key: "discountPercent", label: "Giảm giá (%)", type: "number", min: 0, value: row?.discount_percent ?? 0 }], onSubmit: (values) => props.run("tier.save", { ...values, id: row?.id }) });
  const invite = () => props.openForm({ title: "Mời nhân viên", description: "Mã mời chỉ hiển thị một lần và hết hạn sau 72 giờ.", submitLabel: "Tạo mã mời", fields: [{ key: "email", label: "Giới hạn email (không bắt buộc)", type: "email" }, { key: "roleId", label: "Vai trò", type: "select", required: true, options: (props.data.roles as Row[]).filter((role) => role.code !== "ADMIN").map((role) => ({ value: role.id, label: role.name })) }], onSubmit: async (values) => { const response = await props.run("user.invite", values); if (response?.invitationCode) { await navigator.clipboard?.writeText(response.invitationCode); toast.success(`Mã mời: ${response.invitationCode}`, { duration: 15000, description: "Đã sao chép vào bộ nhớ tạm." }); } } });
  const editUser = (row: Row) => props.openForm({ title: `Tài khoản · ${row.full_name}`, fields: [{ key: "fullName", label: "Họ tên", required: true, value: row.full_name }, { key: "phone", label: "Số điện thoại", value: row.phone }, { key: "roleId", label: "Vai trò", type: "select", required: true, value: row.role_id, options: (props.data.roles as Row[]).map((role) => ({ value: role.id, label: role.name })) }, { key: "status", label: "Trạng thái", type: "select", value: row.status, options: [{ value: "ACTIVE", label: "Hoạt động" }, { value: "LOCKED", label: "Khóa" }] }], onSubmit: (values) => props.run("user.update", { ...values, id: row.id }) });
  return <><SectionHeader title="Quản trị hệ thống" description="Tài khoản, phân quyền, mặt bằng, bảng giá và danh mục vận hành." />
    <Tabs value={activeTab} onValueChange={setTab}><TabsList className="mb-5 max-w-full overflow-x-auto bg-white p-1">{tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.title}</TabsTrigger>)}</TabsList>
      <TabsContent value="accounts"><Card className="gap-0 overflow-hidden py-0"><div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="font-semibold">Tài khoản nhân viên</h3><p className="text-sm text-muted-foreground">Quản lý vai trò và trạng thái truy cập.</p></div><Button onClick={invite}><Plus />Mời nhân viên</Button></div><Table><TableHeader><TableRow><TableHead>Nhân viên</TableHead><TableHead>Email</TableHead><TableHead>Vai trò</TableHead><TableHead>Trạng thái</TableHead><TableHead>Lần cuối đăng nhập</TableHead><TableHead /></TableRow></TableHeader><TableBody>{(props.data.users as Row[]).map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.full_name}</TableCell><TableCell>{row.email}</TableCell><TableCell>{row.role_name}</TableCell><TableCell><StatusBadge value={row.status} /></TableCell><TableCell>{dateTime(row.last_login_at)}</TableCell><TableCell className="text-right"><Button size="icon-sm" variant="ghost" onClick={() => editUser(row)}><Pencil /></Button></TableCell></TableRow>)}</TableBody></Table></Card></TabsContent>
      <TabsContent value="roles"><RoleMatrix {...props} /></TabsContent>
      <TabsContent value="floor"><div className="grid gap-5 xl:grid-cols-2">{allowed("TABLES_MANAGE") && <AdminList title="Khu vực" rows={props.data.areas} columns={["code", "name"]} onAdd={() => editArea()} onEdit={editArea} onDelete={(row) => props.run("area.delete", { id: row.id })} />}{allowed("PRICES_MANAGE") && <AdminList title="Loại bàn" rows={props.data.tableTypes} columns={["code", "name", "base_hourly_rate"]} format={{ base_hourly_rate: money }} onAdd={() => editType()} onEdit={editType} onDelete={(row) => props.run("tableType.delete", { id: row.id })} />}{allowed("TABLES_MANAGE") && <AdminList title="Bàn bida" rows={props.data.tables} columns={["code", "name", "area_name", "type_name"]} onAdd={() => editTable()} onEdit={editTable} onDelete={(row) => props.run("table.delete", { id: row.id })} />}{allowed("PRICES_MANAGE") && <AdminList title="Khung giá" rows={props.data.priceRules} columns={["type_name", "name", "hourly_rate"]} format={{ hourly_rate: money }} onAdd={() => editPrice()} onEdit={editPrice} onDelete={(row) => props.run("price.delete", { id: row.id })} />}</div></TabsContent>
      <TabsContent value="catalog"><div className="grid gap-5 xl:grid-cols-2">{allowed("PRODUCTS_MANAGE") && <AdminList title="Nhóm sản phẩm" rows={props.data.categories} columns={["code", "name"]} onAdd={() => editCategory()} onEdit={editCategory} onDelete={(row) => props.run("category.delete", { id: row.id })} />}{allowed("PRODUCTS_MANAGE") && <AdminList title="Sản phẩm & dịch vụ" rows={props.data.products} columns={["code", "name", "sale_price"]} format={{ sale_price: money }} onAdd={() => editProduct()} onEdit={editProduct} onDelete={(row) => props.run("product.delete", { id: row.id })} />}{allowed("MEMBERSHIPS_MANAGE") && <AdminList title="Hạng hội viên" rows={props.data.tiers} columns={["code", "name", "min_points", "discount_percent"]} onAdd={() => editTier()} onEdit={editTier} />}</div></TabsContent>
    </Tabs>
  </>;
}

function AdminList({ title, rows = [], columns, format = {}, onAdd, onEdit, onDelete }: { title: string; rows: Row[]; columns: string[]; format?: Record<string, (value: unknown) => string>; onAdd: () => void; onEdit: (row: Row) => void; onDelete?: (row: Row) => void }) {
  return <Card className="gap-0 overflow-hidden py-0"><div className="flex items-center justify-between border-b px-5 py-4"><h3 className="font-semibold">{title}</h3><Button size="sm" onClick={onAdd}><Plus />Thêm</Button></div><Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column.replaceAll("_", " ")}</TableHead>)}<TableHead /></TableRow></TableHeader><TableBody>{rows.length ? rows.map((row) => <TableRow key={row.id}>{columns.map((column) => <TableCell key={column}>{format[column] ? format[column](row[column]) : String(row[column] ?? "-")}</TableCell>)}<TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Sửa ${row.name ?? title}`} onClick={() => onEdit(row)}><Pencil /></Button>{onDelete && <Button size="icon-sm" variant="ghost" className="text-rose-600" aria-label={`Ngừng sử dụng ${row.name ?? title}`} onClick={() => onDelete(row)}><Archive /></Button>}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={columns.length + 1} className="h-24 text-center text-muted-foreground">Chưa có dữ liệu</TableCell></TableRow>}</TableBody></Table></Card>;
}

function RoleMatrix(props: ShellProps) {
  const editableRoles = (props.data.roles as Row[]).filter((role) => role.code !== "ADMIN");
  const [roleId, setRoleId] = React.useState(editableRoles[0]?.id ?? "");
  const allPermissions = React.useMemo(() => { const map = new Map<string, Row>(); (props.data.permissionRows as Row[]).forEach((row) => map.set(row.code, row)); return [...map.values()]; }, [props.data.permissionRows]);
  const permissionsForRole = React.useCallback((nextRoleId: string) => new Set((props.data.permissionRows as Row[]).filter((row) => row.role_id === nextRoleId).map((row) => row.code)), [props.data.permissionRows]);
  const [selected, setSelected] = React.useState<Set<string>>(() => permissionsForRole(roleId));
  const modules = [...new Set(allPermissions.map((item) => item.module))];
  return <Card className="gap-5"><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Ma trận phân quyền</CardTitle><CardDescription className="mt-1">Quyền được kiểm tra đồng thời tại giao diện và backend.</CardDescription></div><NativeSelect value={roleId} onChange={(event) => { const nextRoleId = event.target.value; setRoleId(nextRoleId); setSelected(permissionsForRole(nextRoleId)); }}>{editableRoles.map((role) => <NativeSelectOption key={role.id} value={role.id}>{role.name}</NativeSelectOption>)}</NativeSelect></div></CardHeader><CardContent className="space-y-5">{modules.map((module) => <div key={module}><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{module}</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{allPermissions.filter((item) => item.module === module).map((permission) => <label key={permission.code} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 text-sm transition hover:bg-emerald-50"><Checkbox checked={selected.has(permission.code)} onCheckedChange={(checked) => { const next = new Set(selected); if (checked) next.add(permission.code); else next.delete(permission.code); setSelected(next); }} /><span>{permission.name}</span></label>)}</div></div>)}<div className="flex justify-end"><Button onClick={() => props.run("role.permissions", { roleId, permissionCodes: [...selected] })}><ShieldCheck />Lưu phân quyền</Button></div></CardContent></Card>;
}

function AuditView(props: ShellProps) {
  const [query, setQuery] = React.useState("");
  const rows = (props.data.auditLogs as Row[]).filter((row) => `${row.action} ${row.summary} ${row.actor_name ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <><SectionHeader title="Nhật ký hoạt động" description="Các thao tác quan trọng được lưu bất biến để truy vết." actions={<div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong nhật ký..." className="w-64 bg-white pl-9" /></div>} /><Card className="gap-0 overflow-hidden py-0"><Table><TableHeader><TableRow><TableHead>Thời gian</TableHead><TableHead>Người thực hiện</TableHead><TableHead>Hành động</TableHead><TableHead>Đối tượng</TableHead><TableHead>Nội dung</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{dateTime(row.created_at)}</TableCell><TableCell>{row.actor_name || "Hệ thống"}</TableCell><TableCell><Badge variant="outline" className="font-mono text-[10px]">{row.action}</Badge></TableCell><TableCell>{row.entity_type}{row.entity_id ? <span className="ml-1 text-xs text-muted-foreground">{String(row.entity_id).slice(-8)}</span> : null}</TableCell><TableCell className="max-w-md whitespace-normal">{row.summary}</TableCell></TableRow>)}</TableBody></Table></Card></>;
}

function ProfileView(props: ShellProps) {
  const edit = () => props.openForm({ title: "Cập nhật hồ sơ", fields: [{ key: "fullName", label: "Họ tên", required: true, value: props.data.user.fullName }, { key: "phone", label: "Số điện thoại", value: props.data.user.phone }], onSubmit: (values) => props.run("profile.update", values) });
  const password = () => props.openForm({ title: "Đổi mật khẩu", description: "Mật khẩu cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.", fields: [{ key: "currentPassword", label: "Mật khẩu hiện tại", type: "password", required: true }, { key: "newPassword", label: "Mật khẩu mới", type: "password", required: true }, { key: "confirmPassword", label: "Nhập lại mật khẩu mới", type: "password", required: true }], onSubmit: (values) => props.run("password.change", values, false) });
  return <><SectionHeader title="Hồ sơ cá nhân" description="Thông tin tài khoản và bảo mật phiên đăng nhập của bạn." />
    <div className="grid gap-5 xl:grid-cols-[.7fr_1.3fr]"><Card className="overflow-hidden border-0 bg-gradient-to-br from-[#0b6b55] to-[#0b2f27] text-white"><CardContent className="grid place-items-center px-6 py-10 text-center"><div className="grid size-20 place-items-center rounded-3xl bg-white/15 text-3xl font-semibold">{props.data.user.fullName.slice(0, 1).toUpperCase()}</div><h3 className="mt-5 text-2xl font-semibold">{props.data.user.fullName}</h3><p className="mt-1 text-emerald-100/70">{props.data.user.roleName}</p><Badge className="mt-5 bg-white/10 text-white">Đang hoạt động</Badge></CardContent></Card><Card><CardHeader><CardTitle>Thông tin tài khoản</CardTitle><CardDescription>Vai trò và quyền không thể thay đổi tại hồ sơ cá nhân.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Info label="Họ tên" value={props.data.user.fullName} /><Info label="Email" value={props.data.user.email} /><Info label="Số điện thoại" value={props.data.user.phone || "Chưa cập nhật"} /><Info label="Vai trò" value={props.data.user.roleName} /></div><div className="flex flex-wrap gap-2 border-t pt-5"><Button onClick={edit}><Pencil />Chỉnh sửa hồ sơ</Button><Button variant="outline" onClick={password}><LockKeyhole />Đổi mật khẩu</Button><Button variant="ghost" className="text-rose-600" onClick={props.logout}><LogOut />Đăng xuất</Button></div></CardContent></Card></div>
  </>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}
