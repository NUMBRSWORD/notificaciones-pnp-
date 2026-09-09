import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT_IMPUTACION = `Eres un asesor legal que revisa, ANTES de generarse, el documento "Inicio de Imputación de Infracción Leve" de la Policía Nacional del Perú (PNP), conforme a la Ley N.° 30714. Se te da el código de infracción, su texto, fecha y descripción del hecho, además del sustento opcional. Señala solo inconsistencias evidentes y no inventes observaciones. Responde ÚNICAMENTE JSON válido: {"consistente":true|false,"observaciones":["..."],"fecha_detectada":null}.`;

const SYSTEM_PROMPT_NOTIFICACION = `Eres un asesor legal que revisa el cargo de notificación firmado de una Orden de Sanción disciplinaria de la PNP. Verifica razonablemente el investigado, código, sanción y fecha; no inventes datos. Responde ÚNICAMENTE JSON válido: {"consistente":true|false,"observaciones":["..."],"fecha_detectada":"YYYY-MM-DD"|null}.`;

const SYSTEM_PROMPT_EXPEDIENTE = `Eres un revisor documental de expedientes disciplinarios de la Policía Nacional del Perú (PNP), conforme a la Ley N.° 30714. Debes revisar un único PDF que debería contener el legajo firmado completo de un caso.

Recibirás investigado, código, sanción, componentes esperados y texto OCR que puede estar desordenado o tener errores. Reconoce documentos por encabezados y contenido, no solo por coincidencias literales. Los componentes que dicen "ya consta por separado" deben contarse como presentes aunque no aparezcan en el PDF.

Determina los documentos presentes y faltantes. Busca una fecha de recepción o notificación firmada y devuelve YYYY-MM-DD solo si es razonablemente cierta. No inventes documentos, firmas ni fechas.

Responde ÚNICAMENTE JSON válido con exactamente: {"consistente":true|false,"presentes":["..."],"faltantes":["..."],"observaciones":["..."],"fecha_detectada":"YYYY-MM-DD"|null}. "consistente" es true solo si no faltan componentes relevantes ni hay discrepancias graves.`;

function buildUserMessageImputacion(input: Record<string, unknown>): string {
  return [
    `Código de infracción elegido: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Fecha del hecho: ${input.fechaHecho || ""}`,
    `Descripción del hecho redactada por el oficial:\n${input.descripcionHecho || ""}`,
    input.textoDocumento ? `Texto extraído del archivo de sustento:\n${input.textoDocumento}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildUserMessageNotificacion(input: Record<string, unknown>): string {
  return [
    `Investigado sancionado: ${input.investigadoCompleto || ""}`,
    `Código de infracción: ${input.codigoInfraccion || ""}`,
    `Sanción impuesta: ${input.sancionImpuesta || ""}`,
    `Texto extraído del cargo firmado:\n${input.textoDocumento || "(no se pudo extraer texto)"}`,
  ].join("\n\n");
}

function buildUserMessageExpediente(input: Record<string, unknown>): string {
  const componentes = Array.isArray(input.componentesEsperados) ? input.componentesEsperados : [];
  const lista = componentes.map((item: Record<string, unknown>) => `- ${item.etiqueta || "Documento"}${item.yaConsta ? " (ya consta por separado en el sistema)" : ""}`).join("\n");
  return [
    `Investigado sancionado: ${input.investigadoCompleto || ""}`,
    `Código de infracción: ${input.codigoInfraccion || ""}`,
    `Sanción impuesta: ${input.sancionImpuesta || ""}`,
    `Componentes esperados:\n${lista}`,
    `Texto extraído del PDF del expediente firmado:\n${input.textoDocumento || "(no se pudo extraer texto)"}`,
  ].join("\n\n");
}

Deno.serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const input = await req.json();
    const tipo = ["notificacion_orden", "expediente_completo"].includes(input.tipo) ? input.tipo : "imputacion";
    const system = tipo === "expediente_completo" ? SYSTEM_PROMPT_EXPEDIENTE : tipo === "notificacion_orden" ? SYSTEM_PROMPT_NOTIFICACION : SYSTEM_PROMPT_IMPUTACION;
    const userMessage = tipo === "expediente_completo" ? buildUserMessageExpediente(input) : tipo === "notificacion_orden" ? buildUserMessageNotificacion(input) : buildUserMessageImputacion(input);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: tipo === "expediente_completo" ? 1500 : 1000, system, messages: [{ role: "user", content: userMessage }] }),
    });
    if (!resp.ok) return new Response(JSON.stringify({ error: `Error de la API de IA: ${await resp.text()}` }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    const data = await resp.json();
    const text = (data.content || []).filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return new Response(JSON.stringify({ error: "La IA no devolvió un formato reconocible. Intente de nuevo." }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    return new Response(JSON.stringify(JSON.parse(match[0])), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});