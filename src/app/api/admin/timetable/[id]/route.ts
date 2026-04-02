import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function hasTimeOverlap(
  startA: string | null | undefined,
  endA: string | null | undefined,
  startB: string | null | undefined,
  endB: string | null | undefined,
) {
  const aStart = parseTimeToMinutes(startA);
  const aEnd = parseTimeToMinutes(endA);
  const bStart = parseTimeToMinutes(startB);
  const bEnd = parseTimeToMinutes(endB);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return null;
  return aStart < bEnd && bStart < aEnd;
}

const schema = z.object({
  sectionId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional().nullable(),
  teacherId: z.string().uuid().optional(),
  day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]).optional(),
  periodNumber: z.number().int().min(1).max(12).optional(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
});

async function validateSchoolTimetableAssignment(params: {
  institutionId: string;
  sectionId: string;
  subjectId: string | null;
  teacherId: string;
}) {
  const { institutionId, sectionId, subjectId, teacherId } = params;
  const supabase = getSupabaseAdmin();

  const { data: section, error: sectionError } = await supabase
    .from("sections")
    .select("id,class_id")
    .eq("id", sectionId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (sectionError) throw new Error(sectionError.message);
  if (!section) return { ok: false as const, status: 404, message: "Section not found" };

  const { data: teacher, error: teacherError } = await supabase
    .from("users")
    .select("id,role,college_id")
    .eq("id", teacherId)
    .eq("college_id", institutionId)
    .maybeSingle();

  if (teacherError) throw new Error(teacherError.message);
  if (!teacher) return { ok: false as const, status: 404, message: "Teacher not found" };
  if ((teacher.role as string) !== "Faculty") {
    return { ok: false as const, status: 400, message: "Only Faculty can be assigned in timetable" };
  }

  if (subjectId) {
    const { data: subject, error: subjectError } = await supabase
      .from("subjects")
      .select("id,class_id,college_id")
      .eq("id", subjectId)
      .eq("college_id", institutionId)
      .maybeSingle();

    if (subjectError) throw new Error(subjectError.message);
    if (!subject) return { ok: false as const, status: 404, message: "Subject not found" };
    if (subject.class_id && subject.class_id !== section.class_id) {
      return { ok: false as const, status: 400, message: "Selected subject does not belong to this class" };
    }

    const { data: mapping, error: mappingError } = await supabase
      .from("faculty_subjects")
      .select("id")
      .eq("faculty_id", teacherId)
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (mappingError) throw new Error(mappingError.message);
    if (!mapping) {
      return { ok: false as const, status: 400, message: "Selected teacher is not mapped to selected subject" };
    }
  }

  return { ok: true as const };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);
    const institutionId = institution.institutionId;
    if (institution.institutionType !== "school") return apiError("Timetable is available only for school mode", 400);

    const body = schema.parse(await request.json());
    const updatePayload: Record<string, unknown> = {};
    if (body.sectionId !== undefined) updatePayload.section_id = body.sectionId;
    if (body.subjectId !== undefined) updatePayload.subject_id = body.subjectId;
    if (body.teacherId !== undefined) updatePayload.teacher_id = body.teacherId;
    if (body.day !== undefined) updatePayload.day = body.day;
    if (body.periodNumber !== undefined) updatePayload.period_number = body.periodNumber;
    if (body.startTime !== undefined) updatePayload.start_time = body.startTime;
    if (body.endTime !== undefined) updatePayload.end_time = body.endTime;
    if (body.roomId !== undefined) updatePayload.room_id = body.roomId;

    if (Object.keys(updatePayload).length === 0) {
      return apiError("No fields provided for update", 400);
    }

    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from("timetable")
      .select("id,section_id,subject_id,teacher_id,day,period_number,room_id,start_time,end_time")
      .eq("id", id)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (existingError) return apiError(existingError.message, 500);
    if (!existing) return apiError("Timetable entry not found", 404);

    const finalSectionId = (updatePayload.section_id as string | undefined) ?? (existing.section_id as string);
    const finalSubjectId = (updatePayload.subject_id as string | null | undefined) ?? (existing.subject_id as string | null);
    const finalTeacherId = (updatePayload.teacher_id as string | undefined) ?? (existing.teacher_id as string);
    const finalDay = (updatePayload.day as string | undefined) ?? (existing.day as string);
    const finalPeriodNumber = (updatePayload.period_number as number | undefined) ?? (existing.period_number as number);
    const finalRoomId = (updatePayload.room_id as string | null | undefined) ?? (existing.room_id as string | null);

    const validation = await validateSchoolTimetableAssignment({
      institutionId,
      sectionId: finalSectionId,
      subjectId: finalSubjectId,
      teacherId: finalTeacherId,
    });
    if (!validation.ok) return apiError(validation.message, validation.status);

    const { data: sectionConflict, error: sectionConflictError } = await supabase
      .from("timetable")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("day", finalDay)
      .eq("period_number", finalPeriodNumber)
      .eq("section_id", finalSectionId)
      .neq("id", id)
      .limit(1)
      .maybeSingle();

    if (sectionConflictError) return apiError(sectionConflictError.message, 500);
    if (sectionConflict) return apiError("Section already has a timetable entry for this day and period", 409);

    const { data: teacherRows, error: teacherConflictError } = await supabase
      .from("timetable")
      .select("id,period_number,start_time,end_time")
      .eq("institution_id", institutionId)
      .eq("day", finalDay)
      .eq("teacher_id", finalTeacherId)
      .neq("id", id)
      .limit(200);

    if (teacherConflictError) return apiError(teacherConflictError.message, 500);

    const teacherConflict = (teacherRows ?? []).find((row) => {
      const overlap = hasTimeOverlap(
        (updatePayload.start_time as string | null | undefined) ?? (existing.start_time as string | null | undefined),
        (updatePayload.end_time as string | null | undefined) ?? (existing.end_time as string | null | undefined),
        row.start_time,
        row.end_time,
      );
      if (overlap === true) return true;
      if (overlap === false) return false;
      return Number(row.period_number) === Number(finalPeriodNumber);
    });

    if (teacherConflict) return apiError("Teacher already has another section that overlaps in this day/period/time", 409);

    if (finalRoomId) {
      const { data: roomConflict, error: roomConflictError } = await supabase
        .from("timetable")
        .select("id")
        .eq("institution_id", institutionId)
        .eq("day", finalDay)
        .eq("period_number", finalPeriodNumber)
        .eq("room_id", finalRoomId)
        .neq("id", id)
        .limit(1)
        .maybeSingle();

      if (roomConflictError) return apiError(roomConflictError.message, 500);
      if (roomConflict) return apiError("Room is already occupied for this day and period", 409);
    }

    const { data, error } = await supabase
      .from("timetable")
      .update(updatePayload)
      .eq("id", id)
      .eq("institution_id", institutionId)
      .select("id,section_id,subject_id,teacher_id,day,period_number,start_time,end_time,room_id,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess({
      id: data.id,
      sectionId: data.section_id,
      subjectId: data.subject_id,
      teacherId: data.teacher_id,
      day: data.day,
      periodNumber: data.period_number,
      startTime: data.start_time,
      endTime: data.end_time,
      roomId: data.room_id,
      createdAt: data.created_at,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update timetable entry", 500, String(error));
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);
    const institutionId = institution.institutionId;
    if (institution.institutionType !== "school") return apiError("Timetable is available only for school mode", 400);

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("timetable")
      .delete()
      .eq("id", id)
      .eq("institution_id", institutionId);

    if (error) return apiError(error.message, 500);
    return apiSuccess({ id, deleted: true });
  } catch (error) {
    return apiError("Unable to delete timetable entry", 500, String(error));
  }
}
