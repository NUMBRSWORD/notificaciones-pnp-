// El oficio con el que se remite el expediente ya terminado.
//
// Se hace DESPUÉS de tener el expediente completo firmado, así que sus datos
// salen de lo que ya está registrado: la sanción impuesta, las piezas que trae
// el legajo y quién la impuso. Solo dos cosas no están en el expediente y hay
// que confirmarlas a mano:
//
//   - el JEFE DE LA DIVOPUS, a quien va dirigido, que cambia cada tanto;
//   - el COMISARIO que firma, que se confirma cada vez que se genera.

import { nombreCompletoVisible } from "./utils.js";
import { cargarDocxDeps } from "./docxDeps.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

const EN_LETRA = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete",
  "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince"];

/** "2026-09-30" -> "30 de setiembre del 2026", como lo escribe el oficio. */
export function fechaEnLetras(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} del ${m[1]}`;
}

/**
 * La sanción tal como la nombra el oficio: "OCHO (08) días de Sanción Simple".
 * Se escribe igual que en la Orden, para que los dos documentos no se
 * contradigan en la forma.
 */
export function fraseDeSancion(dias, tipo) {
  if (dias === 0 || tipo === "amonestacion") return "AMONESTACIÓN";
  if (dias === null || dias === undefined || !Number.isFinite(Number(dias))) return "";
  const n = Number(dias);
  const letra = (EN_LETRA[n] || String(n)).toUpperCase();
  const cifra = String(n).padStart(2, "0");
  const clase = tipo === "rigor" ? "de Rigor" : "Simple";
  return `${letra} (${cifra}) días de Sanción ${clase}`;
}

/**
 * Los documentos que se remiten junto con la Orden de Sanción, en el orden y
 * con las palabras del modelo. La Orden ya se nombra antes en la frase, así
 * que aquí va lo demás: lo que el expediente traiga de verdad, no una lista
 * fija que podría anunciar un descargo que nunca existió.
 */
export function documentosRemitidos(piezas = {}, codigoInfraccion = "") {
  const codigo = String(codigoInfraccion || "").replace(/^L\s*-?\s*/i, "");
  const lista = [];
  if (piezas.descargo) lista.push("descargo del investigado");
  else if (piezas.acta_no_descargo) lista.push("acta de no recepción de descargo");
  lista.push(`notificación de imputación de infracción leve${codigo ? ` (L-${codigo})` : ""}`);
  if (piezas.notificacion_firmada) lista.push("notificación de la orden de sanción");
  if (lista.length === 1) return lista[0];
  return `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}`;
}

/** "Omar Alberto VENTURA ROMAN" -> "PCQS", como firma el oficio. */
export function inicialesDe(nombre = "") {
  return String(nombre)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter((p) => p.length > 1 && !["DE", "DEL", "LA", "LAS", "LOS", "PNP"].includes(p.toUpperCase()))
    .map((p) => p[0].toUpperCase())
    .join("");
}

/** Grado y nombre como los escribe el oficio: "S3 PNP Nombres APELLIDOS". */
function personaConGrado(grado, apellidos, nombres) {
  const visible = nombreCompletoVisible(apellidos, nombres);
  // Si el grado ya trae «PNP» (p. ej. «S3 PNP») no se repite: «S3 PNP PNP».
  const soloGrado = String(grado || "").replace(/\bPNP\b/gi, "").trim();
  return `${soloGrado} PNP ${visible}`.replace(/\s+/g, " ").trim();
}

/**
 * Todo lo que necesita la plantilla. Lo que no se puede componer se devuelve
 * vacío a propósito: es preferible un hueco visible a un dato inventado en un
 * documento que se firma.
 */
export function datosDelOficio({
  nota, piezas = {}, jefe = {}, comisario = {}, sanciona = {},
  numeroOficio = "", fecha = "", redactadoPor = "",
} = {}) {
  // Son dos personas distintas y conviene no confundirlas: QUIEN IMPUSO la
  // sanción sale del propio caso (el oficial que constató y firmó la orden), y
  // QUIEN FIRMA el oficio es el comisario de turno, que se confirma a mano y
  // de quien salen las iniciales. En un caso pueden coincidir; en otro no.
  const impuso = sanciona.nombre ? sanciona : comisario;
  const firmante = String(comisario.nombre || "").trim();
  return {
    fecha: fechaEnLetras(fecha),
    numero_oficio: String(numeroOficio || "").trim(),
    jefe_grado: String(jefe.grado || "").trim(),
    jefe_nombre: String(jefe.nombre || "").trim(),
    jefe_cargo: String(jefe.cargo || "JEFE DE LA DIVOPUS 03 VENTANILLA").trim(),
    sancion: fraseDeSancion(nota?.sancion_dias, nota?.sancion_tipo),
    documentos: documentosRemitidos(piezas, nota?.codigo_infraccion),
    superior: [impuso.grado, "PNP", impuso.nombre].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    investigado: personaConGrado(nota?.grado, nota?.apellidos, nota?.nombres),
    iniciales: [inicialesDe(firmante), inicialesDe(redactadoPor).toLowerCase()].filter(Boolean).join("/"),
    // El bloque de firma del pie. En el modelo venía dentro de la imagen del
    // sello, con un nombre fijo: así, cada oficio habría salido firmado por
    // quien fuera comisario el día que se hizo la plantilla.
    comisario_oa: String(comisario.oa || "").trim().replace(/^(?!OA-)(\d)/, "OA-$1"),
    comisario_nombre: firmante,
    comisario_grado: [comisario.grado, "PNP"].filter(Boolean).join(" ").replace(/\s+PNP\s+PNP$/, " PNP").trim(),
    comisario_cargo: String(comisario.cargo || "COMISARIO DE VENTANILLA").trim(),
  };
}

/** Lo que falta por confirmar antes de poder generar, en palabras. */
export function faltaParaElOficio(datos = {}) {
  const falta = [];
  if (!String(datos.numero_oficio || "").trim()) falta.push("el número de oficio");
  if (!String(datos.jefe_nombre || "").trim()) falta.push("el jefe de la DIVOPUS");
  if (!String(datos.comisario_nombre || "").trim()) falta.push("el comisario que firma");
  if (!String(datos.comisario_oa || "").trim()) falta.push("el OA del comisario");
  if (!String(datos.superior || "").trim() || /^\s*PNP\s*$/.test(datos.superior)) falta.push("el oficial que impuso la sanción");
  if (!datos.sancion) falta.push("la sanción impuesta");
  if (!datos.fecha) falta.push("la fecha");
  return falta;
}

/** Genera el oficio a partir de la plantilla, con el membrete y el formato del modelo. */
export async function renderizarOficioRemisionDocx(datos) {
  const falta = faltaParaElOficio(datos);
  if (falta.length) throw new Error(`Falta ${falta.join(", ")}.`);
  const { PizZip, Docxtemplater } = await cargarDocxDeps();

  const respuesta = await fetch(new URL("../plantillas/plantilla_oficio_remision.docx", import.meta.url));
  if (!respuesta.ok) throw new Error("No se pudo cargar la plantilla del oficio de remisión.");

  const doc = new Docxtemplater(new PizZip(await respuesta.arrayBuffer()), {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(datos);

  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
