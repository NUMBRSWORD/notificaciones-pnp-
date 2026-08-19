import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
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
- Español jurídico-administrativo peruano, en tercera persona, tono formal (sin exclamaciones ni lenguaje coloquial).
- No inventes números de documento, fechas, nombres, cargos o citas legales que no estén explícitamente en el texto proporcionado (ni en el documento ni en las notas del oficial).
- Ignora ruido de OCR (encabezados institucionales, sellos, firmas, datos de envío) y corrige errores obvios de OCR solo cuando el sentido es evidente por el contexto.
- No agregues hechos, motivos o circunstancias que no estén en el texto dado ni en los datos del caso.
- PROHIBIDO calificar jurídicamente el hecho o citar la norma: el código de infracción y su texto legal (Anexo I) ya se te dan solo como CONTEXTO, para que entiendas qué tipo de conducta estás describiendo -- NUNCA los repitas, cites ni parafrasees dentro del párrafo. Nunca escribas frases como "configurándose la infracción prevista en el código...", "tipificándose como...", "lo que constituye la infracción leve...", el código (L-1, L-2, etc.) ni el nombre del bien jurídico protegido. Esa calificación jurídica ya aparece en una sección aparte del documento (el campo "Código de infracción"); repetirla en la descripción del hecho es redundante. El párrafo debe limitarse a narrar el hecho: qué ocurrió, cuándo, dónde y cómo se comprobó -- nada más.
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
    input.notasOficial ? `Notas del oficial (su propio relato de lo ocurrido):\n${input.notasOficial}` : "",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
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
    const text = (data.content || []).map((b: { text?: string }) => b.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return new Response(JSON.stringify({ error: "La IA no devolvió un formato reconocible. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const parsed = JSON.parse(match[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
