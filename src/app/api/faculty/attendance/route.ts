import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const statusEnum = z.enum(["present", "absent", "late", "half_day", "on_duty", "medical_leave"]);

const postSchema = z.object({
  lectureId: z.string().uuid(),
  attendanceDate: z.string().date(),
  entries: z.array(
    z.object({
      studentId: z.string().uuid(),
      status: statusEnum,
    }),
  ),
  overrideReason: z.string().max(200).optional(),
});

function toLegacyAttendanceStatus(status: z.infer<typeof statusEnum>) {
  if (status === "absent") return "Absent";
  return "Present";
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const { searchParams } = new URL(request.url);
    const lectureId = searchParams.get("lectureId");

    if (!lectureId) return apiError("lectureId is required", 400);

    const supabase = getSupabaseAdmin();

    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .select("id,department_id,faculty_id,starts_at,ends_at,attendance_locked,attendance_lock_expires_at")
      .eq("id", lectureId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (lectureError) return apiError(lectureError.message, 404);
    if (lecture.faculty_id !== ctx.userId) return apiError("Forbidden", 403);

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id,name,email")
      .eq("college_id", ctx.collegeId)
      .eq("department_id", lecture.department_id)
      .order("name", { ascending: true });

    if (studentsError) return apiError(studentsError.message, 500);

    const { data: existing, error: existingError } = await supabase
      .from("attendance")
      .select("student_id,status")
      .eq("lecture_id", lectureId)
      .eq("date", lecture.starts_at ? lecture.starts_at.slice(0, 10) : null);

    if (existingError) return apiError(existingError.message, 500);

    const statusByStudent = new Map<string, string>();
    for (const row of existing ?? []) {
      statusByStudent.set(row.student_id as string, (row.status as string)?.toLowerCase());
    }

    const response = (students ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      status: statusByStudent.get(s.id) ?? "present",
    }));

    return apiSuccess({
      lecture,
      roster: response,
    });
  } catch (error) {
    return apiError("Unable to load attendance roster", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .select("id,faculty_id,attendance_locked,attendance_lock_expires_at,starts_at,ends_at")
      .eq("id", body.lectureId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (lectureError) return apiError(lectureError.message, 404);
    if (lecture.faculty_id !== ctx.userId) return apiError("Forbidden", 403);

    const now = new Date();
    if (lecture.attendance_locked) return apiError("Attendance locked", 400);
    if (lecture.attendance_lock_expires_at && now > new Date(lecture.attendance_lock_expires_at)) {
      return apiError("Attendance window closed", 400);
    }

    const payload = body.entries.map((entry) => ({
      lecture_id: body.lectureId,
      student_id: entry.studentId,
      date: body.attendanceDate,
      status: entry.status.toLowerCase(),
      marked_by: ctx.userId,
      override_reason: body.overrideReason ?? null,
    }));

    let { error } = await supabase.from("attendance").upsert(payload, {
      onConflict: "lecture_id,student_id,date",
    });

    // Backward compatibility for databases still using legacy attendance_status enum (Present/Absent).
    if (error && error.message.toLowerCase().includes("attendance_status")) {
      const legacyPayload = body.entries.map((entry) => ({
        lecture_id: body.lectureId,
        student_id: entry.studentId,
        date: body.attendanceDate,
        status: toLegacyAttendanceStatus(entry.status),
        marked_by: ctx.userId,
        override_reason: body.overrideReason ?? null,
      }));

      const retry = await supabase.from("attendance").upsert(legacyPayload, {
        onConflict: "lecture_id,student_id,date",
      });
      error = retry.error;
    }

    if (error) return apiError(error.message, 500);
    return apiSuccess({ saved: payload.length }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to save attendance", 500, String(error));
  }
}
