import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const componentSchema = z.object({
  componentKey: z.string().min(1).optional(),
  componentName: z.string().min(1),
  amount: z.number().nonnegative(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().trim().max(400).optional(),
  semester: z.number().int().min(1).max(12).optional(),
  classId: z.string().uuid().optional(),
  term: z.string().trim().min(1).max(20).optional(),
  academicYear: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  components: z.array(componentSchema).optional(),
});

function toKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "component";
}

function isMissingDescriptionColumn(message: string | undefined) {
  return (message ?? "").toLowerCase().includes("fee_structures.description")
    || (message ?? "").toLowerCase().includes("column description does not exist");
}

function isMissingSemesterColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("semester") && (msg.includes("column") || msg.includes("schema cache"));
}

function isMissingClassIdColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("class_id") && (msg.includes("column") || msg.includes("schema cache"));
}

function isMissingTermColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("term") && (msg.includes("column") || msg.includes("schema cache"));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);

    const body = patchSchema.parse(await request.json());
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const updatePayload: Record<string, unknown> = {
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.description !== undefined) updatePayload.description = body.description;
    if (body.semester !== undefined) updatePayload.semester = body.semester;
    if (body.classId !== undefined) updatePayload.class_id = body.classId;
    if (body.term !== undefined) updatePayload.term = body.term;
    if (body.academicYear !== undefined) updatePayload.academic_year = body.academicYear;
    if (body.isActive !== undefined) updatePayload.is_active = body.isActive;

    let { data: structure, error: structureError } = await supabase
      .from("fee_structures")
      .update(updatePayload)
      .eq("id", id)
      .eq("college_id", institution.institutionId)
      .select("id,slot_id,semester,class_id,term,name,academic_year,is_active,created_at,updated_at")
      .single();

    if (structureError && isMissingSemesterColumn(structureError.message)) {
      return apiError("Semester field is missing in DB. Run latest migration to enable semester-wise fee structures.", 400);
    }

    if (structureError && isMissingDescriptionColumn(structureError.message) && "description" in updatePayload) {
      const fallbackPayload = { ...updatePayload };
      delete fallbackPayload.description;
      const fallback = await supabase
        .from("fee_structures")
        .update(fallbackPayload)
        .eq("id", id)
        .eq("college_id", institution.institutionId)
        .select("id,slot_id,semester,class_id,term,name,academic_year,is_active,created_at,updated_at")
        .single();
      structure = fallback.data;
      structureError = fallback.error;
    }

    if (structureError && (isMissingClassIdColumn(structureError.message) || isMissingTermColumn(structureError.message))) {
      return apiError("School class/term fields are missing in DB. Run latest migration.", 400);
    }

    if (structureError || !structure) return apiError(structureError?.message ?? "Unable to update fee structure", 500);

    if (body.components) {
      const { error: removeError } = await supabase
        .from("fee_components")
        .delete()
        .eq("fee_structure_id", id)
        .eq("college_id", institution.institutionId);
      if (removeError) return apiError(removeError.message, 500);

      const payload = body.components.map((component, index) => ({
        fee_structure_id: id,
        college_id: institution.institutionId,
        component_key: component.componentKey ? toKey(component.componentKey) : toKey(component.componentName),
        component_name: component.componentName,
        default_amount: component.amount,
        sort_order: component.sortOrder ?? index,
      }));

      const { error: insertError } = await supabase.from("fee_components").insert(payload);
      if (insertError) return apiError(insertError.message, 500);
    }

    const { data: components, error: componentsError } = await supabase
      .from("fee_components")
      .select("id,component_key,component_name,default_amount,sort_order")
      .eq("fee_structure_id", id)
      .order("sort_order", { ascending: true });

    if (componentsError) return apiError(componentsError.message, 500);

    return apiSuccess({
      id: structure.id,
      slotId: structure.slot_id,
      semester: structure.semester,
      classId: structure.class_id,
      term: structure.term,
      name: structure.name,
      academicYear: structure.academic_year,
      isActive: structure.is_active,
      createdAt: structure.created_at,
      updatedAt: structure.updated_at,
      components: (components ?? []).map((row) => ({
        id: row.id,
        componentKey: row.component_key,
        componentName: row.component_name,
        amount: Number(row.default_amount ?? 0),
        sortOrder: Number(row.sort_order ?? 0),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update fee structure", 500, String(error));
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institution = await getInstitutionContext(ctx);

    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("fee_structures")
      .delete()
      .eq("id", id)
      .eq("college_id", institution.institutionId);

    if (error) return apiError(error.message, 500);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return apiError("Unable to delete fee structure", 500, String(error));
  }
}
