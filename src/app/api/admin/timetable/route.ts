import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { timetableCreateSchema } from "@/lib/validators/institution";

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

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);

    if (!(await isSchoolInstitution(institutionId))) return apiSuccess([]);

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
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);

    if (!(await isSchoolInstitution(institutionId))) {
      return apiError("Timetable is available only for school mode", 400);
    }

    const body = timetableCreateSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .select("id")
      .eq("id", body.sectionId)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (sectionError) return apiError(sectionError.message, 500);
    if (!section) return apiError("Section not found", 404);

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

    const { data: teacherConflict, error: teacherConflictError } = await supabase
      .from("timetable")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("day", body.day)
      .eq("period_number", body.periodNumber)
      .eq("teacher_id", body.teacherId)
      .limit(1)
      .maybeSingle();

    if (teacherConflictError) return apiError(teacherConflictError.message, 500);
    if (teacherConflict) {
      return apiError("Teacher already has another section in this day and period", 409);
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
