import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(institutionId))) return apiError("Timetable is available only for school mode", 400);

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
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(institutionId))) return apiError("Timetable is available only for school mode", 400);

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
