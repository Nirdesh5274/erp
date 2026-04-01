import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  departmentId: z.string().uuid(),
  slotId: z.string().uuid(),
  studentName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^\d{10}$/, "Phone number must be exactly 10 digits").optional().nullable(),
  feeAmount: z.number().nonnegative(),
});

interface AdmissionDbRow {
  id: string;
  student_name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: string;
  department_id: string;
  slot_id: string;
}

function generateTempPassword() {
  const randomPart = Math.random().toString(36).slice(-6);
  return `Stu@${randomPart}`;
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("admissions")
      .select("id,student_name,email,phone,status,created_at,department_id,slot_id")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if (ctx.role === "HOD" || ctx.role === "Faculty") {
      const departmentId = ctx.departmentId || null;
      if (!departmentId) return apiError("Department context missing", 400);
      query = query.eq("department_id", departmentId);
    }

    const { data, error } = await query;

    if (error) return apiError(error.message, 500);

    const admissions = ((data ?? []) as AdmissionDbRow[]).map((item) => ({
      id: item.id,
      studentName: item.student_name,
      email: item.email,
      phone: item.phone,
      status: item.status,
      createdAt: item.created_at,
      departmentId: item.department_id,
      slotId: item.slot_id,
    }));

    return apiSuccess(admissions);
  } catch (error) {
    return apiError("Unable to load admissions", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = schema.parse(await request.json());

    if (ctx.role === "HOD" || ctx.role === "Faculty") {
      const creatorDepartmentId = ctx.departmentId || null;
      if (!creatorDepartmentId) return apiError("Department context missing", 400);
      if (body.departmentId !== creatorDepartmentId) {
        return apiError(`${ctx.role} can only create Student in own department`, 403);
      }
    }

    const supabase = getSupabaseAdmin();
    const normalizedEmail = body.email.trim().toLowerCase();
    const normalizedPhone = body.phone?.trim() || null;

    const { data: existingAdmissionByEmail, error: existingAdmissionByEmailError } = await supabase
      .from("admissions")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingAdmissionByEmailError) return apiError(existingAdmissionByEmailError.message, 400);
    if (existingAdmissionByEmail) return apiError("Student email already exists", 400);

    if (normalizedPhone) {
      const { data: existingAdmissionByPhone, error: existingAdmissionByPhoneError } = await supabase
        .from("admissions")
        .select("id")
        .eq("college_id", ctx.collegeId)
        .eq("phone", normalizedPhone)
        .maybeSingle();

      if (existingAdmissionByPhoneError) return apiError(existingAdmissionByPhoneError.message, 400);
      if (existingAdmissionByPhone) return apiError("Student phone number already exists", 400);
    }

    const { data, error } = await supabase.rpc("create_admission_flow", {
      p_college_id: ctx.collegeId,
      p_department_id: body.departmentId,
      p_slot_id: body.slotId,
      p_student_name: body.studentName,
      p_email: normalizedEmail,
      p_phone: normalizedPhone,
      p_fee_amount: body.feeAmount,
    });

    if (error) return apiError(error.message, 400);

    const admission = Array.isArray(data) ? data[0] : data;

    let tempPassword: string | null = null;

    // Auto-provision a Student login and link it to the student record
    // so /student/dashboard works immediately after admission.
    try {
      const { data: existingUser, error: existingUserError } = await supabase
        .from("users")
        .select("id,role")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (existingUserError) throw existingUserError;

      let userId = existingUser?.id as string | undefined;
      tempPassword = generateTempPassword();

      if (existingUser?.role && existingUser.role !== "Student") {
        return apiError("Email already used by non-student user", 400);
      }

      if (!userId) {
        const { data: newUser, error: createUserError } = await supabase
          .from("users")
          .insert({
            college_id: ctx.collegeId,
            department_id: body.departmentId,
            name: body.studentName,
            email: normalizedEmail,
            password: tempPassword,
            role: "Student",
          })
          .select("id")
          .single();

        if (createUserError) throw createUserError;
        userId = newUser?.id;
      } else {
        const { error: resetUserPasswordError } = await supabase
          .from("users")
          .update({
            password: tempPassword,
            role: "Student",
            department_id: body.departmentId,
            college_id: ctx.collegeId,
          })
          .eq("id", userId);

        if (resetUserPasswordError) throw resetUserPasswordError;
      }

      if (userId && admission?.student_id) {
        const { error: linkError } = await supabase
          .from("students")
          .update({
            user_id: userId,
            temp_password: tempPassword,
            must_change_password: true,
            password_generated_at: new Date().toISOString(),
          })
          .eq("id", admission.student_id);

        if (linkError) {
          // Backward-compat if DB columns are not yet migrated.
          const { error: fallbackLinkError } = await supabase
            .from("students")
            .update({ user_id: userId })
            .eq("id", admission.student_id);

          if (fallbackLinkError) throw fallbackLinkError;
        }
      }
    } catch (studentProvisionError) {
      // Non-blocking: admission succeeds even if auto user provision fails.
      console.error("Student auto-provision failed", studentProvisionError);
    }

    return apiSuccess(
      {
        ...admission,
        studentCredentials: tempPassword
          ? {
              email: normalizedEmail,
              tempPassword,
              mustChangePassword: true,
            }
          : null,
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create admission", 500, String(error));
  }
}
