"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { apiFetch } from "@/lib/clientApi";

interface FeeRow {
  id: string;
  amount: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  due_date: string | null;
  payment_mode: string | null;
  reference_number: string | null;
  receipt_number: string | null;
  generated_at: string;
}

interface ReceiptRow {
  id: string;
  fee_id: string;
  receipt_number: string | null;
  amount: number;
  payment_mode: string;
  reference_number: string | null;
  paid_at: string;
}

interface FeesResponse {
  fees: FeeRow[];
  receipts: ReceiptRow[];
}

export default function StudentFeesPage() {
  const [data, setData] = useState<FeesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const resp = await apiFetch<FeesResponse>("/api/student/fees");
      setData(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load fees");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const stats = useMemo(() => {
    const total = data?.fees.reduce((sum, f) => sum + (f.amount ?? 0), 0) ?? 0;
    const paid = data?.fees.reduce((sum, f) => sum + (f.paid_amount ?? 0), 0) ?? 0;
    const due = data?.fees.reduce((sum, f) => sum + (f.due_amount ?? 0), 0) ?? 0;
    return [
      { label: "Total", value: `INR ${total.toLocaleString()}`, trend: "All fees" },
      { label: "Paid", value: `INR ${paid.toLocaleString()}`, trend: "Recorded receipts" },
      { label: "Due", value: `INR ${due.toLocaleString()}`, trend: "Pending" },
    ];
  }, [data]);

  const receiptByFee = useMemo(() => {
    const map = new Map<string, ReceiptRow[]>();
    (data?.receipts ?? []).forEach((r) => {
      const arr = map.get(r.fee_id) ?? [];
      arr.push(r);
      map.set(r.fee_id, arr);
    });
    return map;
  }, [data]);

  const outstanding = useMemo(() => (data?.fees ?? []).filter((fee) => fee.status !== "Paid" && Number(fee.due_amount) > 0), [data]);

  const paymentHistory = useMemo(() => {
    return [...(data?.receipts ?? [])].sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
  }, [data]);

  const handlePayNow = (feeId: string) => {
    setPayingId(feeId);
    window.setTimeout(() => {
      toast("Redirect to payment gateway is pending backend integration.");
      setPayingId(null);
    }, 300);
  };

  const handleDownloadReceipt = (receipt: ReceiptRow) => {
    const content = `Receipt ${receipt.receipt_number ?? receipt.id}\nAmount: INR ${receipt.amount}\nMode: ${receipt.payment_mode}\nRef: ${receipt.reference_number ?? "N/A"}\nPaid at: ${new Date(receipt.paid_at).toLocaleString()}`;
    const blob = new Blob([content], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${receipt.receipt_number ?? receipt.id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
      </div>
      <SectionCard title="Outstanding dues" description="Installments awaiting payment">
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <div className="space-y-3 text-sm">
          {outstanding.map((fee) => (
            <div key={fee.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">Fee #{fee.id.slice(0, 8)}</p>
                  <p className="text-slate-600">Due date: {fee.due_date ? new Date(fee.due_date).toLocaleDateString() : "—"}</p>
                  <p className="text-rose-700">Due: INR {Number(fee.due_amount).toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Generated {new Date(fee.generated_at).toLocaleDateString()}</p>
                </div>
                <button
                  onClick={() => handlePayNow(fee.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white"
                  disabled={payingId === fee.id}
                >
                  {payingId === fee.id ? "Opening gateway..." : "Pay Now"}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Mode: {fee.payment_mode ?? "—"} · Ref: {fee.reference_number ?? "—"} · Receipt: {fee.receipt_number ?? "—"}</p>
            </div>
          ))}
          {outstanding.length === 0 ? <p className="text-xs text-slate-600">No pending dues. Great job!</p> : null}
        </div>
      </SectionCard>

      <SectionCard title="All fee records" description="Paid and pending installments">
        <div className="space-y-3 text-sm">
          {(data?.fees ?? []).map((fee) => (
            <div key={fee.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">Fee #{fee.id.slice(0, 8)}</p>
                  <p className="text-slate-600">Status: {fee.status}</p>
                  <p className="text-slate-600">Due date: {fee.due_date ? new Date(fee.due_date).toLocaleDateString() : "—"}</p>
                  <p className="text-emerald-700">Paid: INR {Number(fee.paid_amount).toLocaleString()}</p>
                  <p className="text-rose-700">Due: INR {Number(fee.due_amount).toLocaleString()}</p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <p>Mode: {fee.payment_mode ?? "—"}</p>
                  <p>Ref: {fee.reference_number ?? "—"}</p>
                  <p>Receipt: {fee.receipt_number ?? "—"}</p>
                </div>
              </div>
              {receiptByFee.get(fee.id)?.length ? (
                <div className="mt-2 space-y-1 text-xs text-slate-700">
                  {receiptByFee.get(fee.id)!.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <p>INR {r.amount} via {r.payment_mode} · Ref {r.reference_number ?? "—"} · Receipt {r.receipt_number ?? "—"}</p>
                      <button onClick={() => handleDownloadReceipt(r)} className="rounded-md bg-slate-900 px-2 py-1 text-white">Download PDF</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Payment history" description="All receipts">
        <div className="space-y-2 text-sm text-slate-700">
          {paymentHistory.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div>
                <p className="font-semibold text-slate-900">Receipt {r.receipt_number ?? r.id.slice(0, 8)}</p>
                <p>INR {Number(r.amount).toLocaleString()} via {r.payment_mode}</p>
                <p className="text-xs text-slate-500">Ref {r.reference_number ?? "—"}</p>
              </div>
              <div className="text-right text-xs text-slate-600">
                <p>{new Date(r.paid_at).toLocaleString()}</p>
                <button onClick={() => handleDownloadReceipt(r)} className="mt-2 rounded-md bg-slate-900 px-2 py-1 text-white">Download PDF</button>
              </div>
            </div>
          ))}
          {paymentHistory.length === 0 ? <p className="text-xs text-slate-600">No receipts found.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
