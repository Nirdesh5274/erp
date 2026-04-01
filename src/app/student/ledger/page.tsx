"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { StatCard } from "@/components/ui/StatCard";
import { apiFetch } from "@/lib/clientApi";

interface StudentLedgerResponse {
  student: {
    id: string;
    admission_id: string | null;
    name: string;
    email: string;
  };
  fees: Array<{
    id: string;
    currency: string;
    base_total: number;
    discount_total: number;
    fine_total: number;
    extra_total: number;
    grand_total: number;
    paid_total: number;
    due_total: number;
    status: string;
    due_date: string | null;
    generated_at: string;
  }>;
  feeItems: Array<{
    id: string;
    student_fee_id: string;
    item_type: "component" | "discount" | "fine" | "extra";
    label: string;
    amount: number;
    quantity: number;
    created_at: string;
  }>;
  payments: Array<{
    id: string;
    student_fee_id: string;
    amount: number;
    payment_mode: string;
    transaction_id: string | null;
    receipt_number: string | null;
    paid_at: string;
  }>;
  receipts: Array<{
    id: string;
    payment_id: string;
    student_fee_id: string;
    file_url: string | null;
    storage_path: string | null;
    created_at: string;
  }>;
}

export default function StudentLedgerPage() {
  const [data, setData] = useState<StudentLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<StudentLedgerResponse>("/api/student/ledger");
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const feeItemsByFee = useMemo(() => {
    const map = new Map<string, StudentLedgerResponse["feeItems"]>();
    (data?.feeItems ?? []).forEach((item) => {
      const list = map.get(item.student_fee_id) ?? [];
      list.push(item);
      map.set(item.student_fee_id, list);
    });
    return map;
  }, [data?.feeItems]);

  const paymentsByFee = useMemo(() => {
    const map = new Map<string, StudentLedgerResponse["payments"]>();
    (data?.payments ?? []).forEach((payment) => {
      const list = map.get(payment.student_fee_id) ?? [];
      list.push(payment);
      map.set(payment.student_fee_id, list);
    });
    return map;
  }, [data?.payments]);

  const receiptByPaymentId = useMemo(() => {
    const map = new Map<string, StudentLedgerResponse["receipts"][number]>();
    (data?.receipts ?? []).forEach((receipt) => {
      map.set(receipt.payment_id, receipt);
    });
    return map;
  }, [data?.receipts]);

  const totals = useMemo(() => {
    return (data?.fees ?? []).reduce(
      (acc, fee) => {
        acc.grand += Number(fee.grand_total ?? 0);
        acc.paid += Number(fee.paid_total ?? 0);
        acc.due += Number(fee.due_total ?? 0);
        return acc;
      },
      { grand: 0, paid: 0, due: 0 },
    );
  }, [data?.fees]);

  if (loading && !data && !error) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Charges" value={`INR ${totals.grand.toLocaleString()}`} trend="All generated fees" />
        <StatCard label="Total Paid" value={`INR ${totals.paid.toLocaleString()}`} trend="Recorded payments" />
        <StatCard label="Total Due" value={`INR ${totals.due.toLocaleString()}`} trend="Outstanding balance" />
      </div>

      <SectionCard title="Student Ledger" description="Complete fee statement with line items and receipts">
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">{data?.student.name ?? "Student"}</p>
          <p>{data?.student.email ?? "N/A"}</p>
          <p>Admission: {data?.student.admission_id ?? "N/A"}</p>
        </div>

        <div className="space-y-4 text-sm">
          {(data?.fees ?? []).map((fee) => {
            const items = feeItemsByFee.get(fee.id) ?? [];
            const payments = paymentsByFee.get(fee.id) ?? [];

            return (
              <div key={fee.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">Fee #{fee.id.slice(0, 8)}</p>
                    <p className="text-slate-600">Generated: {new Date(fee.generated_at).toLocaleDateString()}</p>
                    <p className="text-slate-600">Due date: {fee.due_date ? new Date(fee.due_date).toLocaleDateString() : "-"}</p>
                    <p className="text-xs text-slate-500">Status: {fee.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-700">Grand: INR {Number(fee.grand_total).toLocaleString()}</p>
                    <p className="text-emerald-700">Paid: INR {Number(fee.paid_total).toLocaleString()}</p>
                    <p className="text-rose-700">Due: INR {Number(fee.due_total).toLocaleString()}</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <p className="mb-1 font-semibold text-slate-800">Line items</p>
                    {items.map((item) => (
                      <p key={item.id}>
                        {item.label} ({item.item_type}): INR {Number(item.amount).toLocaleString()}
                      </p>
                    ))}
                    {items.length === 0 ? <p className="text-slate-500">No items</p> : null}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <p className="mb-1 font-semibold text-slate-800">Payments</p>
                    {payments.map((payment) => {
                      const receipt = receiptByPaymentId.get(payment.id);
                      return (
                        <div key={payment.id} className="mb-2 last:mb-0">
                          <p>
                            INR {Number(payment.amount).toLocaleString()} via {payment.payment_mode} on {new Date(payment.paid_at).toLocaleDateString()}
                          </p>
                          <p className="text-slate-500">Ref: {payment.transaction_id ?? "-"} · Receipt: {payment.receipt_number ?? "-"}</p>
                          {receipt ? (
                            <button
                              onClick={() => window.open(`/api/fees/receipt/${receipt.id}`, "_blank", "noopener,noreferrer")}
                              className="mt-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white"
                            >
                              Download receipt
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    {payments.length === 0 ? <p className="text-slate-500">No payments</p> : null}
                  </div>
                </div>
              </div>
            );
          })}

          {(data?.fees.length ?? 0) === 0 ? <p className="text-xs text-slate-600">No fee ledger records found.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
