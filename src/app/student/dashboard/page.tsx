"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { apiFetch } from "@/lib/clientApi";

interface DashboardResponse {
  nextLecture: {
    id: string;
    startsAt: string;
    endsAt: string;
    roomName: string;
    facultyName: string;
    subjectName: string | null;
  } | null;
  attendancePercent: number;
  departmentId: string | null;
}

interface AttendanceSummary {
  attendancePercent: number;
  totalMarked: number;
  presentCount: number;
  requiredFor75: number;
  perSubject: Array<{ subjectId: string | null; subjectName: string; percent: number; present: number; total: number }>;
  calendar: Array<{ date: string; status: string }>;
}

interface FeesResponse {
  fees: Array<{ id: string; due_amount: number; due_date: string | null; status: string }>;
  receipts: Array<{ id: string; amount: number; payment_mode: string; receipt_number: string | null; paid_at: string }>;
}

interface ScheduleResponse {
  lectures: Array<{
    id: string;
    departmentName: string;
    subjectName: string;
    facultyName: string;
    roomName: string;
    startsAt: string;
    endsAt: string;
    liveStatus: string;
    alerts: number;
  }>;
}

interface ProfileResponse {
  student: {
    className: string | null;
    sectionName: string | null;
    rollNumber: string | null;
    term: string | null;
    currentSemester: number | null;
    course: string | null;
  };
  subjects: Array<{ id: string; name: string; facultyName: string | null }>;
}

interface StudentTimetableRow {
  id: string;
  day: string;
  periodNumber: number;
  startTime: string | null;
  endTime: string | null;
  subjectName: string;
  teacherName: string;
}

function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!targetIso) return "";
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return "Starting now";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function AttendanceGauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const angle = (clamped / 100) * 360;
  return (
    <div className="relative h-24 w-24">
      <div
        className="h-full w-full rounded-full"
        style={{
          background: `conic-gradient(#0ea5e9 ${angle}deg, #e2e8f0 0deg)`,
        }}
      />
      <div className="absolute inset-3 flex items-center justify-center rounded-full bg-white text-lg font-bold text-slate-800">
        {clamped}%
      </div>
    </div>
  );
}

