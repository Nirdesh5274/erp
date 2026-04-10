"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";

interface SuperAdminDashboardResponse {
  stats: {
    totalColleges: number;
    collegesThisMonth: number;
    totalAdmins: number;
    adminsThisWeek: number;
    totalUsers: number;
    usersActiveToday: number;
    activeColleges: number;
    pendingVerification: number;
    dailyAttendancePercent: number;
  };
  charts: {
    weeklyActiveUsers: Array<{ key: string; label: string; value: number }>;
    monthlyCollegeGrowth: Array<{ key: string; label: string; collegesAdded: number }>;
  };
  adminProductivity: Array<{
    adminId: string;
    name: string;
    email: string;
    usersCreated: number;
    hodCreated: number;
    estimatedMonthlyCharge: number;
  }>;
  insights: string[];
}

export default function SuperAdminDashboardPage() {
  const [data, setData] = useState<SuperAdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await apiFetch<SuperAdminDashboardResponse>("/api/superadmin/dashboard");
        setData(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const stats = useMemo(
    () => [
      {
        label: "Total Colleges",
        value: data?.stats.totalColleges ?? 0,
        trend: `+${data?.stats.collegesThisMonth ?? 0} this month`,
      },
      {
        label: "Total Admins",
        value: data?.stats.totalAdmins ?? 0,
        trend: `+${data?.stats.adminsThisWeek ?? 0} this week`,
      },
      {
        label: "Total Users",
        value: data?.stats.totalUsers ?? 0,
        trend: `+${data?.stats.usersActiveToday ?? 0} active today`,
      },
      {
        label: "Active Users",
        value: data?.stats.usersActiveToday ?? 0,
        trend: "Today",
      },
      {
        label: "Daily Attendance %",
        value: `${data?.stats.dailyAttendancePercent ?? 0}%`,
        trend: `${data?.stats.activeColleges ?? 0} active colleges`,
      },
    ],
    [data],
  );

  if (loading && !data && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <SectionCard
        title="Bireena Multi-Campus Insights"
        description="Overview of growth, access, and approvals across all institutions"
      >
        <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-2">
          {(data?.insights ?? []).map((line, idx) => (
            <p key={`${idx}-${line}`} className="rounded-xl bg-slate-50 p-3">
              {line}
            </p>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Weekly Active Users" description="Last 7 days login activity">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.charts.weeklyActiveUsers ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Monthly Growth" description="New colleges added (last 6 months)">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.charts.monthlyCollegeGrowth ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="collegesAdded" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Admin Productivity" description="Users/HOD created by each admin and charge estimate">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Admin</th>
                <th className="py-2">Users Created</th>
                <th className="py-2">HOD Created</th>
                <th className="py-2">Est. Monthly Charge</th>
              </tr>
            </thead>
            <tbody>
              {(data?.adminProductivity ?? []).map((row) => (
                <tr key={row.adminId} className="border-b border-slate-100 text-slate-700">
                  <td className="py-2">
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.email}</p>
                  </td>
                  <td className="py-2">{row.usersCreated}</td>
                  <td className="py-2">{row.hodCreated}</td>
                  <td className="py-2 font-semibold">INR {row.estimatedMonthlyCharge.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
