"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BellRing } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { apiFetch } from "@/lib/clientApi";

interface ReportSummary {
  totalStudents: number;
  revenueCollected: number;
  revenueDue: number;
  attendancePercent: number;
  roomUsagePercent: number;
  totalRooms: number;
  transactionsTodayCount: number;
  transactionsTodayAmount: number;
  dailyTransactions: Array<{ date: string; amount: number; count: number }>;
  recentTransactions: Array<{ id: string; amount: number; paymentMode: string; referenceNumber: string | null; paidAt: string }>;
}

interface AttendanceSummary {
  attendance: { total: number; byStatus: Record<string, number> };
  lockedLectures: number;
  todaysLectures: number;
  openAlerts: number;
}

interface AlertsResponse {
  alerts: Array<{ id: string; severity: string; resolved: boolean; message: string; created_at: string }>;
}

interface StudentRow {
  id: string;
  name: string;
  email: string;
  department_id: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface AdmissionRow {
  id: string;
  studentName: string;
  status: string;
  createdAt: string;
  departmentId: string;
}

interface FeeRow {
  id: string;
  paidAmount: number;
  dueAmount: number;
  generatedAt: string;
  paymentMode?: string | null;
  studentId: string | null;
}

interface RoomMonitorRow {
  roomId: string;
  roomName: string;
  status: "Occupied" | "Vacant";
  updatedAt: string;
}

interface ChartPoint {
  label: string;
  value: number;
  secondary?: number;
}

const palette = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];