export default function StudentDashboardPage() {
  const { isSchool } = useInstitutionType();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [fees, setFees] = useState<FeesResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [schoolTimetable, setSchoolTimetable] = useState<StudentTimetableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const countdown = useCountdown(dashboard?.nextLecture?.startsAt ?? null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [dash, att, feeData, profileData] = await Promise.all([
          apiFetch<DashboardResponse>("/api/student/dashboard"),
          apiFetch<AttendanceSummary>("/api/student/attendance/summary"),
          apiFetch<FeesResponse>("/api/student/fees"),
          apiFetch<ProfileResponse>("/api/student/profile"),
        ]);
        setDashboard(dash);
        setAttendance(att);
        setFees(feeData);
        setProfile(profileData);

        if (isSchool) {
          const schoolSchedule = await apiFetch<StudentTimetableRow[]>("/api/student/timetable");
          setSchoolTimetable(schoolSchedule);
          setSchedule({ lectures: [] });
        } else {
          const now = new Date();
          const dayStart = new Date(now);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(now);
          dayEnd.setHours(23, 59, 59, 999);
          const params = new URLSearchParams({ from: dayStart.toISOString(), to: dayEnd.toISOString() });
          if (dash.departmentId) params.set("departmentId", dash.departmentId);
          const sched = await apiFetch<ScheduleResponse>(`/api/hod/schedule?${params.toString()}`);
          setSchedule({ ...sched, lectures: (sched.lectures ?? []).slice(0, 8) });
          setSchoolTimetable([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isSchool]);

  const pendingDue = useMemo(() => {
    const total = (fees?.fees ?? []).reduce((sum, fee) => sum + (fee.status !== "Paid" ? Number(fee.due_amount ?? 0) : 0), 0);
    const nextDue = (fees?.fees ?? [])
      .filter((f) => f.status !== "Paid" && f.due_date)
      .sort((a, b) => new Date(a.due_date as string).getTime() - new Date(b.due_date as string).getTime())[0];
    return { total, nextDue };
  }, [fees]);

  const todayLectures = schedule?.lectures ?? [];
  const recentReceipts = useMemo(() => {
    return [...(fees?.receipts ?? [])]
      .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
      .slice(0, 3);
  }, [fees?.receipts]);

  const attendanceList = attendance?.perSubject ?? [];
  const monthDays = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, []);

  const heatmap = useMemo(() => {
    const statusByDay = new Map<number, string>();
    for (const entry of attendance?.calendar ?? []) {
      const day = new Date(entry.date).getDate();
      statusByDay.set(day, entry.status);
    }
    return monthDays.map((day) => ({ day, status: statusByDay.get(day) ?? "none" }));
  }, [attendance?.calendar, monthDays]);

  if (loading && !dashboard) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {isSchool ? (
            <SectionCard title="Student Profile" description="School class details">
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <p><span className="font-semibold">Class:</span> {profile?.student.className ?? "N/A"}</p>
                <p><span className="font-semibold">Section:</span> {profile?.student.sectionName ?? "N/A"}</p>
                <p><span className="font-semibold">Roll No:</span> {profile?.student.rollNumber ?? "N/A"}</p>
                <p><span className="font-semibold">Term:</span> {profile?.student.term ?? "N/A"}</p>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Next lecture" description="Countdown and details">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Starts in</p>
                <p className="text-3xl font-black text-slate-900">{countdown || "No upcoming class"}</p>
                <p className="text-sm text-slate-600">{dashboard?.nextLecture?.subjectName ?? ""}</p>
                <p className="text-sm text-slate-600">{dashboard?.nextLecture?.facultyName ?? ""}</p>
              </div>
              <div className="text-right text-sm text-slate-600">
                <p className="font-semibold">Room {dashboard?.nextLecture?.roomName ?? "TBD"}</p>
                <p>
                  {dashboard?.nextLecture
                    ? `${new Date(dashboard.nextLecture.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(dashboard.nextLecture.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "—"}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={isSchool ? "Timetable" : "Today's schedule"} description="Timeline">
            <div className="space-y-3 text-sm">
              {isSchool
                ? schoolTimetable.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{item.subjectName}</p>
                        <p className="text-slate-700">{item.teacherName}</p>
                      </div>
                      <div className="text-right text-xs text-slate-600">
                        <p>{item.day} • Period {item.periodNumber}</p>
                        <p>{item.startTime || "--:--"} - {item.endTime || "--:--"}</p>
                      </div>
                    </div>
                  ))
                : todayLectures.map((lec) => (
                <div key={lec.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{lec.departmentName}</p>
                    <p className="text-base font-semibold text-slate-900">{lec.subjectName || "Lecture"}</p>
                    <p className="text-slate-700">{lec.facultyName}</p>
                    <p className="text-slate-600">Room {lec.roomName || "TBD"}</p>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <p>{new Date(lec.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(lec.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    <div className="mt-1">
                      <StatusBadge status={lec.liveStatus} />
                    </div>
                    {lec.alerts > 0 ? <p className="mt-1 text-amber-700">Alerts {lec.alerts}</p> : null}
                  </div>
                </div>
              ))}
              {(isSchool ? schoolTimetable.length === 0 : todayLectures.length === 0) ? <p className="text-xs text-slate-600">No schedule today.</p> : null}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Attendance" description="Overall and per subject">
            <div className="flex items-center gap-4">
              <AttendanceGauge percent={attendance?.attendancePercent ?? dashboard?.attendancePercent ?? 0} />
              <div className="space-y-2 text-sm text-slate-700">
                <p className="font-semibold">Overall</p>
                <p>{attendance?.attendancePercent ?? dashboard?.attendancePercent ?? 0}% • {attendance?.presentCount ?? 0}/{attendance?.totalMarked ?? 0} marked</p>
                <p>Need {attendance?.requiredFor75 ?? 0} more to reach 75%</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-xs text-slate-700">
              {attendanceList.map((item) => (
                <div key={item.subjectId ?? item.subjectName}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-800">{item.subjectName}</p>
                    <p>{item.percent}%</p>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-sky-500" style={{ width: `${item.percent}%` }} />
                  </div>
                </div>
              ))}
              {attendanceList.length === 0 ? <p className="text-slate-500">No attendance records yet.</p> : null}
            </div>
          </SectionCard>

          {pendingDue.total > 0 ? (
            <SectionCard title="Pending fees" description="Due reminders">
              <p className="text-lg font-black text-rose-700">INR {pendingDue.total.toLocaleString()}</p>
              <p className="text-xs text-slate-600">Next due: {pendingDue.nextDue?.due_date ? new Date(pendingDue.nextDue.due_date).toLocaleDateString() : "—"}</p>
              <a href="/student/fees" className="mt-2 inline-flex rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white">
                View fee portal
              </a>
            </SectionCard>
          ) : null}

          <SectionCard title="Recent receipts" description="Download payment receipts">
            <div className="space-y-2 text-xs text-slate-700">
              {recentReceipts.map((receipt) => (
                <div key={receipt.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="font-semibold text-slate-900">{receipt.receipt_number ?? receipt.id.slice(0, 8)}</p>
                  <p>INR {Number(receipt.amount).toLocaleString()} · {receipt.payment_mode}</p>
                  <p className="text-slate-500">{new Date(receipt.paid_at).toLocaleDateString()}</p>
                  <button
                    onClick={() => window.open(`/api/fees/receipt/${receipt.id}`, "_blank", "noopener,noreferrer")}
                    className="mt-1 rounded-md bg-slate-900 px-2 py-1 text-white"
                  >
                    Download receipt
                  </button>
                </div>
              ))}
              {recentReceipts.length === 0 ? <p>No receipts found.</p> : null}
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Attendance calendar" description="Current month heatmap">
        <div className="grid grid-cols-7 gap-2 text-center text-xs">
          {heatmap.map((cell) => (
            <div
              key={cell.day}
              className={`rounded-lg px-2 py-3 font-semibold ${
                cell.status === "present"
                  ? "bg-teal-400 text-white"
                  : cell.status === "absent"
                    ? "bg-red-300 text-red-900"
                    : cell.status === "late"
                      ? "bg-amber-300 text-amber-900"
                      : "bg-slate-100 text-slate-500"
              }`}
            >
              {cell.day}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
