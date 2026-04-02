import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  classId: z.string().uuid().optional(),
  name: z.string().min(1).max(50).optional(),
  totalSeats: z.number().int().positive().max(500).optional(),
  assignedTeacherId: z.string().uuid().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
  academicYear: z.string().max(20).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);

    const body = schema.parse(await request.json());
    const updatePayload: Record<string, unknown> = {};

    if (body.classId !== undefined) updatePayload.class_id = body.classId;
    if (body.name !== undefined) {
      const normalizedName = body.name.trim();
      if (!normalizedName) return apiError("Section name is required", 400);
      updatePayload.name = normalizedName;
    }
    if (body.totalSeats !== undefined) updatePayload.total_seats = body.totalSeats;
    if (body.assignedTeacherId !== undefined) updatePayload.assigned_teacher_id = body.assignedTeacherId;
    if (body.roomId !== undefined) updatePayload.room_id = body.roomId;
    if (body.academicYear !== undefined) updatePayload.academic_year = body.academicYear;
    if (body.metadata !== undefined) updatePayload.metadata = body.metadata;

    if (Object.keys(updatePayload).length === 0) {
      return apiError("No fields provided for update", 400);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("sections")
      .update(updatePayload)
      .eq("id", id)
      .eq("institution_id", institutionId)
      .select("id,class_id,name,total_seats,filled_seats,assigned_teacher_id,room_id,academic_year,metadata,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess({
      id: data.id,
      classId: data.class_id,
      name: data.name,
      totalSeats: data.total_seats,
      filledSeats: data.filled_seats,
      availableSeats: Math.max((data.total_seats ?? 0) - (data.filled_seats ?? 0), 0),
      assignedTeacherId: data.assigned_teacher_id,
      roomId: data.room_id,
      academicYear: data.academic_year,
      metadata: data.metadata ?? {},
      createdAt: data.created_at,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update section", 500, String(error));
  }
}
