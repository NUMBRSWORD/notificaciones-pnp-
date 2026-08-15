import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Eres un asistente que redacta un resumen ejecutivo breve para un oficial de la Policía Nacional del Perú (PNP) sobre el estado de sus casos disciplinarios (infracciones Leves, Ley N° 30714).

Se te da la fecha de hoy y una lista de casos con su estado actual (investigado, código de infracción, fecha del hecho, si ya fue notificada la Imputación, si el plazo de descargo (1 día hábil) ya venció o sigue en curso, si se recibió descargo, si se generó Acta de No Descargo, si se generó Orden de Sanción, y si esa orden ya fue notificada).

Redacta un resumen ejecutivo en español, en prosa clara (puedes usar un par de párrafos cortos y, si ayuda a la claridad, una lista breve al final con los casos que requieren acción urgente), que incluya:
1. Un panorama general: cuántos casos hay en total y en qué etapa se encuentra cada uno (agrupa por etapa: pendiente de notificar, plazo de descargo en curso, plazo vencido sin Acta, listo para Orden de Sanción, Orden generada pero no notificada, trámite completo).
2. Alertas priorizadas: casos cuyo plazo de descargo está vencido y todavía no tienen Acta de No Descargo ni Orden de Sanción (son los que requieren acción más urgente), y casos con Orden de Sanción generada pero aún no notificada.
3. Un cierre breve si todo está al día.

No inventes datos que no estén en la lista dada. Sé conciso y útil, como si fuera el resumen que un asistente personal le entrega cada mañana.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"resumen": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Fecha de hoy: ${input.fechaHoy || ""}`,
    `Lista de casos (JSON):\n${JSON.stringify(input.casos || [])}`,
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
