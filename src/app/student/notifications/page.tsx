"use client";

import { useNotifications } from "@/hooks/useNotifications";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";

export default function StudentNotificationsPage() {
  const { items, unreadCount, loading, error, markRead, reload } = useNotifications();

  if (loading && items.length === 0 && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="My Notifications"
        description="Class reminders, fee updates, and alerts"
        actionSlot={
          <button
            onClick={() => void reload()}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
          >
            Refresh ({unreadCount} unread)
          </button>
        }
      >
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <div className="space-y-3 text-sm">
          {items.map((note) => (
            <div key={note.id} className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div>
                <p className="font-semibold text-slate-900">{note.title ?? "Notification"}</p>
                <p className="text-slate-700">{note.message}</p>
                <p className="text-xs text-slate-500">{new Date(note.created_at).toLocaleString()}</p>
              </div>
              <button
                onClick={() => void markRead(note.id, !note.read)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${note.read ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
              >
                {note.read ? "Read" : "Mark read"}
              </button>
            </div>
          ))}
          {items.length === 0 && !loading ? <p className="text-xs text-slate-600">No notifications yet.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
