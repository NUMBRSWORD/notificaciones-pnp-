// Generación del "Acta de No Recepción de Descargos": se emite cuando ya
// venció el plazo de un (01) día hábil desde que se generó la Imputación y
// el investigado no presentó su descargo. Adaptado de moral-y-disciplina al
// esquema "casos" (los campos administrativos son los mismos; lo único que
// no aplica aquí es la narrativa de ausencia/reincorporación).
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_acta_no_descargo.docx.

import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { buscarOficialConstato, fechaLarga, tokens } from "./imputacion.js";
import { splitApellidosNombres, tituloPorPalabra, nombreCompletoVisible, plazoDescargoVencido, fechaLimiteDescargo } from "./utils.js";

export { plazoDescargoVencido, fechaLimiteDescargo };

// El testigo es siempre la misma persona, igual que en moral-y-disciplina —
// si tu unidad usa otro testigo fijo, edita estos datos.
const TESTIGO_FIJO = {
  grado: "S2",
  apellidos: "HIDALGO FERRARI",
  nombres: "Hans Brandon",
  cip: "32138113",
  dni: "72955816",
};

function sinPnp(grado) {
  return (grado || "").replace(/\.$/, "").replace(/\s*\bPNP\b\s*$/i, "").trim();
}

// Ubica en `efectivos` al investigado del caso, para completar su CIP y DNI.
// Requiere al menos 2 palabras en común (apellidos) para dar el match por bueno.
export function buscarInvestigado(apellidos, nombres, efectivos) {
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

export function puedeGenerarActaNoDescargo(caso, efectivos) {
  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  if (!codigo || !getInfraccion(codigo)) return false;
  if (!caso.imputacion_generada_at) return false;
  if (caso.fecha_descargo) return false;
  if (!plazoDescargoVencido(caso)) return false;
  if (!buscarOficialConstato(caso.oficial_constato, efectivos)) return false;
  if (!buscarInvestigado(caso.apellidos, caso.nombres, efectivos)) return false;
  return true;
}

export function construirDatosActaNoDescargo(caso, efectivos) {
  const superior = buscarOficialConstato(caso.oficial_constato, efectivos);
  if (!superior) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${caso.oficial_constato || "(no registrado)"}" que constató el hecho.`);
  }
  const investigadoEf = buscarInvestigado(caso.apellidos, caso.nombres, efectivos);
  if (!investigadoEf) {
    throw new Error(`No se pudo ubicar en Efectivos a ${caso.apellidos || ""} ${caso.nombres || ""} para completar su CIP/DNI. Verifique que esté registrado en la tabla Efectivos.`);
  }

  const superiorSplit = splitApellidosNombres(superior.apellidos_nombres);
  const ahora = new Date();
  const cierre = new Date(ahora.getTime() + 10 * 60000);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return {
    fecha_larga: fechaLarga(ahora.toISOString().slice(0, 10)),
    hora_apertura: hhmm(ahora),
    hora_cierre: hhmm(cierre),
    superior_grado: sinPnp(superior.grado),
    superior_apellidos: superiorSplit.apellidos.toUpperCase(),
    superior_nombres: tituloPorPalabra(superiorSplit.nombres),
    superior_cip: superior.cip,
    superior_dni: superior.dni,
    testigo_grado: TESTIGO_FIJO.grado,
    testigo_apellidos: TESTIGO_FIJO.apellidos,
    testigo_nombres: TESTIGO_FIJO.nombres,
    testigo_cip: TESTIGO_FIJO.cip,
    testigo_dni: TESTIGO_FIJO.dni,
    investigado_grado: sinPnp(caso.grado),
    investigado_apellidos: (caso.apellidos || "").trim().toUpperCase(),
    investigado_nombres: tituloPorPalabra(caso.nombres),
    investigado_cip: investigadoEf.cip,
    investigado_dni: investigadoEf.dni,
  };
}

export async function renderizarActaNoDescargoDocx(caso, efectivos) {
  const data = construirDatosActaNoDescargo(caso, efectivos);

  const response = await fetch(new URL("../plantillas/plantilla_acta_no_descargo.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla del acta.");
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

export async function generarActaNoDescargoDocx(caso, efectivos) {
  const out = await renderizarActaNoDescargoDocx(caso, efectivos);
  const nombreArchivo = `ACTA NO DESCARGO - ${(caso.grado || "").trim()} ${nombreCompletoVisible(caso.apellidos, caso.nombres)}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
