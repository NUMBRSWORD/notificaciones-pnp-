// La Edge Function solo usa las API nativas de Deno (Request, Response y
// Deno.serve). Evitar una importación de tipos externa permite que el proceso
// arranque aun cuando el resolvedor de módulos del entorno esté temporalmente
// no disponible.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";
// La función se invoca desde el navegador y Supabase corta solicitudes largas.
// Un límite prudente permite contestar antes de los 30 segundos, incluso cuando
// el descargo proviene de OCR de un PDF escaneado.
const MAX_DESCARGO_CHARS = 18000;
const MAX_DIRECTIVAS_CHARS = 12000;

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
3. "analisis_texto": un análisis jurídico-administrativo formal y MUY CONCISO (máximo 450 palabras): menciona la evaluación del descargo, valora sus argumentos, aplica solo las directivas recibidas, considera los antecedentes y cita el artículo 31 de la Ley N° 30714. Concluye justificando el tercio elegido. Cierra con un párrafo de "Verificación de principios de la potestad sancionadora administrativa" que cite textualmente "artículo 230 del Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General, aprobado por Decreto Supremo N° 006-2026-JUS" e incluya los once principios: Legalidad, Debido Procedimiento, Razonabilidad, Tipicidad, Irretroactividad, Concurso de Infracciones, Continuación de Infracciones, Causalidad, Presunción de Licitud, Culpabilidad y Non Bis In Idem. Para cada uno usa una sola frase muy breve y específica al caso; si no aplica, indícalo expresamente.

Reglas estrictas:
- No inventes hechos, fechas, números de documento, normas, directivas o circunstancias que no estén en el descargo, en los datos del caso, en los antecedentes o en las directivas que se te dieron.
- No omitas ninguno de los once principios de la potestad sancionadora en el párrafo de verificación.
- "tercio_value" debe ser EXACTAMENTE uno de los valores de la lista de opciones proporcionada (campo "value"), sin alterarlo ni un carácter.
- Si no se te dio lista de antecedentes o está vacía, no menciones antecedentes en el análisis.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"resumen_descargo": "...", "tercio_value": "...", "analisis_texto": "..."}`;

const SYSTEM_PROMPT_RESUMEN = `Resume fielmente una parte de un descargo disciplinario de la PNP. Tu resumen debe servir para insertarse en una Orden de Sanción y explicar QUÉ DEFENSA FORMULA el investigado.

