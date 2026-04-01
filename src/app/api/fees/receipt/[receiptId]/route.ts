import { apiError } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type ComponentRow = { name?: string; amount?: number | string };

function isMissingDescriptionColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("fee_structures.description") || msg.includes("column description does not exist");
}

function inr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function renderHtml(payload: {
  schoolName: string;
  schoolAddress: string;
  schoolLogoUrl: string;
  receiptNumber: string;
  receiptDate: string;
  studentName: string;
  admissionNumber: string;
  email: string;
  phone: string;
  paymentMode: string;
  referenceNumber: string;
  structureDescription: string;
  components: Array<{ name: string; amount: number }>;
  paidAmount: number;
}) {
  const rows = payload.components
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${item.name}</td>
          <td class="num">${inr(item.amount)}</td>
        </tr>
      `,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${payload.receiptNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; background:#f8fafc; margin:0; padding:24px; color:#0f172a; }
    .sheet { max-width: 860px; margin:0 auto; background:#fff; border:1px solid #cbd5e1; border-radius:12px; overflow:hidden; }
    .head { padding:20px 24px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; gap:16px; }
    .logo { width:64px; height:64px; border-radius:10px; border:1px solid #dbe3ef; object-fit:cover; background:#fff; }
    .logoFallback { width:64px; height:64px; border-radius:10px; border:1px solid #dbe3ef; display:flex; align-items:center; justify-content:center; font-weight:700; color:#334155; background:#f8fafc; }
    .headText { flex:1; }
    .title { margin:0; font-size:22px; font-weight:700; }
    .sub { margin:4px 0 0; color:#475569; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:16px 24px; border-bottom:1px solid #e2e8f0; }
    .meta p { margin:4px 0; font-size:14px; }
    .sec { padding:16px 24px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { border:1px solid #e2e8f0; padding:10px; text-align:left; }
    th { background:#f1f5f9; }
    .num { text-align:right; }
    .total { margin-top:12px; display:flex; justify-content:flex-end; font-size:16px; font-weight:700; }
    .foot { padding:16px 24px; border-top:1px solid #e2e8f0; color:#475569; font-size:12px; display:flex; justify-content:space-between; }
    .print { position:fixed; right:20px; top:20px; background:#0f172a; color:#fff; border:0; border-radius:8px; padding:8px 12px; cursor:pointer; }
    @media print { .print { display:none; } body { background:#fff; padding:0; } .sheet { border:0; border-radius:0; } }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Print / Save PDF</button>
  <article class="sheet">
    <header class="head">
      ${payload.schoolLogoUrl ? `<img class="logo" src="${payload.schoolLogoUrl}" alt="School Logo" />` : `<div class="logoFallback">${payload.schoolName.slice(0, 1)}</div>`}
      <div class="headText">
        <h1 class="title">${payload.schoolName}</h1>
        <p class="sub">${payload.schoolAddress}</p>
        <p class="sub"><strong>Fee Payment Receipt</strong></p>
      </div>
    </header>

    <section class="meta">
      <div>
        <p><strong>Student:</strong> ${payload.studentName}</p>
        <p><strong>Admission No:</strong> ${payload.admissionNumber}</p>
        <p><strong>Email:</strong> ${payload.email}</p>
        <p><strong>Phone:</strong> ${payload.phone}</p>
      </div>
      <div>
        <p><strong>Receipt No:</strong> ${payload.receiptNumber}</p>
        <p><strong>Date:</strong> ${payload.receiptDate}</p>
        <p><strong>Payment Mode:</strong> ${payload.paymentMode}</p>
        <p><strong>Reference:</strong> ${payload.referenceNumber}</p>
      </div>
    </section>

    <section class="sec">
      ${payload.structureDescription ? `<p style="margin:0 0 12px;color:#334155;"><strong>Structure:</strong> ${payload.structureDescription}</p>` : ""}
      <table>
        <thead>
          <tr>
            <th style="width:64px">#</th>
            <th>Particular</th>
            <th style="width:180px" class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td>1</td><td>Fee Payment</td><td class="num">' + inr(payload.paidAmount) + '</td></tr>'}
        </tbody>
      </table>
      <p class="total">Paid Amount: ${inr(payload.paidAmount)}</p>
    </section>

    <footer class="foot">
      <span>This is a system-generated receipt.</span>
      <span>ERP Billing Desk</span>
    </footer>
  </article>
</body>
</html>`;
}

