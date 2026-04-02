import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  slotId: z.string().uuid().optional(),
  fromSemester: z.number().int().min(1).max(12).optional(),
  targetSemester: z.number().int().min(1).max(12).optional(),
  fromClassId: z.string().uuid().optional(),
  targetClassId: z.string().uuid().optional(),
  targetSectionId: z.string().uuid().optional(),
  targetTerm: z.string().max(20).optional(),
});

function isMissingCurrentSemesterColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("current_semester") && (text.includes("column") || text.includes("schema cache"));
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
  return Math.max(due, computedDue) > 0.01;
}

async function generateRollNumberForSection(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  sectionId: string;
  institutionId: string;
}) {
  const { supabase, sectionId, institutionId } = params;
  const { data: section, error: sectionError } = await supabase
    .from("sections")
    .select("name")
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
  return `${section.name}${String(Number(count ?? 0) + 1).padStart(3, "0")}`;
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

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);
    const isSchool = await isSchoolInstitution(ctx.collegeId);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

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
        const [{ data: legacyFees, error: legacyFeesError }, { data: v3Fees, error: v3FeesError }] = await Promise.all([
          supabase
            .from("fees")
            .select("id,amount,paid_amount,due_amount,status")
            .eq("college_id", ctx.collegeId)
            .eq("student_id", candidate.id),
          supabase
            .from("student_fees")
            .select("id,grand_total,paid_total,due_total,status")
            .eq("college_id", ctx.collegeId)
            .eq("student_id", candidate.id),
        ]);

        if (legacyFeesError || v3FeesError) {
          results.push({
            studentId: candidate.id as string,
            name: candidate.name as string,
            upgraded: false,
            message: legacyFeesError?.message ?? v3FeesError?.message ?? "Fee validation failed",
          });
          continue;
        }

        const hasLegacyDue = (legacyFees ?? []).some((fee) =>
          isOpenDueStatus(fee.status) && hasOutstandingAmount(fee.due_amount, fee.amount, fee.paid_amount, fee.status),
        );
        const hasV3Due = (v3Fees ?? []).some((fee) =>
          isOpenDueStatus(fee.status) && hasOutstandingAmount(fee.due_total, fee.grand_total, fee.paid_total, fee.status),
        );

        if (hasLegacyDue || hasV3Due) {
          results.push({
            studentId: candidate.id as string,
            name: candidate.name as string,
            upgraded: false,
            message: "dues_pending",
          });
          continue;
        }

        let nextSectionId = body.targetSectionId ?? null;
        if (!nextSectionId && candidate.section_id) {
          const { data: currentSection, error: currentSectionError } = await supabase
            .from("sections")
            .select("name")
            .eq("id", candidate.section_id)
            .eq("institution_id", ctx.collegeId)
            .maybeSingle();

          if (!currentSectionError && currentSection?.name) {
            const { data: sameNamedTargetSection } = await supabase
              .from("sections")
              .select("id")
              .eq("institution_id", ctx.collegeId)
              .eq("class_id", body.targetClassId)
              .eq("name", currentSection.name)
              .maybeSingle();

            nextSectionId = (sameNamedTargetSection?.id as string | undefined) ?? null;
          }
        }

        let nextRollNumber: string | null = null;
        if (nextSectionId) {
          try {
            nextRollNumber = await generateRollNumberForSection({
              supabase,
              sectionId: nextSectionId,
              institutionId: ctx.collegeId,
            });
          } catch (rollError) {
            results.push({
              studentId: candidate.id as string,
              name: candidate.name as string,
              upgraded: false,
              message: rollError instanceof Error ? rollError.message : "roll_number_failed",
            });
            continue;
          }
        }

        const { error: updateStudentError } = await supabase
          .from("students")
          .update({
            class_id: body.targetClassId,
            section_id: nextSectionId,
            term: body.targetTerm ?? null,
            roll_number: nextRollNumber,
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

    if (!body.slotId) return apiError("slotId is required for bulk semester promotion", 400);

    const fromSemester = body.fromSemester ?? 1;
    const targetSemester = body.targetSemester ?? fromSemester + 1;

    if (targetSemester <= fromSemester) {
      return apiError("Target semester must be greater than source semester", 400);
    }

    const { data: candidates, error: candidatesError } = await supabase
      .from("students")
      .select("id,name,current_semester")
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

    const studentsToPromote = candidates ?? [];
    if (studentsToPromote.length === 0) {
      return apiError("No students found for selected slot and semester", 400);
    }

    const results: Array<{ studentId: string; name: string; upgraded: boolean; message: string }> = [];
    let upgradedCount = 0;

    for (const candidate of studentsToPromote) {
      const { error: updateStudentError } = await supabase
        .from("students")
        .update({ current_semester: targetSemester })
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
      slotId: body.slotId,
      fromSemester,
      targetSemester,
      totalCandidates: studentsToPromote.length,
      upgradedCount,
      skippedCount: studentsToPromote.length - upgradedCount,
      results,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to bulk promote students", 500, String(error));
  }
}
