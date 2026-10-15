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

// Reemplaza a tesseract.js (OCR genérico en el navegador) para leer PDFs
// escaneados e imágenes: en vez de un motor de OCR ciego, le mandamos las
// páginas como imágenes a un modelo con visión para que las transcriba. Es
// más lento por página que tesseract, pero muchísimo más preciso en
// documentos reales (sellos, membretes, tablas, escaneos de mala calidad) --
// y como corre en el servidor, además libera al navegador del oficial.
const SYSTEM_PROMPT = `Eres un transcriptor de documentos oficiales peruanos (normas, reglamentos, directivas, oficios). Se te dan una o más imágenes, cada una una página de un mismo documento, en orden.

Tu única tarea es transcribir EXACTAMENTE el texto visible en cada imagen, en el orden en que aparecen las páginas. Reglas estrictas:
- No resumas, no comentes, no traduzcas, no corrijas redacción ni ortografía del original.
- Preserva la estructura: numeración de artículos, incisos, párrafos, mayúsculas de títulos.
- Si una página tiene tablas, transcribe el contenido de cada celda en un orden legible (fila por fila), no inventes columnas que no existan.
- Ignora elementos puramente decorativos (logos, líneas divisorias) pero SÍ transcribe sellos, membretes y pies de página si tienen texto legible.
- Si una palabra o fragmento es completamente ilegible, márcalo como [ilegible] en vez de adivinar o inventar texto.
- No agregues encabezados, numeración de página propia, ni ningún texto que no esté literalmente en la imagen.

Responde ÚNICAMENTE con el texto transcrito de TODAS las páginas dadas, concatenado en orden y separado por un salto de línea doble entre páginas. Sin JSON, sin comillas envolventes, sin comentarios antes ni después.`;

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
    const paginas = Array.isArray(input.paginas) ? input.paginas : [];
    if (!paginas.length) {
      return new Response(JSON.stringify({ error: "No se recibió ninguna página para transcribir." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (paginas.length > 8) {
      return new Response(JSON.stringify({ error: "Máximo 8 páginas por solicitud." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const content = [
      ...paginas.map((p: { data?: string; mediaType?: string }) => ({
        type: "image",
        source: { type: "base64", media_type: p.mediaType || "image/jpeg", data: p.data || "" },
      })),
      { type: "text", text: `Transcribe estas ${paginas.length} página(s), en el orden dado.` },
    ];

    // Antes eran ~900 tokens por página: una página densa no cabía y, como
    // además se pedía JSON, la respuesta cortada quedaba inservible ("formato
    // no reconocible"). Ahora se pide texto plano y con más margen.
    const maxTokens = Math.min(16000, 2500 * paginas.length + 500);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
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
    let texto = (data.content || []).filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("").trim();
    // Compatibilidad: si el modelo igual envolvió el texto en {"texto": "..."}.
    const envuelto = texto.match(/^\s*\{\s*"texto"\s*:\s*"([\s\S]*)"\s*\}\s*$/);
    if (envuelto) { try { texto = JSON.parse(`"${envuelto[1]}"`); } catch (_) { /* se deja tal cual */ } }
    if (!texto) {
      return new Response(JSON.stringify({ error: "La IA no devolvió texto legible. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Si se alcanzó el límite de salida, se devuelve lo transcrito avisando.
    return new Response(JSON.stringify({ texto, incompleto: data.stop_reason === "max_tokens" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