async function loadCollegeBranding(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  collegeId: string,
) {
  const withLogo = await supabase
    .from("colleges")
    .select("id,name,location,logo_url")
    .eq("id", collegeId)
    .maybeSingle();

  if (!withLogo.error) {
    return {
      name: withLogo.data?.name ?? "School",
      location: withLogo.data?.location ?? "Address",
      logoUrl: String((withLogo.data as { logo_url?: string | null } | null)?.logo_url ?? ""),
    };
  }

  const fallback = await supabase
    .from("colleges")
    .select("id,name,location")
    .eq("id", collegeId)
    .maybeSingle();

  return {
    name: fallback.data?.name ?? "School",
    location: fallback.data?.location ?? "Address",
    logoUrl: "",
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "Student", "HOD", "SuperAdmin"])) {
      return apiError("Forbidden", 403);
    }
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const { receiptId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: modernReceipt, error: modernReceiptError } = await supabase
      .from("receipts")
      .select("id,payment_id,student_fee_id,student_id,file_url,payload,created_at")
      .eq("id", receiptId)
      .maybeSingle();

    if (!modernReceiptError && modernReceipt) {
      const [{ data: payment }, { data: studentFee }, { data: items }, { data: student }] =
        await Promise.all([
          supabase
            .from("payments")
            .select("id,amount,payment_mode,transaction_id,receipt_number,paid_at")
            .eq("id", modernReceipt.payment_id)
            .maybeSingle(),
          supabase
            .from("student_fees")
            .select("id,college_id,student_id,fee_structure_id")
            .eq("id", modernReceipt.student_fee_id)
            .eq("college_id", ctx.collegeId)
            .maybeSingle(),
          supabase
            .from("student_fee_items")
            .select("label,amount")
            .eq("student_fee_id", modernReceipt.student_fee_id)
            .order("created_at", { ascending: true }),
          supabase.from("students").select("id,name,email,admission_id").eq("id", modernReceipt.student_id).maybeSingle(),
        ]);

      let structureDescriptionValue = "";
      if (studentFee?.fee_structure_id) {
        const structureDescription = await supabase
          .from("fee_structures")
          .select("description")
          .eq("id", studentFee.fee_structure_id)
          .maybeSingle();

        if (structureDescription.error && !isMissingDescriptionColumn(structureDescription.error.message)) {
          return apiError(structureDescription.error.message, 500);
        }

        structureDescriptionValue = String(structureDescription.data?.description ?? "");
      }

      const college = await loadCollegeBranding(supabase, ctx.collegeId);

      if (!studentFee) return apiError("Fee not found", 404);
      if (ctx.role === "Student") {
        const { data: studentRow } = await supabase
          .from("students")
          .select("id")
          .eq("college_id", ctx.collegeId)
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (!studentRow || studentRow.id !== studentFee.student_id) return apiError("Forbidden", 403);
      }

      const components = (items ?? [])
        .map((item) => ({
          name: String(item.label ?? "Fee Component"),
          amount: Number(item.amount ?? 0),
        }))
        .filter((item) => item.amount > 0);

      const paidAmount = Number(payment?.amount ?? 0);
      const html = renderHtml({
        schoolName: college.name,
        schoolAddress: college.location,
        schoolLogoUrl: college.logoUrl,
        receiptNumber:
          (modernReceipt.payload as Record<string, unknown> | null | undefined)?.receiptNumber as string ||
          payment?.receipt_number ||
          modernReceipt.id,
        receiptDate: new Date(payment?.paid_at ?? modernReceipt.created_at ?? new Date().toISOString()).toLocaleString(),
        studentName: student?.name ?? "Student",
        admissionNumber: String(student?.admission_id ?? "N/A"),
        email: student?.email ?? "N/A",
        phone: "N/A",
        paymentMode: payment?.payment_mode ?? "N/A",
        referenceNumber: payment?.transaction_id ?? "N/A",
        structureDescription: structureDescriptionValue,
        components,
        paidAmount,
      });

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }

    const { data: receipt, error: receiptError } = await supabase
      .from("payment_receipts")
      .select("id,fee_id,receipt_number,amount,payment_mode,reference_number,paid_at")
      .eq("id", receiptId)
      .single();

    if (receiptError || !receipt) return apiError("Receipt not found", 404);

    const { data: fee, error: feeError } = await supabase
      .from("fees")
      .select("id,college_id,student_id,admission_id,components")
      .eq("id", receipt.fee_id)
      .eq("college_id", ctx.collegeId)
      .single();

    if (feeError || !fee) return apiError("Fee not found", 404);

    if (ctx.role === "Student") {
      const { data: studentRow } = await supabase
        .from("students")
        .select("id")
        .eq("college_id", ctx.collegeId)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (!studentRow || studentRow.id !== fee.student_id) return apiError("Forbidden", 403);
    }

    const [{ data: student }, { data: admission }] = await Promise.all([
      supabase.from("students").select("id,name,email").eq("id", fee.student_id).maybeSingle(),
      supabase.from("admissions").select("id,phone").eq("id", fee.admission_id).maybeSingle(),
    ]);

    const college = await loadCollegeBranding(supabase, String(fee.college_id));

    const components = Array.isArray(fee.components)
      ? (fee.components as ComponentRow[])
          .map((item) => ({
            name: String(item.name ?? "Fee Component"),
            amount: Number(item.amount ?? 0),
          }))
          .filter((item) => item.amount > 0)
      : [];

    const html = renderHtml({
      schoolName: college.name,
      schoolAddress: college.location,
      schoolLogoUrl: college.logoUrl,
      receiptNumber: receipt.receipt_number ?? receipt.id,
      receiptDate: new Date(receipt.paid_at ?? new Date().toISOString()).toLocaleString(),
      studentName: student?.name ?? "Student",
      admissionNumber: admission?.id ?? String(fee.admission_id ?? "N/A"),
      email: student?.email ?? "N/A",
      phone: admission?.phone ?? "N/A",
      paymentMode: receipt.payment_mode ?? "N/A",
      referenceNumber: receipt.reference_number ?? "N/A",
      structureDescription: "",
      components,
      paidAmount: Number(receipt.amount ?? 0),
    });

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    return apiError("Unable to generate receipt", 500, String(error));
  }
}
