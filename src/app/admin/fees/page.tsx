"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CreditCard,
  Download,
  IndianRupee,
  Search,
  UserRound,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface SlotRow {
  id: string;
  course: string;
}

interface SlotStudentSummary {
  id: string;
  name: string;
  email: string;
  admissionId: string | null;
  totalDue: number;
  totalPaid: number;
  feesCount: number;
}

interface StudentFeeRow {
  id: string;
  studentId: string;
  structureId: string | null;
  structureName: string;
  structureDescription: string | null;
  academicYear: string | null;
  baseTotal: number;
  discountTotal: number;
  fineTotal: number;
  extraTotal: number;
  grandTotal: number;
  paidTotal: number;
  dueTotal: number;
  status: string;
  dueDate: string | null;
  generatedAt: string;
}

interface StudentFeeItem {
  id: string;
  student_fee_id: string;
  item_type: string;
  label: string;
  amount: number;
}

interface PaymentRow {
  id: string;
  student_fee_id: string;
  amount: number;
  payment_mode: string;
  transaction_id: string | null;
  receipt_number: string | null;
  paid_at: string;
}

interface ReceiptRow {
  id: string;
  payment_id: string;
  student_fee_id: string;
  created_at: string;
}

interface SlotFeesResponse {
  slot: { id: string; course: string };
  students: SlotStudentSummary[];
}

interface StudentFeesResponse extends SlotFeesResponse {
  selectedStudent: {
    id: string;
    name: string;
    email: string;
    admissionId: string | null;
  };
  fees: StudentFeeRow[];
  feeItems: StudentFeeItem[];
  payments: PaymentRow[];
  receipts: ReceiptRow[];
}

interface ReportsSummary {
  transactionsTodayCount: number;
  transactionsTodayAmount: number;
  recentTransactions: Array<{
    id: string;
    amount: number;
    paymentMode: string;
    referenceNumber: string | null;
    paidAt: string;
  }>;
}

const money = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

function studentStatus(student: SlotStudentSummary) {
  if (student.totalDue <= 0) return "Paid";
  if (student.totalPaid > 0) return "Partial";
  return "Pending";
}

function StudentListPanel({
  students,
  selectedStudentId,
  onSelect,
}: {
  students: SlotStudentSummary[];
  selectedStudentId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-900">Students</p>
      <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
        {students.map((student) => {
          const isSelected = selectedStudentId === student.id;
          const status = studentStatus(student);
          return (
            <button
              key={student.id}
              onClick={() => onSelect(student.id)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                isSelected ? "border-emerald-300 bg-emerald-50/70" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{student.name}</p>
                  <p className="truncate text-xs text-slate-600">{student.admissionId ?? "No admission"}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    status === "Paid"
                      ? "bg-emerald-100 text-emerald-700"
                      : status === "Partial"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {status}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="truncate text-xs text-slate-500">{student.email}</p>
                <p className="text-xs font-semibold text-rose-600">Due {money(student.totalDue)}</p>
              </div>
            </button>
          );
        })}
        {students.length === 0 ? <p className="text-xs text-slate-500">No students found.</p> : null}
      </div>
    </section>
  );
}

function SummaryCards({
  totalFees,
  paid,
  due,
  fine,
}: {
  totalFees: number;
  paid: number;
  due: number;
  fine: number;
}) {
  const cards = [
    { label: "Total Fees", value: totalFees, icon: Wallet, text: "text-slate-900" },
    { label: "Paid", value: paid, icon: IndianRupee, text: "text-emerald-700" },
    { label: "Due", value: due, icon: AlertTriangle, text: "text-rose-700" },
    { label: "Late Fine", value: fine, icon: CalendarDays, text: "text-amber-700" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">{card.label}</p>
            <card.icon size={16} className="text-slate-400" />
          </div>
          <p className={`mt-2 text-lg font-bold ${card.text}`}>{money(card.value)}</p>
        </article>
      ))}
    </div>
  );
}

