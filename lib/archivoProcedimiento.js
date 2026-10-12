import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { hoyLima, fechaLima } from "./fechas.js";
import { buscarOficialConstato, conPnp, fechaLarga } from "./imputacion.js";
import { nombreCompletoVisible, nombreParaSello, normalizarMencionInvestigado, splitApellidosNombres } from "./utils.js";

// Archivo del Procedimiento: alternativa a la Orden cuando el descargo y los
// actuados muestran que el hecho no se adecúa a una infracción leve.
export function puedeGenerarArchivoProcedimiento(caso, efectivos) {
  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  return Boolean(codigo && getInfraccion(codigo) && caso.imputacion_generada_at && caso.fecha_descargo && !caso.sancion_generada_at && !caso.archivo_procedimiento_generado_at && buscarOficialConstato(caso.oficial_constato, efectivos));
}

export function construirDatosArchivoProcedimiento(caso, efectivos, seleccion) {
  const codigo = normalizarCodigoInfraccion(caso.codigo_infraccion);
  if (!getInfraccion(codigo)) throw new Error("El Archivo del Procedimiento solo corresponde a una infracción leve válida.");
  if (!caso.fecha_descargo) throw new Error("Primero registre el descargo que será evaluado.");
  if (caso.sancion_generada_at) throw new Error("Este caso ya tiene una Orden de Sanción; no corresponde archivarlo.");
  if (!seleccion?.motivoTexto?.trim()) throw new Error("Escriba el motivo del archivo.");
  if (!seleccion?.resolucionNumero?.trim()) throw new Error("Escriba el número de resolución.");
  const superior = buscarOficialConstato(caso.oficial_constato, efectivos);
  if (!superior) throw new Error("No se ubica al oficial que constató el hecho en Efectivos.");
  const base = normalizarMencionInvestigado(caso.descripcion_hecho || "", caso.apellidos, caso.nombres);
  const puesto = String(caso.puesto_rol || "").trim();
  const hecho = puesto ? `${base}\n\nConforme al rol de servicio del día, al investigado se le asignó: ${puesto}.` : base;
  const separacion = splitApellidosNombres(superior.apellidos_nombres);
  return {
    resolucion_numero: seleccion.resolucionNumero.trim(),
    lugar_fecha: `Ventanilla, ${fechaLarga(hoyLima())}`,
    investigado_completo: `${conPnp(caso.grado)} ${nombreCompletoVisible(caso.apellidos, caso.nombres)}`.replace(/\s+/g, " ").trim(),
    codigo_imputado: codigo.replace(/^L(\d+)$/, "L-$1"),
    hecho_completo: hecho,
    fecha_notificacion: fechaLarga(fechaLima(caso.imputacion_generada_at)),
    motivo_archivo: normalizarMencionInvestigado(seleccion.motivoTexto.trim(), caso.apellidos, caso.nombres),
    signer_oa: `OA-${String(superior.cip || "").replace(/\D+/g, "")}`,
    signer_nombre: nombreParaSello(separacion.apellidos, separacion.nombres),
    signer_grado: conPnp(superior.grado).toUpperCase(),
  };
}

export async function renderizarArchivoProcedimientoDocx(caso, efectivos, seleccion) {
  const datos = construirDatosArchivoProcedimiento(caso, efectivos, seleccion);
  const respuesta = await fetch(new URL("../plantillas/plantilla_archivo_leve.docx", import.meta.url));
  if (!respuesta.ok) throw new Error("No se pudo cargar la plantilla del Archivo del Procedimiento.");
  const zip = new PizZip(await respuesta.arrayBuffer());
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{", end: "}" } });
  doc.render(datos);
  return doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}