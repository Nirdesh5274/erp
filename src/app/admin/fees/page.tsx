"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface FeeRow {
  id: string;
  amount: number;
  paidAmount: number;
  dueAmount: number;
  status: "Paid" | "Pending";
  generatedAt: string;
  studentId: string | null;
  dueDate?: string | null;
  lastReminderAt?: string | null;
  paymentMode?: string | null;
  referenceNumber?: string | null;
  receiptNumber?: string | null;
  studentName?: string | null;
  studentEmail?: string | null;
}

interface ReceiptRow {
  id: string;
  receipt_number: string | null;
  amount: number;
  payment_mode: string;
  reference_number: string | null;
  paid_at: string;
}

interface TemplateRow {
  id: string;
  academic_year: string;
  components: Array<{ name: string; amount: number }>;
  created_at: string;
}

interface StudentRow {
  id: string;
  name: string;
  email: string;
  department_id: string | null;
  slot_id: string | null;
  created_at: string;
}

export default function AdminFeesPage() {
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payingId, setPayingId] = useState("");
  const [amountById, setAmountById] = useState<Record<string, number>>({});
  const [paymentModeById, setPaymentModeById] = useState<Record<string, string>>({});
  const [referenceById, setReferenceById] = useState<Record<string, string>>({});
  const [receiptNoById, setReceiptNoById] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, ReceiptRow[]>>({});
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateYear, setTemplateYear] = useState("");
  const [templateComponents, setTemplateComponents] = useState<Array<{ name: string; amount: number }>>([
    { name: "Tuition", amount: 0 },
  ]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [generateStudentId, setGenerateStudentId] = useState("");
  const [generateTemplateId, setGenerateTemplateId] = useState("");
  const [generateDueDate, setGenerateDueDate] = useState("");
  const [generateGraceDays, setGenerateGraceDays] = useState(0);
  const [generating, setGenerating] = useState(false);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<FeeRow[]>("/api/admin/fees");
      setFees(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load fees");
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await apiFetch<TemplateRow[]>("/api/admin/fee-templates");
      setTemplates(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load templates");
    }
  };

  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      await Promise.all([load(), loadTemplates(), loadStudents()]);
    };

    void boot();
  }, []);

  const totals = useMemo(
    () =>
      fees.reduce(
        (acc, fee) => {
          acc.total += fee.amount;
          acc.paid += fee.paidAmount;
          acc.due += fee.dueAmount;
          return acc;
        },
        { total: 0, paid: 0, due: 0 },
      ),
    [fees],
  );

  const handlePay = async (feeId: string) => {
    const amount = amountById[feeId] ?? 0;
    if (amount <= 0) return;
    setPayingId(feeId);
    setError("");
    try {
      await apiFetch("/api/admin/fees/receipts", {
        method: "POST",
        body: JSON.stringify({
          feeId,
          amount,
          paymentMode: paymentModeById[feeId] || "Cash",
          referenceNumber: referenceById[feeId] || undefined,
          receiptNumber: receiptNoById[feeId] || undefined,
        }),
      });
      await Promise.all([load(), loadReceipts(feeId)]);
      toast.success("Payment recorded");
    } catch (payError) {
      const message = payError instanceof Error ? payError.message : "Unable to update fee";
      setError(message);
      toast.error(message);
    } finally {
      setPayingId("");
    }
  };

  const handleReminder = async (feeId: string) => {
    setError("");
    try {
      await apiFetch("/api/admin/fees", {
        method: "PATCH",
        body: JSON.stringify({ feeId, remind: true }),
      });
      await load();
      toast.success("Reminder sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send reminder";
      setError(message);
      toast.error(message);
    }
  };

  const loadReceipts = async (feeId: string) => {
    try {
      const data = await apiFetch<ReceiptRow[]>(`/api/admin/fees/receipts?feeId=${feeId}`);
      setReceipts((prev) => ({ ...prev, [feeId]: data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load receipts");
    }
  };

  const addTemplateComponent = () => {
    setTemplateComponents((prev) => [...prev, { name: "New Component", amount: 0 }]);
  };

  const saveTemplate = async () => {
    setError("");
    try {
      await apiFetch("/api/admin/fee-templates", {
        method: "POST",
        body: JSON.stringify({
          name: templateName || `Template ${new Date().toISOString()}`,
          academicYear: templateYear || "2024-2025",
          components: templateComponents,
        }),
      });
      setTemplateName("");
      setTemplateYear("");
      setTemplateComponents([{ name: "Tuition", amount: 0 }]);
      await loadTemplates();
      toast.success("Template saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save template";
      setError(message);
      toast.error(message);
    }
  };

  const loadStudents = async () => {
    try {
      const data = await apiFetch<StudentRow[]>("/api/admin/students");
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load students");
    }
  };

  const generateFee = async () => {
    if (!generateStudentId || !generateTemplateId) return;
    setGenerating(true);
    setError("");
    try {
      await apiFetch("/api/admin/fees/generate", {
        method: "POST",
        body: JSON.stringify({
          studentId: generateStudentId,
          templateId: generateTemplateId,
          dueDate: generateDueDate || undefined,
          graceDays: generateGraceDays || 0,
        }),
      });
      setGenerateStudentId("");
      setGenerateTemplateId("");
      setGenerateDueDate("");
      setGenerateGraceDays(0);
      await load();
      toast.success("Fee generated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to generate fee";
      setError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading && fees.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <SectionCard title="Fees" description="Fee collection, payment update, and pending dues">
      <div className="mb-4 grid gap-3 text-sm md:grid-cols-3">
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3">Total: INR {totals.total.toLocaleString()}</p>
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-teal-700">Paid: INR {totals.paid.toLocaleString()}</p>
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-rose-700">Due: INR {totals.due.toLocaleString()}</p>
      </div>
      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}


      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-800">Generate Fee from Template</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={generateStudentId}
              onChange={(e) => setGenerateStudentId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select student</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
            <select
              value={generateTemplateId}
              onChange={(e) => setGenerateTemplateId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select template</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.academic_year} · {tpl.components.length} components
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              type="date"
              value={generateDueDate}
              onChange={(e) => setGenerateDueDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              value={generateGraceDays}
              onChange={(e) => setGenerateGraceDays(Number(e.target.value))}
              placeholder="Grace days"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() => void generateFee()}
              disabled={!generateStudentId || !generateTemplateId || generating}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {generating ? "Generating..." : "Generate fee"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Creates a pending installment with template components.</p>
        </div>

       <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
         <p className="mb-3 text-sm font-semibold text-slate-800">Create Fee Template</p>
         <div className="grid gap-3 md:grid-cols-3">
           <input
             value={templateName}
             onChange={(e) => setTemplateName(e.target.value)}
             placeholder="Template name"
             className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
           />
           <input
             value={templateYear}
             onChange={(e) => setTemplateYear(e.target.value)}
             placeholder="Academic year"
             className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
           />
         </div>
         <div className="mt-3 space-y-2">
           {templateComponents.map((comp, idx) => (
             <div key={idx} className="grid gap-2 md:grid-cols-2">
               <input
                 value={comp.name}
                 onChange={(e) => setTemplateComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c)))}
                 placeholder="Component name"
                 className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
               />
               <input
                 type="number"
                 value={comp.amount}
                 onChange={(e) => setTemplateComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, amount: Number(e.target.value) } : c)))}
                 placeholder="Amount"
                 className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
               />
             </div>
           ))}
           <div className="flex items-center gap-2 text-sm">
             <button onClick={addTemplateComponent} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100">
               Add component
             </button>
             <button onClick={() => void saveTemplate()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
               Save template
             </button>
           </div>
         </div>
         {templates.length ? (
           <p className="mt-3 text-xs text-slate-500">{templates.length} templates saved.</p>
         ) : null}
       </div>

      </div>

      <div className="space-y-3">
        {fees.map((fee) => (
          <div key={fee.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-900">
              {fee.studentName ?? studentById.get(fee.studentId ?? "")?.name ?? "Unknown student"}
            </p>
            <p className="text-xs text-slate-600">
              {fee.studentEmail ?? studentById.get(fee.studentId ?? "")?.email ?? "No email"}
            </p>
            <p className="font-semibold text-slate-800">Fee #{fee.id.slice(0, 8)}</p>
            <p className="text-slate-600">Generated: {new Date(fee.generatedAt).toLocaleDateString()}</p>
            <p className="text-slate-600">Due date: {fee.dueDate ? new Date(fee.dueDate).toLocaleDateString() : "—"}</p>
            <p className="text-teal-700">Paid: INR {fee.paidAmount.toLocaleString()}</p>
            <p className="text-rose-700">Due: INR {fee.dueAmount.toLocaleString()}</p>
            <p className="text-xs text-slate-500">Payment mode: {fee.paymentMode ?? "—"} · Ref: {fee.referenceNumber ?? "—"} · Receipt: {fee.receiptNumber ?? "—"}</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
              <input
                type="number"
                min={0}
                max={fee.dueAmount}
                value={amountById[fee.id] ?? 0}
                onChange={(e) => setAmountById((prev) => ({ ...prev, [fee.id]: Number(e.target.value) }))}
                className="rounded-lg border border-slate-300 px-3 py-1"
                placeholder="Payment amount"
              />
              <input
                value={paymentModeById[fee.id] ?? "Cash"}
                onChange={(e) => setPaymentModeById((prev) => ({ ...prev, [fee.id]: e.target.value }))}
                placeholder="Payment mode"
                className="rounded-lg border border-slate-300 px-3 py-1"
              />
              <input
                value={referenceById[fee.id] ?? ""}
                onChange={(e) => setReferenceById((prev) => ({ ...prev, [fee.id]: e.target.value }))}
                placeholder="Reference number"
                className="rounded-lg border border-slate-300 px-3 py-1"
              />
              <input
                value={receiptNoById[fee.id] ?? ""}
                onChange={(e) => setReceiptNoById((prev) => ({ ...prev, [fee.id]: e.target.value }))}
                placeholder="Receipt #"
                className="rounded-lg border border-slate-300 px-3 py-1"
              />
              <button
                onClick={() => void handlePay(fee.id)}
                disabled={payingId === fee.id || fee.dueAmount === 0}
                className="rounded-lg bg-teal-700 px-3 py-1 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {payingId === fee.id ? "Saving..." : "Record Payment"}
              </button>
              <button
                onClick={() => void handleReminder(fee.id)}
                className="rounded-lg border border-slate-300 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-100"
              >
                Send Reminder
              </button>
              <span className={fee.status === "Paid" ? "text-emerald-700" : "text-amber-700"}>{fee.status}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <button
                onClick={() => void loadReceipts(fee.id)}
                className="rounded-full border border-slate-200 px-3 py-1 font-semibold hover:bg-slate-100"
              >
                View receipts
              </button>
              <span>Last reminder: {fee.lastReminderAt ? new Date(fee.lastReminderAt).toLocaleString() : "—"}</span>
            </div>
            {receipts[fee.id]?.length ? (
              <div className="mt-2 space-y-1 text-xs text-slate-700">
                {receipts[fee.id].map((r) => (
                  <p key={r.id} className="rounded-lg bg-white px-3 py-2">
                    INR {r.amount} via {r.payment_mode} · Ref {r.reference_number ?? "—"} · Receipt {r.receipt_number ?? "—"} · {new Date(r.paid_at).toLocaleString()}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
