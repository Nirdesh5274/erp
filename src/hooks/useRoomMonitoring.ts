"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/clientApi";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export type LiveStatus = "occupied" | "vacant" | "maintenance" | "cleaning";

export interface MonitoringRoom {
  roomId: string;
  roomName: string;
  roomType: string;
  capacity: number;
  status: LiveStatus;
  currentLectureId: string | null;
  facultyId: string | null;
  facultyName: string;
  subjectId: string | null;
  subjectName: string;
  startsAt: string | null;
  endsAt: string | null;
  attendancePercent: number | null;
  presentCount: number;
  totalMarked: number;
  timeRemainingMinutes: number | null;
  isOverdue: boolean;
  isStartingSoon: boolean;
}

export interface MonitoringAlert {
  id: string;
  roomId: string | null;
  lectureId: string | null;
  message: string;
  severity: string;
  resolved?: boolean;
  createdAt: string;
}

export interface MonitoringEvent {
  id: string;
  roomId: string;
  lectureId: string | null;
  status: LiveStatus;
  reason: string | null;
  changedAt: string;
  changedBy: string | null;
  roomName: string;
  roomType: string;
}

interface MonitoringPayload {
  rooms: MonitoringRoom[];
  alerts: MonitoringAlert[];
  events: MonitoringEvent[];
}

type RoomStatusRow = {
  id?: string;
  status?: string;
  lecture_id?: string | null;
  room_id?: string | null;
};

type MonitoringAlertRow = {
  id?: string;
  room_id?: string | null;
  lecture_id?: string | null;
  message?: string | null;
  severity?: string | null;
  resolved?: boolean | null;
  created_at?: string | null;
};

type StatusLogRow = {
  id?: string;
  room_id?: string | null;
  lecture_id?: string | null;
  status?: string | null;
  reason?: string | null;
  override_by?: string | null;
  changed_at?: string | null;
};

function isKnownRoomStatusTriggerError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("lower(room_live_status)") || normalized.includes("function lower(room_live_status)");
}

export function useRoomMonitoring() {
  const { user } = useCurrentUser();
  const [rooms, setRooms] = useState<MonitoringRoom[]>([]);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [events, setEvents] = useState<MonitoringEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const roomsRef = useRef<MonitoringRoom[]>([]);

  const collegeId = user?.collegeId ?? null;

  const load = async () => {
    if (!collegeId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<MonitoringPayload>("/api/admin/monitoring");
      const normalizedRooms = (data.rooms ?? []).map((room) => ({
        ...room,
        status: (room.status ?? "vacant").toLowerCase() as LiveStatus,
      }));
      setRooms(normalizedRooms);
      roomsRef.current = normalizedRooms;
      setAlerts(data.alerts ?? []);
      setEvents(data.events ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load monitoring");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!collegeId) return;
    void load();

    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`room-monitoring-${collegeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_status_log",
          filter: `college_id=eq.${collegeId}`,
        },
        (payload: RealtimePostgresChangesPayload<RoomStatusRow>) => {
          const newRow = (payload.new ?? {}) as RoomStatusRow;
          const nextStatus = newRow.status?.toLowerCase();
          const lectureId = newRow.lecture_id ?? null;
          const roomId = newRow.room_id ?? null;
          if (!roomId || !nextStatus) return;

          setRooms((prev) =>
            prev.map((room) =>
              room.roomId === roomId
                ? {
                    ...room,
                    status: (nextStatus as LiveStatus) ?? room.status,
                    currentLectureId: lectureId ?? room.currentLectureId,
                  }
                : room,
            ),
          );
          roomsRef.current = roomsRef.current.map((room) =>
            room.roomId === roomId
              ? {
                  ...room,
                  status: (nextStatus as LiveStatus) ?? room.status,
                  currentLectureId: lectureId ?? room.currentLectureId,
                }
              : room,
          );

          const metaRoom = roomsRef.current.find((room) => room.roomId === roomId);

          setEvents((prev) =>
            [
              {
                id: String(newRow.id ?? crypto.randomUUID()),
                roomId,
                lectureId,
                status: (nextStatus as LiveStatus) ?? "vacant",
                reason: (newRow as StatusLogRow).reason ?? null,
                changedAt: (newRow as StatusLogRow).changed_at ?? new Date().toISOString(),
                changedBy: (newRow as StatusLogRow).override_by ?? null,
                roomName: metaRoom?.roomName ?? "",
                roomType: metaRoom?.roomType ?? "",
              },
              ...prev,
            ].slice(0, 60),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "monitoring_alerts",
          filter: `college_id=eq.${collegeId}`,
        },
        (payload: RealtimePostgresChangesPayload<MonitoringAlertRow>) => {
          const newRow = (payload.new ?? {}) as MonitoringAlertRow;
          setAlerts((prev) => [
            {
              id: String(newRow.id ?? crypto.randomUUID()),
              roomId: newRow.room_id ?? null,
              lectureId: newRow.lecture_id ?? null,
              message: String(newRow.message ?? ""),
              severity: String(newRow.severity ?? "warning"),
              resolved: Boolean(newRow.resolved ?? false),
              createdAt: String(newRow.created_at ?? new Date().toISOString()),
            },
            ...prev,
          ]);
        },
      )
      .subscribe((status) => {
        setIsRealtimeConnected(status === "SUBSCRIBED");
      });

    const refreshInterval = window.setInterval(() => {
      void load();
    }, 30000);

    return () => {
      window.clearInterval(refreshInterval);
      setIsRealtimeConnected(false);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId]);

  const overrideRoom = async (roomId: string, status: LiveStatus, reason?: string) => {
    setError(null);
    try {
      await apiFetch("/api/admin/monitoring", {
        method: "PATCH",
        body: JSON.stringify({ roomId, status, reason }),
      });
      await load();
    } catch (overrideError) {
      const message = overrideError instanceof Error ? overrideError.message : "Unable to override room";
      if (isKnownRoomStatusTriggerError(message)) {
        await load();
        return;
      }
      setError(message);
    }
  };

  const occupiedCount = useMemo(
    () => rooms.filter((r) => (r.status ?? "vacant").toLowerCase() === "occupied").length,
    [rooms],
  );

  return {
    rooms,
    alerts,
    loading,
    error,
    occupiedCount,
    refresh: load,
    overrideRoom,
    events,
    isRealtimeConnected,
  };
}