export default function AdminFeesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const [slotStudents, setSlotStudents] = useState<SlotStudentSummary[]>([]);
  const [studentDetails, setStudentDetails] = useState<StudentFeesResponse | null>(null);
  const [reportsSummary, setReportsSummary] = useState<ReportsSummary | null>(null);

  const [payingFeeId, setPayingFeeId] = useState("");
  const [paymentAmountByFee, setPaymentAmountByFee] = useState<Record<string, number>>({});
  const [paymentModeByFee, setPaymentModeByFee] = useState<Record<string, string>>({});
  const [transactionIdByFee, setTransactionIdByFee] = useState<Record<string, string>>({});
  const [receiptNoByFee, setReceiptNoByFee] = useState<Record<string, string>>({});

  const [adjustingFeeId, setAdjustingFeeId] = useState("");
  const [adjustLabelByFee, setAdjustLabelByFee] = useState<Record<string, string>>({});
  const [adjustTypeByFee, setAdjustTypeByFee] = useState<Record<string, "discount" | "fine" | "extra">>({});
  const [adjustAmountByFee, setAdjustAmountByFee] = useState<Record<string, number>>({});

  const loadSlots = async () => {
    const data = await apiFetch<SlotRow[]>("/api/admin/slots");
    setSlots(data);
    if (!selectedSlotId && data.length > 0) setSelectedSlotId(data[0].id);
  };

  const loadSlotStudents = async (slotId: string) => {
    if (!slotId) return setSlotStudents([]);
    const data = await apiFetch<SlotFeesResponse>(`/api/admin/student-fees?slotId=${slotId}`);
    setSlotStudents(data.students);
  };

  const loadStudentDetails = async (slotId: string, studentId: string) => {
    if (!slotId || !studentId) return setStudentDetails(null);
    const data = await apiFetch<StudentFeesResponse>(`/api/admin/student-fees?slotId=${slotId}&studentId=${studentId}`);
    setStudentDetails(data);
  };

  const loadReportsSummary = async () => {
    const data = await apiFetch<ReportsSummary>("/api/admin/reports");
    setReportsSummary(data);
  };

  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all([loadSlots(), loadReportsSummary()]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load fee dashboard");
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!selectedSlotId) return;
      setError("");
      try {
        await loadSlotStudents(selectedSlotId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load students");
      }
    };
    void run();
  }, [selectedSlotId]);

  const studentsForUI = slotStudents;

  useEffect(() => {
    if (!selectedStudentId && studentsForUI.length > 0) {
      setSelectedStudentId(studentsForUI[0].id);
    }
  }, [selectedStudentId, studentsForUI]);

  useEffect(() => {
    const run = async () => {
      if (!selectedSlotId || !selectedStudentId) return;
      if (!slotStudents.some((student) => student.id === selectedStudentId)) return;
      setError("");
      try {
        await loadStudentDetails(selectedSlotId, selectedStudentId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load student details");
      }
    };
    void run();
  }, [selectedSlotId, selectedStudentId, slotStudents]);

  const feeItemsByFeeId = useMemo(() => {
    const map = new Map<string, StudentFeeItem[]>();
    for (const item of studentDetails?.feeItems ?? []) {
      const bucket = map.get(item.student_fee_id) ?? [];
      bucket.push(item);
      map.set(item.student_fee_id, bucket);
    }
    return map;
  }, [studentDetails?.feeItems]);

  const paymentsByFeeId = useMemo(() => {
    const map = new Map<string, PaymentRow[]>();
    for (const payment of studentDetails?.payments ?? []) {
      const bucket = map.get(payment.student_fee_id) ?? [];
      bucket.push(payment);
      map.set(payment.student_fee_id, bucket);
    }
    return map;
  }, [studentDetails?.payments]);

  const receiptByPaymentId = useMemo(() => {
    const map = new Map<string, ReceiptRow>();
    for (const receipt of studentDetails?.receipts ?? []) {
      map.set(receipt.payment_id, receipt);
    }
    return map;
  }, [studentDetails?.receipts]);

  const feesForUI = studentDetails?.fees ?? [];
  const itemsForUI = feeItemsByFeeId;
  const paymentsForUI = paymentsByFeeId;
  const receiptMapForUI = receiptByPaymentId;

  const totalPaidInSlot = useMemo(() => studentsForUI.reduce((sum, row) => sum + Number(row.totalPaid ?? 0), 0), [studentsForUI]);
  const totalDueInSlot = useMemo(() => studentsForUI.reduce((sum, row) => sum + Number(row.totalDue ?? 0), 0), [studentsForUI]);

  const filteredStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return studentsForUI;
    return studentsForUI.filter((student) => {
      return (
        student.name.toLowerCase().includes(q)
        || student.email.toLowerCase().includes(q)
        || (student.admissionId ?? "").toLowerCase().includes(q)
      );
    });
  }, [studentsForUI, searchTerm]);

  const targetFee = useMemo(() => feesForUI.find((fee) => fee.dueTotal > 0) ?? feesForUI[0] ?? null, [feesForUI]);

  const summary = useMemo(() => {
    return feesForUI.reduce(
      (acc, fee) => {
        acc.total += fee.grandTotal;
        acc.paid += fee.paidTotal;
        acc.due += fee.dueTotal;
        acc.fine += fee.fineTotal;
        return acc;
      },
      { total: 0, paid: 0, due: 0, fine: 0 },
    );
  }, [feesForUI]);

  const breakdownRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const fee of feesForUI) {
      for (const item of itemsForUI.get(fee.id) ?? []) {
        if (item.item_type === "discount") continue;
        map.set(item.label, (map.get(item.label) ?? 0) + Number(item.amount ?? 0));
      }
    }
    return Array.from(map.entries()).map(([label, amount]) => ({ label, amount }));
  }, [feesForUI, itemsForUI]);

  const transactionRows = useMemo(() => {
    const list = feesForUI.flatMap((fee) => {
      return (paymentsForUI.get(fee.id) ?? []).map((payment) => ({
        id: payment.id,
        feeId: fee.id,
        amount: payment.amount,
        mode: payment.payment_mode,
        paidAt: payment.paid_at,
        receiptNumber: payment.receipt_number,
        transactionId: payment.transaction_id,
        receiptId: receiptMapForUI.get(payment.id)?.id ?? null,
      }));
    });

    const filteredByDate = dateFilter
      ? list.filter((tx) => new Date(tx.paidAt).toISOString().slice(0, 10) === dateFilter)
      : list;

    return filteredByDate.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
  }, [feesForUI, paymentsForUI, receiptMapForUI, dateFilter]);

  const refreshActiveViews = async () => {
    if (!selectedSlotId) return;
    await Promise.all([
      loadSlotStudents(selectedSlotId),
      loadReportsSummary(),
      selectedStudentId && slotStudents.some((student) => student.id === selectedStudentId)
        ? loadStudentDetails(selectedSlotId, selectedStudentId)
        : Promise.resolve(),
    ]);
  };

  const recordPayment = async () => {
    if (!targetFee) return;

    const feeId = targetFee.id;
    const amount = Number(paymentAmountByFee[feeId] ?? 0);
    if (amount <= 0) return toast.error("Enter a valid payment amount");

    setPayingFeeId(feeId);
    setError("");
    try {
      await apiFetch("/api/admin/payments", {
        method: "POST",
        body: JSON.stringify({
          studentFeeId: feeId,
          amount,
          paymentMode: paymentModeByFee[feeId] || "Cash",
          transactionId: transactionIdByFee[feeId] || undefined,
          receiptNumber: receiptNoByFee[feeId] || undefined,
        }),
      });
      await refreshActiveViews();
      setPaymentAmountByFee((prev) => ({ ...prev, [feeId]: 0 }));
      setTransactionIdByFee((prev) => ({ ...prev, [feeId]: "" }));
      setReceiptNoByFee((prev) => ({ ...prev, [feeId]: "" }));
      toast.success("Payment recorded successfully");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to record payment";
      setError(message);
      toast.error(message);
    } finally {
      setPayingFeeId("");
    }
  };

  const applyAdjustment = async () => {
    if (!targetFee) return;

    const feeId = targetFee.id;
    const itemType = adjustTypeByFee[feeId] ?? "fine";
    const label = (adjustLabelByFee[feeId] ?? "").trim();
    const amount = Number(adjustAmountByFee[feeId] ?? 0);

    if (!label || amount <= 0) return toast.error("Adjustment label and amount are required");

    setAdjustingFeeId(feeId);
    setError("");
    try {
      await apiFetch(`/api/admin/student-fees/${feeId}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ feeId, itemType, label, amount }),
      });
      await refreshActiveViews();
      setAdjustLabelByFee((prev) => ({ ...prev, [feeId]: "" }));
      setAdjustAmountByFee((prev) => ({ ...prev, [feeId]: 0 }));
      toast.success("Adjustment applied");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to apply adjustment";
      setError(message);
      toast.error(message);
    } finally {
      setAdjustingFeeId("");
    }
  };

  const downloadReceipt = (receiptId: string | null) => {
    if (!receiptId) return toast.error("Receipt not available yet");
    window.open(`/api/fees/receipt/${receiptId}`, "_blank", "noopener,noreferrer");
  };

  if (loading && slots.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-5 pb-2">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Fees Management</h1>
            <p className="text-sm text-slate-600">Manage student fees, payments, and transactions</p>
            {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[560px]">
            <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">Collection Today</p>
              <p className="text-lg font-bold text-emerald-800">{money(reportsSummary?.transactionsTodayAmount ?? 0)}</p>
            </article>
            <article className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs text-rose-700">Total Due</p>
              <p className="text-lg font-bold text-rose-800">{money(totalDueInSlot)}</p>
            </article>
            <article className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs text-sky-700">Total Paid</p>
              <p className="text-lg font-bold text-sky-800">{money(totalPaidInSlot)}</p>
            </article>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-slate-600">
            Slot / Class
            <select
              value={selectedSlotId}
              onChange={(event) => {
                setSelectedSlotId(event.target.value);
                setSelectedStudentId("");
                setStudentDetails(null);
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
            >
              <option value="">Select slot</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>{slot.course}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-600 xl:col-span-2">
            Search student
            <div className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 focus-within:border-slate-400">
              <Search size={16} className="text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Student name / admission ID"
                className="w-full bg-transparent text-sm text-slate-800 outline-none"
              />
            </div>
          </label>

          <label className="text-xs text-slate-600">
            Date filter
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <StudentListPanel
            students={filteredStudents}
            selectedStudentId={selectedStudentId}
            onSelect={(id) => setSelectedStudentId(id)}
          />
        </div>

        <div className="space-y-4 xl:col-span-8">
          <SummaryCards
            totalFees={summary.total}
            paid={summary.paid}
            due={summary.due}
            fine={summary.fine}
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Fee Breakdown</p>
              <p className="text-xs text-slate-500">Component-wise totals</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Component</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((row) => (
                    <tr key={row.label} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{row.label}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{money(row.amount)}</td>
                    </tr>
                  ))}
                  {breakdownRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-xs text-slate-500" colSpan={2}>No fee items available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard size={16} className="text-slate-500" />
                <p className="text-sm font-semibold text-slate-900">Record Payment</p>
              </div>
              <p className="mb-2 text-xs text-slate-500">
                Target Fee: {targetFee ? `${targetFee.structureName} (${money(targetFee.dueTotal)} due)` : "No active fee"}
              </p>
              <div className="space-y-2">
                <input
                  type="number"
                  min={0}
                  value={targetFee ? (paymentAmountByFee[targetFee.id] ?? 0) : 0}
                  onChange={(event) => targetFee && setPaymentAmountByFee((prev) => ({ ...prev, [targetFee.id]: Number(event.target.value) }))}
                  placeholder="Amount"
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                />
                <select
                  value={targetFee ? (paymentModeByFee[targetFee.id] ?? "Cash") : "Cash"}
                  onChange={(event) => targetFee && setPaymentModeByFee((prev) => ({ ...prev, [targetFee.id]: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Online">Online</option>
                  <option value="Card">Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
                <input
                  value={targetFee ? (transactionIdByFee[targetFee.id] ?? "") : ""}
                  onChange={(event) => targetFee && setTransactionIdByFee((prev) => ({ ...prev, [targetFee.id]: event.target.value }))}
                  placeholder="Transaction ID"
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                />
                <input
                  value={targetFee ? (receiptNoByFee[targetFee.id] ?? "") : ""}
                  onChange={(event) => targetFee && setReceiptNoByFee((prev) => ({ ...prev, [targetFee.id]: event.target.value }))}
                  placeholder="Receipt number"
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                />
                <button
                  onClick={() => void recordPayment()}
                  disabled={!targetFee || payingFeeId === targetFee.id}
                  className="h-10 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {targetFee && payingFeeId === targetFee.id ? "Recording..." : "Record Payment"}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <CalendarDays size={16} className="text-slate-500" />
                <p className="text-sm font-semibold text-slate-900">Apply Adjustment</p>
              </div>
              <div className="space-y-2">
                <select
                  value={targetFee ? (adjustTypeByFee[targetFee.id] ?? "fine") : "fine"}
                  onChange={(event) => targetFee && setAdjustTypeByFee((prev) => ({ ...prev, [targetFee.id]: event.target.value as "discount" | "fine" | "extra" }))}
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                >
                  <option value="fine">Late Fine</option>
                  <option value="discount">Discount</option>
                  <option value="extra">Extra Charge</option>
                </select>
                <input
                  value={targetFee ? (adjustLabelByFee[targetFee.id] ?? "") : ""}
                  onChange={(event) => targetFee && setAdjustLabelByFee((prev) => ({ ...prev, [targetFee.id]: event.target.value }))}
                  placeholder="Label"
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                />
                <input
                  type="number"
                  min={0}
                  value={targetFee ? (adjustAmountByFee[targetFee.id] ?? 0) : 0}
                  onChange={(event) => targetFee && setAdjustAmountByFee((prev) => ({ ...prev, [targetFee.id]: Number(event.target.value) }))}
                  placeholder="Amount"
                  className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-400"
                  disabled={!targetFee}
                />
                <button
                  onClick={() => void applyAdjustment()}
                  disabled={!targetFee || adjustingFeeId === targetFee.id}
                  className="h-10 w-full rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {targetFee && adjustingFeeId === targetFee.id ? "Applying..." : "Apply"}
                </button>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Transaction History</p>
              <button
                onClick={() => void loadReportsSummary()}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2">
              {transactionRows.slice(0, 10).map((tx) => (
                <article key={tx.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{money(tx.amount)} · {tx.mode}</p>
                    <p className="text-xs text-slate-600">{new Date(tx.paidAt).toLocaleString()} · Receipt {tx.receiptNumber ?? "-"}</p>
                    <p className="text-xs text-slate-500">Ref: {tx.transactionId ?? "-"}</p>
                  </div>
                  <button
                    onClick={() => downloadReceipt(tx.receiptId)}
                    className="inline-flex items-center gap-1 self-start rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <Download size={13} /> Receipt
                  </button>
                </article>
              ))}
              {transactionRows.length === 0 ? <p className="text-xs text-slate-500">No transactions available.</p> : null}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Recent day-close feed</p>
              <div className="mt-2 space-y-1">
                {(reportsSummary?.recentTransactions ?? []).slice(0, 5).map((tx) => (
                  <p key={tx.id} className="text-xs text-slate-700">
                    <span className="font-semibold">{money(tx.amount)}</span> via {tx.paymentMode} at {new Date(tx.paidAt).toLocaleString()}
                  </p>
                ))}
                {(reportsSummary?.recentTransactions?.length ?? 0) === 0 ? <p className="text-xs text-slate-500">No recent transactions found.</p> : null}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
