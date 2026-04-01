import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const postSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1),
  message: z.string().min(1),
  link: z.string().url().optional(),
  channels: z.array(z.enum(["in-app", "email", "push"])).default(["in-app"]),
  metadata: z.record(z.string(), z.any()).optional(),
});

const patchSchema = z.object({
  notificationId: z.string().uuid(),
  read: z.boolean().default(true),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ctx.userId || !ctx.collegeId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("notifications")
      .select("id,title,message,link,read,metadata,created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return apiError(error.message, 500);
    return apiSuccess({ notifications: data ?? [] });
  } catch (error) {
    return apiError("Unable to load notifications", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty", "Student", "SuperAdmin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from("notifications").insert({
      user_id: body.userId,
      title: body.title,
      message: body.message,
      link: body.link ?? null,
      metadata: {
        ...body.metadata,
        channels: body.channels,
        emailStatus: body.channels.includes("email") ? "queued" : "skipped",
        pushStatus: body.channels.includes("push") ? "queued" : "skipped",
      },
    });

    if (error) return apiError(error.message, 500);
    return apiSuccess({ queued: true }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to queue notification", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ctx.userId || !ctx.collegeId) return apiError("Missing user context", 400);
    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("notifications")
      .update({ read: body.read })
      .eq("id", body.notificationId)
      .eq("user_id", ctx.userId);

    if (error) return apiError(error.message, 500);
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update notification", 500, String(error));
  }
}
