import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/clientApi";

interface NotificationRow {
  id: string;
  title: string | null;
  message: string | null;
  link: string | null;
  read: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface NotificationsResponse {
  notifications: NotificationRow[];
}

export function useNotifications(pollMs = 15000) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<NotificationsResponse>("/api/notifications");
      setItems(data.notifications ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => {
      void load();
    }, pollMs) as unknown as number;
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [pollMs]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const markRead = async (notificationId: string, read = true) => {
    try {
      await apiFetch("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ notificationId, read }),
      });
      setItems((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read } : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update notification");
    }
  };

  return { items, unreadCount, loading, error, reload: load, markRead };
}
