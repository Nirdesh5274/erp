import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  departmentId: z.string().uuid(),
  course: z.string().min(2),
  totalSeats: z.number().int().nonnegative(),
});

interface SlotDbRow {
  id: string;
  course: string;
  total_seats: number;
  filled_seats: number;
  department_id: string;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);
    if ((ctx.role === "HOD" || ctx.role === "Faculty") && !ctx.departmentId) {
      return apiError("Department context missing", 400);
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("slots")
      .select("id,course,total_seats,filled_seats,department_id,created_at")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if ((ctx.role === "HOD" || ctx.role === "Faculty") && ctx.departmentId) {
      query = query.eq("department_id", ctx.departmentId);
    }

    const { data, error } = await query;

    if (error) return apiError(error.message, 500);

    const slots = ((data ?? []) as SlotDbRow[]).map((slot) => ({
      id: slot.id,
      course: slot.course,
      totalSeats: slot.total_seats,
      filledSeats: slot.filled_seats,
      availableSeats: Math.max(slot.total_seats - slot.filled_seats, 0),
      departmentId: slot.department_id,
      createdAt: slot.created_at,
    }));

    return apiSuccess(slots);
  } catch (error) {
    return apiError("Unable to load slots", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("slots")
      .insert({
        college_id: ctx.collegeId,
        department_id: body.departmentId,
        course: body.course,
        total_seats: body.totalSeats,
      })
      .select("id,course,total_seats,filled_seats,department_id,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess(
      {
        id: data.id,
        course: data.course,
        totalSeats: data.total_seats,
        filledSeats: data.filled_seats,
        availableSeats: Math.max(data.total_seats - data.filled_seats, 0),
        departmentId: data.department_id,
        createdAt: data.created_at,
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create slot", 500, String(error));
  }
}
