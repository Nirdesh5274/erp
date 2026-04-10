"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, Building2, TriangleAlert, Users } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface ReportSummary {
  totalStudents: number;
  revenueCollected: number;
  revenueCollectedMtd?: number;
  revenueDue: number;
  revenueDueOutstanding?: number;
  attendancePercent: number;
  roomUsagePercent: number;
  totalRooms: number;
}

interface InstitutionProfile {
  id: string;
  name: string;
  location: string;
  logoUrl: string;
  institutionCode: string;
  status: string;
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [savingInstitution, setSavingInstitution] = useState(false);

  const [institutionName, setInstitutionName] = useState("");
  const [institutionLocation, setInstitutionLocation] = useState("");
  const [institutionCode, setInstitutionCode] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [data, institutionData] = await Promise.all([
          apiFetch<ReportSummary>("/api/admin/reports"),
          apiFetch<InstitutionProfile>("/api/admin/institution"),
        ]);
        setSummary(data);
        setInstitution(institutionData);
        setInstitutionName(institutionData.name ?? "");
        setInstitutionLocation(institutionData.location ?? "");
        setInstitutionCode(institutionData.institutionCode ?? "");
        setLogoUrl(institutionData.logoUrl ?? "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load reports");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const saveInstitutionProfile = async () => {
    setSaveStatus("");
    setError("");
    try {
      setSavingInstitution(true);
      const updated = await apiFetch<InstitutionProfile>("/api/admin/institution", {
        method: "PATCH",
        body: JSON.stringify({
          name: institutionName,
          location: institutionLocation,
          institutionCode,
          logoUrl,
        }),
      });
      setInstitution(updated);
      setSaveStatus("Institution profile updated");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update institution profile");
    } finally {
      setSavingInstitution(false);
    }
  };

  const formatInr = (paise: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(paise);

  const formattedDate = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  const stats = useMemo(
    () => [
      {
        title: "Total Students",
        icon: <Users size={18} />,
        color: "blue" as const,
        value: summary?.totalStudents ?? 0,
        subtitle: "Live enrollment",
      },
      {
        title: "Rooms Occupied Now",
        icon: <Building2 size={18} />,
        color: "teal" as const,
        value: `${summary?.roomUsagePercent ?? 0}%`,
        subtitle: `${summary?.totalRooms ?? 0} rooms in campus`,
      },
      {
        title: "Fee Collected MTD",
        icon: <Banknote size={18} />,
        color: "green" as const,
        value: formatInr(summary?.revenueCollectedMtd ?? summary?.revenueCollected ?? 0),
        subtitle: "Net received this month",
      },
      {
        title: "Pending Fees",
        icon: <TriangleAlert size={18} />,
        color: "amber" as const,
        value: formatInr(summary?.revenueDueOutstanding ?? summary?.revenueDue ?? 0),
        subtitle: "Pending settlements",
      },
    ],
    [summary],
  );

  if (loading && !summary) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Good {greeting}, Admin</h1>
          <p className="text-sm text-slate-500">{formattedDate}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/admissions" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            Add Student
          </Link>
          <Link href="/admin/analytics" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Reports
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.slice(0, 4).map((stat) => (
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
        <SectionCard title="Today's Priority Queue" description="Admin action board">
          {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">Review pending fee dues and collect payments</li>
            <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">Approve new admissions for available slots</li>
            <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">Monitor room occupancy for active lectures</li>
          </ul>
        </SectionCard>

        <SectionCard title="Attendance Health" description="College level pulse">
          <div className="grid gap-4 md:grid-cols-2">
            <StatCard
              title="Overall Attendance"
              value={`${summary?.attendancePercent ?? 0}%`}
              subtitle="Across marked lectures"
              color={(summary?.attendancePercent ?? 0) >= 75 ? "green" : "amber"}
            />
            <StatCard
              title="Space Utilization"
              value={`${summary?.roomUsagePercent ?? 0}%`}
              subtitle="Room occupancy snapshot"
              color="teal"
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Admin Quick Actions" description="Jump to frequently used workflows">
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <div className="grid gap-3 md:grid-cols-4">
          <Link href="/admin/students" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Students</Link>
          <Link href="/admin/fees" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Fees</Link>
          <Link href="/admin/fee-structures" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Fee Structures</Link>
          <Link href="/admin/monitoring" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Monitoring</Link>
          <Link href="/admin/attendance" className="rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Attendance</Link>
        </div>
      </SectionCard>

      <SectionCard
        title="Institution Branding"
        description="Update your school/college details and logo used in receipts"
      >
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Institution Name</span>
            <input
              value={institutionName}
              onChange={(event) => setInstitutionName(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-600">Institution ID / Code</span>
            <input
              value={institutionCode}
              onChange={(event) => setInstitutionCode(event.target.value)}
              placeholder="e.g. SCH-102"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-semibold text-slate-600">Address / Location</span>
            <input
              value={institutionLocation}
              onChange={(event) => setInstitutionLocation(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-semibold text-slate-600">Logo URL</span>
            <input
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
        </div>

        {institution?.status ? <p className="mt-2 text-xs text-slate-500">Status: {institution.status}</p> : null}
        {saveStatus ? <p className="mt-2 text-sm text-emerald-700">{saveStatus}</p> : null}

        <button
          type="button"
          onClick={() => void saveInstitutionProfile()}
          disabled={savingInstitution}
          className="mt-3 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {savingInstitution ? "Saving..." : "Save Branding"}
        </button>
      </SectionCard>
    </div>
  );
}
