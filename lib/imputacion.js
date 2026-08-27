// Generación del documento "INICIO DE IMPUTACIÓN DE INFRACCIÓN LEVE" a partir
// de un CASO genérico (cualquier hecho leve constatado por el oficial, no
// solo ausencia/reincorporación como en moral-y-disciplina).
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_imputacion_leve.docx
// (copia exacta del cargo oficial de Notificación y Entrega de Acto
// Administrativo Disciplinario de la PNP, con placeholders {tag}). La
// plantilla en sí ya es genérica: no menciona ausencia en ningún lugar, solo
// el generador de moral-y-disciplina armaba esa narrativa fija. Aquí la
// descripción del hecho la escribe el oficial libremente, caso por caso.

import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { soloDigitos, conPnp, limpiarNombreVisible, nombreCompletoVisible, fechaLarga, fechaCorta, tokens, buscarOficialConstato } from "./utils.js";

// Re-exportadas tal cual: el resto de la app (app.js, ordenSancion.js,
// actaNoDescargo.js) las importa desde aquí -- la implementación vive en
// utils.js (sin dependencias, cubierta por lib/utils.test.js).
export { conPnp, fechaLarga, fechaCorta, tokens, buscarOficialConstato };

// Determina si un caso tiene todos los datos necesarios para generar el
// documento (código Leve válido + descripción del hecho + oficial
// identificable en Efectivos).
export function puedeGenerarImputacion(caso, efectivos) {
  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  if (!codigo || !getInfraccion(codigo)) return false;
  if (!caso.descripcion_hecho || !caso.descripcion_hecho.trim()) return false;
  if (!buscarOficialConstato(caso.oficial_constato, efectivos)) return false;
  return true;
}

// Arma el objeto de datos {tag: valor} que se le pasa a docxtemplater.
// Lanza un Error con un mensaje explicativo (mostrable directo al usuario)
// si falta algún dato indispensable.
export function construirDatosImputacion(caso, efectivos) {
  const infraccion = getInfraccion(caso.codigo_infraccion);
  if (!infraccion) {
    throw new Error("Este caso no tiene un código de infracción Leve válido (Anexo I). Solo se puede generar la imputación para infracciones leves (L1–L117).");
  }
  const oficial = buscarOficialConstato(caso.oficial_constato, efectivos);
  if (!oficial) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${caso.oficial_constato || "(no registrado)"}" que constató el hecho. Verifique que esté registrado en la tabla Efectivos con el mismo apellido.`);
  }
  if (!caso.descripcion_hecho || !caso.descripcion_hecho.trim()) {
    throw new Error("Falta describir el hecho constatado.");
  }

  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  const codigoConGuion = codigo.replace(/^L(\d+)$/, "L-$1");
  const infraccionSinPunto = infraccion.infraccion.replace(/\.\s*$/, "");
  const investigadoCompleto = `${conPnp(caso.grado)} ${nombreCompletoVisible(caso.apellidos, caso.nombres)}`.replace(/\s+/g, " ").trim();

  return {
    investigado_completo: investigadoCompleto,
    unidad_investigado: caso.unidad_investigado || "DIVOPUS 3-CPNP VENTANILLA.",
    descripcion_hecho: caso.descripcion_hecho.trim(),
    bien_juridico: infraccion.bienJuridico,
    codigo_infraccion_texto: `${codigoConGuion} (${infraccionSinPunto}).`,
    sancion_texto: infraccion.sancion,
    superior_completo: `${conPnp(oficial.grado)} ${limpiarNombreVisible(oficial.apellidos_nombres)}.`.replace(/\s+/g, " ").trim(),
    fecha_larga: fechaLarga(new Date().toISOString().slice(0, 10)),
    fecha_corta: fechaCorta(new Date().toISOString().slice(0, 10)),
    oficial_cip: soloDigitos(oficial.cip),
    oficial_nombre_completo: limpiarNombreVisible(oficial.apellidos_nombres),
    oficial_grado_seal: conPnp(oficial.grado),
    oficial_cargo: caso.oficial_cargo || "OFICIAL DE PERMANENCIA",
  };
}

// Renderiza la plantilla con los datos del caso y devuelve el Blob del
// .docx resultante (sin descargarlo todavía).
export async function renderizarImputacionDocx(caso, efectivos) {
  const data = construirDatosImputacion(caso, efectivos);

  const response = await fetch(new URL("../plantillas/plantilla_imputacion_leve.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla del documento.");
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

export async function generarImputacionDocx(caso, efectivos) {
  const out = await renderizarImputacionDocx(caso, efectivos);
  const nombreArchivo = `IMPUTACION LEVE - ${(caso.grado || "").trim()} ${(caso.nombres || "").trim()} ${(caso.apellidos || "").trim()}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
