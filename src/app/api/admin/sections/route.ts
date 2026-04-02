import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sectionCreateSchema } from "@/lib/validators/institution";

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId") ?? searchParams.get("class_id");

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("sections")
      .select("id,class_id,name,total_seats,filled_seats,assigned_teacher_id,room_id,academic_year,metadata,created_at")
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false });

    if (classId) query = query.eq("class_id", classId);

    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    return apiSuccess(
      (data ?? []).map((row) => ({
        id: row.id,
        classId: row.class_id,
        name: row.name,
        totalSeats: row.total_seats,
        filledSeats: row.filled_seats,
        availableSeats: Math.max((row.total_seats ?? 0) - (row.filled_seats ?? 0), 0),
        assignedTeacherId: row.assigned_teacher_id,
        roomId: row.room_id,
        academicYear: row.academic_year,
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
      })),
    );
  } catch (error) {
    return apiError("Unable to load sections", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!institutionId) return apiError("Missing institution context", 400);

    const body = sectionCreateSchema.parse(await request.json());

    const supabase = getSupabaseAdmin();
    const { data: classRow, error: classError } = await supabase
      .from("classes")
      .select("id")
      .eq("id", body.classId)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (classError) return apiError(classError.message, 500);
    if (!classRow) return apiError("Class not found for this institution", 404);

    const normalizedName = body.name.trim();
    const { data: existing, error: existingError } = await supabase
      .from("sections")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("class_id", body.classId)
      .ilike("name", normalizedName)
      .maybeSingle();

    if (existingError) return apiError(existingError.message, 500);
    if (existing) return apiError("Section already exists for this class", 400);

    const { data, error } = await supabase
      .from("sections")
      .insert({
        institution_id: institutionId,
        class_id: body.classId,
        name: normalizedName,
        total_seats: body.totalSeats,
        assigned_teacher_id: body.assignedTeacherId ?? null,
        room_id: body.roomId ?? null,
        academic_year: body.academicYear ?? null,
        metadata: body.metadata ?? {},
      })
      .select("id,class_id,name,total_seats,filled_seats,assigned_teacher_id,room_id,academic_year,metadata,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess(
      {
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
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create section", 500, String(error));
  }
}