export default function AdminAnalyticsPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse["alerts"]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [monitorRows, setMonitorRows] = useState<RoomMonitorRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        const [reportData, attendanceData, alertsData, studentsData, departmentsData, admissionsData, feesData, monitorData] = await Promise.all([
          apiFetch<ReportSummary>("/api/admin/reports"),
          apiFetch<AttendanceSummary>("/api/admin/attendance/summary"),
          apiFetch<AlertsResponse>("/api/admin/notifications"),
          apiFetch<StudentRow[]>("/api/admin/students"),
          apiFetch<DepartmentRow[]>("/api/admin/departments"),
          apiFetch<AdmissionRow[]>("/api/admin/admissions"),
          apiFetch<FeeRow[]>("/api/admin/fees"),
          apiFetch<RoomMonitorRow[]>("/api/admin/class-monitor"),
        ]);

        setSummary(reportData);
        setAttendance(attendanceData);
        setAlerts(alertsData.alerts);
        setStudents(studentsData);
        setDepartments(departmentsData);
        setAdmissions(admissionsData);
        setFees(feesData);
        setMonitorRows(monitorData);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load analytics");
      }
    };

    void load();
  }, []);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const departmentById = useMemo(() => new Map(departments.map((dept) => [dept.id, dept.name])), [departments]);

  const stats = useMemo(
    () => [
      { label: "Total Students", value: summary?.totalStudents ?? students.length, trend: "Live enrollment" },
      { label: "Attendance Entries", value: attendance?.attendance.total ?? 0, trend: "Last 7 days" },
      {
        label: "Fee Collected",
        value: `INR ${(summary?.revenueCollected ?? 0).toLocaleString()}`,
        trend: `Due INR ${(summary?.revenueDue ?? 0).toLocaleString()}`,
      },
      { label: "Room Usage", value: `${summary?.roomUsagePercent ?? 0}%`, trend: `${summary?.totalRooms ?? 0} rooms` },
    ],
    [summary, students.length, attendance],
  );

  const admissionsTrend = useMemo<ChartPoint[]>(() => {
    const today = new Date();
    const byDate = new Map<string, number>();

    admissions.forEach((item) => {
      const key = new Date(item.createdAt).toISOString().slice(0, 10);
      byDate.set(key, (byDate.get(key) ?? 0) + 1);
    });

    return Array.from({ length: 30 }, (_, idx) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - idx));
      const key = date.toISOString().slice(0, 10);
      return { label: key.slice(5), value: byDate.get(key) ?? 0 };
    });
  }, [admissions]);

  const departmentAdmissions = useMemo<ChartPoint[]>(() => {
    const counts = new Map<string, number>();
    admissions.forEach((item) => {
      const label = departmentById.get(item.departmentId) ?? "Unknown";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [admissions, departmentById]);

  const monthlyRevenue = useMemo<ChartPoint[]>(() => {
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, idx) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return { label: date.toLocaleString("en-US", { month: "short" }), key, value: 0, secondary: 0 };
    });

    const bucketByKey = new Map(buckets.map((item) => [item.key, item]));

    fees.forEach((fee) => {
      const date = new Date(fee.generatedAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = bucketByKey.get(key);
      if (!bucket) return;
      bucket.value += fee.paidAmount;
      bucket.secondary = (bucket.secondary ?? 0) + fee.dueAmount;
    });

    return buckets.map((item) => ({ label: item.label, value: item.value, secondary: item.secondary }));
  }, [fees]);

  const paymentModes = useMemo(() => {
    const counts = new Map<string, number>();

    fees.forEach((fee) => {
      const key = fee.paymentMode?.trim() || "Unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [fees]);

  const defaulters = useMemo(() => {
    return fees
      .filter((fee) => fee.dueAmount > 0)
      .sort((a, b) => b.dueAmount - a.dueAmount)
      .slice(0, 20)
      .map((fee) => ({
        id: fee.id,
        name: studentById.get(fee.studentId ?? "")?.name ?? "Unknown student",
        email: studentById.get(fee.studentId ?? "")?.email ?? "No email",
        due: fee.dueAmount,
        generatedAt: fee.generatedAt,
      }));
  }, [fees, studentById]);

  const roomUsage = useMemo<ChartPoint[]>(() => {
    return monitorRows.map((row) => ({
      label: row.roomName,
      value: row.status === "Occupied" ? 100 : 0,
    }));
  }, [monitorRows]);

  const admissionFunnel = useMemo<ChartPoint[]>(() => {
    const totalAdmissions = admissions.length;
    const totalStudents = students.length;
    const feePaid = fees.filter((fee) => fee.dueAmount === 0).length;

    return [
      { label: "Admissions", value: totalAdmissions },
      { label: "Students", value: totalStudents },
      { label: "Fee Paid", value: feePaid },
      { label: "Pending Fee", value: Math.max(totalStudents - feePaid, 0) },
    ];
  }, [admissions.length, students.length, fees]);

  const statusRows = useMemo(() => {
    const byStatus = attendance?.attendance.byStatus ?? {};
    const total = attendance?.attendance.total ?? 0;

    return Object.entries(byStatus)
      .map(([key, count]) => ({
        key,
        label: key.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        count,
        percent: total ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [attendance]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
      </div>

      <SectionCard title="Admissions overview" description="Live trend and department distribution from admissions data">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={admissionsTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentAdmissions}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#a855f7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Fee analytics" description="Actual paid, due, payment mode split, and top pending accounts">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" name="Paid" stroke="#0ea5e9" strokeWidth={2} />
                <Line type="monotone" dataKey="secondary" name="Due" stroke="#ef4444" strokeWidth={2} />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentModes} dataKey="value" nameKey="name" innerRadius={45} outerRadius={82} paddingAngle={3}>
                  {paymentModes.map((entry, index) => (
                    <Cell key={entry.name} fill={palette[index % palette.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm text-slate-800">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2 pr-4 font-semibold">Student</th>
                <th className="py-2 pr-4 font-semibold">Email</th>
                <th className="py-2 pr-4 font-semibold">Due</th>
                <th className="py-2 font-semibold">Generated</th>
              </tr>
            </thead>
            <tbody>
              {defaulters.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">{row.name}</td>
                  <td className="py-2 pr-4 text-slate-600">{row.email}</td>
                  <td className="py-2 pr-4 font-semibold">INR {row.due.toLocaleString()}</td>
                  <td className="py-2 text-slate-600">{new Date(row.generatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Transactions report" description="Daily collection and latest transactions">
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <StatCard
            label="Transactions Today"
            value={summary?.transactionsTodayCount ?? 0}
            trend="Receipt entries"
          />
          <StatCard
            label="Today Collection"
            value={`INR ${(summary?.transactionsTodayAmount ?? 0).toLocaleString()}`}
            trend="Captured payments"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary?.dailyTransactions ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="amount" name="Amount" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                <Bar dataKey="count" name="Count" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 text-sm">
            {(summary?.recentTransactions ?? []).map((tx) => (
              <div key={tx.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">INR {tx.amount.toLocaleString()} · {tx.paymentMode}</p>
                <p className="text-xs text-slate-600">Ref: {tx.referenceNumber ?? "—"}</p>
                <p className="text-xs text-slate-500">{new Date(tx.paidAt).toLocaleString()}</p>
              </div>
            ))}
            {(summary?.recentTransactions?.length ?? 0) === 0 ? <p className="text-xs text-slate-600">No transactions yet.</p> : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Room utilization" description="Live occupancy state from class monitor">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roomUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 text-sm">
            {monitorRows.map((row) => (
              <div key={row.roomId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <p className="font-semibold text-slate-800">{row.roomName}</p>
                  <p className="text-xs text-slate-500">Updated {new Date(row.updatedAt).toLocaleString()}</p>
                </div>
                <span className={row.status === "Occupied" ? "text-emerald-700" : "text-slate-500"}>{row.status}</span>
              </div>
            ))}
            {monitorRows.length === 0 ? <p className="text-xs text-slate-600">No room monitor rows found.</p> : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Admission funnel" description="Current stage counts from live admissions, students, and fees">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={admissionFunnel}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Attendance mix" description="Status distribution from attendance summary API">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-800">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Count</th>
                <th className="py-2 font-semibold">Percent</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">{row.label}</td>
                  <td className="py-2 pr-4 font-semibold">{row.count}</td>
                  <td className="py-2 text-slate-600">{row.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Recent alerts" description="Unresolved monitoring and operational alerts">
        <div className="space-y-2 text-sm">
          {alerts.slice(0, 6).map((alert) => (
            <div key={alert.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <p className="font-semibold text-slate-800">{alert.message}</p>
                <p className="text-xs text-slate-500">{new Date(alert.created_at).toLocaleString()}</p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${alert.resolved ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                <BellRing size={14} /> {alert.resolved ? "Resolved" : alert.severity}
              </span>
            </div>
          ))}
          {alerts.length === 0 ? <p className="text-xs text-slate-600">No alerts right now.</p> : null}
        </div>
      </SectionCard>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
