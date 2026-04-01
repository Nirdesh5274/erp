import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const patchSchema = z.object({
  studentId: z.string().uuid(),
});

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
    // Required DB columns for temp password lifecycle:
    // alter table students add column if not exists temp_password text;
    // alter table students add column if not exists must_change_password boolean default false;
    // alter table students add column if not exists password_generated_at timestamptz;
    const { data, error } = await supabase
      .from("students")
      .select("id,name,email,department_id,slot_id,created_at,user_id,temp_password,must_change_password,password_generated_at")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if (error) {
      const message = error.message.toLowerCase();
      if (!message.includes("temp_password") && !message.includes("must_change_password") && !message.includes("password_generated_at")) {
        return apiError(error.message, 500);
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .from("students")
        .select("id,name,email,department_id,slot_id,created_at,user_id")
        .eq("college_id", ctx.collegeId)
        .order("created_at", { ascending: false });

      if (fallbackError) return apiError(fallbackError.message, 500);

      return apiSuccess(
        (fallbackData ?? []).map((row) => ({
          ...row,
          temp_password: null,
          must_change_password: false,
          password_generated_at: null,
        })),
      );
    }
    return apiSuccess(data ?? []);
  } catch (error) {
    return apiError("Unable to load students", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id,name,email,department_id,user_id")
      .eq("id", body.studentId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (studentError || !student) return apiError("Student not found", 404);

    const tempPassword = generateTempPassword();
    let userId = student.user_id as string | null;

    if (!userId) {
      const { data: newUser, error: createUserError } = await supabase
        .from("users")
        .insert({
          college_id: ctx.collegeId,
          department_id: student.department_id,
          name: student.name,
          email: student.email,
          password: tempPassword,
          role: "Student",
        })
        .select("id")
        .single();

      if (createUserError) return apiError(createUserError.message, 500);
      userId = newUser.id;
    } else {
      const { error: updateUserError } = await supabase
        .from("users")
        .update({
          password: tempPassword,
          role: "Student",
          department_id: student.department_id,
          college_id: ctx.collegeId,
        })
        .eq("id", userId);

      if (updateUserError) return apiError(updateUserError.message, 500);
    }

    const { error: updateStudentError } = await supabase
      .from("students")
      .update({
        user_id: userId,
        temp_password: tempPassword,
        must_change_password: true,
        password_generated_at: new Date().toISOString(),
      })
      .eq("id", student.id)
      .eq("college_id", ctx.collegeId);

    if (updateStudentError) {
      const { error: fallbackUpdateStudentError } = await supabase
        .from("students")
        .update({ user_id: userId })
        .eq("id", student.id)
        .eq("college_id", ctx.collegeId);

      if (fallbackUpdateStudentError) return apiError(fallbackUpdateStudentError.message, 500);
    }

    return apiSuccess({
      studentId: student.id,
      email: student.email,
      tempPassword,
      mustChangePassword: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to regenerate student password", 500, String(error));
  }
}
