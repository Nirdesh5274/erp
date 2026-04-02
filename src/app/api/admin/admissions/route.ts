import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  departmentId: z.string().uuid().optional(),
  slotId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  rollNumber: z.string().max(30).optional().nullable(),
  term: z.enum(["Term1", "Term2", "Annual"]).optional(),
  studentName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^\d{10}$/, "Phone number must be exactly 10 digits").optional().nullable(),
  currentSemester: z.number().int().min(1).max(12).optional(),
  feeAmount: z.number().nonnegative(),
});

interface AdmissionDbRow {
  id: string;
  student_name: string;
  email: string;
  phone: string | null;
  section_id?: string | null;
  roll_number?: string | null;
  term?: string | null;
  current_semester?: number | null;
  status: string;
  created_at: string;
  department_id: string | null;
  slot_id: string | null;
}

function isMissingCurrentSemesterColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("current_semester") && (text.includes("column") || text.includes("schema cache"));
}

function isMissingSchoolColumnsError(message: string) {
  const text = message.toLowerCase();
  return (
    (text.includes("section_id") || text.includes("roll_number") || text.includes("term") || text.includes("class_id") || text.includes("institution_id"))
    && (text.includes("column") || text.includes("schema cache"))
  );
}

function generateTempPassword() {
  const randomPart = Math.random().toString(36).slice(-6);
  return `Stu@${randomPart}`;
}

async function ensureSchoolDepartmentId(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  institutionId: string;
}) {
  const { supabase, institutionId } = params;
  const defaultName = "School Core";

  const { data: existing, error: existingError } = await supabase
    .from("departments")
    .select("id")
    .eq("college_id", institutionId)
    .ilike("name", defaultName)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createdError } = await supabase
    .from("departments")
    .insert({ college_id: institutionId, name: defaultName })
    .select("id")
    .single();

  if (createdError) throw new Error(createdError.message);
  return created.id as string;
}

async function ensureSchoolSlotId(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  institutionId: string;
  departmentId: string;
  className: string;
}) {
  const { supabase, institutionId, departmentId, className } = params;

  const { data: existing, error: existingError } = await supabase
    .from("slots")
    .select("id")
    .eq("college_id", institutionId)
    .eq("department_id", departmentId)
    .eq("course", className)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createdError } = await supabase
    .from("slots")
    .insert({
      college_id: institutionId,
      department_id: departmentId,
      course: className,
      total_seats: 9999,
      filled_seats: 0,
    })
    .select("id")
    .single();

  if (createdError) throw new Error(createdError.message);
  return created.id as string;
}

