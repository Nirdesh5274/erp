import { apiError } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) return apiError("Unauthorized", 401);

    const { data, error } = await supabase
      .from("refresh_tokens")
      .select("id, created_at, last_used_at, expires_at, revoked, ip_address, user_agent")
      .eq("user_id", userId)
      .eq("revoked", false)
      .order("created_at", { ascending: false });

    if (error) return apiError("Failed to load sessions", 500, error.message);
    return Response.json({ ok: true, data });
  } catch (error) {
    return apiError("Failed to load sessions", 500, String(error));
  }
}
