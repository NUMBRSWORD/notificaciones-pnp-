import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// La anon key es pública (está en config.js) y pasa la verificación de JWT de
// Supabase, así que por sí sola no prueba nada: sin esta comprobación
// cualquiera podía usar la IA a costa de la cuenta. Se exige un usuario real
// con sesión iniciada (con la anon key, /auth/v1/user responde error).
async function sesionAutenticada(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: SUPABASE_ANON_KEY } });
    return respuesta.ok;
  } catch (_) {
    return false;
  }
}
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Eres un asistente que redacta un resumen ejecutivo breve para un oficial de la Policía Nacional del Perú (PNP) sobre el estado de sus casos disciplinarios (infracciones Leves, Ley N° 30714).

Se te da la fecha de hoy y una lista de casos con su estado actual (investigado, código de infracción, fecha del hecho, si ya fue notificada la Imputación, si el plazo de descargo (1 día hábil) ya venció o sigue en curso, si se recibió descargo, si se generó Acta de No Descargo, si se generó Orden de Sanción, y si esa orden ya fue notificada).

Redacta un resumen ejecutivo en español, en prosa clara (puedes usar un par de párrafos cortos y, si ayuda a la claridad, una lista breve al final con los casos que requieren acción urgente), que incluya:
1. Un panorama general: cuántos casos hay en total y en qué etapa se encuentra cada uno (agrupa por etapa: pendiente de notificar, plazo de descargo en curso, plazo vencido sin Acta, listo para Orden de Sanción, Orden generada pero no notificada, trámite completo).
2. Alertas priorizadas: casos cuyo plazo de descargo está vencido y todavía no tienen Acta de No Descargo ni Orden de Sanción (son los que requieren acción más urgente), y casos con Orden de Sanción generada pero aún no notificada.
3. Un cierre breve si todo está al día.

Cada investigado viene identificado con un alias (E01, E02…): menciónalo exactamente con ese alias, sin inventar nombres. No inventes datos que no estén en la lista dada. Sé conciso y útil, como si fuera el resumen que un asistente personal le entrega cada mañana.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"resumen": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Fecha de hoy: ${input.fechaHoy || ""}`,
    `Lista de casos (JSON):\n${JSON.stringify(input.casos || [])}`,
  ].filter(Boolean).join("\n\n");
}


// Salida estructurada: la IA llena esta "herramienta" con campos definidos en
// vez de escribir JSON a mano. Antes, si agregaba un comentario, escribía otra
// cosa o la respuesta se cortaba, fallaba con "formato no reconocible".
const HERRAMIENTA = {
  name: "entregar_resultado",
  description: "Entrega el resumen ejecutivo.",
  input_schema: {"type": "object", "properties": {"resumen": {"type": "string"}}, "required": ["resumen"]},
};

// Lee lo que entregó la IA. Si por algo no usó la herramienta, se intenta el
// JSON escrito como texto (formato anterior).
function leerSalidaIA(data: { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }>; stop_reason?: string }): { salida: Record<string, unknown> | null; error: string } {
  const bloques = data?.content || [];
  const uso = bloques.find((b) => b?.type === "tool_use" && b?.name === HERRAMIENTA.name);
  if (uso?.input && typeof uso.input === "object") return { salida: uso.input as Record<string, unknown>, error: "" };
  const texto = bloques.filter((b) => b?.type === "text").map((b) => b.text || "").join("");
  const m = texto.match(/\{[\s\S]*\}/);
  if (m) { try { return { salida: JSON.parse(m[0]), error: "" }; } catch (_) { /* sigue abajo */ } }
  return {
    salida: null,
    error: data?.stop_reason === "max_tokens"
      ? "La respuesta de la IA se cortó por ser muy extensa. Intente de nuevo o con menos texto."
      : "La IA no devolvió el resultado esperado. Intente de nuevo.",
  };
}

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await sesionAutenticada(req))) {
    return new Response(JSON.stringify({ error: "Debe iniciar sesión." }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const input = await req.json();

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: [HERRAMIENTA],
        tool_choice: { type: "tool", name: HERRAMIENTA.name },
        messages: [{ role: "user", content: buildUserMessage(input) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `Error de la API de IA: ${errText}` }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const { salida, error: errorSalida } = leerSalidaIA(data);
    if (!salida) {
      return new Response(JSON.stringify({ error: errorSalida }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(salida), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