async function generateRollNumberForSection(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  institutionId: string;
  sectionId: string;
}) {
  const { supabase, institutionId, sectionId } = params;

  const { data: section, error: sectionError } = await supabase
    .from("sections")
    .select("name")
    .eq("id", sectionId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (sectionError) throw new Error(sectionError.message);
  if (!section) throw new Error("Section not found");

  const { count, error: countError } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("college_id", institutionId)
    .eq("section_id", sectionId);

  if (countError) throw new Error(countError.message);
  return `${section.name}${String(Number(count ?? 0) + 1).padStart(3, "0")}`;
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);
    const institutionId = institution.institutionId;

    let scopedDepartmentId: string | null = null;
    if (institution.institutionType === "college" && (ctx.role === "HOD" || ctx.role === "Faculty")) {
      scopedDepartmentId = ctx.departmentId || null;
      if (!scopedDepartmentId) return apiError("Department context missing", 400);
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("admissions")
      .select("id,student_name,email,phone,section_id,roll_number,term,current_semester,status,created_at,department_id,slot_id")
      .eq("college_id", institutionId)
      .order("created_at", { ascending: false });

    if (scopedDepartmentId) {
      query = query.eq("department_id", scopedDepartmentId);
    }

    const { data, error } = await query;

    if (error && !isMissingCurrentSemesterColumnError(error.message)) return apiError(error.message, 500);

    if (error) {
      let fallbackQuery = supabase
        .from("admissions")
        .select("id,student_name,email,phone,status,created_at,department_id,slot_id")
        .eq("college_id", institutionId)
        .order("created_at", { ascending: false });

      if (scopedDepartmentId) {
        fallbackQuery = fallbackQuery.eq("department_id", scopedDepartmentId);
      }

      const fallback = await fallbackQuery;

      if (fallback.error) return apiError(fallback.error.message, 500);

      const admissions = ((fallback.data ?? []) as AdmissionDbRow[]).map((item) => ({
        id: item.id,
        studentName: item.student_name,
        email: item.email,
        phone: item.phone,
        currentSemester: null,
        sectionId: null,
        rollNumber: null,
        term: null,
        status: item.status,
        createdAt: item.created_at,
        departmentId: item.department_id,
        slotId: item.slot_id,
      }));

      return apiSuccess(admissions);
    }

    const admissions = ((data ?? []) as AdmissionDbRow[]).map((item) => ({
      id: item.id,
      studentName: item.student_name,
      email: item.email,
      phone: item.phone,
      currentSemester: item.current_semester ?? null,
      sectionId: item.section_id ?? null,
      rollNumber: item.roll_number ?? null,
      term: item.term ?? null,
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
    const institution = await getInstitutionContext(ctx);
    const institutionId = institution.institutionId;

    const body = schema.parse(await request.json());

    if (institution.institutionType === "college" && (ctx.role === "HOD" || ctx.role === "Faculty")) {
      const creatorDepartmentId = ctx.departmentId || null;
      if (!creatorDepartmentId) return apiError("Department context missing", 400);
      if (!body.departmentId || body.departmentId !== creatorDepartmentId) {
        return apiError(`${ctx.role} can only create Student in own department`, 403);
      }
    }

    const supabase = getSupabaseAdmin();
    const normalizedEmail = body.email.trim().toLowerCase();
    const normalizedPhone = body.phone?.trim() || null;
    const normalizedSemester = body.currentSemester ?? 1;

    const { data: existingAdmissionByEmail, error: existingAdmissionByEmailError } = await supabase
      .from("admissions")
      .select("id")
      .eq("college_id", institutionId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingAdmissionByEmailError) return apiError(existingAdmissionByEmailError.message, 400);
    if (existingAdmissionByEmail) return apiError("Student email already exists", 400);

    if (normalizedPhone) {
      const { data: existingAdmissionByPhone, error: existingAdmissionByPhoneError } = await supabase
        .from("admissions")
        .select("id")
        .eq("college_id", institutionId)
        .eq("phone", normalizedPhone)
        .maybeSingle();

      if (existingAdmissionByPhoneError) return apiError(existingAdmissionByPhoneError.message, 400);
      if (existingAdmissionByPhone) return apiError("Student phone number already exists", 400);
    }

    let admission:
      | {
          admission_id: string;
          student_id: string;
          fee_id: string;
          available_seats: number | null;
        }
      | null = null;

    if (institution.institutionType === "school") {
      if (!body.classId || !body.sectionId || !body.term) {
        return apiError("classId, sectionId and term are required for school admission", 400);
      }

      const [{ data: classRow, error: classError }, { data: sectionRow, error: sectionError }] = await Promise.all([
        supabase
          .from("classes")
          .select("id,name")
          .eq("id", body.classId)
          .eq("institution_id", institutionId)
          .maybeSingle(),
        supabase
          .from("sections")
          .select("id,class_id,total_seats,filled_seats")
          .eq("id", body.sectionId)
          .eq("institution_id", institutionId)
          .maybeSingle(),
      ]);

      if (classError || sectionError) {
        const message = classError?.message ?? sectionError?.message ?? "Failed to validate class/section";
        if (isMissingSchoolColumnsError(message)) {
          return apiError("School columns are missing in DB. Run institution_type_unified_additive.sql", 400);
        }
        return apiError(message, 500);
      }

      if (!classRow) return apiError("Class not found", 404);
      if (!sectionRow) return apiError("Section not found", 404);
      if (sectionRow.class_id !== body.classId) return apiError("Section does not belong to selected class", 400);

      const totalSeats = Number(sectionRow.total_seats ?? 0);
      const filledSeats = Number(sectionRow.filled_seats ?? 0);
      if (filledSeats >= totalSeats) return apiError("No seats available in selected section", 400);

      let schoolDepartmentId: string;
      try {
        schoolDepartmentId = await ensureSchoolDepartmentId({ supabase, institutionId });
      } catch (schoolDeptError) {
        return apiError("Unable to prepare school department", 500, String(schoolDeptError));
      }

      let schoolSlotId: string;
      try {
        schoolSlotId = await ensureSchoolSlotId({
          supabase,
          institutionId,
          departmentId: schoolDepartmentId,
          className: classRow.name,
        });
      } catch (schoolSlotError) {
        return apiError("Unable to prepare school slot mapping", 500, String(schoolSlotError));
      }

      let rollNumber = body.rollNumber?.trim() || "";
      if (!rollNumber) {
        try {
          rollNumber = await generateRollNumberForSection({
            supabase,
            institutionId,
            sectionId: body.sectionId,
          });
        } catch (rollError) {
          return apiError("Unable to generate roll number", 500, String(rollError));
        }
      }

      const { data: createdAdmission, error: createAdmissionError } = await supabase
        .from("admissions")
        .insert({
          college_id: institutionId,
          department_id: schoolDepartmentId,
          slot_id: schoolSlotId,
          student_name: body.studentName,
          email: normalizedEmail,
          phone: normalizedPhone,
          current_semester: 1,
          section_id: body.sectionId,
          roll_number: rollNumber,
          term: body.term,
          status: "Approved",
        })
        .select("id")
        .single();

      if (createAdmissionError) {
        if (isMissingSchoolColumnsError(createAdmissionError.message)) {
          return apiError("School columns are missing in DB. Run institution_type_unified_additive.sql", 400);
        }
        return apiError(createAdmissionError.message, 400);
      }

      const { data: createdStudent, error: createStudentError } = await supabase
        .from("students")
        .insert({
          college_id: institutionId,
          institution_id: institutionId,
          department_id: schoolDepartmentId,
          slot_id: schoolSlotId,
          admission_id: createdAdmission.id,
          name: body.studentName,
          email: normalizedEmail,
          current_semester: 1,
          class_id: body.classId,
          section_id: body.sectionId,
          roll_number: rollNumber,
          term: body.term,
        })
        .select("id")
        .single();

      if (createStudentError) return apiError(createStudentError.message, 400);

      const { data: createdFee, error: createFeeError } = await supabase
        .from("fees")
        .insert({
          college_id: institutionId,
          admission_id: createdAdmission.id,
          student_id: createdStudent.id,
          amount: body.feeAmount,
          due_amount: body.feeAmount,
          status: body.feeAmount > 0 ? "Pending" : "Paid",
        })
        .select("id")
        .single();

      if (createFeeError) return apiError(createFeeError.message, 400);

      const { error: updateSectionError } = await supabase
        .from("sections")
        .update({ filled_seats: filledSeats + 1 })
        .eq("id", body.sectionId)
        .eq("institution_id", institutionId);

      if (updateSectionError) return apiError(updateSectionError.message, 500);

      admission = {
        admission_id: createdAdmission.id,
        student_id: createdStudent.id,
        fee_id: createdFee.id,
        available_seats: Math.max(totalSeats - (filledSeats + 1), 0),
      };
    } else {
      if (!body.departmentId || !body.slotId) {
        return apiError("departmentId and slotId are required for college admission", 400);
      }

      const { data, error } = await supabase.rpc("create_admission_flow", {
        p_college_id: institutionId,
        p_department_id: body.departmentId,
        p_slot_id: body.slotId,
        p_student_name: body.studentName,
        p_email: normalizedEmail,
        p_phone: normalizedPhone,
        p_fee_amount: body.feeAmount,
      });

      if (error) return apiError(error.message, 400);
      admission = (Array.isArray(data) ? data[0] : data) ?? null;
    }

    if (!admission?.admission_id || !admission?.student_id) {
      return apiError("Admission flow did not return required IDs", 500);
    }

    if (admission?.admission_id) {
      const { error: admissionSemesterError } = await supabase
        .from("admissions")
        .update({ current_semester: normalizedSemester })
        .eq("id", admission.admission_id)
        .eq("college_id", institutionId);

      if (admissionSemesterError && !isMissingCurrentSemesterColumnError(admissionSemesterError.message)) {
        return apiError(admissionSemesterError.message, 400);
      }
    }

    if (admission?.student_id) {
      const { error: studentSemesterError } = await supabase
        .from("students")
        .update({ current_semester: normalizedSemester })
        .eq("id", admission.student_id)
        .eq("college_id", institutionId);

      if (studentSemesterError && !isMissingCurrentSemesterColumnError(studentSemesterError.message)) {
        return apiError(studentSemesterError.message, 400);
      }
    }

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

      const departmentForUser = body.departmentId ?? ctx.departmentId ?? null;

      if (!userId) {
        const { data: newUser, error: createUserError } = await supabase
          .from("users")
          .insert({
            college_id: institutionId,
            department_id: departmentForUser,
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
            department_id: departmentForUser,
            college_id: institutionId,
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
          institutionType: institution.institutionType,
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create admission", 500, String(error));
  }
}
