import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface StudentRow {
  id: string;
  name: string;
  email: string;
  admission_id: string | null;
  slot_id: string | null;
}

interface StudentFeeRow {
  id: string;
  student_id: string;
  slot_id: string | null;
  fee_structure_id: string | null;
  base_total: number | string;
  discount_total: number | string;
  fine_total: number | string;
  extra_total: number | string;
  grand_total: number | string;
  paid_total: number | string;
  due_total: number | string;
  status: string;
  due_date: string | null;
  generated_at: string;
}

function isMissingDescriptionColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("fee_structures.description") || msg.includes("column description does not exist");
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const url = new URL(request.url);
    const slotId = url.searchParams.get("slotId");
    const studentId = url.searchParams.get("studentId");

    if (!slotId) return apiError("slotId is required", 400);

    const supabase = getSupabaseAdmin();

    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("id,course")
      .eq("id", slotId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (slotError || !slot) return apiError("Slot not found", 404);

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id,name,email,admission_id,slot_id")
      .eq("college_id", ctx.collegeId)
      .eq("slot_id", slotId)
      .order("name", { ascending: true });

    if (studentsError) return apiError(studentsError.message, 500);

    const studentIds = (students ?? []).map((row) => row.id as string);

    let fees: StudentFeeRow[] = [];
    if (studentIds.length > 0) {
      let feesQuery = supabase
        .from("student_fees")
        .select("id,student_id,slot_id,fee_structure_id,base_total,discount_total,fine_total,extra_total,grand_total,paid_total,due_total,status,due_date,generated_at")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", slotId)
        .in("student_id", studentIds)
        .order("generated_at", { ascending: false });

      if (studentId) feesQuery = feesQuery.eq("student_id", studentId);

      const { data: feeRows, error: feesError } = await feesQuery;
      if (feesError) return apiError(feesError.message, 500);
      fees = (feeRows ?? []) as StudentFeeRow[];
    }

    const summaryByStudent = new Map<string, { totalDue: number; totalPaid: number; feesCount: number }>();
    for (const fee of fees) {
      const key = fee.student_id;
      const current = summaryByStudent.get(key) ?? { totalDue: 0, totalPaid: 0, feesCount: 0 };
      current.totalDue += Number(fee.due_total ?? 0);
      current.totalPaid += Number(fee.paid_total ?? 0);
      current.feesCount += 1;
      summaryByStudent.set(key, current);
    }

    const studentSummaries = (students ?? []).map((student) => {
      const summary = summaryByStudent.get(student.id as string) ?? { totalDue: 0, totalPaid: 0, feesCount: 0 };
      return {
        id: student.id,
        name: student.name,
        email: student.email,
        admissionId: student.admission_id,
        totalDue: summary.totalDue,
        totalPaid: summary.totalPaid,
        feesCount: summary.feesCount,
      };
    });

    if (!studentId) {
      return apiSuccess({
        slot: { id: slot.id, course: slot.course },
        students: studentSummaries,
      });
    }

    const selectedStudent = (students ?? []).find((row) => row.id === studentId) as StudentRow | undefined;
    if (!selectedStudent) return apiError("Student not found in selected slot", 404);

    const structureIds = Array.from(new Set(fees.map((fee) => fee.fee_structure_id).filter(Boolean) as string[]));
    const feeIds = fees.map((fee) => fee.id);

    const [structuresRes, itemsRes, paymentsRes, receiptsRes] = await Promise.all([
      structureIds.length > 0
        ? supabase
            .from("fee_structures")
            .select("id,name,description,academic_year")
            .in("id", structureIds)
        : Promise.resolve({ data: [], error: null }),
      feeIds.length > 0
        ? supabase
            .from("student_fee_items")
            .select("id,student_fee_id,item_type,label,amount,quantity,metadata,created_at")
            .in("student_fee_id", feeIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      feeIds.length > 0
        ? supabase
            .from("payments")
            .select("id,student_fee_id,amount,payment_mode,transaction_id,receipt_number,paid_at")
            .in("student_fee_id", feeIds)
            .order("paid_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      feeIds.length > 0
        ? supabase
            .from("receipts")
            .select("id,payment_id,student_fee_id,file_url,storage_path,payload,created_at")
            .in("student_fee_id", feeIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    let structuresData = structuresRes.data ?? [];
    let structuresError = structuresRes.error;

    if (structuresError && isMissingDescriptionColumn(structuresError.message)) {
      const fallbackStructures = structureIds.length > 0
        ? await supabase
            .from("fee_structures")
            .select("id,name,academic_year")
            .in("id", structureIds)
        : { data: [], error: null };

      if (fallbackStructures.error) return apiError(fallbackStructures.error.message, 500);
      structuresData = (fallbackStructures.data ?? []).map((row) => ({ ...row, description: null }));
      structuresError = null;
    }

    if (structuresError) return apiError(structuresError.message, 500);
    if (itemsRes.error) return apiError(itemsRes.error.message, 500);
    if (paymentsRes.error) return apiError(paymentsRes.error.message, 500);
    if (receiptsRes.error) return apiError(receiptsRes.error.message, 500);

    const structureById = new Map(structuresData.map((row) => [row.id as string, row]));

    const feeDetails = fees.map((fee) => {
      const structure = fee.fee_structure_id ? structureById.get(fee.fee_structure_id) : null;
      return {
        id: fee.id,
        studentId: fee.student_id,
        structureId: fee.fee_structure_id,
        structureName: structure?.name ?? "Fee Structure",
        structureDescription: structure?.description ?? null,
        academicYear: structure?.academic_year ?? null,
        baseTotal: Number(fee.base_total ?? 0),
        discountTotal: Number(fee.discount_total ?? 0),
        fineTotal: Number(fee.fine_total ?? 0),
        extraTotal: Number(fee.extra_total ?? 0),
        grandTotal: Number(fee.grand_total ?? 0),
        paidTotal: Number(fee.paid_total ?? 0),
        dueTotal: Number(fee.due_total ?? 0),
        status: fee.status,
        dueDate: fee.due_date,
        generatedAt: fee.generated_at,
      };
    });

    return apiSuccess({
      slot: { id: slot.id, course: slot.course },
      students: studentSummaries,
      selectedStudent: {
        id: selectedStudent.id,
        name: selectedStudent.name,
        email: selectedStudent.email,
        admissionId: selectedStudent.admission_id,
      },
      fees: feeDetails,
      feeItems: itemsRes.data ?? [],
      payments: paymentsRes.data ?? [],
      receipts: receiptsRes.data ?? [],
    });
  } catch (error) {
    return apiError("Unable to load student fees", 500, String(error));
  }
}
