import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcStudentFeeTotals } from "@/lib/feeManagement";

const componentSchema = z.object({
  componentKey: z.string().min(1).optional(),
  componentName: z.string().min(1),
  amount: z.number().nonnegative(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const postSchema = z.object({
  slotId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().trim().max(400).optional(),
  academicYear: z.string().min(1),
  isActive: z.boolean().optional(),
  components: z.array(componentSchema).min(1),
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

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    let { data: structures, error: structuresError } = await supabase
      .from("fee_structures")
      .select("id,college_id,slot_id,name,description,academic_year,is_active,created_at,updated_at")
      .eq("college_id", ctx.collegeId)
      .order("updated_at", { ascending: false });

    if (structuresError && isMissingDescriptionColumn(structuresError.message)) {
      const fallback = await supabase
        .from("fee_structures")
        .select("id,college_id,slot_id,name,academic_year,is_active,created_at,updated_at")
        .eq("college_id", ctx.collegeId)
        .order("updated_at", { ascending: false });
      structures = (fallback.data ?? []).map((row) => ({ ...row, description: null }));
      structuresError = fallback.error;
    }

    if (structuresError) return apiError(structuresError.message, 500);

    const ids = (structures ?? []).map((row) => row.id as string);
    const componentByStructure = new Map<string, Array<{ id: string; componentKey: string; componentName: string; amount: number; sortOrder: number }>>();

    if (ids.length > 0) {
      const { data: components, error: componentsError } = await supabase
        .from("fee_components")
        .select("id,fee_structure_id,component_key,component_name,default_amount,sort_order")
        .in("fee_structure_id", ids)
        .order("sort_order", { ascending: true });

      if (componentsError) return apiError(componentsError.message, 500);

      for (const row of components ?? []) {
        const structureId = row.fee_structure_id as string;
        const list = componentByStructure.get(structureId) ?? [];
        list.push({
          id: row.id as string,
          componentKey: row.component_key as string,
          componentName: row.component_name as string,
          amount: Number(row.default_amount ?? 0),
          sortOrder: Number(row.sort_order ?? 0),
        });
        componentByStructure.set(structureId, list);
      }
    }

    return apiSuccess(
      (structures ?? []).map((row) => ({
        id: row.id,
        slotId: row.slot_id,
        name: row.name,
        description: row.description,
        academicYear: row.academic_year,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        components: componentByStructure.get(row.id as string) ?? [],
      })),
    );
  } catch (error) {
    return apiError("Unable to load fee structures", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const basePayload = {
      college_id: ctx.collegeId,
      slot_id: body.slotId,
      name: body.name,
      academic_year: body.academicYear,
      is_active: body.isActive ?? true,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    };

    let { data: structure, error: structureError } = await supabase
      .from("fee_structures")
      .insert({
        ...basePayload,
        description: body.description ?? null,
      })
      .select("id,slot_id,name,description,academic_year,is_active,created_at,updated_at")
      .single();

    if (structureError && isMissingDescriptionColumn(structureError.message)) {
      const fallback = await supabase
        .from("fee_structures")
        .insert(basePayload)
        .select("id,slot_id,name,academic_year,is_active,created_at,updated_at")
        .single();
      structure = fallback.data ? { ...fallback.data, description: null } : null;
      structureError = fallback.error;
    }

    if (structureError || !structure) return apiError(structureError?.message ?? "Unable to create fee structure", 500);

    const componentPayload = body.components.map((component, index) => ({
      fee_structure_id: structure.id,
      college_id: ctx.collegeId,
      component_key: component.componentKey ? toKey(component.componentKey) : toKey(component.componentName),
      component_name: component.componentName,
      default_amount: component.amount,
      sort_order: component.sortOrder ?? index,
    }));

    const { data: components, error: componentsError } = await supabase
      .from("fee_components")
      .insert(componentPayload)
      .select("id,component_key,component_name,default_amount,sort_order");

    if (componentsError) return apiError(componentsError.message, 500);

    const { data: slotStudents, error: studentsError } = await supabase
      .from("students")
      .select("id,admission_id")
      .eq("college_id", ctx.collegeId)
      .eq("slot_id", body.slotId);

    if (studentsError) return apiError(studentsError.message, 500);

    const studentIds = (slotStudents ?? []).map((row) => row.id as string);
    if (studentIds.length > 0) {
      const { data: existingFees, error: existingFeesError } = await supabase
        .from("student_fees")
        .select("id,student_id")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", body.slotId)
        .eq("fee_structure_id", structure.id)
        .in("student_id", studentIds);

      if (existingFeesError) return apiError(existingFeesError.message, 500);

      const existingStudentIds = new Set((existingFees ?? []).map((row) => row.student_id as string));
      const missingStudents = (slotStudents ?? []).filter((student) => !existingStudentIds.has(student.id as string));

      if (missingStudents.length > 0) {
        const feeRowsPayload = missingStudents.map((student) => ({
          college_id: ctx.collegeId,
          student_id: student.id,
          admission_id: student.admission_id,
          slot_id: body.slotId,
          fee_structure_id: structure.id,
          notes: body.description ?? null,
        }));

        const { data: createdFees, error: createdFeesError } = await supabase
          .from("student_fees")
          .insert(feeRowsPayload)
          .select("id,student_id");

        if (createdFeesError) return apiError(createdFeesError.message, 500);

        const componentRows = (components ?? []).map((component) => ({
          id: component.id as string,
          component_name: component.component_name as string,
          default_amount: Number(component.default_amount ?? 0),
        }));

        const itemsPayload = (createdFees ?? []).flatMap((fee) =>
          componentRows.map((component) => ({
            student_fee_id: fee.id,
            college_id: ctx.collegeId,
            source_component_id: component.id,
            item_type: "component",
            label: component.component_name,
            amount: component.default_amount,
            quantity: 1,
            metadata: {
              source: "fee_structure",
              structureName: structure.name,
              structureDescription: structure.description,
            },
          })),
        );

        if (itemsPayload.length > 0) {
          const { error: itemsError } = await supabase.from("student_fee_items").insert(itemsPayload);
          if (itemsError) return apiError(itemsError.message, 500);
        }

        await Promise.all((createdFees ?? []).map((fee) => recalcStudentFeeTotals(supabase, fee.id as string)));
      }
    }

    return apiSuccess(
      {
        id: structure.id,
        slotId: structure.slot_id,
        name: structure.name,
        description: structure.description,
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
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create fee structure", 500, String(error));
  }
}
