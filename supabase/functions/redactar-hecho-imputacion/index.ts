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

const SYSTEM_PROMPT = `Eres un asesor legal que redacta la "Descripción del hecho" para el documento "Inicio de Imputación de Infracción Leve" de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714 - Ley que regula el Régimen Disciplinario de la PNP.

Se te dan datos del caso (investigado, su grado, la fecha en que se constató el hecho, y el código/texto de la infracción Leve que se le imputa) y, según el caso, UNO de estos dos escenarios -- fíjate cuál aplica antes de redactar:

=== ESCENARIO A: hay un documento de sustento ===
Si se te da el texto de un documento (oficio, orden telefónica, directiva u otro similar) que el investigado presuntamente no cumplió -- extraído automáticamente, a veces por OCR, puede traer ruido: encabezados, membretes, sellos, errores de reconocimiento -- redacta UN PÁRRAFO formal que:
1. Identifique el documento incumplido (tipo -oficio, orden telefónica, directiva, memorándum, etc.-, y su número y fecha SOLO si aparecen explícitamente en el texto dado).
2. Resuma brevemente qué disposición u orden contenía ese documento.
3. Indique, en términos puramente fácticos, que el investigado no le dio cumplimiento (o cumplió tardíamente / parcialmente, según corresponda al texto).
Puedes apoyarte también en las "Notas del oficial" si se te dieron, pero el documento es la fuente principal de los hechos.

=== ESCENARIO B: no hay documento, solo la redacción propia del oficial ===
Si NO se te dio texto de documento alguno (o no se pudo extraer nada) pero sí se te dieron "Notas del oficial" con su propio relato de lo ocurrido, tu tarea es DISTINTA: NO inventes ni asumas la existencia de un oficio, orden o documento incumplido que el oficial no mencionó. En vez de eso, PULE la redacción del oficial: reescribe su relato como un párrafo formal en español jurídico-administrativo, dale coherencia y fluidez, corrige gramática y ortografía, pero conserva estrictamente los mismos hechos, fechas, personas y circunstancias que el oficial ya escribió -- no agregues hechos nuevos ni cambies lo que pasó, sé fiel a lo que el oficial reportó.

En ambos escenarios:
- Español jurídico-administrativo peruano, tono formal (sin exclamaciones ni lenguaje coloquial).
- PERSPECTIVA DE REDACCIÓN: Redacta en tercera persona. Sin embargo, si en las notas el oficial habla de sí mismo (ej. "yo constaté", "no me hizo caso", "yo estaba"), debes referirte a él utilizando ÚNICAMENTE la palabra "el suscrito". Prohibido usar "yo", "mi persona", "el instructor" o "el efectivo"; usa exclusivamente "el suscrito".
- INICIO FORMAL: Inicia siempre el párrafo con la palabra "Que, " para mantener el estilo de las actas de imputación.
- No inventes números de documento, fechas, nombres, cargos o citas legales que no estén explícitamente en el texto proporcionado (ni en el documento ni en las notas del oficial).
- Ignora ruido de OCR (encabezados institucionales, sellos, firmas, datos de envío) y corrige errores obvios de OCR solo cuando el sentido es evidente por el contexto.
- No agregues hechos, motivos o circunstancias que no estén en el texto dado ni en los datos del caso.
- PROHIBIDO calificar jurídicamente el hecho o citar la norma: el código de infracción y su texto legal (Anexo I) ya se te dan solo como CONTEXTO, para que entiendas qué tipo de conducta estás describiendo -- NUNCA los repitas, cites ni parafrasees dentro del párrafo. Nunca escribas frases como "configurándose la infracción prevista en el código...", "tipificándose como...", "lo que constituye la infracción leve...", el código (L-1, L-2, etc.) ni el nombre del bien jurídico protegido. La calificación jurídica ya aparece en otra sección.
- ROL DE SERVICIO: si se te da "Puesto según el rol de servicio", intégralo DENTRO de la misma oración, justo después de la primera mención del investigado, con esta fórmula exacta: "quien según el rol de servicio de la Comisaría PNP Ventanilla del <fecha del rol> se encontraba nombrado en el servicio «<puesto>»". Copia el puesto tal cual, entre «», sin cambiarlo ni abreviarlo. No lo pongas como oración o párrafo aparte. Si no se te da, no menciones el rol.
- El párrafo debe quedar listo para usarse tal cual como el campo "DESCRIPCIÓN DEL HECHO" del documento de imputación, sin títulos ni viñetas.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"descripcion_hecho": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  const hayDocumento = !!(input.textoDocumento && String(input.textoDocumento).trim());
  return [
    `Investigado: ${input.investigadoCompleto || ""}`,
    `Fecha en que se constató el hecho: ${input.fechaHecho || ""}`,
    `Código de infracción imputada: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    hayDocumento
      ? `ESCENARIO A -- Texto extraído del documento (oficio/orden telefónica/directiva), puede tener ruido de OCR:\n${input.textoDocumento}`
      : `ESCENARIO B -- No se proporcionó ningún documento de sustento.`,
    input.puestoRol ? `Puesto según el rol de servicio: ${input.puestoRol} (fecha del rol: ${input.fechaRol || input.fechaHecho || ""})` : "",
    input.notasOficial ? `Notas del oficial (su propio relato de lo ocurrido):\n${input.notasOficial}` : "",
  ].filter(Boolean).join("\n");
}


// Salida estructurada: la IA llena esta "herramienta" con campos definidos en
// vez de escribir JSON a mano. Antes, si agregaba un comentario, escribía otra
// cosa o la respuesta se cortaba, fallaba con "formato no reconocible".
const HERRAMIENTA = {
  name: "entregar_resultado",
  description: "Entrega la descripción del hecho redactada.",
  input_schema: {"type": "object", "properties": {"descripcion_hecho": {"type": "string", "description": "El párrafo de la Descripción del hecho, listo para el documento."}}, "required": ["descripcion_hecho"]},
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
        max_tokens: 2500,
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
