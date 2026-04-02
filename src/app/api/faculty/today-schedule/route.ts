import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function getTodayName() {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[new Date().getDay()];
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

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Faculty"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId || !ctx.userId || !ctx.collegeId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();

    if (await isSchoolInstitution(institutionId)) {
      const todayName = getTodayName();
      const { data, error } = await supabase
        .from("timetable")
        .select("id,period_number,start_time,end_time,section_id,subject_id,room_id")
        .eq("institution_id", institutionId)
        .eq("teacher_id", ctx.userId)
        .eq("day", todayName)
        .order("period_number", { ascending: true });

      if (error) return apiError(error.message, 500);

      const rows = data ?? [];
      const sectionIds = Array.from(new Set(rows.map((row) => row.section_id as string).filter(Boolean)));
      const subjectIds = Array.from(new Set(rows.map((row) => row.subject_id as string | null).filter(Boolean) as string[]));
      const roomIds = Array.from(new Set(rows.map((row) => row.room_id as string | null).filter(Boolean) as string[]));

      const [sectionsRes, subjectsRes, roomsRes] = await Promise.all([
        sectionIds.length ? supabase.from("sections").select("id,name").in("id", sectionIds) : Promise.resolve({ data: [], error: null }),
        subjectIds.length ? supabase.from("subjects").select("id,name").in("id", subjectIds) : Promise.resolve({ data: [], error: null }),
        roomIds.length ? supabase.from("rooms").select("id,name").in("id", roomIds) : Promise.resolve({ data: [], error: null }),
      ]);

      if (sectionsRes.error) return apiError(sectionsRes.error.message, 500);
      if (subjectsRes.error) return apiError(subjectsRes.error.message, 500);
      if (roomsRes.error) return apiError(roomsRes.error.message, 500);

      const sectionName = new Map((sectionsRes.data ?? []).map((row) => [row.id as string, row.name as string]));
      const subjectName = new Map((subjectsRes.data ?? []).map((row) => [row.id as string, row.name as string]));
      const roomName = new Map((roomsRes.data ?? []).map((row) => [row.id as string, row.name as string]));

      return apiSuccess({
        mode: "school",
        periods: rows.map((row) => ({
          id: row.id,
          periodNumber: row.period_number,
          subjectName: row.subject_id ? subjectName.get(row.subject_id as string) ?? "Subject" : "General",
          sectionName: sectionName.get(row.section_id as string) ?? "Section",
          roomName: row.room_id ? roomName.get(row.room_id as string) ?? "TBD" : "TBD",
          startTime: row.start_time,
          endTime: row.end_time,
        })),
      });
    }

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("lectures")
      .select("id,starts_at,ends_at,room_id,subject_id")
      .eq("college_id", ctx.collegeId)
      .eq("faculty_id", ctx.userId)
      .gte("starts_at", dayStart.toISOString())
      .lte("starts_at", dayEnd.toISOString())
      .order("starts_at", { ascending: true });

    if (error) return apiError(error.message, 500);

    const rows = data ?? [];
    const subjectIds = Array.from(new Set(rows.map((row) => row.subject_id as string | null).filter(Boolean) as string[]));
    const roomIds = Array.from(new Set(rows.map((row) => row.room_id as string | null).filter(Boolean) as string[]));

    const [subjectsRes, roomsRes] = await Promise.all([
      subjectIds.length ? supabase.from("subjects").select("id,name").in("id", subjectIds) : Promise.resolve({ data: [], error: null }),
      roomIds.length ? supabase.from("rooms").select("id,name").in("id", roomIds) : Promise.resolve({ data: [], error: null }),
    ]);

    if (subjectsRes.error) return apiError(subjectsRes.error.message, 500);
    if (roomsRes.error) return apiError(roomsRes.error.message, 500);

    const subjectName = new Map((subjectsRes.data ?? []).map((row) => [row.id as string, row.name as string]));
    const roomName = new Map((roomsRes.data ?? []).map((row) => [row.id as string, row.name as string]));

    return apiSuccess({
      mode: "college",
      lectures: rows.map((row) => ({
        id: row.id,
        subjectName: row.subject_id ? subjectName.get(row.subject_id as string) ?? "Subject" : "General",
        roomName: row.room_id ? roomName.get(row.room_id as string) ?? "TBD" : "TBD",
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      })),
    });
  } catch (error) {
    return apiError("Unable to load today's schedule", 500, String(error));
  }
}
