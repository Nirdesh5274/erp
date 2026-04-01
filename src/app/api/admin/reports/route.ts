import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface FeeAggRow {
  amount: number | string;
  paid_amount: number | string;
  due_amount: number | string;
}

interface LectureIdRow {
  id: string;
}

interface AttendanceRow {
  status: string;
  lecture_id: string;
}

interface MonitorRow {
  status: "Occupied" | "Vacant";
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "SuperAdmin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId && ctx.role !== "SuperAdmin") return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();

    const studentsQuery = supabase.from("students").select("id", { count: "exact", head: true });
    const feesQuery = supabase.from("fees").select("amount,paid_amount,due_amount");
    const attendanceQuery = supabase.from("attendance").select("status,lecture_id");
    const roomsQuery = supabase.from("rooms").select("id", { count: "exact", head: true });
    const monitorQuery = supabase.from("room_monitoring").select("status");
    const lectureIdsQuery = supabase.from("lectures").select("id");

    const scopedStudentsQuery = ctx.collegeId ? studentsQuery.eq("college_id", ctx.collegeId) : studentsQuery;
    const scopedFeesQuery = ctx.collegeId ? feesQuery.eq("college_id", ctx.collegeId) : feesQuery;
    const scopedRoomsQuery = ctx.collegeId ? roomsQuery.eq("college_id", ctx.collegeId) : roomsQuery;
    const scopedMonitorQuery = ctx.collegeId ? monitorQuery.eq("college_id", ctx.collegeId) : monitorQuery;
    const scopedLectureIdsQuery = ctx.collegeId ? lectureIdsQuery.eq("college_id", ctx.collegeId) : lectureIdsQuery;

    const [
      studentsResponse,
      feesResponse,
      attendanceResponse,
      roomsResponse,
      monitorResponse,
      lectureIdsResponse,
    ] = await Promise.all([
      scopedStudentsQuery,
      scopedFeesQuery,
      attendanceQuery,
      scopedRoomsQuery,
      scopedMonitorQuery,
      scopedLectureIdsQuery,
    ]);

    if (studentsResponse.error) return apiError(studentsResponse.error.message, 500);
    if (feesResponse.error) return apiError(feesResponse.error.message, 500);
    if (attendanceResponse.error) return apiError(attendanceResponse.error.message, 500);
    if (roomsResponse.error) return apiError(roomsResponse.error.message, 500);
    if (monitorResponse.error) return apiError(monitorResponse.error.message, 500);
    if (lectureIdsResponse.error) return apiError(lectureIdsResponse.error.message, 500);

    const feeRows = (feesResponse.data ?? []) as FeeAggRow[];
    const totalRevenue = feeRows.reduce((sum, row) => sum + Number(row.paid_amount), 0);
    const totalDue = feeRows.reduce((sum, row) => sum + Number(row.due_amount), 0);

    const lectureIds = new Set(((lectureIdsResponse.data ?? []) as LectureIdRow[]).map((lecture) => lecture.id));
    const attendanceRows = ((attendanceResponse.data ?? []) as AttendanceRow[]).filter((row) => lectureIds.has(row.lecture_id));
    const present = attendanceRows.filter((row) => row.status === "Present").length;
    const attendancePercent = attendanceRows.length === 0 ? 0 : Math.round((present / attendanceRows.length) * 100);

    const monitoringRows = (monitorResponse.data ?? []) as MonitorRow[];
    const occupied = monitoringRows.filter((row) => row.status === "Occupied").length;
    const roomUsagePercent = monitoringRows.length === 0 ? 0 : Math.round((occupied / monitoringRows.length) * 100);

    return apiSuccess({
      totalStudents: studentsResponse.count ?? 0,
      revenueCollected: totalRevenue,
      revenueDue: totalDue,
      attendancePercent,
      roomUsagePercent,
      totalRooms: roomsResponse.count ?? 0,
    });
  } catch (error) {
    return apiError("Unable to load reports", 500, String(error));
  }
}
