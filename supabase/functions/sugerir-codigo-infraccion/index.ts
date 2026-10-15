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

const SYSTEM_PROMPT = `Eres un asesor legal que ayuda a un oficial de la Policía Nacional del Perú (PNP) a clasificar una infracción disciplinaria Leve, conforme al Anexo I de la Ley N° 30714 - Ley que regula el Régimen Disciplinario de la PNP.

Se te da la descripción libre de un hecho constatado (escrita por el oficial, puede estar incompleta o ser un borrador) y el catálogo completo de infracciones Leves del Anexo I (117 códigos, cada uno con su "codigo", "bienJuridico", "infraccion" y "sancion").

Debes identificar cuál de esos códigos describe MEJOR el hecho narrado.

Reglas estrictas:
- El "codigo_sugerido" debe ser EXACTAMENTE uno de los códigos del catálogo dado (por ejemplo "L21"), copiado tal cual, sin inventar códigos que no estén en la lista.
- Si el hecho descrito podría encajar razonablemente en más de un código, incluye hasta 2 alternativas adicionales en "alternativas" (también códigos exactos del catálogo), ordenadas de más a menos probable.
- Si el hecho descrito es demasiado vago o no corresponde claramente a ninguna infracción Leve del catálogo, responde con "codigo_sugerido": null y explica por qué en "justificacion".
- "justificacion" debe ser un texto breve (2-4 líneas) en español formal, explicando por qué ese código encaja con el hecho narrado, citando qué elementos del relato coinciden con el texto de la infracción.
- No inventes hechos que no estén en la descripción dada.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"codigo_sugerido": "L21" | null, "alternativas": ["L22"], "justificacion": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Descripción libre del hecho constatado (escrita por el oficial):\n${input.descripcionHecho || "(vacío)"}`,
    `Catálogo de infracciones Leves del Anexo I (elige el "codigo" de una de estas, exactamente):\n${JSON.stringify(input.catalogo || [])}`,
  ].filter(Boolean).join("\n\n");
}


// Salida estructurada: la IA llena esta "herramienta" con campos definidos en
// vez de escribir JSON a mano. Antes, si agregaba un comentario, escribía otra
// cosa o la respuesta se cortaba, fallaba con "formato no reconocible".
const HERRAMIENTA = {
  name: "entregar_resultado",
  description: "Entrega el código sugerido del Anexo I, alternativas y la justificación.",
  input_schema: {"type": "object", "properties": {"codigo_sugerido": {"type": ["string", "null"]}, "alternativas": {"type": "array", "items": {"type": "string"}}, "justificacion": {"type": "string"}}, "required": ["codigo_sugerido", "alternativas", "justificacion"]},
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
        max_tokens: 1500,
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
