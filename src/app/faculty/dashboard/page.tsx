"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock3 } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface LectureRow {
  id: string;
  room_id: string;
  room_name: string;
  subject_id: string | null;
  subject_name: string;
  student_count: number;
  marked_present: number;
  starts_at: string;
  ends_at: string;
}

function CountdownTimer({ targetTime }: { targetTime: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);
  const diff = new Date(targetTime).getTime() - now;
  if (diff <= 0) return <span className="rounded-lg bg-white/20 px-3 py-1 text-sm font-semibold">Starting now</span>;
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return <span className="rounded-lg bg-white/20 px-3 py-1 text-sm font-semibold">{minutes}m {seconds}s</span>;
}

export default function FacultyDashboardPage() {
  const [lectures, setLectures] = useState<LectureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const lectureData = await apiFetch<LectureRow[]>("/api/faculty/lectures");
        setLectures(lectureData);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const todaysLectures = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return lectures.filter((lecture) => {
      const startsAt = new Date(lecture.starts_at).getTime();
      return startsAt >= start.getTime() && startsAt <= end.getTime();
    });
  }, [lectures, now]);

  const nextLecture = useMemo(
    () => todaysLectures.find((lecture) => new Date(lecture.starts_at).getTime() >= Date.now()) ?? null,
    [todaysLectures],
  );

  const markedCount = useMemo(() => todaysLectures.filter((row) => row.student_count > 0).length, [todaysLectures]);

  const stats = [
    {
      title: "Today's Lectures",
      value: todaysLectures.length,
      subtitle:
        todaysLectures.length > 0
          ? `Next at ${new Date(todaysLectures[0].starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "No lectures today",
      icon: <CalendarClock size={18} />,
      color: "teal" as const,
    },
    {
      title: "Marked Attendance",
      value: `${markedCount}/${todaysLectures.length}`,
      subtitle: "Use Attendance tab to submit",
      icon: <CheckCircle2 size={18} />,
      color: "green" as const,
    },
    {
      title: "Pending",
      value: todaysLectures.filter((item) => new Date(item.starts_at) > now).length,
      subtitle: "Based on current time",
      icon: <Clock3 size={18} />,
      color: "amber" as const,
    },
  ];

  if (loading && lectures.length === 0) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.title} title={stat.title} value={stat.value} subtitle={stat.subtitle} icon={stat.icon} color={stat.color} />
        ))}
      </div>

      {nextLecture ? (
        <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-teal-600 p-6 text-white">
          <p className="text-sm font-medium uppercase tracking-wide text-teal-100">Next Lecture</p>
          <p className="mt-1 text-3xl font-bold">{nextLecture.subject_name}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <span>{new Date(nextLecture.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(nextLecture.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span>Room {nextLecture.room_name}</span>
            <span>{nextLecture.student_count} students</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <CountdownTimer targetTime={nextLecture.starts_at} />
            <Link href="/faculty/attendance" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50">
              Mark Attendance
            </Link>
          </div>
        </div>
      ) : null}

      <SectionCard title="Today's schedule timeline" description="Subject, room, and marked attendance">
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <ul className="space-y-2 text-sm text-slate-700">
          {todaysLectures.map((lecture) => (
            <li key={lecture.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="font-semibold text-slate-900">{lecture.subject_name} - Room {lecture.room_name}</p>
              <p>
                {new Date(lecture.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(lecture.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="text-xs text-slate-600">Marked: {lecture.marked_present}/{lecture.student_count}</p>
            </li>
          ))}
          {todaysLectures.length === 0 ? <li className="text-slate-600">No lectures scheduled today.</li> : null}
        </ul>
      </SectionCard>

      <SectionCard title="Quick attendance" description="Jump directly to attendance marking">
        <Link href="/faculty/attendance" className="inline-flex rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          Open attendance workspace
        </Link>
      </SectionCard>
    </div>
  );
}
