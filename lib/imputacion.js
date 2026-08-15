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

const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

// Grados que se consideran parte del "grado" y no del nombre, al intentar
// ubicar en `efectivos` a la persona mencionada en oficial_constato (texto
// libre, tal como lo escriba el oficial, p.ej. "TNTE. ZEGOBIA QUISPE Antony"
// o "S2 PNP RAMIREZ CANDIA").
const GRADOS = new Set([
  "GRAL", "TGRAL", "CGRAL", "CRNL", "CORONEL", "CMDTE", "CMDT", "COMANDANTE",
  "MY", "MAY", "MAYOR", "CAP", "CAPITAN", "TNTE", "TTE", "TENIENTE",
  "ALF", "ALFZ", "ALFEREZ", "SO", "SOB", "SOT", "SO1", "SO2", "SO3",
  "S1", "S2", "S3", "ST1", "ST2", "ST3", "SS", "SB", "PNP", "EST", "CADETE", "SUBOF",
]);

export function soloDigitos(s) {
  return (s || "").replace(/\D+/g, "");
}

// Añade "PNP" al grado para el sello/cuerpo del documento, sin duplicarlo:
// en `efectivos` los grados de oficiales ya vienen completos ("TENIENTE PNP"),
// mientras que los de suboficiales no lo incluyen ("S2", "ST1", etc.).
export function conPnp(grado) {
  const g = (grado || "").replace(/\.$/, "").trim();
  return /\bPNP\b$/i.test(g) ? g : `${g} PNP`.trim();
}

// Algunos registros de `efectivos` guardan apellidos_nombres con coma sin
// espacio detrás (p.ej. "ROJAS GUINEA,ALDO CANZIANI"); esto lo deja legible
// ("ROJAS GUINEA, ALDO CANZIANI") para usarlo en el cuerpo del documento y el
// sello, sin afectar el emparejamiento (que usa normalizarTexto por separado).
export function limpiarNombreVisible(s) {
  return (s || "").replace(/,\s*/g, ", ").replace(/\s+/g, " ").trim();
}

export function fechaLarga(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  return `${d} de ${MESES_LARGO[m - 1]} del ${y}`;
}

export function fechaCorta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-");
  return `${d}/${m}/${y}`;
}

function normalizarTexto(s) {
  return (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s) {
  return normalizarTexto(s).split(" ").filter(Boolean);
}

// Ubica en `efectivos` a la persona mencionada en oficial_constato, ignorando
// las palabras que sean grado ("TNTE.", "PNP", etc.) y comparando el resto de
// palabras contra apellidos_nombres. Requiere al menos 2 palabras en común
// (p.ej. los dos apellidos) para dar el match por bueno.
export function buscarOficialConstato(oficialConstato, efectivos) {
  if (!oficialConstato || !efectivos?.length) return null;
  const nombreTokens = tokens(oficialConstato).filter((t) => !GRADOS.has(t));
  if (!nombreTokens.length) return null;

  let mejor = null;
  let mejorScore = 0;
  for (const ef of efectivos) {
    const efTokens = new Set(tokens(ef.apellidos_nombres));
    const score = nombreTokens.filter((t) => efTokens.has(t)).length;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = ef;
    }
  }
  return mejorScore >= 2 ? mejor : null;
}

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
  const investigadoCompleto = `${conPnp(caso.grado)} ${caso.apellidos || ""}, ${caso.nombres || ""}`.replace(/\s+/g, " ").trim();

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
  const nombreArchivo = `IMPUTACION LEVE - ${(caso.grado || "").trim()} ${(caso.apellidos || "").trim()} ${(caso.nombres || "").trim()}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
