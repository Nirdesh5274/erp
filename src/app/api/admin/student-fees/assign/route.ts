import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcStudentFeeTotals } from "@/lib/feeManagement";

const postSchema = z.object({
  studentId: z.string().uuid(),
  slotId: z.string().uuid(),
  feeStructureId: z.string().uuid().optional(),
  dueDate: z.string().date().optional(),
  graceDays: z.number().int().nonnegative().optional(),
  notes: z.string().trim().max(300).optional(),
});

function isMissingSemesterColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("semester") && (msg.includes("column") || msg.includes("schema cache"));
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id,admission_id,slot_id,current_semester")
      .eq("id", body.studentId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (studentError && isMissingSemesterColumn(studentError.message)) {
      return apiError("Semester field is missing in DB. Run latest migration to enable semester-wise fee structures.", 400);
    }

    if (studentError || !student) return apiError("Student not found", 404);

    const currentSemester = Number(student.current_semester ?? 1);

    let structureId = body.feeStructureId ?? null;
    if (!structureId) {
      const { data: structure, error: structureError } = await supabase
        .from("fee_structures")
        .select("id")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", body.slotId)
        .eq("semester", currentSemester)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (structureError && isMissingSemesterColumn(structureError.message)) {
        return apiError("Semester field is missing in DB. Run latest migration to enable semester-wise fee structures.", 400);
      }

      if (structureError) return apiError(structureError.message, 500);
      if (!structure) return apiError(`No active fee structure found for selected slot and semester ${currentSemester}`, 400);
      structureId = structure.id;
    }

    const { data: structure, error: loadStructureError } = await supabase
      .from("fee_structures")
      .select("id,slot_id,semester")
      .eq("id", structureId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (loadStructureError && isMissingSemesterColumn(loadStructureError.message)) {
      return apiError("Semester field is missing in DB. Run latest migration to enable semester-wise fee structures.", 400);
    }

    if (loadStructureError || !structure) return apiError("Fee structure not found", 404);
    if (structure.slot_id !== body.slotId) return apiError("Fee structure does not belong to selected slot", 400);
    if (Number(structure.semester ?? 1) !== currentSemester) {
      return apiError(`Fee structure semester does not match student semester (${currentSemester})`, 400);
    }

    const { data: components, error: componentsError } = await supabase
      .from("fee_components")
      .select("id,component_name,default_amount")
      .eq("fee_structure_id", structureId)
      .order("sort_order", { ascending: true });

    if (componentsError) return apiError(componentsError.message, 500);
    if ((components ?? []).length === 0) return apiError("Fee structure has no components", 400);

    const { data: fee, error: feeError } = await supabase
      .from("student_fees")
      .insert({
        college_id: ctx.collegeId,
        student_id: body.studentId,
        admission_id: student.admission_id,
        slot_id: body.slotId,
        fee_structure_id: structureId,
        due_date: body.dueDate ?? null,
        grace_days: body.graceDays ?? 0,
        notes: body.notes ?? null,
      })
      .select("id,college_id,student_id,slot_id,fee_structure_id,due_date,status")
      .single();

    if (feeError) return apiError(feeError.message, 500);

    const itemPayload = (components ?? []).map((component) => ({
      student_fee_id: fee.id,
      college_id: ctx.collegeId,
      source_component_id: component.id,
      item_type: "component",
      label: component.component_name,
      amount: Number(component.default_amount ?? 0),
      quantity: 1,
      metadata: { source: "fee_structure" },
    }));

    const { error: itemsError } = await supabase.from("student_fee_items").insert(itemPayload);
    if (itemsError) return apiError(itemsError.message, 500);

    const totals = await recalcStudentFeeTotals(supabase, fee.id);

    const { data: fullFee, error: fullFeeError } = await supabase
      .from("student_fees")
      .select("id,college_id,student_id,admission_id,slot_id,fee_structure_id,currency,base_total,discount_total,fine_total,extra_total,grand_total,paid_total,due_total,status,due_date,grace_days,generated_at")
      .eq("id", fee.id)
      .single();

    if (fullFeeError) return apiError(fullFeeError.message, 500);

    return apiSuccess({
      fee: fullFee,
      totals,
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to assign fee", 500, String(error));
  }
}
