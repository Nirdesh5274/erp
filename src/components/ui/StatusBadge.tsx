type BadgeVariant =
  | "occupied"
  | "vacant"
  | "maintenance"
  | "present"
  | "absent"
  | "late"
  | "pending"
  | "paid"
  | "overdue"
  | "active"
  | "trial"
  | "expired";

const badgeConfig: Record<BadgeVariant, { label: string; className: string }> = {
  occupied: { label: "Occupied", className: "bg-teal-100 text-teal-700 ring-1 ring-teal-200" },
  vacant: { label: "Vacant", className: "bg-slate-100 text-slate-600 ring-1 ring-slate-200" },
  maintenance: { label: "Maintenance", className: "bg-amber-100 text-amber-700 ring-1 ring-amber-200" },
  present: { label: "Present", className: "bg-green-100 text-green-700 ring-1 ring-green-200" },
  absent: { label: "Absent", className: "bg-red-100 text-red-700 ring-1 ring-red-200" },
  late: { label: "Late", className: "bg-amber-100 text-amber-700 ring-1 ring-amber-200" },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-700 ring-1 ring-amber-200" },
  paid: { label: "Paid", className: "bg-green-100 text-green-700 ring-1 ring-green-200" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-700 ring-1 ring-red-200" },
  active: { label: "Active", className: "bg-teal-100 text-teal-700 ring-1 ring-teal-200" },
  trial: { label: "Trial", className: "bg-blue-100 text-blue-700 ring-1 ring-blue-200" },
  expired: { label: "Expired", className: "bg-slate-100 text-slate-500 ring-1 ring-slate-200" },
};

export function StatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase() as BadgeVariant;
  const config = badgeConfig[key] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
