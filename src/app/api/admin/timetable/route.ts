import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { timetableCreateSchema } from "@/lib/validators/institution";

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
      .select("id,class_id,college_id,institution_id")
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

async function ensureHodCanManageSection(params: {
  userId: string | null;
  institutionId: string;
  sectionId: string;
}) {
  const { userId, institutionId, sectionId } = params;
  if (!userId) return { ok: false as const, status: 400, message: "HOD user context missing" };

  const supabase = getSupabaseAdmin();
  const [{ data: hodRow, error: hodError }, { data: section, error: sectionError }] = await Promise.all([
    supabase
      .from("users")
      .select("id,class_id")
      .eq("id", userId)
      .eq("college_id", institutionId)
      .maybeSingle(),
    supabase
      .from("sections")
      .select("id,class_id")
      .eq("id", sectionId)
      .eq("institution_id", institutionId)
      .maybeSingle(),
  ]);

  if (hodError) {
    const text = hodError.message.toLowerCase();
    if (!(text.includes("class_id") && (text.includes("column") || text.includes("schema cache")))) {
      throw new Error(hodError.message);
    }
  }
  if (sectionError) throw new Error(sectionError.message);
  if (!section) return { ok: false as const, status: 404, message: "Section not found" };

  if (!hodError) {
    const hodClassId = hodRow?.class_id ?? null;
    if (!hodClassId) return { ok: false as const, status: 400, message: "HOD class context missing" };
    if (String(hodClassId) !== String(section.class_id)) {
      return { ok: false as const, status: 403, message: "HOD can only manage timetable for own class" };
    }
  }

  return { ok: true as const };
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);
    const institutionId = institution.institutionId;

    if (institution.institutionType !== "school") return apiSuccess([]);

    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId") ?? searchParams.get("section_id");
    const day = searchParams.get("day");

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("timetable")
      .select("id,section_id,subject_id,teacher_id,day,period_number,start_time,end_time,room_id,created_at")
      .eq("institution_id", institutionId)
      .order("day", { ascending: true })
      .order("period_number", { ascending: true });

    if (sectionId) query = query.eq("section_id", sectionId);
    if (day) query = query.eq("day", day);

    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    return apiSuccess(
      (data ?? []).map((row) => ({
        id: row.id,
        sectionId: row.section_id,
        subjectId: row.subject_id,
        teacherId: row.teacher_id,
        day: row.day,
        periodNumber: row.period_number,
        startTime: row.start_time,
        endTime: row.end_time,
        roomId: row.room_id,
        createdAt: row.created_at,
      })),
    );
  } catch (error) {
    return apiError("Unable to load timetable", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);
    const institutionId = institution.institutionId;

    if (institution.institutionType !== "school") {
      return apiError("Timetable is available only for school mode", 400);
    }

    const body = timetableCreateSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (ctx.role === "HOD") {
      const canManage = await ensureHodCanManageSection({
        userId: ctx.userId ?? null,
        institutionId,
        sectionId: body.sectionId,
      });
      if (!canManage.ok) return apiError(canManage.message, canManage.status);
    }

    const validation = await validateSchoolTimetableAssignment({
      institutionId,
      sectionId: body.sectionId,
      subjectId: body.subjectId ?? null,
      teacherId: body.teacherId,
    });
    if (!validation.ok) return apiError(validation.message, validation.status);

    const { data: sectionConflict, error: sectionConflictError } = await supabase
      .from("timetable")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("day", body.day)
      .eq("period_number", body.periodNumber)
      .eq("section_id", body.sectionId)
      .limit(1)
      .maybeSingle();

    if (sectionConflictError) return apiError(sectionConflictError.message, 500);
    if (sectionConflict) {
      return apiError("Section already has a timetable entry for this day and period", 409);
    }

    const { data: teacherRows, error: teacherConflictError } = await supabase
      .from("timetable")
      .select("id,period_number,start_time,end_time")
      .eq("institution_id", institutionId)
      .eq("day", body.day)
      .eq("teacher_id", body.teacherId)
      .limit(200);

    if (teacherConflictError) return apiError(teacherConflictError.message, 500);

    const teacherConflict = (teacherRows ?? []).find((row) => {
      const overlap = hasTimeOverlap(body.startTime ?? null, body.endTime ?? null, row.start_time, row.end_time);
      if (overlap === true) return true;
      if (overlap === false) return false;
      return Number(row.period_number) === Number(body.periodNumber);
    });

    if (teacherConflict) {
      return apiError("Teacher already has another section that overlaps in this day/period/time", 409);
    }

    if (body.roomId) {
      const { data: roomConflict, error: roomConflictError } = await supabase
        .from("timetable")
        .select("id")
        .eq("institution_id", institutionId)
        .eq("day", body.day)
        .eq("period_number", body.periodNumber)
        .eq("room_id", body.roomId)
        .limit(1)
        .maybeSingle();

      if (roomConflictError) return apiError(roomConflictError.message, 500);
      if (roomConflict) {
        return apiError("Room is already occupied for this day and period", 409);
      }
    }

    const { data, error } = await supabase
      .from("timetable")
      .insert({
        institution_id: institutionId,
        section_id: body.sectionId,
        subject_id: body.subjectId ?? null,
        teacher_id: body.teacherId,
        day: body.day,
        period_number: body.periodNumber,
        start_time: body.startTime ?? null,
        end_time: body.endTime ?? null,
        room_id: body.roomId ?? null,
      })
      .select("id,section_id,subject_id,teacher_id,day,period_number,start_time,end_time,room_id,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess(
      {
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
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create timetable entry", 500, String(error));
  }
}
