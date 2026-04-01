"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { PageSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";
import { useNotifications } from "@/hooks/useNotifications";

interface AlertRow {
  id: string;
  room_id: string | null;
  lecture_id: string | null;
  message: string;
  severity: string;
  resolved: boolean;
  created_at: string;
}

interface AlertsResponse {
  alerts: AlertRow[];
}

export default function AdminNotificationsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { items, unreadCount, loading: loadingMy, error: myError, markRead, reload } = useNotifications();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AlertsResponse>("/api/admin/notifications");
      setAlerts(data.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const markResolved = async (id: string, resolved: boolean) => {
    setError(null);
    try {
      await apiFetch("/api/admin/notifications", {
        method: "PATCH",
        body: JSON.stringify({ alertId: id, resolved }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update notification");
    }
  };

  const stats = useMemo(() => {
    const open = alerts.filter((a) => !a.resolved).length;
    const critical = alerts.filter((a) => a.severity === "critical" && !a.resolved).length;
    return [
      { label: "Open Alerts", value: open, trend: `${alerts.length} total` },
      { label: "Critical", value: critical, trend: "Monitoring" },
    ];
  }, [alerts]);

  const toText = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

  if (loading && alerts.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Notifications</p>
          <h1 className="text-2xl font-black text-slate-900">Alerts & Actions</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
        <StatCard label="My unread" value={unreadCount} trend="In-app notices" />
      </div>

      <SectionCard title="Latest alerts" description="Mark resolved after handling">
        {loading ? <TableSkeleton rows={4} /> : null}
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertCircle className={alert.severity === "critical" ? "text-rose-600" : "text-amber-600"} size={18} />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{alert.message}</p>
                  <p className="text-xs text-slate-500">{new Date(alert.created_at).toLocaleString()}</p>
                  <p className="text-xs text-slate-500">Room: {alert.room_id ?? "—"} · Lecture: {alert.lecture_id ?? "—"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void markResolved(alert.id, !alert.resolved)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${alert.resolved ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
              >
                <CheckCircle size={14} /> {alert.resolved ? "Resolved" : "Mark Resolved"}
              </button>
            </div>
          ))}
          {alerts.length === 0 && !loading ? <p className="text-sm text-slate-500">No alerts yet.</p> : null}
        </div>
      </SectionCard>

      <SectionCard title="In-app notifications" description="Personal messages, email/push queued" actionSlot={
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
        >
          Refresh
        </button>
      }>
        {loadingMy ? <TableSkeleton rows={4} /> : null}
        {myError ? <p className="mb-3 text-sm text-rose-700">{myError}</p> : null}
        <div className="space-y-3 text-sm">
          {items.map((note) => (
            <div key={note.id} className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div>
                <p className="font-semibold text-slate-900">{note.title ?? "Notification"}</p>
                <p className="text-slate-700">{note.message}</p>
                <p className="text-xs text-slate-500">{new Date(note.created_at).toLocaleString()}</p>
                <p className="text-xs text-slate-500">Channels: {(note.metadata?.channels as string[] | undefined)?.join(", ") ?? "in-app"}</p>
                <p className="text-xs text-slate-500">Email: {toText(note.metadata?.emailStatus, "n/a")} · Push: {toText(note.metadata?.pushStatus, "n/a")}</p>
              </div>
              <button
                type="button"
                onClick={() => void markRead(note.id, !note.read)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${note.read ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
              >
                {note.read ? "Read" : "Mark read"}
              </button>
            </div>
          ))}
          {items.length === 0 && !loadingMy ? <p className="text-xs text-slate-600">No notifications yet.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
