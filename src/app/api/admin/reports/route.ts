import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface FeeAggRow {
  amount: number | string;
  paid_amount: number | string;
  due_amount: number | string;
}

interface LectureIdRow {
  id: string;
}

interface AttendanceRow {
  status: string;
  lecture_id: string;
}

interface MonitorRow {
  status: "Occupied" | "Vacant";
}

interface ReceiptRow {
  id: string;
  amount: number | string;
  payment_mode: string | null;
  reference_number: string | null;
  paid_at: string;
  fee_id: string;
}

interface StudentFeeAggRow {
  grand_total: number | string;
  paid_total: number | string;
  due_total: number | string;
  status: string;
  generated_at: string;
}

interface V3PaymentRow {
  id: string;
  amount: number | string;
  payment_mode: string | null;
  transaction_id: string | null;
  paid_at: string;
  student_fee_id: string;
}

interface UnifiedTransaction {
  id: string;
  amount: number;
  paymentMode: string;
  referenceNumber: string | null;
  paidAt: string;
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "SuperAdmin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId && ctx.role !== "SuperAdmin") return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();

    const studentsQuery = supabase.from("students").select("id", { count: "exact", head: true });
    const feesQuery = supabase.from("fees").select("amount,paid_amount,due_amount");
    const attendanceQuery = supabase.from("attendance").select("status,lecture_id");
    const roomsQuery = supabase.from("rooms").select("id", { count: "exact", head: true });
    const monitorQuery = supabase.from("room_monitoring").select("status");
    const lectureIdsQuery = supabase.from("lectures").select("id");
    const receiptQuery = supabase
      .from("payment_receipts")
      .select("id,amount,payment_mode,reference_number,paid_at,fee_id")
      .order("paid_at", { ascending: false })
      .limit(300);
    const studentFeesV3Query = supabase
      .from("student_fees")
      .select("grand_total,paid_total,due_total,status,generated_at")
      .order("generated_at", { ascending: false })
      .limit(1000);
    const paymentsV3Query = supabase
      .from("payments")
      .select("id,amount,payment_mode,transaction_id,paid_at,student_fee_id")
      .order("paid_at", { ascending: false })
      .limit(300);

    const scopedStudentsQuery = ctx.collegeId ? studentsQuery.eq("college_id", ctx.collegeId) : studentsQuery;
    const scopedFeesQuery = ctx.collegeId ? feesQuery.eq("college_id", ctx.collegeId) : feesQuery;
    const scopedRoomsQuery = ctx.collegeId ? roomsQuery.eq("college_id", ctx.collegeId) : roomsQuery;
    const scopedMonitorQuery = ctx.collegeId ? monitorQuery.eq("college_id", ctx.collegeId) : monitorQuery;
    const scopedLectureIdsQuery = ctx.collegeId ? lectureIdsQuery.eq("college_id", ctx.collegeId) : lectureIdsQuery;
    const scopedStudentFeesV3Query = ctx.collegeId ? studentFeesV3Query.eq("college_id", ctx.collegeId) : studentFeesV3Query;
    const scopedPaymentsV3Query = ctx.collegeId ? paymentsV3Query.eq("college_id", ctx.collegeId) : paymentsV3Query;

    let scopedReceiptQuery: Promise<{ data: ReceiptRow[] | null; error: { message: string } | null }>;
    if (ctx.collegeId) {
      const { data: feeRows, error: feeIdError } = await supabase
        .from("fees")
        .select("id")
        .eq("college_id", ctx.collegeId);
      if (feeIdError) return apiError(feeIdError.message, 500);

      const feeIds = (feeRows ?? []).map((row) => row.id as string);
      if (feeIds.length === 0) {
        scopedReceiptQuery = Promise.resolve({ data: [], error: null });
      } else {
        scopedReceiptQuery = receiptQuery.in("fee_id", feeIds) as unknown as Promise<{
          data: ReceiptRow[] | null;
          error: { message: string } | null;
        }>;
      }
    } else {
      scopedReceiptQuery = receiptQuery as unknown as Promise<{ data: ReceiptRow[] | null; error: { message: string } | null }>;
    }

    const [
      studentsResponse,
      feesResponse,
      attendanceResponse,
      roomsResponse,
      monitorResponse,
      lectureIdsResponse,
      receiptResponse,
      studentFeesV3Response,
      paymentsV3Response,
    ] = await Promise.all([
      scopedStudentsQuery,
      scopedFeesQuery,
      attendanceQuery,
      scopedRoomsQuery,
      scopedMonitorQuery,
      scopedLectureIdsQuery,
      scopedReceiptQuery,
      scopedStudentFeesV3Query,
      scopedPaymentsV3Query,
    ]);

    if (studentsResponse.error) return apiError(studentsResponse.error.message, 500);
    if (feesResponse.error) return apiError(feesResponse.error.message, 500);
    if (attendanceResponse.error) return apiError(attendanceResponse.error.message, 500);
    if (roomsResponse.error) return apiError(roomsResponse.error.message, 500);
    if (monitorResponse.error) return apiError(monitorResponse.error.message, 500);
    if (lectureIdsResponse.error) return apiError(lectureIdsResponse.error.message, 500);
    if (receiptResponse.error) return apiError(receiptResponse.error.message, 500);
    if (studentFeesV3Response.error) return apiError(studentFeesV3Response.error.message, 500);
    if (paymentsV3Response.error) return apiError(paymentsV3Response.error.message, 500);

