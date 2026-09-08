import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_OAUTH_CLIENT_ID") || "";
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/google-drive-callback`;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const cors = {
  "Access-Control-Allow-Origin": "https://numbrsword.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization) throw new Error("Debe iniciar sesión.");
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) throw new Error("Sesión no válida.");
  const { data: perfil, error: perfilError } = await userClient
    .from("perfiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (perfilError || perfil?.role !== "admin") throw new Error("Solo el administrador puede conectar Drive.");
  return auth.user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID) {
    return json({ error: "Falta configurar la conexión segura con Google Drive." }, 503);
  }
  try {
    const user = await requireAdmin(req);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const estado = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const expira_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await admin.from("google_drive_oauth_estados").insert({ estado, user_id: user.id, expira_at });
    if (error) throw error;
    const parametros = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: estado,
    });
    return json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${parametros}` });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo iniciar la conexión con Drive." }, 403);
  }
});
