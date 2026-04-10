import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcStudentFeeTotals } from "@/lib/feeManagement";
import { makeReceiptNumber } from "@/lib/feeManagement";

const schema = z.object({
  class_id: z.string().uuid(),
  section_id: z.string().uuid(),
  term: z.string().max(20).default("Annual"),
  academic_year: z.string().max(20).optional(),
  admission_fee: z.number().nonnegative().default(20000),
  paid_amount: z.number().positive(),
  payment_mode: z.enum(["Cash", "UPI", "Online", "Card", "Bank Transfer"]).default("Cash"),
  transaction_id: z.string().trim().optional().or(z.literal("")),
  receipt_number: z.string().trim().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  forceDuplicate: z.boolean().optional(),
});

function generateTempPassword() {
  const randomPart = Math.random().toString(36).slice(-6);
  return `Stu@${randomPart}`;
}

async function generateSchoolRollNumber(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  sectionId: string;
  institutionId: string;
}) {
  const { supabase, sectionId, institutionId } = params;
  const { data: section, error: sectionError } = await supabase
    .from("sections")
    .select("id,name")
    .eq("id", sectionId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (sectionError) throw new Error(sectionError.message);
  if (!section) throw new Error("Section not found for roll generation");

  const { count, error: countError } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId)
    .eq("institution_id", institutionId);

  if (countError) throw new Error(countError.message);

  const next = Number(count ?? 0) + 1;
  const padded = String(next).padStart(3, "0");
  return `${section.name}${padded}`;
}

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

function isMissingStudentStatusColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("status") && text.includes("students") && (text.includes("column") || text.includes("schema cache"));
}

