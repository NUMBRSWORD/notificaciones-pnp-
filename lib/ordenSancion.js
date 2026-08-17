// Generación de la "Orden de Sanción": se emite luego de evaluar el descargo
// (o su ausencia, si venció el plazo sin que se presente), eligiendo el
// tercio de la sanción a imponer. A diferencia de moral-y-disciplina (que
// solo cubría L21/L24 con tercios tipeados a mano), aquí el tercio se calcula
// para CUALQUIER código Leve leyendo el texto "sancion" del Anexo I —
// ver lib/tercios.js — y el "caso concreto" es directamente la descripción
// del hecho en texto libre que ya escribió el oficial, no una narrativa fija.
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_orden_sancion.docx
// (copia exacta, con placeholders {tag}, del formato real ya aprobado).

import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { buscarOficialConstato, conPnp, fechaLarga, fechaCorta, tokens } from "./imputacion.js";
import { plazoDescargoVencido } from "./actaNoDescargo.js";
import { opcionesTercioDesdeSancion } from "./tercios.js";

function splitApellidosNombres(full) {
  const txt = (full || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (txt.includes(",")) {
    const [ap, no] = txt.split(",");
    return { apellidos: ap.trim(), nombres: (no || "").trim() };
  }
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return { apellidos: txt, nombres: "" };
  return { apellidos: words.slice(0, 2).join(" "), nombres: words.slice(2).join(" ") };
}

// Ubica en `efectivos` al investigado del caso, para completar su CIP en la
// frase de DECISIÓN. Requiere al menos 2 palabras en común (apellidos).
function buscarInvestigado(apellidos, nombres, efectivos) {
  if (!apellidos || !efectivos?.length) return null;
  const objetivo = tokens(`${apellidos} ${nombres}`);
  if (!objetivo.length) return null;
  let mejor = null;
  let mejorScore = 0;
  for (const ef of efectivos) {
    const efTokens = new Set(tokens(ef.apellidos_nombres));
    const score = objetivo.filter((t) => efTokens.has(t)).length;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = ef;
    }
  }
  return mejorScore >= 2 ? mejor : null;
}

export function opcionesTercio(codigoInfraccion) {
  const infraccion = getInfraccion(codigoInfraccion);
  if (!infraccion) return null;
  return opcionesTercioDesdeSancion(infraccion.sancion);
}

// Párrafo estándar de "Análisis y Evaluación" para los casos SIN descargo
// (venció el plazo sin respuesta), con el cierre ajustado según el tercio
// elegido. Punto de partida editable, no texto final.
export function analisisSinDescargoDefault(codigoInfraccion, tercioValue) {
  const opciones = opcionesTercio(codigoInfraccion) || [];
  const opcion = opciones.find((o) => o.value === tercioValue);
  const extremo = opcion?.extremo || "correspondiente";
  return (
    "Habiendo vencido el plazo reglamentario sin que el administrado haga ejercicio de su derecho a la defensa mediante la presentación de sus descargos, se procede a valorar los actuados. De los hechos descritos ha quedado objetiva y fehacientemente acreditada la comisión de la infracción imputada. Aunado a ello, para la graduación de la sanción se toma en estricta consideración lo establecido en el artículo 31 de la Ley N° 30714, el cual contempla los criterios para la imposición de sanciones. " +
    `En tal sentido, atendiendo a los criterios de razonabilidad y proporcionalidad, corresponde imponer la medida en su extremo ${extremo}.\n\n` +
    "Verificación de los principios de la potestad sancionadora administrativa (Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General): (i) Legalidad, en tanto la potestad disciplinaria se ejerce por autoridad competente conforme a la Ley N° 30714 y su reglamento; (ii) Debido Procedimiento, pues el investigado fue debidamente notificado de la imputación y tuvo la oportunidad real de presentar su descargo, no habiéndolo ejercido dentro del plazo legal; (iii) Razonabilidad, al graduarse la sanción dentro de los márgenes previstos en el Anexo I sin exceder lo estrictamente necesario; (iv) Tipicidad, dado que la conducta imputada se subsume exactamente en la infracción del Anexo I antes citada; (v) Irretroactividad, al aplicarse las normas vigentes al momento de los hechos; (vi) Concurso de Infracciones, no verificándose en el presente caso la concurrencia de otra infracción por el mismo hecho; (vii) Continuación de Infracciones, no correspondiendo su aplicación al tratarse de un hecho único; (viii) Causalidad, por recaer la sanción sobre quien realizó la conducta imputada; (ix) Presunción de Licitud, habiéndose desvirtuado dicha presunción con los medios probatorios que sustentan la imputación; (x) Culpabilidad, al no haberse acreditado causa eximente de responsabilidad; y (xi) Non Bis In Idem, no existiendo doble sanción por el mismo hecho y fundamento."
  );
}

