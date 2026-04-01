import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { superAdminStats } from "@/services/dashboardData";

export default function SuperAdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {superAdminStats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} trend={stat.trend} />
        ))}
      </div>

      <SectionCard
        title="Bireena Multi-Campus Insights"
        description="Overview of growth, access, and approvals across all institutions"
      >
        <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-2">
          <p className="rounded-xl bg-slate-50 p-3">North Zone onboarding completion is at 84%.</p>
          <p className="rounded-xl bg-slate-50 p-3">4 colleges requested new admin privileges today.</p>
          <p className="rounded-xl bg-slate-50 p-3">Central audit reports are ready for export.</p>
          <p className="rounded-xl bg-slate-50 p-3">2 campuses flagged for inactive session data sync.</p>
        </div>
      </SectionCard>
    </div>
  );
}