Reglas obligatorias:
- Ignora por completo los encabezados y datos de trámite: destinatario, administrado, sumilla, referencia, número de documento, fecha de presentación, firmas, cargos, anexos de portada y la sola frase "interpongo descargo". Esos datos NO son argumentos de defensa.
- Identifica los argumentos sustantivos: qué versión de los hechos sostiene, qué niega o reconoce, qué circunstancia justifica o atenúa, qué solicita y qué documentos o medios probatorios invoca.
- Redacta un párrafo formal, en tercera persona, de aproximadamente 120 a 300 palabras cuando el texto contenga argumentos suficientes. Ordena las ideas por puntos, sin copiar literalmente el escrito ni evaluarlo.
- No evalúes responsabilidad, no elijas sanción y no inventes información.
- Si esta parte solo contiene encabezados, identificación o contenido ilegible por OCR, responde exactamente: "Esta parte del archivo solo contiene datos de identificación o texto no legible; no se advierten argumentos de defensa sustantivos." El resultado se combinará con otras partes antes del análisis jurídico final.`;

const SYSTEM_PROMPT_TERCIO = `Evalúa un descargo disciplinario de la PNP conforme a la Ley N° 30714 y devuelve únicamente el value EXACTO de una de las opciones de tercio recibidas. Elige mínimo si hay justificación acreditada y sin antecedentes; medio si no desvirtúa el hecho o solo reconoce sin prueba; máximo si existen antecedentes o agravantes acreditados. Usa solamente los hechos y directivas recibidos, sin inventar información.`;

const SYSTEM_PROMPT_ANALISIS = `Eres un asesor legal que redacta el análisis para una Orden de Sanción de la PNP conforme a la Ley N° 30714. Usa solamente los hechos, antecedentes y directivas recibidos; si no hay directiva aplicable, no inventes ninguna. Redacta un análisis jurídico-administrativo de máximo 350 palabras: evalúa el descargo, los antecedentes y directivas relevantes, y cita el artículo 31 de la Ley N° 30714. No indiques ni recomiendes un tercio, extremo o número de días: la aplicación lo selecciona por separado. Cierra con un párrafo que cite textualmente "artículo 230 del Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General, aprobado por Decreto Supremo N° 006-2026-JUS" y mencione, con frases muy breves aplicadas al caso, los once principios: Legalidad, Debido Procedimiento, Razonabilidad, Tipicidad, Irretroactividad, Concurso de Infracciones, Continuación de Infracciones, Causalidad, Presunción de Licitud, Culpabilidad y Non Bis In Idem.`;

const HERRAMIENTA_ANALISIS = {
  name: "entregar_analisis",
  description: "Devuelve el análisis disciplinario completo con el formato solicitado.",
  input_schema: {
    type: "object",
    properties: {
      analisis_texto: { type: "string" },
      resumen_descargo: { type: "string" },
      tercio_value: { type: "string" },
    },
    required: ["analisis_texto", "resumen_descargo", "tercio_value"],
    additionalProperties: false,
  },
};

const HERRAMIENTA_RESUMEN = {
  name: "entregar_resumen_descargo",
  description: "Devuelve una síntesis sustantiva de los argumentos de defensa, excluyendo encabezados y datos de trámite.",
  input_schema: {
    type: "object",
    properties: { resumen_descargo: { type: "string" } },
    required: ["resumen_descargo"],
    additionalProperties: false,
  },
};

const HERRAMIENTA_TERCIO = {
  name: "entregar_tercio",
  description: "Devuelve el tercio de sanción solicitado.",
  input_schema: {
    type: "object",
    properties: {
      tercio_value: { type: "string" },
    },
    required: ["tercio_value"],
    additionalProperties: false,
  },
};

const HERRAMIENTA_TEXTO_ANALISIS = {
  name: "entregar_texto_analisis",
  description: "Devuelve únicamente el análisis jurídico solicitado.",
  input_schema: {
    type: "object",
    properties: {
      analisis_texto: { type: "string" },
    },
    required: ["analisis_texto"],
    additionalProperties: false,
  },
};

function recortarTexto(texto: unknown, limite: number, etiqueta: string): string {
  const limpio = String(texto || "").trim();
  if (limpio.length <= limite) return limpio;
  const inicio = Math.ceil(limite * 0.7);
  const cierre = limite - inicio;
  return `${limpio.slice(0, inicio)}\n\n[Se omitió una parte extensa de ${etiqueta} para mantener el análisis dentro del límite.]\n\n${limpio.slice(-cierre)}`;
}

function buildUserMessage(input: Record<string, unknown>): string {
  const antecedentes = Array.isArray(input.antecedentes) ? input.antecedentes : [];
  const directivas = Array.isArray(input.directivas) ? input.directivas : [];
  let caracteresDisponibles = MAX_DIRECTIVAS_CHARS;
  const directivasTexto = directivas.length
    ? directivas.map((d: { titulo?: string; numero_documento?: string; contenido?: string }, i: number) => {
        if (caracteresDisponibles <= 0) return null;
        const contenido = recortarTexto(d.contenido, caracteresDisponibles, "las directivas internas");
        caracteresDisponibles -= contenido.length;
        return `--- Directiva ${i + 1}: ${d.titulo || "(sin título)"}${d.numero_documento ? ` (${d.numero_documento})` : ""} ---\n${contenido}`;
      }).filter(Boolean).join("\n\n")
    : "(no se proporcionaron directivas internas al sistema; si el descargo invoca una circunstancia que normalmente requeriría una, dilo expresamente en vez de asumir requisitos)";
  return [
    `Investigado: ${input.investigadoCompleto || ""}`,
    `Código de infracción imputada: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Rango de sanción (Anexo I): ${input.sancionTexto || ""}`,
    `Descripción del hecho ya constatado: ${input.descripcionHecho || ""}`,
    `Opciones de tercio disponibles (elige el "value" de una, exactamente): ${JSON.stringify(input.tercios || [])}`,
    `Antecedentes disciplinarios previos de este investigado en el sistema (${antecedentes.length}): ${JSON.stringify(antecedentes)}`,
    `Texto extraído del descargo presentado por el investigado, puede tener ruido de OCR:\n${recortarTexto(input.textoDescargo, MAX_DESCARGO_CHARS, "el descargo") || "(no se pudo extraer texto)"}`,
    `Directivas internas vigentes proporcionadas por el administrador:\n${directivasTexto}`,
  ].filter(Boolean).join("\n");
}

function buildResumenMessage(input: Record<string, unknown>): string {
  return `Texto de esta parte del descargo, posiblemente extraído por OCR:\n${recortarTexto(input.textoDescargo, MAX_DESCARGO_CHARS, "el descargo") || "(no se pudo extraer texto)"}`;
}

function limpiarTextoAnalisis(texto: unknown): string {
  return String(texto || "")
    .replace(/<\/?(?:analisis_texto|invoke)>/gi, "")
    .trim();
}

async function solicitarIA(system: string, herramienta: { name: string }, maxTokens: number, mensaje: string): Promise<Record<string, unknown>> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools: [herramienta],
      tool_choice: { type: "tool", name: herramienta.name },
      messages: [{ role: "user", content: mensaje }],
    }),
  });
  if (!resp.ok) throw new Error(`Error de la API de IA: ${await resp.text()}`);
  const data = await resp.json();
  const toolUse = (data.content || []).find((block: { type?: string; name?: string; input?: Record<string, unknown> }) =>
    block.type === "tool_use" && block.name === herramienta.name
  );
  if (!toolUse?.input) throw new Error("La IA no devolvió el resultado estructurado esperado.");
  return toolUse.input;
}

async function solicitarIASeguro(system: string, herramienta: { name: string }, maxTokens: number, mensaje: string): Promise<Record<string, unknown>> {
  try {
    return await solicitarIA(system, herramienta, maxTokens, mensaje);
  } catch (err) {
    console.error("Respuesta parcial de IA no disponible:", err);
    return {};
  }
}

function tercioPorDefecto(input: Record<string, unknown>): string {
  const opciones = Array.isArray(input.tercios) ? input.tercios : [];
  const medio = opciones.find((opcion: { extremo?: string; label?: string; value?: string }) =>
    /medio/i.test(`${opcion.extremo || ""} ${opcion.label || ""} ${opcion.value || ""}`)
  ) as { value?: string } | undefined;
  return String(medio?.value || (opciones[0] as { value?: string } | undefined)?.value || "");
}

// Si la llamada dedicada al resumen falla, se conserva un resumen breve del
// propio texto extraído. Nunca se devuelve la frase genérica que no aporta los
// argumentos de defensa requeridos por la plantilla.
function resumenDeRespaldo(input: Record<string, unknown>): string {
  const texto = String(input.textoDescargo || "").replace(/\s+/g, " ").trim();
  if (!texto) return "";
  const oraciones = texto.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const esEncabezado = (oracion: string) => /\b(administrado|sumilla|referencia|interpone descargo|notificaci[oó]n de presunta infracci[oó]n|señor(?:a)?\s+(?:comandante|coronel|mayor|capit[aá]n|teniente))\b/i.test(oracion)
    && !/\b(alega|sostiene|manifiesta|señala|argumenta|solicita|pide|niega|reconoce|justifica|porque|adjunta|acredita|prueba)\b/i.test(oracion);
  const candidatas = oraciones
    .map((oracion) => oracion.trim())
    .filter((oracion) => oracion.length >= 25)
    .filter((oracion) => !esEncabezado(oracion));
  const extracto = candidatas
    .slice(0, 3)
    .join(" ")
    .slice(0, 1100);
  if (!extracto) return "Esta parte del archivo solo contiene datos de identificación o texto no legible; no se advierten argumentos de defensa sustantivos.";
  return `En su descargo, el investigado expone, en síntesis, los siguientes puntos relevantes: ${extracto}`;
}

function analisisDeRespaldo(input: Record<string, unknown>, resumen: string): string {
  const codigo = String(input.codigoInfraccion || "la infracción imputada");
  const hecho = String(input.descripcionHecho || "el hecho constatado").replace(/\s+/g, " ").slice(0, 900);
  return `Se ha recibido y valorado el descargo presentado. ${resumen || "El texto extraído del descargo debe ser revisado junto con el archivo original."} En relación con ${codigo}, corresponde contrastar sus alegaciones con ${hecho || "los hechos constatados"}, sin incorporar circunstancias no acreditadas. Conforme al artículo 31 de la Ley N° 30714, la autoridad debe graduar la sanción atendiendo a las circunstancias de comisión, los antecedentes y la proporcionalidad del caso concreto.\n\nVerificación de principios de la potestad sancionadora administrativa: conforme al artículo 230 del Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General, aprobado por Decreto Supremo N° 006-2026-JUS, se observa la Legalidad por la infracción previamente tipificada; el Debido Procedimiento por la oportunidad de descargo; la Razonabilidad al graduar según el caso; la Tipicidad por la correspondencia con la conducta imputada; la Irretroactividad según la norma vigente; el Concurso de Infracciones y la Continuación de Infracciones solo si se acreditan; la Causalidad respecto del autor del hecho; la Presunción de Licitud mediante la valoración del descargo; la Culpabilidad según la evidencia disponible; y el Non Bis In Idem evitando doble sanción por el mismo hecho. Nota: este es un borrador de respaldo; revise el PDF original antes de guardar.`;
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
    if (input.modo === "resumir_bloque") {
      const resumen = await solicitarIASeguro(SYSTEM_PROMPT_RESUMEN, HERRAMIENTA_RESUMEN, 650, buildResumenMessage(input));
      const resumenTexto = String(resumen.resumen_descargo || resumenDeRespaldo(input)).trim();
      if (!resumenTexto) throw new Error("No se pudo obtener un resumen legible de esta parte del descargo.");
      return new Response(JSON.stringify({ resumen_descargo: resumenTexto }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Se ejecutan en paralelo: evita que un análisis extenso consuma todo el
    // tiempo disponible y garantiza que el resumen no recorte la decisión.
    const [resumen, tercio, analisis] = await Promise.all([
      solicitarIASeguro(SYSTEM_PROMPT_RESUMEN, HERRAMIENTA_RESUMEN, 650, buildResumenMessage(input)),
      solicitarIASeguro(SYSTEM_PROMPT_TERCIO, HERRAMIENTA_TERCIO, 300, buildUserMessage(input)),
      solicitarIASeguro(SYSTEM_PROMPT_ANALISIS, HERRAMIENTA_TEXTO_ANALISIS, 1500, buildUserMessage(input)),
    ]);
    const resumenTexto = String(resumen.resumen_descargo || resumenDeRespaldo(input)).trim();
    if (!resumenTexto) throw new Error("No se pudo obtener un resumen legible del descargo. Revise el archivo o redacte el resumen manualmente.");
    const tercioTexto = String(tercio.tercio_value || tercioPorDefecto(input)).trim();
    const analisisTexto = limpiarTextoAnalisis(analisis.analisis_texto);
    return new Response(JSON.stringify({
      resumen_descargo: resumenTexto,
      tercio_value: tercioTexto,
      analisis_texto: analisisTexto || analisisDeRespaldo(input, resumenTexto),
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
