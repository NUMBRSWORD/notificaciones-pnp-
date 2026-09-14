import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const MODEL = "claude-sonnet-5";
const ORIGENES = new Set(["https://numbrsword.github.io", "http://127.0.0.1:4174", "http://localhost:4174"]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.has(origin) ? origin : "https://numbrsword.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

async function sesionAutenticada(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: SUPABASE_ANON_KEY } });
  return respuesta.ok;
}

const SYSTEM = `Lee un rol de servicio de la PNP y ubica a la persona indicada. No inventes datos. Responde SOLO JSON válido con estas claves exactas: {"encontrado":boolean,"puesto":string|null,"fecha_rol_inicio":"YYYY-MM-DD"|null,"fecha_rol_fin":"YYYY-MM-DD"|null,"situacion":"normal"|"falto"|"descanso_medico"|"vacaciones"|"permiso"|"franco"|"suspension"|null,"detalle_novedad":string|null}. El puesto debe ser breve y conservar la denominación que aparece en el rol. Si la persona no aparece, encontrado es false y puesto es null.`;

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (!await sesionAutenticada(req)) return new Response(JSON.stringify({ error: "Sesión no autorizada." }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  try {
    const { texto, persona, fecha } = await req.json();
    if (!texto || !persona || !fecha) return new Response(JSON.stringify({ error: "Faltan texto del rol, persona o fecha." }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system: SYSTEM, messages: [{ role: "user", content: `Fecha que se busca: ${fecha}\nPersona: ${persona}\n\nROL DE SERVICIO:\n${String(texto).slice(0, 120000)}` }] }),
    });
    if (!respuesta.ok) return new Response(JSON.stringify({ error: "La IA no pudo procesar el rol." }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
    const data = await respuesta.json();
    const salida = (data.content || []).map((b: { text?: string }) => b.text || "").join("");
    const match = salida.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("La IA no devolvió un formato reconocible.");
    return new Response(JSON.stringify(JSON.parse(match[0])), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});