    const feeRows = (feesResponse.data ?? []) as FeeAggRow[];
    const totalRevenueLegacy = feeRows.reduce((sum, row) => sum + Number(row.paid_amount), 0);
    const totalDueLegacy = feeRows.reduce((sum, row) => sum + Number(row.due_amount), 0);

    const lectureIds = new Set(((lectureIdsResponse.data ?? []) as LectureIdRow[]).map((lecture) => lecture.id));
    const attendanceRows = ((attendanceResponse.data ?? []) as AttendanceRow[]).filter((row) => lectureIds.has(row.lecture_id));
    const present = attendanceRows.filter((row) => row.status === "Present").length;
    const attendancePercent = attendanceRows.length === 0 ? 0 : Math.round((present / attendanceRows.length) * 100);

    const monitoringRows = (monitorResponse.data ?? []) as MonitorRow[];
    const occupied = monitoringRows.filter((row) => row.status === "Occupied").length;
    const roomUsagePercent = monitoringRows.length === 0 ? 0 : Math.round((occupied / monitoringRows.length) * 100);

    const receipts = (receiptResponse.data ?? []) as ReceiptRow[];
    const studentFeeRows = (studentFeesV3Response.data ?? []) as StudentFeeAggRow[];
    const v3PaymentRows = (paymentsV3Response.data ?? []) as V3PaymentRow[];

    const v3Collected = studentFeeRows.reduce((sum, row) => sum + Number(row.paid_total ?? 0), 0);
    const v3Due = studentFeeRows.reduce((sum, row) => sum + Number(row.due_total ?? 0), 0);
    const v3Grand = studentFeeRows.reduce((sum, row) => sum + Number(row.grand_total ?? 0), 0);
    const v3PaidFeesCount = studentFeeRows.filter((row) => row.status === "Paid").length;
    const v3PendingFeesCount = studentFeeRows.filter((row) => row.status !== "Paid").length;

    const unifiedTransactions: UnifiedTransaction[] = [
      ...receipts.map((receipt) => ({
        id: `legacy-${receipt.id}`,
        amount: Number(receipt.amount ?? 0),
        paymentMode: receipt.payment_mode ?? "N/A",
        referenceNumber: receipt.reference_number,
        paidAt: receipt.paid_at,
      })),
      ...v3PaymentRows.map((payment) => ({
        id: `v3-${payment.id}`,
        amount: Number(payment.amount ?? 0),
        paymentMode: payment.payment_mode ?? "N/A",
        referenceNumber: payment.transaction_id,
        paidAt: payment.paid_at,
      })),
    ].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

    const dailyMap = new Map<string, { amount: number; count: number }>();
    for (const tx of unifiedTransactions) {
      const dayKey = new Date(tx.paidAt).toISOString().slice(0, 10);
      const current = dailyMap.get(dayKey) ?? { amount: 0, count: 0 };
      current.amount += tx.amount;
      current.count += 1;
      dailyMap.set(dayKey, current);
    }

    const dailyTransactions = Array.from(dailyMap.entries())
      .map(([date, value]) => ({ date, amount: value.amount, count: value.count }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 14);

    const todayKey = new Date().toISOString().slice(0, 10);
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const today = dailyMap.get(todayKey) ?? { amount: 0, count: 0 };

    const revenueCollectedMtd = unifiedTransactions.reduce((sum, tx) => {
      const txMonthKey = new Date(tx.paidAt).toISOString().slice(0, 7);
      if (txMonthKey !== currentMonthKey) return sum;
      return sum + tx.amount;
    }, 0);

    const revenueCollected = totalRevenueLegacy + v3Collected;
    const revenueDue = totalDueLegacy + v3Due;
    const revenueDueOutstanding = revenueDue;

    return apiSuccess({
      totalStudents: studentsResponse.count ?? 0,
      revenueCollected,
      revenueCollectedMtd,
      revenueDue,
      revenueDueOutstanding,
      attendancePercent,
      roomUsagePercent,
      totalRooms: roomsResponse.count ?? 0,
      transactionsTodayCount: today.count,
      transactionsTodayAmount: today.amount,
      dailyTransactions,
      recentTransactions: unifiedTransactions.slice(0, 25),
      feeV3Summary: {
        billedAmount: v3Grand,
        collectedAmount: v3Collected,
        dueAmount: v3Due,
        paidFeesCount: v3PaidFeesCount,
        pendingFeesCount: v3PendingFeesCount,
      },
      recentV3Payments: v3PaymentRows.slice(0, 25).map((payment) => ({
        id: payment.id,
        studentFeeId: payment.student_fee_id,
        amount: Number(payment.amount ?? 0),
        paymentMode: payment.payment_mode ?? "N/A",
        referenceNumber: payment.transaction_id,
        paidAt: payment.paid_at,
      })),
    });
  } catch (error) {
    return apiError("Unable to load reports", 500, String(error));
  }
}
