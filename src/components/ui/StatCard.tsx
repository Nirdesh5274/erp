import type { ReactNode } from "react";

type CardColor = "teal" | "amber" | "red" | "green" | "blue";

interface StatCardProps {
  title?: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: { value: number; label: string } | string;
  color?: CardColor;
  onClick?: () => void;
  label?: string;
}

const colorMap: Record<CardColor, { bg: string; icon: string; badge: string }> = {
  teal: { bg: "bg-teal-50", icon: "text-teal-600", badge: "bg-teal-100 text-teal-700" },
  amber: { bg: "bg-amber-50", icon: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
  red: { bg: "bg-red-50", icon: "text-red-600", badge: "bg-red-100 text-red-700" },
  green: { bg: "bg-green-50", icon: "text-green-600", badge: "bg-green-100 text-green-700" },
  blue: { bg: "bg-blue-50", icon: "text-blue-600", badge: "bg-blue-100 text-blue-700" },
};

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  color = "teal",
  onClick,
  label,
}: StatCardProps) {
  const c = colorMap[color];
  const heading = title ?? label ?? "Metric";

  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 md:gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm transition-all duration-200 ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""}`}
    >
      {icon ? (
        <div className={`flex h-10 w-10 md:h-11 md:w-11 flex-shrink-0 items-center justify-center rounded-xl ${c.bg}`}>
          <span className={c.icon}>{icon}</span>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[11px] md:text-xs font-medium uppercase tracking-wide text-slate-500 break-words">{heading}</p>
        <p className="text-xl md:text-2xl font-bold leading-none text-slate-900 break-words">{value}</p>
        {subtitle ? <p className="mt-1.5 text-xs text-slate-500">{subtitle}</p> : null}
        {typeof trend === "string" ? <p className="mt-2 text-xs text-slate-500">{trend}</p> : null}
        {trend && typeof trend !== "string" ? (
          <span className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.badge}`}>
            {trend.value > 0 ? "up" : "down"} {Math.abs(trend.value)}% {trend.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
