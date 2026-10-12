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

// Mismo criterio que la lectura del rol en moral-y-disciplina
// (extraer-nota-informativa, tipo "rol_servicio"). La versión anterior era una
// sola línea genérica: la IA no sabía cómo es el rol de Ventanilla, confundía
// filas, tomaba puestos de otra persona y no distinguía la sección NOVEDADES.
const SYSTEM = `Eres un asistente que lee el ROL DE SERVICIO DIARIO de la Comisaría PNP Ventanilla (REGPOL Callao). Es una tabla larga con columnas: N° | GRADO | PNP | "APELLIDOS Nombres" | PUESTO O SERVICIO ASIGNADO | (a veces) SECTOR o DETALLE. Tiene encabezados de sección que agrupan al personal (servicio 24x24, patrullaje motorizado con placa y CONDUCTOR/OPERADOR, administrativo, secciones FAMILIA/INVESTIGACIÓN, apoyo DIROES) y al final una sección de NOVEDADES con subgrupos: "PERSONAL PNP FALTOS AL SERVICIO", "PERSONAL PNP CON DESCANSO MEDICO", "OTROS" (FRANCO, PERMISO A CUENTA DE VACACIONES, LICENCIAS, VACACIONES, SUSPENSIÓN TEMPORAL DEL SERVICIO, PERMISO POR ONOMÁSTICO, etc.). El texto viene de un PDF y puede tener ruido de OCR.

EN EL ENCABEZADO el rol indica el periodo que cubre, por ejemplo "DEL 10SET26 AL 11SET26 (07:00 A 07:00 HRS.)" (servicio de 24 horas que ARRANCA el 10). Extrae ese periodo.

Se te da el nombre de un efectivo (apellidos y nombres, puede venir sin coma) y la fecha del hecho. Busca a esa persona por sus APELLIDOS (tolera OCR y tildes); si hay dos personas con los mismos apellidos, usa los nombres para elegir. El puesto debe salir de la MISMA FILA de esa persona, nunca de la fila de al lado. Devuelve SOLO este JSON:

- "fecha_rol_inicio": fecha de inicio del periodo del rol en "YYYY-MM-DD" (de "DEL 10SET26..." => "2026-09-10"). null si no aparece.
- "fecha_rol_fin": fecha de fin del periodo en "YYYY-MM-DD". null si no aparece o es el mismo día.
- "encontrado": true si ubicaste a la persona en este rol, false si no.
- "puesto": frase corta EN MAYÚSCULAS con el servicio/puesto asignado tal como figura en su fila, uniendo puesto + sector/detalle si lo hay (ej. "OFICIAL DE PATRULLAJE SECTOR: 3 Y 5", "PATRULLAJE MOTORIZADO PAT. TMP-3096 - CONDUCTOR", "SECCION DE FAMILIA", "PERSONAL DE APOYO DIROES PNP"). null si la persona está en NOVEDADES sin puesto de servicio, o no se encontró.
- "situacion": según la sección bajo la que aparece: "servicio" | "falto" | "descanso_medico" | "vacaciones" | "permiso" | "franco" | "suspension" | "otro". null si no se encontró.
- "detalle_novedad": si la situación NO es "servicio", copia el texto de la novedad tal como figura (ej. "CINCO (05) DIAS DEL 08SET2026 AL 13SET2026 VACACIONES PERSONAL DIROES"). null en otro caso.

IMPORTANTE: este rol vale SOLO para el periodo de su encabezado. NO deduzcas la situación de la persona para otra fecha distinta. Reporta lo que dice ESTE rol; el cliente comparará las fechas.

No inventes. Si la persona no aparece, {"encontrado": false, "puesto": null, "situacion": null, "detalle_novedad": null} (igual con fecha_rol_inicio/fin si se leen).

Responde ÚNICAMENTE con ese objeto JSON, sin texto antes ni después.`;

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
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content: `Fecha del hecho: ${fecha}\nEfectivo a ubicar: ${persona}\n\nTEXTO DEL ROL DE SERVICIO:\n${String(texto).slice(0, 120000)}` }] }),
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