import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT_IMPUTACION = `Eres un asesor legal que revisa, ANTES de generarse, el documento "Inicio de Imputación de Infracción Leve" de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714.

Se te da el código de infracción elegido (con su texto del Anexo I), la fecha del hecho, y la "Descripción del hecho" que el oficial redactó libremente y que se usará tal cual en el documento oficial. Opcionalmente también se te da el texto extraído del archivo de sustento adjunto (oficio/orden telefónica), si lo hay.

Revisa si hay problemas evidentes ANTES de generar el documento oficial, por ejemplo:
- La descripción no menciona con claridad qué ocurrió, cuándo o cómo se comprobó.
- La descripción no parece corresponder al código de infracción elegido (el relato no encaja con el texto de esa infracción).
- La descripción contradice la fecha del hecho indicada.
- Si hay texto del archivo de sustento, y la descripción contradice o no guarda relación con lo que dice ese documento.
- La descripción es demasiado breve o genérica para sustentar una sanción disciplinaria.

No seas excesivamente estricto: si la descripción es razonable y coherente con el código elegido, no inventes observaciones. Esto es una revisión de apoyo, no un rechazo formal.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"consistente": true|false, "observaciones": ["..."], "fecha_detectada": null}`;

const SYSTEM_PROMPT_NOTIFICACION = `Eres un asesor legal que revisa el cargo de notificación firmado de una "Orden de Sanción" disciplinaria de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714.

Se te da el nombre del investigado sancionado, el código de infracción y la sanción impuesta, y el texto extraído (por OCR o lectura directa, puede tener ruido) del cargo de notificación firmado que se subió como comprobante de entrega.

Debes:
1. Verificar que el documento efectivamente corresponda a una notificación dirigida a ese investigado (nombre coincide, aunque sea parcialmente, considerando posible ruido de OCR).
2. Buscar en el texto una fecha de recepción/notificación (fecha en que el investigado firmó o recibió el documento) y devolverla en formato YYYY-MM-DD en "fecha_detectada" si la encuentras con razonable certeza; si no la encuentras, deja "fecha_detectada": null.
3. Señalar en "observaciones" cualquier discrepancia relevante (por ejemplo, el nombre no coincide, no hay firma o fecha visible, el documento no parece ser un cargo de notificación).

"consistente" debe ser true solo si el documento razonablemente corresponde a la notificación de esa Orden de Sanción a ese investigado, sin discrepancias graves.

No inventes fechas ni datos que no estén en el texto dado.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"consistente": true|false, "observaciones": ["..."], "fecha_detectada": "YYYY-MM-DD" | null}`;

function buildUserMessageImputacion(input: Record<string, unknown>): string {
  return [
    `Código de infracción elegido: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Fecha del hecho: ${input.fechaHecho || ""}`,
    `Descripción del hecho redactada por el oficial:\n${input.descripcionHecho || ""}`,
    input.textoDocumento ? `Texto extraído del archivo de sustento adjunto:\n${input.textoDocumento}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildUserMessageNotificacion(input: Record<string, unknown>): string {
  return [
    `Investigado sancionado: ${input.investigadoCompleto || ""}`,
    `Código de infracción: ${input.codigoInfraccion || ""}`,
    `Sanción impuesta: ${input.sancionImpuesta || ""}`,
    `Texto extraído del cargo de notificación firmado (puede tener ruido de OCR):\n${input.textoDocumento || "(no se pudo extraer texto)"}`,
  ].filter(Boolean).join("\n\n");
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
    const tipo = input.tipo === "notificacion_orden" ? "notificacion_orden" : "imputacion";
    const system = tipo === "notificacion_orden" ? SYSTEM_PROMPT_NOTIFICACION : SYSTEM_PROMPT_IMPUTACION;
    const userMessage = tipo === "notificacion_orden" ? buildUserMessageNotificacion(input) : buildUserMessageImputacion(input);

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
        system,
        messages: [{ role: "user", content: userMessage }],
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
