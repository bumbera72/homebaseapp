/// <reference lib="deno.ns" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// supabase/functions/delete-account/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-homebase-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SupabaseAdminClient = ReturnType<typeof createClient>;

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
};

async function findUserIdByEmail(
  supabaseAdmin: SupabaseAdminClient,
  email: string
) {
  let page = 1;
  const perPage = 200;

  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    const users = data?.users ?? [];
    const match = (users as SupabaseAuthUser[]).find(
      (u: SupabaseAuthUser) => (u.email || "").toLowerCase() === email.toLowerCase()
    );

    if (match?.id) return match.id;
    if (users.length < perPage) break;

    page += 1;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const secret = Deno.env.get("HOMEBASE_DELETE_SECRET");
    if (!secret) {
      return json(500, { error: "Missing server secret" });
    }

    const providedSecret = req.headers.get("x-homebase-secret");
    if (!providedSecret || providedSecret !== secret) {
      return json(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("HOMEBASE_SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("HOMEBASE_SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Missing server environment variables" });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim();

    if (!email || !email.includes("@")) {
      return json(400, { error: "Valid email is required" });
    }

    const userId = await findUserIdByEmail(supabaseAdmin, email);

    // Do not leak whether user exists
    if (!userId) {
      return json(200, { ok: true, message: "Deletion request received" });
    }

    // Delete user-owned rows in your tables. Different tables may use different column names.
    // We'll try common patterns and skip tables/columns that don't exist.
    const tablesToDeleteFrom = [
      "profiles",
      "tasks",
      "brain_dump_items",
      "shopping_list_items",
      "recipes",
      "schedule_items",
    ];

    async function deleteByAnyUserColumn(table: string, uid: string) {
      // Try these column names in order.
      // `profiles` often uses `id` as the user's id.
      const candidateColumns = table === "profiles" ? ["id", "user_id"] : ["user_id", "id"];

      for (const col of candidateColumns) {
        const { error } = await supabaseAdmin.from(table).delete().eq(col, uid);

        if (!error) return;

        // Postgres error codes:
        // 42P01 = undefined_table
        // 42703 = undefined_column
        const code = (error as any)?.code;

        if (code === "42P01" || code === "PGRST205") {
          // Table doesn't exist in this project (or isn't in PostgREST schema cache); skip.
          return;
        }

        // Some PostgREST errors don't expose a Postgres code; treat these as missing-table too.
        const msg = (error as any)?.message as string | undefined;
        if (msg && msg.includes("schema cache") && msg.includes("Could not find the table")) {
          return;
        }

        if (code === "42703") {
          // Column doesn't exist; try the next candidate column.
          continue;
        }

        // Any other error should surface (RLS, permissions, etc.)
        throw error;
      }

      // If none of the candidate columns exist, just skip silently.
      return;
    }

    for (const table of tablesToDeleteFrom) {
      await deleteByAnyUserColumn(table, userId);
    }

    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) throw deleteError;

    return json(200, { ok: true, message: "Account deleted" });
  } catch (err) {
    // Log the full error for Supabase function logs
    console.error("delete-account error:", err);

    // Produce a readable message for debugging
    const message =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === "string"
        ? err
        : JSON.stringify(err);

    return json(500, { error: message });
  }
});