async function isSchoolInstitution(collegeId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("colleges")
    .select("type")
    .eq("id", collegeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.type === "school";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(ctx.collegeId))) return apiError("Lead conversion is available only for school mode", 400);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id,name,phone,email,status,academic_year")
      .eq("id", id)
      .eq("institution_id", ctx.collegeId)
      .is("deleted_at", null)
      .maybeSingle();

    if (leadError) return apiError(leadError.message, 500);
    if (!lead) return apiError("Lead not found", 404);
    if (lead.status === "converted") return apiError("Lead is already converted", 400);
    if (lead.status === "refused") return apiError("Refused lead cannot be converted", 400);

    const leadPhone = normalizePhone(lead.phone);
    const { data: duplicateStudent, error: duplicateStudentError } = await supabase
      .from("students")
      .select("id,name")
      .eq("college_id", ctx.collegeId)
      .eq("email", lead.email ?? "")
      .limit(1)
      .maybeSingle();

    if (duplicateStudentError) return apiError(duplicateStudentError.message, 500);

    const { data: duplicatePhoneStudent, error: duplicatePhoneStudentError } = await supabase
      .from("admissions")
      .select("id,student_name,phone")
      .eq("college_id", ctx.collegeId)
      .eq("phone", leadPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (duplicatePhoneStudentError) return apiError(duplicatePhoneStudentError.message, 500);

    if ((duplicateStudent || duplicatePhoneStudent) && !body.forceDuplicate) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: {
            code: "CONFLICT",
            message: "Student with this phone may already exist. Continue anyway?",
          },
          existing: duplicateStudent
            ? { id: duplicateStudent.id, name: duplicateStudent.name }
            : { id: duplicatePhoneStudent?.id, name: duplicatePhoneStudent?.student_name },
          requiresConfirmation: true,
        },
        { status: 409 },
      );
    }

    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .select("id,total_seats,filled_seats")
      .eq("id", body.section_id)
      .eq("class_id", body.class_id)
      .eq("institution_id", ctx.collegeId)
      .maybeSingle();

    if (sectionError) return apiError(sectionError.message, 400);
    if (!section) return apiError("Section not found for selected class", 404);

    const totalSeats = Number(section.total_seats ?? 0);
    const filledSeats = Number(section.filled_seats ?? 0);
    if (filledSeats >= totalSeats) {
      return apiError("No seats available in selected section", 400);
    }

    const rollNumber = await generateSchoolRollNumber({
      supabase,
      sectionId: body.section_id,
      institutionId: ctx.collegeId,
    });

    let createdAdmissionId: string | null = null;
    let createdStudentId: string | null = null;
    let createdStudentFeeId: string | null = null;
    let createdUserId: string | null = null;

    const warnings: string[] = [];
    const email = (body.email?.trim() || lead.email || `${leadPhone}@student.local`).toLowerCase();
    let createdPaymentId: string | null = null;
    let createdReceiptId: string | null = null;

    try {
      // Inserts start here. After this point, avoid early returns so rollback always runs on failure.
      const { data: admissionRow, error: admissionError } = await supabase
        .from("admissions")
        .insert({
          college_id: ctx.collegeId,
          department_id: null,
          slot_id: null,
          student_name: lead.name,
          email,
          phone: leadPhone,
          current_semester: 1,
          status: "Approved",
          class_id: body.class_id,
          section_id: body.section_id,
          term: body.term,
          roll_number: rollNumber,
        })
        .select("id")
        .single();

      if (admissionError || !admissionRow?.id) throw new Error(admissionError?.message ?? "Failed to create admission");
      createdAdmissionId = admissionRow.id;

      const studentInsertPayload = {
        college_id: ctx.collegeId,
        institution_id: ctx.collegeId,
        department_id: null,
        slot_id: null,
        admission_id: admissionRow.id,
        name: lead.name,
        email,
        current_semester: 1,
        class_id: body.class_id,
        section_id: body.section_id,
        term: body.term,
        roll_number: rollNumber,
        status: "active",
      };

      let { data: studentRow, error: studentError } = await supabase
        .from("students")
        .insert(studentInsertPayload)
        .select("id")
        .single();

      if (studentError && isMissingStudentStatusColumnError(studentError.message)) {
        const fallbackStudentPayload: Record<string, unknown> = { ...studentInsertPayload };
        delete fallbackStudentPayload.status;
        const retry = await supabase
          .from("students")
          .insert(fallbackStudentPayload)
          .select("id")
          .single();

        studentRow = retry.data;
        studentError = retry.error;
        warnings.push("students.status column missing: inserted student without status field");
      }

      if (studentError || !studentRow?.id) throw new Error(studentError?.message ?? "Failed to create student");
      createdStudentId = studentRow.id;

      const { data: schoolStructure, error: schoolStructureError } = await supabase
        .from("fee_structures")
        .select("id,name")
        .eq("college_id", ctx.collegeId)
        .eq("class_id", body.class_id)
        .eq("term", body.term)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (schoolStructureError) throw new Error(schoolStructureError.message);

      if (schoolStructure) {
        const { data: studentFeeRow, error: studentFeeError } = await supabase
          .from("student_fees")
          .insert({
            college_id: ctx.collegeId,
            student_id: studentRow.id,
            admission_id: admissionRow.id,
            slot_id: null,
            fee_structure_id: schoolStructure.id,
            notes: `Auto-assigned on lead conversion (${body.term})`,
          })
          .select("id")
          .single();

        if (studentFeeError || !studentFeeRow?.id) throw new Error(studentFeeError?.message ?? "Failed to create student fee");
        createdStudentFeeId = studentFeeRow.id;

        const { data: components, error: componentsError } = await supabase
          .from("fee_components")
          .select("id,component_name,default_amount")
          .eq("fee_structure_id", schoolStructure.id)
          .order("sort_order", { ascending: true });

        if (componentsError) throw new Error(componentsError.message);

        if ((components ?? []).length > 0) {
          const { error: itemsError } = await supabase.from("student_fee_items").insert(
            (components ?? []).map((component) => ({
              student_fee_id: studentFeeRow.id,
              college_id: ctx.collegeId,
              source_component_id: component.id,
              item_type: "component",
              label: component.component_name,
              amount: Number(component.default_amount ?? 0),
              quantity: 1,
              metadata: { source: "lead_conversion", term: body.term },
            })),
          );

          if (itemsError) throw new Error(itemsError.message);
        }

        await recalcStudentFeeTotals(supabase, studentFeeRow.id);
      } else {
        warnings.push("Full fee structure not configured");

        const { data: fallbackStudentFee, error: fallbackStudentFeeError } = await supabase
          .from("student_fees")
          .insert({
            college_id: ctx.collegeId,
            student_id: studentRow.id,
            admission_id: admissionRow.id,
            slot_id: null,
            fee_structure_id: null,
            notes: "Fallback fee generated from admission fee amount",
          })
          .select("id")
          .single();

        if (fallbackStudentFeeError || !fallbackStudentFee?.id) throw new Error(fallbackStudentFeeError?.message ?? "Failed to create fallback student fee");
        createdStudentFeeId = fallbackStudentFee.id;

        if (body.admission_fee > 0) {
          const { error: fallbackItemError } = await supabase.from("student_fee_items").insert({
            student_fee_id: fallbackStudentFee.id,
            college_id: ctx.collegeId,
            source_component_id: null,
            item_type: "extra",
            label: "Admission Fee (Fallback)",
            amount: Number(body.admission_fee),
            quantity: 1,
            metadata: { source: "lead_conversion_fallback" },
          });

          if (fallbackItemError) throw new Error(fallbackItemError.message);
        }

        await recalcStudentFeeTotals(supabase, fallbackStudentFee.id);
      }

      if (!createdStudentFeeId) throw new Error("Student fee not created");

      const { data: refreshedFee, error: refreshedFeeError } = await supabase
        .from("student_fees")
        .select("id,grand_total,due_total")
        .eq("id", createdStudentFeeId)
        .eq("college_id", ctx.collegeId)
        .single();

      if (refreshedFeeError || !refreshedFee) throw new Error(refreshedFeeError?.message ?? "Unable to load generated fee");

      const dueAmount = Number(refreshedFee.due_total ?? 0);
      if (dueAmount <= 0) {
        throw new Error("No due amount available for admission conversion");
      }

      if (Number(body.paid_amount) > dueAmount) {
        throw new Error(`Paid amount cannot exceed due amount (${dueAmount})`);
      }

      const receiptNumber = body.receipt_number?.trim() || makeReceiptNumber("ADM");

      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          college_id: ctx.collegeId,
          student_fee_id: createdStudentFeeId,
          student_id: createdStudentId,
          amount: Number(body.paid_amount),
          payment_mode: body.payment_mode,
          transaction_id: body.transaction_id?.trim() || null,
          receipt_number: receiptNumber,
          collected_by: ctx.userId,
          notes: "Admission conversion payment",
        })
        .select("id")
        .single();

      if (paymentError || !payment?.id) throw new Error(paymentError?.message ?? "Unable to create admission payment");
      createdPaymentId = payment.id;

      await recalcStudentFeeTotals(supabase, createdStudentFeeId);

      const { data: receipt, error: receiptError } = await supabase
        .from("receipts")
        .insert({
          college_id: ctx.collegeId,
          payment_id: payment.id,
          student_fee_id: createdStudentFeeId,
          student_id: createdStudentId,
          payload: {
            receiptNumber,
            paymentMode: body.payment_mode,
            transactionId: body.transaction_id?.trim() || null,
            source: "lead_conversion",
          },
        })
        .select("id")
        .single();

      if (receiptError || !receipt?.id) throw new Error(receiptError?.message ?? "Unable to create receipt");
      createdReceiptId = receipt.id;

      // In school conversion, dues are tracked via student_fees/student_fee_items.
      // Avoid writing duplicate legacy admission fee rows into fees.

      const { error: seatsError } = await supabase
        .from("sections")
        .update({ filled_seats: filledSeats + 1 })
        .eq("id", body.section_id)
        .eq("institution_id", ctx.collegeId);

      if (seatsError) throw new Error(seatsError.message);

      const tempPassword = generateTempPassword();
      let userId: string | null = null;

      const { data: existingUser, error: existingUserError } = await supabase
        .from("users")
        .select("id,role")
        .eq("email", email)
        .maybeSingle();

      if (existingUserError) throw new Error(existingUserError.message);
      if (existingUser?.role && existingUser.role !== "Student") {
        throw new Error("Email already used by non-student user");
      }

      if (!existingUser?.id) {
        const { data: newUser, error: createUserError } = await supabase
          .from("users")
          .insert({
            college_id: ctx.collegeId,
            department_id: null,
            name: lead.name,
            email,
            password: tempPassword,
            role: "Student",
          })
          .select("id")
          .single();

        if (createUserError || !newUser?.id) throw new Error(createUserError?.message ?? "Failed to create user");
        userId = newUser.id as string;
        createdUserId = userId;
      } else {
        userId = existingUser.id as string;
        const { error: updateUserError } = await supabase
          .from("users")
          .update({
            password: tempPassword,
            role: "Student",
            college_id: ctx.collegeId,
          })
          .eq("id", userId);

        if (updateUserError) throw new Error(updateUserError.message);
      }

      const { error: linkStudentError } = await supabase
        .from("students")
        .update({
          user_id: userId,
          temp_password: tempPassword,
          must_change_password: true,
          password_generated_at: new Date().toISOString(),
        })
        .eq("id", studentRow.id)
        .eq("college_id", ctx.collegeId);

      if (linkStudentError) {
        const { error: fallbackLinkError } = await supabase
          .from("students")
          .update({ user_id: userId })
          .eq("id", studentRow.id)
          .eq("college_id", ctx.collegeId);
        if (fallbackLinkError) throw new Error(fallbackLinkError.message);
      }

      const { error: leadUpdateError } = await supabase
        .from("leads")
        .update({
          status: "converted",
          converted_student_id: studentRow.id,
          converted_at: new Date().toISOString(),
          academic_year: body.academic_year ?? lead.academic_year ?? null,
        })
        .eq("id", id)
        .eq("institution_id", ctx.collegeId)
        .is("deleted_at", null);

      if (leadUpdateError) throw new Error(leadUpdateError.message);

      return apiSuccess({
        student_id: studentRow.id,
        roll_number: rollNumber,
        login_email: email,
        login_password: tempPassword,
        receipt_id: createdReceiptId,
        receipt_url: createdReceiptId ? `/api/fees/receipt/${createdReceiptId}` : null,
        warnings,
      });
    } catch (conversionError) {
      if (createdReceiptId) {
        await supabase.from("receipts").delete().eq("id", createdReceiptId).eq("college_id", ctx.collegeId);
      }

      if (createdPaymentId) {
        await supabase.from("payments").delete().eq("id", createdPaymentId).eq("college_id", ctx.collegeId);
      }

      if (createdStudentFeeId) {
        await supabase.from("student_fees").delete().eq("id", createdStudentFeeId).eq("college_id", ctx.collegeId);
      }

      if (createdStudentId) {
        await supabase.from("students").delete().eq("id", createdStudentId).eq("college_id", ctx.collegeId);
      }

      if (createdAdmissionId) {
        await supabase.from("admissions").delete().eq("id", createdAdmissionId).eq("college_id", ctx.collegeId);
      }

      if (createdUserId) {
        await supabase.from("users").delete().eq("id", createdUserId).eq("college_id", ctx.collegeId);
      }

      const errorMessage = conversionError instanceof Error ? conversionError.message : "Rolled back";
      return NextResponse.json(
        { error: "CONVERSION_FAILED", message: errorMessage },
        { status: 500 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to convert lead", 500, String(error));
  }
}
