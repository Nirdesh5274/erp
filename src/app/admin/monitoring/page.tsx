"use client";

import { useMemo } from "react";
import { Activity, AlertCircle, AlertTriangle, Clock, Flame, Gauge, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { useRoomMonitoring, type LiveStatus } from "@/hooks/useRoomMonitoring";
import { PageSkeleton } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/StatusBadge";

const statusStyles: Record<string, string> = {
  occupied: "bg-emerald-100 text-emerald-800 border-emerald-200",
  vacant: "bg-slate-100 text-slate-800 border-slate-200",
  maintenance: "bg-amber-100 text-amber-800 border-amber-200",
  cleaning: "bg-sky-100 text-sky-800 border-sky-200",
};

const severityStyles: Record<string, string> = {
  critical: "bg-rose-100 text-rose-800 border-rose-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  info: "bg-sky-100 text-sky-800 border-sky-200",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatMinutes(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  if (value <= 0) return "Ending";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${minutes}m`;
}

export default function AdminMonitoringPage() {
  const { rooms, alerts, events, loading, error, occupiedCount, refresh, overrideRoom, isRealtimeConnected } = useRoomMonitoring();

  const stats = useMemo(
    () => [
      { label: "Rooms Occupied", value: occupiedCount, trend: `${rooms.length} total` },
      {
        label: "Live Alerts",
        value: alerts.length,
        trend: alerts.length > 0 ? "Action needed" : "All clear",
      },
      {
        label: "Low Attendance (<60%)",
        value: rooms.filter((room) => (room.attendancePercent ?? 100) < 60).length,
        trend: "Pulse from attendance",
      },
      {
        label: "Overdue Rooms",
        value: rooms.filter((room) => room.isOverdue).length,
        trend: "Past end time",
      },
    ],
    [alerts.length, occupiedCount, rooms],
  );

  const handleOverride = (roomId: string, status: keyof typeof statusStyles & LiveStatus) => {
    const wantsReason = status === "maintenance" || status === "cleaning";
    const reason = wantsReason ? window.prompt("Add a note for this override (optional)")?.trim() : undefined;
    void overrideRoom(roomId, status, reason || undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Live Monitoring</p>
          <h1 className="text-2xl font-black text-slate-900">Room grid and attendance pulse</h1>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className={`h-2.5 w-2.5 rounded-full ${isRealtimeConnected ? "animate-pulse bg-emerald-500" : "bg-slate-300"}`} />
            {isRealtimeConnected ? "Realtime connected" : "Realtime reconnecting"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      {loading && rooms.length === 0 ? <PageSkeleton /> : null}

      <SectionCard title="Room Grid" description="Realtime room status, attendance pulse, and time remaining">
        {loading && rooms.length > 0 ? <p className="text-sm text-slate-500">Refreshing monitoring data...</p> : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => {
            const normalizedStatus = (room.status ?? "vacant").toLowerCase();
            return (
              <article
                key={room.roomId}
                className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
                  normalizedStatus === "occupied"
                    ? "border-l-4 border-l-teal-500"
                    : normalizedStatus === "maintenance"
                      ? "border-l-4 border-l-amber-500"
                      : "border-l-4 border-l-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{room.roomType}</p>
                    <h3 className="text-lg font-bold text-slate-900">{room.roomName}</h3>
                    <p className="text-xs text-slate-500">Capacity {room.capacity}</p>
                  </div>
                  <StatusBadge status={normalizedStatus} />
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  <p className="flex items-center gap-2 text-slate-600">
                    <Clock size={16} className="text-slate-500" /> {formatTime(room.startsAt)} → {formatTime(room.endsAt)}
                    <span className="text-xs text-slate-500">({formatMinutes(room.timeRemainingMinutes)})</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Gauge size={16} className="text-emerald-600" /> Attendance {room.attendancePercent ?? "—"}%
                    <span className="text-xs text-slate-500">
                      ({room.presentCount}/{room.totalMarked || "?"})
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-sky-600" /> {room.facultyName || "Faculty TBD"}
                  </p>
                  <p className="flex items-center gap-2">
                    <Flame size={16} className="text-amber-600" /> {room.subjectName || "Subject pending"}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => handleOverride(room.roomId, "maintenance")}
                  >
                    <Wrench size={14} className="mr-1 inline" /> Maintenance
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => handleOverride(room.roomId, "vacant")}
                  >
                    Mark Vacant
                  </button>
                  {room.isOverdue ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                      <AlertTriangle size={14} /> Overdue
                    </span>
                  ) : null}
                  {room.isStartingSoon ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      <Clock size={14} /> Starting soon
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Live Timeline" description="Latest overrides and status changes">
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No recent changes.</p>
        ) : (
          <div className="space-y-3">
            {events.slice(0, 16).map((event) => {
              const badgeClass = statusStyles[event.status] ?? statusStyles.vacant;
              return (
                <div
                  key={event.id}
                  className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>
                      <Activity size={14} /> {event.status.toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{event.roomName || "Room"}</p>
                      <p className="text-xs text-slate-500">
                        {event.roomType ? `${event.roomType} • ` : ""}
                        {new Date(event.changedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {event.changedBy ? ` by ${event.changedBy}` : ""}
                      </p>
                      {event.reason ? <p className="text-xs text-slate-600">{event.reason}</p> : null}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">{new Date(event.changedAt).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Alerts" description="Newest first">
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No alerts yet.</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const badgeClass = severityStyles[alert.severity] ?? severityStyles.warning;
              return (
                <div
                  key={alert.id}
                  className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 text-amber-600" size={18} />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{alert.message}</p>
                      <p className="text-xs text-slate-500">{new Date(alert.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>
                    {alert.severity}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
