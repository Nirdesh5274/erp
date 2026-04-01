"use client";

import { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { apiFetch } from "@/lib/clientApi";

interface ProfileResponse {
  student: {
    id: string | null;
    name: string;
    email: string;
    departmentId: string | null;
    departmentName: string | null;
    slotId: string | null;
    course: string | null;
    admissionId: string | null;
  };
  subjects: Array<{ id: string; name: string; facultyName: string | null }>;
}

interface LectureItem {
  id: string;
  departmentName: string;
  subjectName: string;
  facultyName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  liveStatus: string;
  alerts: number;
}

interface ScheduleResponse {
  lectures: LectureItem[];
}

export default function StudentProfilePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [schedule, setSchedule] = useState<LectureItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const loadProfile = async () => {
    setError(null);
    try {
      const data = await apiFetch<ProfileResponse>("/api/student/profile");
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load profile");
    }
  };

  const loadSchedule = async (departmentId: string | null) => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
    if (departmentId) params.set("departmentId", departmentId);

    try {
      const resp = await apiFetch<ScheduleResponse>(`/api/hod/schedule?${params.toString()}`);
      setSchedule(resp.lectures ?? []);
    } catch {
      setSchedule([]);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setTimeout(() => {
      void loadSchedule(profile.student.departmentId);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [profile]);

  const weekDays = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      return d;
    });
  }, []);

  const scheduleByDay = useMemo(() => {
    const map = new Map<number, LectureItem[]>();
    for (const lec of schedule) {
      const day = new Date(lec.startsAt).getDay();
      const arr = map.get(day) ?? [];
      arr.push(lec);
      map.set(day, arr);
    }
    for (const [day, list] of map) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      map.set(day, list);
    }
    return map;
  }, [schedule]);

  const onRequestEdit = () => {
    toast("Profile edit request flow pending backend approval route.");
  };

  const onChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirm password must match");
      return;
    }

    setChangingPassword(true);
    try {
      await apiFetch<boolean>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password changed successfully. Please login again.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Unable to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <SectionCard
        title="Personal details"
        description="Name, department, and course"
        actionSlot={
          <button onClick={onRequestEdit} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
            Request edit
          </button>
        }
      >
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">Name: {profile?.student.name ?? "—"}</p>
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">Email: {profile?.student.email ?? "—"}</p>
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">Department: {profile?.student.departmentName ?? "—"}</p>
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">Course: {profile?.student.course ?? "—"}</p>
        </div>
        <p className="mt-3 text-xs text-slate-500">Student ID: {profile?.student.id ?? "Pending mapping"} · Admission: {profile?.student.admissionId ?? "—"}</p>
      </SectionCard>

      <SectionCard title="Enrolled subjects" description="With assigned faculty where available">
        <div className="grid gap-3 md:grid-cols-2">
          {(profile?.subjects ?? []).map((subj) => (
            <div key={subj.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <p className="font-semibold text-slate-900">{subj.name}</p>
              <p className="text-slate-700">Faculty: {subj.facultyName ?? "To be assigned"}</p>
            </div>
          ))}
          {(profile?.subjects ?? []).length === 0 ? <p className="text-xs text-slate-600">No subjects linked to your department.</p> : null}
        </div>
      </SectionCard>

      <SectionCard title="Weekly timetable" description="Read-only schedule for this week">
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          {weekDays.map((day) => {
            const list = scheduleByDay.get(day.getDay()) ?? [];
            const label = day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
            return (
              <div key={day.toISOString()} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm text-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                {list.map((lec) => (
                  <div key={lec.id} className="mb-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{lec.subjectName || "Lecture"}</p>
                    <p className="text-slate-700">{lec.facultyName}</p>
                    <p className="text-slate-600">Room {lec.roomName || "TBD"}</p>
                    <p className="text-xs text-slate-600">{new Date(lec.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(lec.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                ))}
                {list.length === 0 ? <p className="text-xs text-slate-600">No lectures.</p> : null}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Change Password" description="Update your temporary password after first login">
        <form onSubmit={onChangePassword} className="grid gap-3 text-sm md:grid-cols-2">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="rounded-xl border border-slate-300 px-3 py-2"
            required
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="rounded-xl border border-slate-300 px-3 py-2"
            minLength={8}
            required
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="rounded-xl border border-slate-300 px-3 py-2 md:col-span-2"
            minLength={8}
            required
          />
          <button
            type="submit"
            disabled={changingPassword}
            className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white md:col-span-2 disabled:opacity-60"
          >
            {changingPassword ? "Updating..." : "Change Password"}
          </button>
        </form>
        {passwordError ? <p className="mt-3 text-sm text-rose-700">{passwordError}</p> : null}
        {passwordSuccess ? <p className="mt-3 text-sm text-emerald-700">{passwordSuccess}</p> : null}
      </SectionCard>
    </div>
  );
}
