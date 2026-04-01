import React from "react";

interface SectionCardProps {
  title: string;
  description?: string;
  actionSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function SectionCard({ title, description, actionSlot, children }: SectionCardProps) {
  return (
    <section className="panel p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg md:text-xl font-bold tracking-tight text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {actionSlot ? <div className="shrink-0">{actionSlot}</div> : null}
      </div>
      {children}
    </section>
  );
}
