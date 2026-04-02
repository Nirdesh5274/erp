import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcStudentFeeTotals } from "@/lib/feeManagement";
import { z } from "zod";

const patchSchema = z.object({
  studentId: z.string().uuid().optional(),
  action: z.enum(["regeneratePassword", "upgradeSemester", "bulkUpgradeSemester", "deactivate"]).optional(),
  slotId: z.string().uuid().optional(),
  fromSemester: z.number().int().min(1).max(12).optional(),
  targetSemester: z.number().int().min(1).max(12).optional(),
  fromClassId: z.string().uuid().optional(),
  targetClassId: z.string().uuid().optional(),
  fromSectionId: z.string().uuid().optional(),
  targetSectionId: z.string().uuid().optional(),
  targetTerm: z.string().max(20).optional(),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(120).optional(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  status: z.enum(["all", "active", "inactive", "graduated"]).default("all"),
});

function generateTempPassword() {
  const randomPart = Math.random().toString(36).slice(-6);
  return `Stu@${randomPart}`;
}

function isMissingCurrentSemesterColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("current_semester") && (text.includes("column") || text.includes("schema cache"));
}

function isMissingSemesterColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("semester") && (text.includes("column") || text.includes("schema cache"));
}

function isMissingSchoolColumnsError(message: string) {
  const text = message.toLowerCase();
  return (
    (text.includes("class_id") || text.includes("section_id") || text.includes("term"))
    && (text.includes("column") || text.includes("schema cache"))
  );
}

function isOpenDueStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "pending" || normalized === "partially paid";
}

function toFiniteNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasOutstandingAmount(
  dueValue: unknown,
  totalValue: unknown,
  paidValue: unknown,
  status: string | null | undefined,
) {
  const normalizedStatus = String(status ?? "").toLowerCase();
  if (normalizedStatus === "cancelled") return false;

  const due = toFiniteNumber(dueValue);
  const total = toFiniteNumber(totalValue);
  const paid = toFiniteNumber(paidValue);

  const computedDue = Math.max(total - paid, 0);
  const effectiveDue = Math.max(due, computedDue);

  // Avoid blocking promotion on floating precision dust (for example 0.0000001)
  return effectiveDue > 0.01;
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

async function performSemesterUpgradeForStudent(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  collegeId: string;
  student: {
    id: string;
    admission_id: string | null;
    slot_id?: string | null;
    current_semester?: number | null;
  };
  targetSemester: number;
}) {
  const { supabase, collegeId, student, targetSemester } = params;
  const currentSemester = Number(student.current_semester ?? 1);

  if (targetSemester <= currentSemester) {
    return { ok: false as const, error: "Target semester must be greater than current semester" };
  }

  if (targetSemester > 12) {
    return { ok: false as const, error: "Target semester cannot be greater than 12" };
  }

  const slotId = student.slot_id ?? null;
  if (!slotId) {
    return { ok: false as const, error: "Student slot is missing. Cannot auto-generate semester fee." };
  }

  const { data: targetStructure, error: targetStructureError } = await supabase
    .from("fee_structures")
    .select("id,name")
    .eq("college_id", collegeId)
    .eq("slot_id", slotId)
    .eq("semester", targetSemester)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (targetStructureError) {
    if (isMissingSemesterColumnError(targetStructureError.message)) {
      return { ok: false as const, error: "Semester-wise fee structures are not migrated yet. Run latest DB migration." };
    }
    return { ok: false as const, error: targetStructureError.message };
  }

  if (!targetStructure) {
    return { ok: false as const, error: `No active fee structure found for semester ${targetSemester} in selected slot.` };
  }

  const { data: targetComponents, error: targetComponentsError } = await supabase
    .from("fee_components")
    .select("id,component_name,default_amount")
    .eq("fee_structure_id", targetStructure.id)
    .order("sort_order", { ascending: true });

  if (targetComponentsError) return { ok: false as const, error: targetComponentsError.message };
  if ((targetComponents ?? []).length === 0) return { ok: false as const, error: "Selected semester fee structure has no components" };

  const [{ data: legacyFees, error: legacyFeesError }, { data: v3Fees, error: v3FeesError }] = await Promise.all([
    supabase
      .from("fees")
      .select("id,amount,paid_amount,due_amount,status")
      .eq("college_id", collegeId)
      .eq("student_id", student.id),
    supabase
      .from("student_fees")
      .select("id,grand_total,paid_total,due_total,status")
      .eq("college_id", collegeId)
      .eq("student_id", student.id),
  ]);

  if (legacyFeesError) return { ok: false as const, error: legacyFeesError.message };
  if (v3FeesError) return { ok: false as const, error: v3FeesError.message };

  const hasLegacyDue = (legacyFees ?? []).some((fee) =>
    hasOutstandingAmount(fee.due_amount, fee.amount, fee.paid_amount, fee.status)
    && isOpenDueStatus(fee.status),
  );
  const hasV3Due = (v3Fees ?? []).some((fee) =>
    hasOutstandingAmount(fee.due_total, fee.grand_total, fee.paid_total, fee.status)
    && isOpenDueStatus(fee.status),
  );

  const legacyOutstanding = (legacyFees ?? []).reduce((sum, fee) => {
    if (!isOpenDueStatus(fee.status)) return sum;
    const due = Math.max(toFiniteNumber(fee.due_amount), Math.max(toFiniteNumber(fee.amount) - toFiniteNumber(fee.paid_amount), 0));
    return sum + (due > 0.01 ? due : 0);
  }, 0);

  const v3Outstanding = (v3Fees ?? []).reduce((sum, fee) => {
    if (!isOpenDueStatus(fee.status)) return sum;
    const due = Math.max(toFiniteNumber(fee.due_total), Math.max(toFiniteNumber(fee.grand_total) - toFiniteNumber(fee.paid_total), 0));
    return sum + (due > 0.01 ? due : 0);
  }, 0);

  if (hasLegacyDue || hasV3Due) {
    const totalOutstanding = legacyOutstanding + v3Outstanding;
    return { ok: false as const, error: `Cannot upgrade semester while fee dues are pending (Outstanding: ₹${totalOutstanding.toFixed(2)}). Clear dues first.` };
  }

  const { error: studentUpgradeError } = await supabase
    .from("students")
    .update({ current_semester: targetSemester })
    .eq("id", student.id)
    .eq("college_id", collegeId);

  if (studentUpgradeError) {
    if (isMissingCurrentSemesterColumnError(studentUpgradeError.message)) {
      return { ok: false as const, error: "Semester column is missing in DB. Run latest migration to enable upgrades." };
    }
    return { ok: false as const, error: studentUpgradeError.message };
  }

  if (student.admission_id) {
    const { error: admissionUpgradeError } = await supabase
      .from("admissions")
      .update({ current_semester: targetSemester })
      .eq("id", student.admission_id)
      .eq("college_id", collegeId);

    if (admissionUpgradeError && !isMissingCurrentSemesterColumnError(admissionUpgradeError.message)) {
      return { ok: false as const, error: admissionUpgradeError.message };
    }
  }

  const { data: existingSemesterFee, error: existingSemesterFeeError } = await supabase
    .from("student_fees")
    .select("id")
    .eq("college_id", collegeId)
    .eq("student_id", student.id)
    .eq("fee_structure_id", targetStructure.id)
    .maybeSingle();

  if (existingSemesterFeeError) return { ok: false as const, error: existingSemesterFeeError.message };

  let createdFeeId: string | null = null;
  if (!existingSemesterFee) {
    const { data: createdFee, error: createdFeeError } = await supabase
      .from("student_fees")
      .insert({
        college_id: collegeId,
        student_id: student.id,
        admission_id: student.admission_id,
        slot_id: slotId,
        fee_structure_id: targetStructure.id,
        notes: `Auto-generated on semester upgrade to Semester ${targetSemester}`,
      })
      .select("id")
      .single();

    if (createdFeeError) return { ok: false as const, error: createdFeeError.message };

    createdFeeId = createdFee.id as string;

    const itemPayload = (targetComponents ?? []).map((component) => ({
      student_fee_id: createdFeeId,
      college_id: collegeId,
      source_component_id: component.id,
      item_type: "component",
      label: component.component_name,
      amount: Number(component.default_amount ?? 0),
      quantity: 1,
      metadata: {
        source: "semester_upgrade",
        semester: targetSemester,
        structureName: targetStructure.name,
      },
    }));

    const { error: insertItemsError } = await supabase.from("student_fee_items").insert(itemPayload);
    if (insertItemsError) return { ok: false as const, error: insertItemsError.message };

    await recalcStudentFeeTotals(supabase, createdFeeId);
  }

  return {
    ok: true as const,
    data: {
      studentId: student.id,
      previousSemester: currentSemester,
      currentSemester: targetSemester,
      feeStructureId: targetStructure.id,
      feeGenerated: !existingSemesterFee,
      generatedFeeId: createdFeeId,
      upgradedAt: new Date().toISOString(),
    },
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);
    const isSchool = await isSchoolInstitution(ctx.collegeId);

    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? 1,
      limit: url.searchParams.get("limit") ?? 20,
      search: url.searchParams.get("search") ?? undefined,
      classId: url.searchParams.get("classId") ?? undefined,
      sectionId: url.searchParams.get("sectionId") ?? undefined,
      status: url.searchParams.get("status") ?? "all",
    });

    const offset = (query.page - 1) * query.limit;
    const searchText = query.search?.trim();

    const supabase = getSupabaseAdmin();
    // Required DB columns for temp password lifecycle:
    // alter table students add column if not exists temp_password text;
    // alter table students add column if not exists must_change_password boolean default false;
    // alter table students add column if not exists password_generated_at timestamptz;
    let studentQuery = supabase
      .from("students")
      .select("id,name,email,department_id,slot_id,class_id,section_id,roll_number,term,status,current_semester,created_at,user_id,temp_password,must_change_password,password_generated_at", { count: "exact" })
      .eq("college_id", ctx.collegeId)
      .eq("institution_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if (isSchool) {
      if (query.classId) studentQuery = studentQuery.eq("class_id", query.classId);
      if (query.sectionId) studentQuery = studentQuery.eq("section_id", query.sectionId);
      if (query.status !== "all") studentQuery = studentQuery.eq("status", query.status);
    }

    if (searchText) {
      const escaped = searchText.replace(/[%_]/g, "");
      studentQuery = studentQuery.or(`name.ilike.%${escaped}%,roll_number.ilike.%${escaped}%`);
    }

    const { data, error, count } = await studentQuery.range(offset, offset + query.limit - 1);

    if (error) {
      const message = error.message.toLowerCase();
      if (!message.includes("temp_password") && !message.includes("must_change_password") && !message.includes("password_generated_at") && !isMissingCurrentSemesterColumnError(error.message)) {
        return apiError(error.message, 500);
      }

      let fallbackQuery = supabase
        .from("students")
        .select("id,name,email,department_id,slot_id,class_id,section_id,roll_number,term,created_at,user_id", { count: "exact" })
        .eq("college_id", ctx.collegeId)
        .eq("institution_id", ctx.collegeId)
        .order("created_at", { ascending: false });

      if (isSchool) {
        if (query.classId) fallbackQuery = fallbackQuery.eq("class_id", query.classId);
        if (query.sectionId) fallbackQuery = fallbackQuery.eq("section_id", query.sectionId);
      }

      if (searchText) {
        const escaped = searchText.replace(/[%_]/g, "");
        fallbackQuery = fallbackQuery.or(`name.ilike.%${escaped}%,roll_number.ilike.%${escaped}%`);
      }

      const { data: fallbackData, error: fallbackError, count: fallbackCount } = await fallbackQuery.range(offset, offset + query.limit - 1);

      if (fallbackError) return apiError(fallbackError.message, 500);

      return apiSuccess(
        {
          rows: (fallbackData ?? []).map((row) => ({
            ...row,
            status: "active",
            current_semester: null,
            temp_password: null,
            must_change_password: false,
            password_generated_at: null,
          })),
          page: query.page,
          limit: query.limit,
          total: Number(fallbackCount ?? 0),
          totalPages: Math.max(Math.ceil(Number(fallbackCount ?? 0) / query.limit), 1),
        },
      );
    }
    return apiSuccess({
      rows: data ?? [],
      page: query.page,
      limit: query.limit,
      total: Number(count ?? 0),
      totalPages: Math.max(Math.ceil(Number(count ?? 0) / query.limit), 1),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid query", 400, error.flatten());
    return apiError("Unable to load students", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);
    const isSchool = await isSchoolInstitution(ctx.collegeId);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (body.action === "bulkUpgradeSemester") {
      if (isSchool) {
        if (!body.fromClassId || !body.targetClassId) {
          return apiError("fromClassId and targetClassId are required for school class promotion", 400);
        }

        const { data: candidates, error: candidatesError } = await supabase
          .from("students")
          .select("id,name,class_id,section_id")
          .eq("college_id", ctx.collegeId)
          .eq("class_id", body.fromClassId)
          .order("name", { ascending: true });

        if (candidatesError) {
          if (isMissingSchoolColumnsError(candidatesError.message)) {
            return apiError("School promotion columns are missing. Run institution_unified_migration.sql", 400);
          }
          return apiError(candidatesError.message, 500);
        }

        const studentsToPromote = candidates ?? [];
        if (studentsToPromote.length === 0) {
          return apiError("No students found for selected class", 400);
        }

        const results: Array<{ studentId: string; name: string; upgraded: boolean; message: string }> = [];
        let upgradedCount = 0;

        for (const candidate of studentsToPromote) {
          const nextSectionId = body.targetSectionId ?? (candidate.section_id as string | null) ?? null;
          const { error: updateStudentError } = await supabase
            .from("students")
            .update({
              class_id: body.targetClassId,
              section_id: nextSectionId,
              term: body.targetTerm ?? null,
            })
            .eq("id", candidate.id)
            .eq("college_id", ctx.collegeId);

          if (updateStudentError) {
            results.push({
              studentId: candidate.id as string,
              name: candidate.name as string,
              upgraded: false,
              message: updateStudentError.message,
            });
            continue;
          }

          upgradedCount += 1;
          results.push({
            studentId: candidate.id as string,
            name: candidate.name as string,
            upgraded: true,
            message: "Promoted",
          });
        }

        return apiSuccess({
          fromClassId: body.fromClassId,
          targetClassId: body.targetClassId,
          targetSectionId: body.targetSectionId ?? null,
          targetTerm: body.targetTerm ?? null,
          totalCandidates: studentsToPromote.length,
          upgradedCount,
          skippedCount: studentsToPromote.length - upgradedCount,
          results,
        });
      }

      if (!body.slotId) return apiError("slotId is required for bulk upgrade", 400);

      const fromSemester = body.fromSemester ?? 1;
      const targetSemester = body.targetSemester ?? fromSemester + 1;

      if (targetSemester <= fromSemester) {
        return apiError("Target semester must be greater than source semester", 400);
      }

      if (targetSemester > 12) {
        return apiError("Target semester cannot be greater than 12", 400);
      }

      const { data: candidates, error: candidatesError } = await supabase
        .from("students")
        .select("id,name,admission_id,slot_id,current_semester")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", body.slotId)
        .eq("current_semester", fromSemester)
        .order("name", { ascending: true });

      if (candidatesError) {
        if (isMissingCurrentSemesterColumnError(candidatesError.message)) {
          return apiError("Semester column is missing in DB. Run latest migration to enable upgrades.", 400);
        }
        return apiError(candidatesError.message, 500);
      }

      const studentsToUpgrade = candidates ?? [];
      if (studentsToUpgrade.length === 0) {
        return apiError("No students found for selected slot and semester", 400);
      }

      const results: Array<{ studentId: string; name: string; upgraded: boolean; message: string }> = [];
      let upgradedCount = 0;

      for (const candidate of studentsToUpgrade) {
        const outcome = await performSemesterUpgradeForStudent({
          supabase,
          collegeId: ctx.collegeId,
          student: {
            id: candidate.id as string,
            admission_id: candidate.admission_id as string | null,
            slot_id: candidate.slot_id as string | null,
            current_semester: candidate.current_semester as number | null,
          },
          targetSemester,
        });

        if (outcome.ok) {
          upgradedCount += 1;
          results.push({ studentId: candidate.id as string, name: candidate.name as string, upgraded: true, message: "Upgraded" });
        } else {
          results.push({ studentId: candidate.id as string, name: candidate.name as string, upgraded: false, message: outcome.error });
        }
      }

      return apiSuccess({
        slotId: body.slotId,
        fromSemester,
        targetSemester,
        totalCandidates: studentsToUpgrade.length,
        upgradedCount,
        skippedCount: studentsToUpgrade.length - upgradedCount,
        results,
      });
    }

    if (!body.studentId) return apiError("studentId is required", 400);

    const { data: studentWithSemester, error: studentWithSemesterError } = await supabase
      .from("students")
      .select("id,name,email,department_id,user_id,admission_id,slot_id,current_semester")
      .eq("id", body.studentId)
      .eq("college_id", ctx.collegeId)
      .single();

    let student = studentWithSemester as
      | {
          id: string;
          name: string;
          email: string;
          department_id: string;
          user_id: string | null;
          admission_id: string | null;
          slot_id?: string | null;
          current_semester?: number | null;
        }
      | null;

    if (studentWithSemesterError) {
      if (!isMissingCurrentSemesterColumnError(studentWithSemesterError.message)) {
        return apiError("Student not found", 404);
      }

      const { data: fallbackStudent, error: fallbackStudentError } = await supabase
        .from("students")
        .select("id,name,email,department_id,user_id,admission_id,slot_id")
        .eq("id", body.studentId)
        .eq("college_id", ctx.collegeId)
        .single();

      if (fallbackStudentError || !fallbackStudent) return apiError("Student not found", 404);
      student = fallbackStudent as typeof student;
    }

    if (!student) return apiError("Student not found", 404);

    const action = body.action ?? (body.targetSemester ? "upgradeSemester" : "regeneratePassword");

    if (action === "deactivate") {
      const { error: deactivateError } = await supabase
        .from("students")
        .update({ status: "inactive" })
        .eq("id", student.id)
        .eq("college_id", ctx.collegeId);

      if (deactivateError) return apiError(deactivateError.message, 500);
      return apiSuccess({ studentId: student.id, status: "inactive" });
    }

    if (action === "upgradeSemester") {
      if (isSchool) {
        return apiError("Use class promotion flow for school mode", 400);
      }

      const currentSemester = Number(student.current_semester ?? 1);
      const targetSemester = body.targetSemester ?? currentSemester + 1;

      const outcome = await performSemesterUpgradeForStudent({
        supabase,
        collegeId: ctx.collegeId,
        student: {
          id: student.id,
          admission_id: student.admission_id,
          slot_id: student.slot_id,
          current_semester: student.current_semester,
        },
        targetSemester,
      });

      if (!outcome.ok) return apiError(outcome.error, 400);
      return apiSuccess(outcome.data);
    }

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
