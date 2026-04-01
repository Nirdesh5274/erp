import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function isMissingDescriptionColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("fee_structures.description") || msg.includes("column description does not exist");
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();
    const { data: studentRow, error: studentError } = await supabase
      .from("students")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    if (studentError) return apiError(studentError.message, 500);
    const studentId = studentRow?.id;
    if (!studentId) return apiError("Student record not found", 404);

    const { data: fees, error } = await supabase
      .from("student_fees")
      .select("id,fee_structure_id,base_total,discount_total,fine_total,extra_total,grand_total,paid_total,due_total,status,due_date,generated_at")
      .eq("college_id", ctx.collegeId)
      .eq("student_id", studentId)
      .order("generated_at", { ascending: false });

    if (error) return apiError(error.message, 500);

    const feeIds = (fees ?? []).map((f) => f.id);
    const structureIds = Array.from(new Set((fees ?? []).map((f) => f.fee_structure_id).filter(Boolean) as string[]));

    const [componentsRes, structuresRes, paymentsRes, receiptsRes] = await Promise.all([
      feeIds.length > 0
        ? supabase
            .from("student_fee_items")
            .select("student_fee_id,item_type,label,amount")
            .in("student_fee_id", feeIds)
        : Promise.resolve({ data: [], error: null }),
      structureIds.length > 0
        ? supabase
            .from("fee_structures")
            .select("id,name,description")
            .in("id", structureIds)
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
            .select("id,payment_id,student_fee_id,created_at")
            .in("student_fee_id", feeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    let structuresData = structuresRes.data ?? [];
    let structuresError = structuresRes.error;

    if (structuresError && isMissingDescriptionColumn(structuresError.message)) {
      const fallbackStructures = structureIds.length > 0
        ? await supabase
            .from("fee_structures")
            .select("id,name")
            .in("id", structureIds)
        : { data: [], error: null };

      if (fallbackStructures.error) return apiError(fallbackStructures.error.message, 500);
      structuresData = (fallbackStructures.data ?? []).map((row) => ({ ...row, description: null }));
      structuresError = null;
    }

    if (componentsRes.error) return apiError(componentsRes.error.message, 500);
    if (structuresError) return apiError(structuresError.message, 500);
    if (paymentsRes.error) return apiError(paymentsRes.error.message, 500);
    if (receiptsRes.error) return apiError(receiptsRes.error.message, 500);

    const componentsByFeeId = new Map<string, Array<{ name: string; amount: number; type?: string }>>();
    for (const row of componentsRes.data ?? []) {
      const list = componentsByFeeId.get(row.student_fee_id as string) ?? [];
      list.push({ name: row.label as string, amount: Number(row.amount ?? 0), type: row.item_type as string });
      componentsByFeeId.set(row.student_fee_id as string, list);
    }

    const structureById = new Map(structuresData.map((row) => [row.id as string, row]));

    const latestPaymentByFee = new Map<string, (typeof paymentsRes.data)[number]>();
    for (const payment of paymentsRes.data ?? []) {
      if (!latestPaymentByFee.has(payment.student_fee_id as string)) {
        latestPaymentByFee.set(payment.student_fee_id as string, payment);
      }
    }

    const receiptByPaymentId = new Map((receiptsRes.data ?? []).map((row) => [row.payment_id as string, row]));

    const normalizedFees = (fees ?? []).map((fee) => {
      const structure = fee.fee_structure_id ? structureById.get(fee.fee_structure_id as string) : null;
      const latestPayment = latestPaymentByFee.get(fee.id as string);
      return {
        id: fee.id,
        amount: Number(fee.grand_total ?? 0),
        paid_amount: Number(fee.paid_total ?? 0),
        due_amount: Number(fee.due_total ?? 0),
        status: fee.status,
        due_date: fee.due_date,
        payment_mode: latestPayment?.payment_mode ?? null,
        reference_number: latestPayment?.transaction_id ?? null,
        receipt_number: latestPayment?.receipt_number ?? null,
        generated_at: fee.generated_at,
        components: componentsByFeeId.get(fee.id as string) ?? [],
        late_fine_accumulated: Number(fee.fine_total ?? 0),
        scholarship_amount: Number(fee.discount_total ?? 0),
        currency: "INR",
        structure_name: structure?.name ?? null,
        structure_description: structure?.description ?? null,
      };
    });

    const normalizedReceipts = (paymentsRes.data ?? [])
      .map((payment) => {
        const receipt = receiptByPaymentId.get(payment.id as string);
        if (!receipt) return null;
        return {
          id: receipt.id,
          fee_id: payment.student_fee_id,
          receipt_number: payment.receipt_number,
          amount: Number(payment.amount ?? 0),
          payment_mode: payment.payment_mode,
          reference_number: payment.transaction_id,
          paid_at: payment.paid_at,
        };
      })
      .filter(Boolean);

    return apiSuccess({ fees: normalizedFees, receipts: normalizedReceipts });
  } catch (error) {
    return apiError("Unable to load student fees", 500, String(error));
  }
}
