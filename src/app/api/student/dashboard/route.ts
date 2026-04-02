import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface UserRow {
  id: string;
  email: string;
  department_id: string | null;
}

const attendanceStatuses = new Set(["present", "late", "half_day", "on_duty", "medical_leave"]);
const lectureSchema = z.object({
  id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  room_id: z.string(),
  faculty_id: z.string(),
  subject_id: z.string().uuid().nullable(),
});
const attendanceRowSchema = z.object({
  status: z.string().optional(),
  lecture: z
    .object({
      id: z.string().uuid().optional(),
      subject_id: z.string().uuid().nullable().optional(),
    })
    .nullable()
    .optional(),
});

function getTodayName() {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[new Date().getDay()];
}

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function combineTodayIso(timeValue: string | null) {
  if (!timeValue) return new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  return `${today}T${timeValue}`;
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
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();
    const schoolMode = await isSchoolInstitution(ctx.collegeId);

    if (schoolMode) {
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id,email")
        .eq("id", ctx.userId)
        .eq("college_id", ctx.collegeId)
        .single();

      if (userError) return apiError(userError.message, 404);

      const [studentByUser, studentByEmail] = await Promise.all([
        supabase
          .from("students")
          .select("id,section_id")
          .eq("college_id", ctx.collegeId)
          .eq("user_id", ctx.userId)
          .maybeSingle(),
        supabase
          .from("students")
          .select("id,section_id")
          .eq("college_id", ctx.collegeId)
          .eq("email", user.email as string)
          .maybeSingle(),
      ]);

      if (studentByUser.error) return apiError(studentByUser.error.message, 500);
      if (studentByEmail.error) return apiError(studentByEmail.error.message, 500);

      const studentId = (studentByUser.data?.id as string | undefined) ?? (studentByEmail.data?.id as string | undefined) ?? null;
      const sectionId = (studentByUser.data?.section_id as string | undefined) ?? (studentByEmail.data?.section_id as string | undefined) ?? null;

      let attendancePercent = 0;
      if (studentId) {
        const { data: attendanceRows, error: attendanceError } = await supabase
          .from("school_attendance")
          .select("status")
          .eq("student_id", studentId);

        if (attendanceError) return apiError(attendanceError.message, 500);

        const total = attendanceRows?.length ?? 0;
        const present = (attendanceRows ?? []).reduce((sum, row) => {
          const status = (row.status as string | null)?.toLowerCase() ?? "";
          if (!attendanceStatuses.has(status)) return sum;
          return sum + (status === "half_day" ? 0.5 : 1);
        }, 0);
        attendancePercent = total === 0 ? 0 : Math.round((present / total) * 100);
      }

      let nextLecture: {
        id: string;
        startsAt: string;
        endsAt: string;
        roomName: string;
        facultyName: string;
        subjectName: string | null;
      } | null = null;

      if (sectionId) {
        const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        const todayName = getTodayName();
        const { data: timetableRows, error: timetableError } = await supabase
          .from("timetable")
          .select("id,room_id,teacher_id,subject_id,start_time,end_time,period_number")
          .eq("institution_id", ctx.collegeId)
          .eq("section_id", sectionId)
          .eq("day", todayName)
          .order("period_number", { ascending: true });

        if (timetableError) return apiError(timetableError.message, 500);

        const nextRow = (timetableRows ?? []).find((row) => {
          const startMinutes = parseTimeToMinutes(row.start_time as string | null);
          if (startMinutes === null) return true;
          return startMinutes >= nowMinutes;
        }) ?? (timetableRows ?? [])[0] ?? null;

        if (nextRow) {
          const [roomRes, facultyRes, subjectRes] = await Promise.all([
            nextRow.room_id
              ? supabase.from("rooms").select("name").eq("id", nextRow.room_id).maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            supabase.from("users").select("name").eq("id", nextRow.teacher_id).maybeSingle(),
            nextRow.subject_id
              ? supabase.from("subjects").select("name").eq("id", nextRow.subject_id).maybeSingle()
              : Promise.resolve({ data: null, error: null }),
          ]);

          if (roomRes.error) return apiError(roomRes.error.message, 500);
          if (facultyRes.error) return apiError(facultyRes.error.message, 500);
          if (subjectRes?.error) return apiError(subjectRes.error.message, 500);

          nextLecture = {
            id: nextRow.id as string,
            startsAt: combineTodayIso(nextRow.start_time as string | null),
            endsAt: combineTodayIso(nextRow.end_time as string | null),
            roomName: roomRes.data?.name ?? "TBD",
            facultyName: facultyRes.data?.name ?? "TBD",
            subjectName: subjectRes?.data?.name ?? null,
          };
        }
      }

      return apiSuccess({ nextLecture, attendancePercent, departmentId: null });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id,email,department_id")
      .eq("id", ctx.userId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (userError) return apiError(userError.message, 404);

    const typedUser = user as UserRow;
    const departmentId = typedUser.department_id;

    const studentByUserPromise = supabase
      .from("students")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const studentByEmailPromise = supabase
      .from("students")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .eq("email", typedUser.email)
      .maybeSingle();

    const [studentByUser, studentByEmail] = await Promise.all([studentByUserPromise, studentByEmailPromise]);
    if (studentByUser.error) return apiError(studentByUser.error.message, 500);
    if (studentByEmail.error) return apiError(studentByEmail.error.message, 500);

    const studentId = studentByUser.data?.id ?? studentByEmail.data?.id ?? null;

    let attendancePercent = 0;
    if (studentId) {
      const { data: attendanceRows, error: attendanceError } = await supabase
        .from("attendance")
        .select("id,status,date,lecture:lectures(id,subject_id,starts_at,ends_at,subject:subjects(id,name))")
        .eq("student_id", studentId)
        .order("date", { ascending: false });

      if (attendanceError) return apiError(attendanceError.message, 500);

      const parsedRows = attendanceRowSchema.array().parse(attendanceRows ?? []);
      const total = parsedRows.length;
      const present = parsedRows.reduce((sum, row) => {
        const status = (row.status ?? "").toLowerCase();
        if (!attendanceStatuses.has(status)) return sum;
        return sum + (status === "half_day" ? 0.5 : 1);
      }, 0);
      attendancePercent = total === 0 ? 0 : Math.round((present / total) * 100);
    }

    const nowIso = new Date().toISOString();
    let nextLecture: {
      id: string;
      startsAt: string;
      endsAt: string;
      roomName: string;
      facultyName: string;
      subjectName: string | null;
    } | null = null;

    if (departmentId) {
      const { data: lectures, error: lecturesError } = await supabase
        .from("lectures")
        .select("id,starts_at,ends_at,room_id,faculty_id,subject_id")
        .eq("college_id", ctx.collegeId)
        .eq("department_id", departmentId)
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(1);

      if (lecturesError) return apiError(lecturesError.message, 500);

      const lecture = lectures ? lectureSchema.array().parse(lectures)[0] : null;
      if (lecture) {
        const [roomRes, facultyRes, subjectRes] = await Promise.all([
          supabase.from("rooms").select("name").eq("id", lecture.room_id).maybeSingle(),
          supabase.from("users").select("name").eq("id", lecture.faculty_id).maybeSingle(),
          lecture.subject_id
            ? supabase.from("subjects").select("name").eq("id", lecture.subject_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

        if (roomRes.error) return apiError(roomRes.error.message, 500);
        if (facultyRes.error) return apiError(facultyRes.error.message, 500);
        if (subjectRes?.error) return apiError(subjectRes.error.message, 500);

        nextLecture = {
          id: lecture.id,
          startsAt: lecture.starts_at,
          endsAt: lecture.ends_at,
          roomName: roomRes.data?.name ?? "TBD",
          facultyName: facultyRes.data?.name ?? "TBD",
          subjectName: subjectRes?.data?.name ?? null,
        };
      }
    }

    return apiSuccess({ nextLecture, attendancePercent, departmentId });
  } catch (error) {
    return apiError("Unable to load student dashboard", 500, String(error));
  }
}
