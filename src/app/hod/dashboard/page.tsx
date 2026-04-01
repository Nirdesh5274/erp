"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, CalendarClock, GraduationCap, ShieldAlert, Users } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface DashboardResponse {
  stats: {
    faculty: number;
    subjects: number;
    lecturesThisWeek: number;
    attendanceLocked: number;
    openAlerts: number;
    attendancePercent: number | null;
  };
  assignments: Array<{
    subjectId: string;
    subjectName: string;
    facultyId: string;
    facultyName: string;
    facultyEmail: string;
  }>;
  lockedLectures: Array<{
    id: string;
    subjectId: string | null;
    subjectName: string;
    facultyId: string;
    facultyName: string;
    roomId: string;
    roomName: string;
    startsAt: string;
    attendanceLockReason: string | null;
  }>;
}

export default function HodDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<DashboardResponse>("/api/hod/dashboard");
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statCards = useMemo(() => {
    if (!data) return [];
    return [
      { title: "Faculty", value: data.stats.faculty, subtitle: "Active in dept", color: "blue" as const, icon: <Users size={18} /> },
      { title: "Subjects", value: data.stats.subjects, subtitle: "Mapped to owners", color: "teal" as const, icon: <BookOpen size={18} /> },
      {
        title: "Lectures This Week",
        value: data.stats.lecturesThisWeek,
        subtitle: "Scheduled",
        color: "green" as const,
        icon: <CalendarClock size={18} />,
      },
      {
        title: "Attendance Locked",
        value: data.stats.attendanceLocked,
        subtitle: "Unlock if needed",
        color: "amber" as const,
        icon: <ShieldAlert size={18} />,
      },
      {
        title: "Open Alerts",
        value: data.stats.openAlerts,
        subtitle: "Monitoring",
        color: data.stats.openAlerts > 0 ? ("red" as const) : ("green" as const),
        icon: <AlertTriangle size={18} />,
      },
      {
        title: "Attendance %",
        value: data.stats.attendancePercent !== null ? `${data.stats.attendancePercent}%` : "—",
        subtitle: "Last 7 days",
        color:
          (data.stats.attendancePercent ?? 0) >= 75
            ? ("green" as const)
            : (data.stats.attendancePercent ?? 0) >= 60
              ? ("amber" as const)
              : ("red" as const),
        icon: <GraduationCap size={18} />,
      },
    ];
  }, [data]);

  const handleUnlock = async (lectureId: string) => {
    try {
      await apiFetch("/api/hod/attendance/locks", {
        method: "PATCH",
        body: JSON.stringify({ lectureId, action: "unlock" }),
      });
      await load();
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Unable to unlock attendance");
    }
  };

  if (loading && !data) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        {statCards.slice(0, 4).map((stat) => (
          <StatCard
            key={stat.title}
            title={stat.title}
            value={stat.value}
            subtitle={stat.subtitle}
            icon={stat.icon}
            color={stat.color}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Open Alerts" description="Department monitoring status">
          <StatCard
            title="Active Alert Count"
            value={data?.stats.openAlerts ?? 0}
            subtitle={(data?.stats.openAlerts ?? 0) > 0 ? "Needs review" : "All clear"}
            color={(data?.stats.openAlerts ?? 0) > 0 ? "red" : "green"}
            icon={<AlertTriangle size={18} />}
          />
        </SectionCard>

        <SectionCard title="Dept Attendance" description="Rolling seven day health">
          <StatCard
            title="Attendance %"
            value={data?.stats.attendancePercent !== null ? `${data?.stats.attendancePercent ?? 0}%` : "—"}
            subtitle="Department-wide"
            color={(data?.stats.attendancePercent ?? 0) >= 75 ? "green" : (data?.stats.attendancePercent ?? 0) >= 60 ? "amber" : "red"}
            icon={<GraduationCap size={18} />}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Subject Assignments"
        description="Faculty to subject mapping"
        actionSlot={
          <button onClick={load} className="text-sm font-semibold text-teal-700 hover:underline" disabled={loading}>
            Refresh
          </button>
        }
      >
        <DataTable
          data={data?.assignments ?? []}
          searchKey="subjectName"
          emptyMessage="No subject assignments available"
          columns={[
            { key: "subjectName", header: "Subject" },
            { key: "facultyName", header: "Faculty" },
            { key: "facultyEmail", header: "Email" },
            {
              key: "actions",
              header: "Actions",
              render: () => (
                <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Reassign
                </button>
              ),
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="Attendance Locks" description="Unlock action available inline">
        <DataTable
          data={data?.lockedLectures ?? []}
          searchKey="subjectName"
          emptyMessage="No locked attendance windows"
          columns={[
            { key: "subjectName", header: "Subject", render: (row) => row.subjectName || "Lecture" },
            { key: "facultyName", header: "Faculty" },
            { key: "roomName", header: "Room", render: (row) => row.roomName || "Room" },
            {
              key: "startsAt",
              header: "Starts",
              render: (row) => new Date(row.startsAt).toLocaleString(),
            },
            {
              key: "actions",
              header: "Actions",
              render: (row) => (
                <button
                  onClick={() => handleUnlock(row.id)}
                  className="rounded-lg bg-amber-600 px-2 py-1 text-xs font-semibold text-white"
                >
                  Unlock
                </button>
              ),
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="Quick Actions" description="Common HOD tasks">
        <div className="grid gap-3 md:grid-cols-4">
          <Link href="/hod/faculty" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Add Faculty</Link>
          <Link href="/hod/schedule" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">View Schedule</Link>
          <button onClick={async () => {
            const ids = (data?.lockedLectures ?? []).map((lecture) => lecture.id);
            for (const id of ids) {
              await handleUnlock(id);
            }
          }} className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Unlock All</button>
          <Link href="/hod/schedule" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Reports</Link>
        </div>
      </SectionCard>
    </div>
  );
}
