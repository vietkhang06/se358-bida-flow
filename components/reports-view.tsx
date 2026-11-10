"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import { CalendarRange, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Row = Record<string, any>;

export type ReportFilterValue = {
  from: string;
  to: string;
  tz: string;
};

const TIMEZONE_OPTIONS = [
  { value: "Asia/Ho_Chi_Minh", label: "Việt Nam (Asia/Ho_Chi_Minh, UTC+7)" },
  { value: "Asia/Bangkok", label: "Thái Lan (Asia/Bangkok, UTC+7)" },
  { value: "UTC", label: "Giờ quốc tế (UTC)" },
  { value: "Asia/Tokyo", label: "Nhật Bản (Asia/Tokyo, UTC+9)" },
];

const money = (amount: unknown) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(amount ?? 0));

function todayInZone(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftIsoDate(isoDate: string, deltaDays: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

export function ReportsView({
  report,
  reportMeta,
  activeFilter,
  onApplyFilter,
}: {
  report: Row | null;
  reportMeta?: Row | null;
  activeFilter: ReportFilterValue | null;
  onApplyFilter: (next: ReportFilterValue | null) => Promise<void>;
}) {
  const safeReport = report ?? { revenue: [], tables: [], products: [], inventory: [] };
  const effectiveFrom = activeFilter?.from ?? String(reportMeta?.from ?? shiftIsoDate(todayInZone("Asia/Ho_Chi_Minh"), -29));
  const effectiveTo = activeFilter?.to ?? String(reportMeta?.to ?? todayInZone("Asia/Ho_Chi_Minh"));
  const effectiveTz = activeFilter?.tz ?? String(reportMeta?.timezone ?? "Asia/Ho_Chi_Minh");

  const [draftState, setDraftState] = React.useState<ReportFilterValue | null>(null);
  const draft = draftState ?? {
    from: effectiveFrom,
    to: effectiveTo,
    tz: effectiveTz,
  };
  const [busy, setBusy] = React.useState(false);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  const submitFilter = async (next: ReportFilterValue | null) => {
    if (next) {
      if (!next.from || !next.to) {
        setErrorText("Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.");
        return;
      }
      if (next.from > next.to) {
        setErrorText("Ngày bắt đầu không được lớn hơn ngày kết thúc.");
        return;
      }
    }
    setErrorText(null);
    setBusy(true);
    try {
      await onApplyFilter(next);
      setDraftState(next);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Không thể tải báo cáo với bộ lọc hiện tại.");
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (kind: "today" | "7d" | "30d" | "month") => {
    const today = todayInZone(draft.tz);
    let from = today;
    if (kind === "7d") from = shiftIsoDate(today, -6);
    if (kind === "30d") from = shiftIsoDate(today, -29);
    if (kind === "month") from = `${today.slice(0, 8)}01`;
    const next = { from, to: today, tz: draft.tz };
    setDraftState(next);
    void submitFilter(next);
  };

  const revenue = (safeReport.revenue ?? []) as Row[];
  const maxRevenue = Math.max(1, ...revenue.map((item) => Number(item.revenue ?? 0)));
  const netRevenue = revenue.reduce((sum, item) => sum + Number(item.revenue ?? 0), 0);
  const tableRevenue = revenue.reduce((sum, item) => sum + Number(item.table_revenue ?? 0), 0);
  const serviceRevenue = revenue.reduce((sum, item) => sum + Number(item.service_revenue ?? 0), 0);
  const discountAmount = revenue.reduce((sum, item) => sum + Number(item.discount_amount ?? 0), 0);
  const surchargeAmount = revenue.reduce((sum, item) => sum + Number(item.surcharge_amount ?? 0), 0);
  const invoiceCount = revenue.reduce((sum, item) => sum + Number(item.invoice_count ?? 0), 0);
  const grossRevenue = tableRevenue + serviceRevenue;

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Báo cáo &amp; thống kê</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Chỉ tổng hợp hóa đơn đã thanh toán hoàn tất (PAID), loại trừ hóa đơn hủy và chưa thanh toán.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-white">
            <CalendarRange className="mr-1 size-3.5" />
            {effectiveFrom} → {effectiveTo} · {effectiveTz}
          </Badge>
        </div>
      </div>

      <Card className="mb-5 gap-3 py-4">
        <CardContent className="space-y-3 px-4">
          <form
            className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void submitFilter(draft);
            }}
          >
            <div className="space-y-1">
              <label htmlFor="report-from" className="text-xs font-medium text-muted-foreground">Từ ngày</label>
              <Input
                id="report-from"
                aria-label="Từ ngày"
                type="date"
                value={draft.from}
                onChange={(event) => setDraftState({ ...draft, from: event.target.value })}
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="report-to" className="text-xs font-medium text-muted-foreground">Đến ngày</label>
              <Input
                id="report-to"
                aria-label="Đến ngày"
                type="date"
                value={draft.to}
                onChange={(event) => setDraftState({ ...draft, to: event.target.value })}
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="report-tz" className="text-xs font-medium text-muted-foreground">Múi giờ nghiệp vụ</label>
              <NativeSelect
                id="report-tz"
                aria-label="Múi giờ báo cáo"
                value={draft.tz}
                onChange={(event) => setDraftState({ ...draft, tz: event.target.value })}
                className="w-full bg-white"
              >
                {TIMEZONE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy}>Áp dụng</Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setErrorText(null);
                  void submitFilter(null);
                }}
              >
                <RotateCcw className="size-4" />
                Mặc định
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Chọn nhanh:</span>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("today")}>Hôm nay</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("7d")}>7 ngày</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("30d")}>30 ngày</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("month")}>Tháng này</Button>
          </div>

          {errorText && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorText}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_.6fr]">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>Doanh thu theo ngày ({effectiveFrom} → {effectiveTo})</CardTitle>
            <CardDescription>
              Thực thu hóa đơn PAID theo múi giờ {effectiveTz}; phân tách tỷ trọng tiền bàn và sản phẩm/dịch vụ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-64 items-end gap-2 overflow-x-auto pb-2">
              {revenue.length ? (
                revenue.map((item) => {
                  const dayGross = Math.max(1, Number(item.table_revenue ?? 0) + Number(item.service_revenue ?? 0));
                  return (
                    <div key={item.day} className="group flex h-full min-w-8 flex-1 flex-col justify-end gap-1">
                      <div
                        className="relative flex min-h-1 flex-col justify-end overflow-hidden rounded-t-lg bg-emerald-100"
                        style={{ height: `${Math.max(4, (Number(item.revenue ?? 0) / maxRevenue) * 100)}%` }}
                        title={`${item.day}: ${money(item.revenue)} (${item.invoice_count ?? 0} HĐ)`}
                      >
                        <div className="bg-amber-400" style={{ height: `${(Number(item.service_revenue ?? 0) / dayGross) * 100}%` }} />
                        <div className="bg-emerald-600" style={{ height: `${(Number(item.table_revenue ?? 0) / dayGross) * 100}%` }} />
                      </div>
                      <span className="truncate text-center text-[10px] text-muted-foreground">{String(item.day).slice(5)}</span>
                    </div>
                  );
                })
              ) : (
                <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
                  Chưa có doanh thu trong kỳ đã chọn
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-4 text-xs">
              <span className="flex items-center gap-2"><i className="size-2.5 rounded-full bg-emerald-600" />Tiền bàn</span>
              <span className="flex items-center gap-2"><i className="size-2.5 rounded-full bg-amber-400" />Dịch vụ</span>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle>Cơ cấu kỳ này</CardTitle>
            <CardDescription>{invoiceCount} hóa đơn đã thanh toán hoàn tất</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm text-muted-foreground">Tổng doanh thu thực thu (PAID)</p>
              <p className="mt-1 text-3xl font-semibold">{money(netRevenue)}</p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span>Tiền bàn gộp ({money(tableRevenue)})</span>
                  <span>{grossRevenue ? Math.round((tableRevenue / grossRevenue) * 100) : 0}%</span>
                </div>
                <Progress value={grossRevenue ? (tableRevenue / grossRevenue) * 100 : 0} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span>Sản phẩm / dịch vụ gộp ({money(serviceRevenue)})</span>
                  <span>{grossRevenue ? Math.round((serviceRevenue / grossRevenue) * 100) : 0}%</span>
                </div>
                <Progress value={grossRevenue ? (serviceRevenue / grossRevenue) * 100 : 0} />
              </div>
              <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Giảm giá &amp; ưu đãi hội viên</span>
                  <span className="font-medium text-rose-600">-{money(discountAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phụ thu</span>
                  <span className="font-medium text-emerald-700">+{money(surchargeAmount)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <ReportTable
          title="Hiệu suất bàn (đã trừ thời gian tạm dừng)"
          columns={["Bàn", "Số phiên", "Thời gian tính phí", "Doanh thu bàn"]}
          rows={((safeReport.tables ?? []) as Row[]).map((item) => [
            item.name,
            item.session_count,
            `${Math.round(Number(item.minutes ?? 0))} phút`,
            money(item.revenue),
          ])}
        />
        <ReportTable
          title="Sản phẩm / dịch vụ bán chạy"
          columns={["Sản phẩm", "Số lượng", "Doanh thu"]}
          rows={((safeReport.products ?? []) as Row[]).map((item) => [item.name, item.quantity, money(item.revenue)])}
        />
        <ReportTable
          title="Nhập - xuất - tồn trong kỳ"
          columns={["Hàng hóa", "Nhập", "Xuất", "Điều chỉnh", "Tồn hiện tại"]}
          rows={((safeReport.inventory ?? []) as Row[]).map((item) => [
            item.name,
            item.imported,
            item.exported,
            item.adjusted ?? 0,
            item.stock_quantity,
          ])}
        />
      </div>
    </>
  );
}

function ReportTable({ title, columns, rows }: { title: string; columns: string[]; rows: any[][] }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b px-5 py-4"><h3 className="font-semibold">{title}</h3></div>
      <Table>
        <TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row, index) => <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}</TableRow>)
          ) : (
            <TableRow><TableCell colSpan={columns.length} className="h-28 text-center text-muted-foreground">Chưa có dữ liệu</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
