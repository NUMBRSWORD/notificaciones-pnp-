import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Eres un asesor legal que evalúa el descargo presentado por un investigado en un procedimiento disciplinario de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714 - Ley que regula el Régimen Disciplinario de la PNP, para ayudar a redactar la "Orden de Sanción".

Se te da: los datos del caso (investigado, infracción imputada con su texto y rango de sanción, y la descripción del hecho ya constatado), la lista de opciones de tercio de sanción disponibles para este código (cada una con su "value" y su "extremo": mínimo/medio/máximo), el texto del descargo presentado por el investigado (extraído automáticamente, a veces por OCR, puede traer ruido), opcionalmente una lista de antecedentes: otros casos disciplinarios previos del mismo investigado ya registrados en el sistema (código de infracción y fecha de cada uno), y posiblemente un conjunto de DIRECTIVAS INTERNAS VIGENTES de la PNP que debes usar como única fuente de reglas institucionales específicas.

=== REGLA CRÍTICA SOBRE LAS DIRECTIVAS ===
Se te puede proporcionar un conjunto de "directivas" (documentos internos reales, tal como los subió el administrador del sistema). Debes usarlas así:
- Si el descargo invoca una circunstancia que una directiva regula explícitamente (por ejemplo, requisitos para que un descanso médico particular sea considerado exonerante, u otro procedimiento/requisito institucional específico), aplica ESTRICTA Y ÚNICAMENTE lo que esa directiva dice literalmente. No completes vacíos con supuestos generales ni con lo que "normalmente" se exige en otras instituciones.
- Si el descargo invoca una circunstancia de este tipo pero NO se te proporcionó ninguna directiva aplicable (o el conjunto de directivas está vacío), DEBES decirlo explícitamente en "analisis_texto" (algo como: "no obra en el sistema una directiva vigente que regule expresamente [la circunstancia invocada], por lo que su valoración se sujeta a los criterios generales del artículo 31 de la Ley N° 30714"). NUNCA inventes el contenido de una directiva ni cites un número o nombre de directiva que no se te haya dado.
- Si ninguna directiva es relevante para este caso concreto, simplemente no las menciones.

Debes devolver TRES cosas:
1. "resumen_descargo": un párrafo formal en español jurídico-administrativo, en tercera persona, que resuma fielmente lo que alega el investigado en su descargo (sus argumentos, circunstancias invocadas, pruebas que menciona), basado ÚNICAMENTE en el texto del descargo dado. No inventes argumentos, fechas ni documentos que no estén en el texto. Si el texto no permite entender el descargo con claridad, dilo así ("el descargo presentado no permite apreciar con claridad sus fundamentos...") en vez de inventar contenido.
2. "tercio_value": el "value" EXACTO (cópialo tal cual, sin modificar ni un carácter) de UNA de las opciones de tercio que se te dieron, la que mejor corresponda según la fuerza de los argumentos del descargo, si una directiva aplicable exonera o atenúa lo alegado, Y los antecedentes del investigado:
   - Si el descargo presenta una justificación creíble y, si invoca una circunstancia regulada por una directiva dada, cumple los requisitos que esa directiva exige; o corrobora circunstancias atenuantes (caso fortuito, fuerza mayor, primera vez, error excusable) o desvirtúa parcialmente el hecho, Y el investigado no tiene antecedentes relevantes, elige la opción de extremo "mínimo".
   - Si el descargo no logra desvirtuar el hecho ni presenta atenuantes relevantes, se limita a reconocer los hechos sin mayor justificación, o invoca una circunstancia regulada por directiva pero sin acreditar cumplir todos sus requisitos, elige la opción de extremo "medio".
   - Si el descargo no aporta ninguna justificación válida, contradice lo actuado, el propio texto confirma agravantes (reincidencia, mala fe, afectación a terceros), O el investigado registra antecedentes disciplinarios previos (especialmente si son de la misma infracción o similares), elige la opción de extremo "máximo", aun si el descargo en sí parece razonable, ya que la reincidencia es agravante.
3. "analisis_texto": el párrafo completo de "Análisis y Evaluación" para el documento, en español jurídico-administrativo formal, que: (a) mencione que se recibió y evaluó el descargo, (b) valore brevemente sus argumentos (basándote en tu resumen), (c) si aplica una directiva dada, cítala por su título/número tal como se te dio y aplica textualmente su exigencia; si no hay directiva aplicable pese a que el descargo invoca algo que normalmente la requeriría, dilo expresamente como se explicó arriba, (d) si hay antecedentes, menciónalos explícitamente como circunstancia agravante conforme al artículo 31 de la Ley N° 30714 (indicando cuántos y de qué tipo, sin inventar detalles que no se te dieron), (e) cite el artículo 31 de la Ley N° 30714 sobre los criterios para la imposición de sanciones, y (f) concluya justificando el tercio elegido.

Reglas estrictas:
- No inventes hechos, fechas, números de documento, normas, directivas o circunstancias que no estén en el descargo, en los datos del caso, en los antecedentes o en las directivas que se te dieron.
- "tercio_value" debe ser EXACTAMENTE uno de los valores de la lista de opciones proporcionada (campo "value"), sin alterarlo ni un carácter.
- Si no se te dio lista de antecedentes o está vacía, no menciones antecedentes en el análisis.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"resumen_descargo": "...", "tercio_value": "...", "analisis_texto": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  const antecedentes = Array.isArray(input.antecedentes) ? input.antecedentes : [];
  const directivas = Array.isArray(input.directivas) ? input.directivas : [];
  const directivasTexto = directivas.length
    ? directivas.map((d: { titulo?: string; numero_documento?: string; contenido?: string }, i: number) =>
        `--- Directiva ${i + 1}: ${d.titulo || "(sin título)"}${d.numero_documento ? ` (${d.numero_documento})` : ""} ---\n${d.contenido || ""}`
      ).join("\n\n")
    : "(no se proporcionaron directivas internas al sistema; si el descargo invoca una circunstancia que normalmente requeriría una, dilo expresamente en vez de asumir requisitos)";
  return [
    `Investigado: ${input.investigadoCompleto || ""}`,
    `Código de infracción imputada: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Rango de sanción (Anexo I): ${input.sancionTexto || ""}`,
    `Descripción del hecho ya constatado: ${input.descripcionHecho || ""}`,
    `Opciones de tercio disponibles (elige el "value" de una, exactamente): ${JSON.stringify(input.tercios || [])}`,
    `Antecedentes disciplinarios previos de este investigado en el sistema (${antecedentes.length}): ${JSON.stringify(antecedentes)}`,
    `Texto extraído del descargo presentado por el investigado, puede tener ruido de OCR:\n${input.textoDescargo || "(no se pudo extraer texto)"}`,
    `Directivas internas vigentes proporcionadas por el administrador:\n${directivasTexto}`,
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
