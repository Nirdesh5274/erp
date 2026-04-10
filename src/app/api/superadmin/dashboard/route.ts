import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function startOfMonthIso(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function startOfWeekIso(now: Date) {
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff).toISOString();
}

function startOfDayIso(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isMissingColumnError(message: string, columnName: string) {
  const text = message.toLowerCase();
  return text.includes(columnName.toLowerCase()) && (text.includes("column") || text.includes("schema cache"));
}

export async function GET() {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const supabase = getSupabaseAdmin();
    const now = new Date();

    const [
      collegesCountRes,
      collegesThisMonthRes,
      adminsCountRes,
      adminsThisWeekRes,
      usersCountRes,
      adminsByCollegeRes,
      collegesRowsRes,
    ] = await Promise.all([
      supabase.from("colleges").select("id", { count: "exact", head: true }),
      supabase.from("colleges").select("id", { count: "exact", head: true }).gte("created_at", startOfMonthIso(now)),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "Admin"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "Admin").gte("created_at", startOfWeekIso(now)),
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("college_id").eq("role", "Admin").not("college_id", "is", null),
      supabase.from("colleges").select("id,created_at").order("created_at", { ascending: true }),
    ]);

    if (collegesCountRes.error) return apiError(collegesCountRes.error.message, 500);
    if (collegesThisMonthRes.error) return apiError(collegesThisMonthRes.error.message, 500);
    if (adminsCountRes.error) return apiError(adminsCountRes.error.message, 500);
    if (adminsThisWeekRes.error) return apiError(adminsThisWeekRes.error.message, 500);
    if (usersCountRes.error) return apiError(usersCountRes.error.message, 500);
    if (adminsByCollegeRes.error) return apiError(adminsByCollegeRes.error.message, 500);
    if (collegesRowsRes.error) return apiError(collegesRowsRes.error.message, 500);

    const usersActiveTodayRes = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("last_login_at", startOfDayIso(now));

    let usersActiveToday = 0;
    if (usersActiveTodayRes.error) {
      if (!isMissingColumnError(usersActiveTodayRes.error.message, "last_login_at")) {
        return apiError(usersActiveTodayRes.error.message, 500);
      }
    } else {
      usersActiveToday = usersActiveTodayRes.count ?? 0;
    }

    const totalColleges = collegesCountRes.count ?? 0;
    const totalAdmins = adminsCountRes.count ?? 0;
    const totalUsers = usersCountRes.count ?? 0;
    const collegesThisMonth = collegesThisMonthRes.count ?? 0;
    const adminsThisWeek = adminsThisWeekRes.count ?? 0;

    const activeCollegeIds = new Set((adminsByCollegeRes.data ?? []).map((row) => row.college_id as string));
    const activeColleges = activeCollegeIds.size;
    const pendingVerification = Math.max(totalColleges - activeColleges, 0);
    const onboardingCompletion = totalColleges === 0 ? 0 : Math.round((activeColleges / totalColleges) * 100);

    // Weekly active user chart
    const weekDays = Array.from({ length: 7 }, (_, idx) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - idx));
      return { key: dateKey(date), label: date.toLocaleDateString("en-US", { weekday: "short" }), value: 0 };
    });
    const weekByKey = new Map(weekDays.map((item) => [item.key, item]));

    const activeUsersLast7Res = await supabase
      .from("users")
      .select("last_login_at")
      .gte("last_login_at", new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString());

    if (!activeUsersLast7Res.error) {
      for (const row of activeUsersLast7Res.data ?? []) {
        const loginAt = row.last_login_at as string | null;
        if (!loginAt) continue;
        const key = loginAt.slice(0, 10);
        const point = weekByKey.get(key);
        if (point) point.value += 1;
      }
    }

    // Monthly growth chart (last 6 months)
    const monthlyGrowth = Array.from({ length: 6 }, (_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { key, label: d.toLocaleDateString("en-US", { month: "short" }), collegesAdded: 0 };
    });
    const monthlyByKey = new Map(monthlyGrowth.map((item) => [item.key, item]));

    for (const row of collegesRowsRes.data ?? []) {
      const createdAt = row.created_at as string;
      const key = createdAt.slice(0, 7);
      const point = monthlyByKey.get(key);
      if (point) point.collegesAdded += 1;
    }

    // Attendance snapshot across school + college datasets
    let dailyAttendancePercent = 0;
    const [attendanceRes, schoolAttendanceRes] = await Promise.all([
      supabase.from("attendance").select("status,date").gte("date", startOfDayIso(now).slice(0, 10)),
      supabase.from("school_attendance").select("status,date").gte("date", startOfDayIso(now).slice(0, 10)),
    ]);

    const attendanceRows = [
      ...(attendanceRes.error ? [] : (attendanceRes.data ?? [])),
      ...(schoolAttendanceRes.error ? [] : (schoolAttendanceRes.data ?? [])),
    ] as Array<{ status: string | null }>;

    if (attendanceRows.length > 0) {
      const presentStatuses = new Set(["present", "late", "half_day", "on_duty", "medical_leave"]);
      const presentCount = attendanceRows.reduce((sum, row) => {
        const status = String(row.status ?? "").toLowerCase();
        return sum + (presentStatuses.has(status) ? (status === "half_day" ? 0.5 : 1) : 0);
      }, 0);
      dailyAttendancePercent = Math.round((presentCount / attendanceRows.length) * 100);
    }

    // Admin productivity and estimated charge
    const adminsRes = await supabase
      .from("users")
      .select("id,name,email,created_by")
      .eq("role", "Admin");

    const adminIds = (adminsRes.error ? [] : (adminsRes.data ?? []).map((row) => row.id as string));
    const createdByRes = adminIds.length
      ? await supabase.from("users").select("created_by,role").in("created_by", adminIds)
      : { data: [], error: null };

    const createdCount = new Map<string, number>();
    const hodCount = new Map<string, number>();
    if (!createdByRes.error) {
      for (const row of createdByRes.data ?? []) {
        const creator = row.created_by as string | null;
        if (!creator) continue;
        createdCount.set(creator, (createdCount.get(creator) ?? 0) + 1);
        if (row.role === "HOD") hodCount.set(creator, (hodCount.get(creator) ?? 0) + 1);
      }
    }

    const adminProductivity = (adminsRes.error ? [] : (adminsRes.data ?? [])).map((admin) => {
      const usersCreated = createdCount.get(admin.id as string) ?? 0;
      const hodCreated = hodCount.get(admin.id as string) ?? 0;
      return {
        adminId: admin.id,
        name: admin.name,
        email: admin.email,
        usersCreated,
        hodCreated,
        estimatedMonthlyCharge: usersCreated * 20 + hodCreated * 100,
      };
    });

    return apiSuccess({
      stats: {
        totalColleges,
        collegesThisMonth,
        totalAdmins,
        adminsThisWeek,
        totalUsers,
        usersActiveToday,
        activeColleges,
        pendingVerification,
        dailyAttendancePercent,
      },
      charts: {
        weeklyActiveUsers: weekDays,
        monthlyCollegeGrowth: monthlyGrowth,
      },
      adminProductivity,
      insights: [
        `Onboarding completion is at ${onboardingCompletion}%.`,
        `${adminsThisWeek} new admin accounts were created this week.`,
        `${usersActiveToday} users were active today.`,
        `${pendingVerification} campuses are pending admin setup.`,
      ],
    });
  } catch (error) {
    return apiError("Unable to load superadmin dashboard", 500, String(error));
  }
}