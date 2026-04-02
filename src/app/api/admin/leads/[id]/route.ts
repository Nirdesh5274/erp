import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const statusTransitions: Record<string, string[]> = {
  new: ["contacted", "refused"],
  contacted: ["follow_up", "refused"],
  follow_up: ["contacted", "refused"],
  refused: [],
  converted: [],
};

const patchSchema = z.object({
  status: z.enum(["new", "contacted", "follow_up", "refused", "converted"]).optional(),
  notes: z.string().max(1500).optional().nullable(),
  followUpDate: z.string().date().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  refusedReason: z.string().max(1500).optional().nullable(),
});

function normalizeText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function isSchoolInstitution(collegeId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("colleges")
    .select("type")
    .eq("id", collegeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.type === "school";
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(ctx.collegeId))) return apiError("Leads pipeline is available only for school mode", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id,status")
      .eq("id", id)
      .eq("institution_id", ctx.collegeId)
      .is("deleted_at", null)
      .maybeSingle();

    if (leadError) return apiError(leadError.message, 500);
    if (!lead) return apiError("Lead not found", 404);

    if (body.status === "converted") {
      return apiError("Converted status can only be set via convert endpoint", 400);
    }

    if (body.status && body.status !== lead.status) {
      const allowed = statusTransitions[lead.status] ?? [];
      if (!allowed.includes(body.status)) {
        return apiError(`Invalid status transition: ${lead.status} -> ${body.status}`, 400);
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.notes !== undefined) updatePayload.notes = normalizeText(body.notes);
    if (body.followUpDate !== undefined) updatePayload.follow_up_date = body.followUpDate;
    if (body.assignedTo !== undefined) updatePayload.assigned_to = body.assignedTo;
    if (body.refusedReason !== undefined) updatePayload.refused_reason = normalizeText(body.refusedReason);

    if (body.status === "refused" && body.refusedReason === undefined) {
      updatePayload.refused_reason = null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return apiError("No updates provided", 400);
    }

    const { data, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", id)
      .eq("institution_id", ctx.collegeId)
      .is("deleted_at", null)
      .select("id,name,phone,email,parent_name,parent_phone,interested_class,interested_section,academic_year,status,refused_reason,follow_up_date,notes,assigned_to,converted_student_id,converted_at,source,created_at,updated_at")
      .single();

    if (error) return apiError(error.message, 400);
    return apiSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update lead", 500, String(error));
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(ctx.collegeId))) return apiError("Leads pipeline is available only for school mode", 400);

    const supabase = getSupabaseAdmin();
    const { data: lead, error: fetchError } = await supabase
      .from("leads")
      .select("id,status")
      .eq("id", id)
      .eq("institution_id", ctx.collegeId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError) return apiError(fetchError.message, 500);
    if (!lead) return apiError("Lead not found", 404);

    if (!(lead.status === "new" || lead.status === "refused")) {
      return apiError("Only new or refused leads can be deleted", 400);
    }

    const { error } = await supabase
      .from("leads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("institution_id", ctx.collegeId)
      .is("deleted_at", null);

    if (error) return apiError(error.message, 400);
    return apiSuccess({ id, deleted: true });
  } catch (error) {
    return apiError("Unable to delete lead", 500, String(error));
  }
}