export function puedeGenerarOrdenSancion(caso, efectivos) {
  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  const infraccion = getInfraccion(codigo);
  if (!infraccion || !opcionesTercioDesdeSancion(infraccion.sancion)) return false;
  if (!caso.imputacion_generada_at) return false;
  if (!caso.fecha_descargo && !plazoDescargoVencido(caso)) return false;
  if (!buscarOficialConstato(caso.oficial_constato, efectivos)) return false;
  if (!buscarInvestigado(caso.apellidos, caso.nombres, efectivos)) return false;
  return true;
}

export function construirDatosOrdenSancion(caso, efectivos, seleccion) {
  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  const infraccion = getInfraccion(codigo);
  if (!infraccion) {
    throw new Error("Este caso no tiene un código de infracción Leve válido (Anexo I).");
  }
  const opciones = opcionesTercioDesdeSancion(infraccion.sancion);
  if (!opciones) {
    throw new Error("No se pudo calcular el tercio de sanción para este código (redacción de sanción no reconocida).");
  }
  const opcion = opciones.find((o) => o.value === seleccion?.tercioValue);
  if (!opcion) {
    throw new Error("Seleccione el tercio de la sanción a imponer.");
  }
  if (!seleccion?.analisisTexto?.trim()) {
    throw new Error("Escriba el Análisis y Evaluación del caso antes de generar el documento.");
  }

  const superior = buscarOficialConstato(caso.oficial_constato, efectivos);
  if (!superior) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${caso.oficial_constato || "(no registrado)"}" que constató el hecho.`);
  }
  const investigadoEf = buscarInvestigado(caso.apellidos, caso.nombres, efectivos);
  if (!investigadoEf) {
    throw new Error(`No se pudo ubicar en Efectivos a ${caso.apellidos || ""} ${caso.nombres || ""} para completar su CIP. Verifique que esté registrado en la tabla Efectivos.`);
  }

  const superiorSplit = splitApellidosNombres(superior.apellidos_nombres);
  const codigoConGuion = codigo.replace(/^L(\d+)$/, "L-$1");
  const infraccionSinPunto = infraccion.infraccion.replace(/\.\s*$/, "");
  const investigadoCompleto = `${conPnp(caso.grado)} ${caso.apellidos || ""} ${caso.nombres || ""}`.replace(/\s+/g, " ").trim();

  const descargoTexto = (seleccion.descargoTexto || "").trim() ||
    "El investigado no presentó su descargo por escrito dentro del plazo de un (01) día hábil establecido por ley, conforme acta respectiva, precluyendo su derecho a la defensa en la presente etapa procedimental.";

  const hechoCompleto = `"${infraccionSinPunto}"; CASO CONCRETO: ${caso.descripcion_hecho || ""}`;

  const decisionTexto =
    `Se resuelve SANCIONAR al ${investigadoCompleto}, CIP N° ${investigadoEf.cip}, perteneciente a la comisaría PNP Ventanilla, ` +
    `con ${opcion.fragmento} por la comisión de la infracción leve código ${codigoConGuion} tipificada en el Anexo I de la tabla de infracción y sanciones de la ley 30714 y sus modificatorias.`;

  const hoyISO = new Date().toISOString().slice(0, 10);

  return {
    investigado_completo: investigadoCompleto,
    hecho_completo: hechoCompleto,
    descargo_texto: descargoTexto,
    bien_juridico: ` ${infraccion.bienJuridico}. `,
    codigo_texto: `${codigoConGuion} (${infraccionSinPunto}).`,
    sancion_rango: ` ${infraccion.sancion}`,
    analisis_texto: seleccion.analisisTexto.trim(),
    decision_texto: decisionTexto,
    signer_oa: `OA-${(superior.cip || "").replace(/\D+/g, "")}`,
    signer_nombre: `${superiorSplit.nombres} ${superiorSplit.apellidos}`.replace(/\s+/g, " ").trim(),
    signer_grado: conPnp(superior.grado).toUpperCase(),
    fecha_larga_punto: `Ventanilla, ${fechaLarga(hoyISO)}.`,
    fecha_corta: fechaCorta(hoyISO),
  };
}

export async function renderizarOrdenSancionDocx(caso, efectivos, seleccion) {
  const data = construirDatosOrdenSancion(caso, efectivos, seleccion);

  const response = await fetch(new URL("../plantillas/plantilla_orden_sancion.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla de la Orden de Sanción.");
  const arrayBuffer = await response.arrayBuffer();

  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(data);

  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function generarOrdenSancionDocx(caso, efectivos, seleccion) {
  const out = await renderizarOrdenSancionDocx(caso, efectivos, seleccion);
  const nombreArchivo = `ORDEN DE SANCION - ${(caso.grado || "").trim()} ${(caso.apellidos || "").trim()} ${(caso.nombres || "").trim()}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
