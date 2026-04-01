"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";

interface UploadItem {
  id: string;
  label: string;
  status: "pending" | "uploaded";
  fileName?: string;
}

const downloadTemplates = [
  { id: "admission-letter", label: "Admission letter" },
  { id: "fee-receipt", label: "Latest fee receipt" },
  { id: "bonafide", label: "Bonafide certificate" },
];

export default function StudentDocumentsPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([
    { id: "marksheet", label: "Marksheets", status: "pending" },
    { id: "id-proof", label: "ID proof", status: "pending" },
  ]);

  const handleDownload = (itemId: string, label: string) => {
    const content = `${label} for your records. Generated on ${new Date().toLocaleString()}.`;
    const blob = new Blob([content], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${itemId}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = (id: string, file: File) => {
    setUploads((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "uploaded", fileName: file.name } : item)),
    );
    toast("File stored locally. Connect storage API to persist uploads.");
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Download documents" description="Auto-generated letters and receipts">
        <div className="grid gap-3 md:grid-cols-3">
          {downloadTemplates.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <p className="font-semibold text-slate-900">{doc.label}</p>
              <p className="text-xs text-slate-600">Generated on demand.</p>
              <button
                onClick={() => handleDownload(doc.id, doc.label)}
                className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
              >
                Download PDF
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Upload requested documents" description="Send files requested by admin">
        <div className="space-y-3 text-sm text-slate-700">
          {uploads.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div>
                <p className="font-semibold text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-600">Status: {item.status === "uploaded" ? "Uploaded" : "Pending"}</p>
                {item.fileName ? <p className="text-xs text-slate-500">Last file: {item.fileName}</p> : null}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                Upload
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(item.id, file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Hook this to storage (Supabase bucket/S3) to persist uploads.</p>
      </SectionCard>
    </div>
  );
}
