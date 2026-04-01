import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface AttendanceStatusRow {
  status: string | null;
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoDate = sevenDaysAgo.toISOString().slice(0, 10);

    const { data: lectureRows, error: lectureRowsError } = await supabase
      .from("lectures")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .gte("starts_at", `${sevenDaysAgoDate}T00:00:00.000Z`);

    if (lectureRowsError) return apiError(lectureRowsError.message, 500);

    const lectureIds = (lectureRows ?? []).map((row) => row.id as string);

    const statusCountsPromise = lectureIds.length
      ? supabase
          .from("attendance")
          .select("status", { count: "exact", head: false })
          .in("lecture_id", lectureIds)
          .gte("date", sevenDaysAgoDate)
      : Promise.resolve({ data: [], error: null, count: 0 });

    const lockedLecturesPromise = supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .eq("attendance_locked", true);

    const todaysLecturesPromise = supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .gte("starts_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .lte("starts_at", new Date(new Date().setHours(23, 59, 59, 999)).toISOString());

    const alertsPromise = supabase
      .from("monitoring_alerts")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .eq("resolved", false);

    const [statusCounts, lockedLectures, todaysLectures, alerts] = await Promise.all([
      statusCountsPromise,
      lockedLecturesPromise,
      todaysLecturesPromise,
      alertsPromise,
    ]);

    if (statusCounts.error) return apiError(statusCounts.error.message, 500);
    if (lockedLectures.error) return apiError(lockedLectures.error.message, 500);
    if (todaysLectures.error) return apiError(todaysLectures.error.message, 500);
    if (alerts.error) return apiError(alerts.error.message, 500);

    const summary = {
      attendance: {
        total: statusCounts.data?.length ?? 0,
        byStatus: (statusCounts.data ?? []).reduce<Record<string, number>>((acc, row) => {
          const typedRow = row as AttendanceStatusRow;
          const key = typedRow.status?.toLowerCase() ?? "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      },
      lockedLectures: lockedLectures.count ?? 0,
      todaysLectures: todaysLectures.count ?? 0,
      openAlerts: alerts.count ?? 0,
    };

    return apiSuccess(summary);
  } catch (error) {
    return apiError("Unable to load attendance summary", 500, String(error));
  }
}
