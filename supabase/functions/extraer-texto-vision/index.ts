import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
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

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"texto": "..."} -- el texto de TODAS las páginas dadas, concatenado en orden, separado por un salto de línea doble entre páginas.`;

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

    // ~900 tokens de salida por página (una página densa de texto legal
    // ronda los 500-800 palabras) más un margen -- suficiente para el
    // tamaño de lote que usa el cliente (hasta 8 páginas).
    const maxTokens = Math.min(8000, 900 * paginas.length + 400);

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
