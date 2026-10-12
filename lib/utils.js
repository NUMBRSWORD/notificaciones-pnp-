import { fechaLima, hoyLima, siguienteDiaHabil } from "./fechas.js";
// Funciones puras, sin ninguna dependencia externa (nada de Supabase, DOM, ni
// paquetes vía CDN) -- se separaron de imputacion.js/actaNoDescargo.js para
// que se puedan probar con `node --test` sin necesitar un navegador ni red.

const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

// Grados que se consideran parte del "grado" y no del nombre, al intentar
// ubicar en `efectivos` a la persona mencionada en un texto libre (p.ej.
// "TNTE. MENDOZA QUISPE Antonio" o "S2 PNP CASTRO LEON").
const GRADOS = new Set([
  "GRAL", "TGRAL", "CGRAL", "CRNL", "CORONEL", "CMDTE", "CMDT", "COMANDANTE",
  "MY", "MAY", "MAYOR", "CAP", "CAPITAN", "TNTE", "TTE", "TENIENTE",
  "ALF", "ALFZ", "ALFEREZ", "SO", "SOB", "SOT", "SO1", "SO2", "SO3",
  "S1", "S2", "S3", "ST1", "ST2", "ST3", "SS", "SB", "PNP", "EST", "CADETE", "SUBOF",
]);

export function soloDigitos(s) {
  return (s || "").replace(/\D+/g, "");
}

// Añade "PNP" al grado para el sello/cuerpo del documento, sin duplicarlo.
export function conPnp(grado) {
  const g = (grado || "").replace(/\.$/, "").trim();
  return /\bPNP\b$/i.test(g) ? g : `${g} PNP`.trim();
}

// Una mayúscula por palabra ("ALDO CANZIANI" -> "Aldo Canziani"). Para cuando
// solo se necesita formatear el campo de nombres a secas (p.ej. plantillas
// que reciben apellidos y nombres en placeholders separados).
export function tituloPorPalabra(s) {
  return (s || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// Convierte el dato del padrón "APELLIDOS,NOMBRES" al formato visible
// "Nombres APELLIDOS". No altera el dato guardado ni el criterio de búsqueda.
export function limpiarNombreVisible(s) {
  const limpio = (s || "").replace(/,\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (!limpio) return limpio;

  const tieneComa = limpio.includes(",");
  let apellidos, nombres;
  if (tieneComa) {
    const idx = limpio.indexOf(",");
    apellidos = limpio.slice(0, idx).trim();
    nombres = limpio.slice(idx + 1).trim();
  } else {
    const palabras = limpio.split(" ");
    if (palabras.length <= 2) return limpio.toUpperCase();
    apellidos = palabras.slice(0, 2).join(" ");
    nombres = palabras.slice(2).join(" ");
  }
  if (!nombres) return apellidos.toUpperCase();
  return `${tituloPorPalabra(nombres)} ${apellidos.toUpperCase()}`.trim();
}

// Mismo formato para los campos separados de un investigado: nombres primero
// y apellidos en MAYÚSCULAS después. El parámetro separador se mantiene por
// compatibilidad.
export function nombreCompletoVisible(apellidos, nombres, separador = " ") {
  const apMayus = (apellidos || "").trim().toUpperCase();
  const noTitulo = tituloPorPalabra(nombres);
  return noTitulo ? `${noTitulo}${separador}${apMayus}`.trim() : apMayus;
}

// Formato reservado para el sello de firma: los nombres en formato título y
// los apellidos en MAYÚSCULAS (p.ej. "Carlos Alberto ROJAS VEGA").
export function nombreParaSello(apellidos, nombres) {
  const apellidosMayus = (apellidos || "").trim().toUpperCase();
  const nombresTitulo = tituloPorPalabra(nombres);
  return nombresTitulo ? `${nombresTitulo} ${apellidosMayus}`.trim() : apellidosMayus;
}

// Normaliza dentro de un texto libre las menciones al investigado. Es útil
// para análisis o descripciones ya redactados por IA que pueden traer el
// orden anterior "APELLIDOS Nombres".
export function normalizarMencionInvestigado(texto, apellidos, nombres) {
  const original = texto || "";
  const apellidosLimpios = (apellidos || "").trim();
  const nombresLimpios = (nombres || "").trim();
  if (!original || !apellidosLimpios || !nombresLimpios) return original;

  const patron = (valor) => valor
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const formato = nombreCompletoVisible(apellidosLimpios, nombresLimpios);
  const nombresLuegoApellidos = new RegExp(`\\b${patron(nombresLimpios)}\\s+${patron(apellidosLimpios)}\\b`, "gi");
  const apellidosLuegoNombres = new RegExp(`\\b${patron(apellidosLimpios)}\\s+${patron(nombresLimpios)}\\b`, "gi");

  return original
    .replace(nombresLuegoApellidos, formato)
    .replace(apellidosLuegoNombres, formato);
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

export function normalizarTexto(s) {
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

// Ubica en `efectivos` a la persona mencionada en un texto libre, ignorando
// las palabras que sean grado y comparando el resto contra apellidos_nombres.
// Requiere al menos 2 palabras en común (p.ej. los dos apellidos).
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

// Separa "apellidos_nombres" en sus dos partes. Si trae coma corta ahí; si
// no, asume que las primeras 1-2 palabras son los apellidos.
// El efectivo que se buscó por CIP/DNI (consulta puntual al servidor) solo vale
// para el caso si los apellidos y nombres que quedaron escritos en el formulario
// siguen siendo los suyos (misma regla que buscarInvestigado: al menos 2
// palabras en común). Si la persona cambió el nombre a mano, no se le asigna el
// CIP de otro. Devuelve el CIP o null.
export function cipDelEfectivoBuscado(apellidos, nombres, buscado) {
  if (!buscado?.cip || !apellidos) return null;
  const objetivo = tokens(`${apellidos} ${nombres}`);
  const delEfectivo = new Set(tokens(buscado.apellidos_nombres));
  return objetivo.filter((t) => delEfectivo.has(t)).length >= 2 ? buscado.cip : null;
}

// Qué le pasó a la consulta buscar_efectivo: "sin_funcion" si el servidor aún no
// tiene la función (falta correr busqueda_efectivos_oficiales.sql), "error" para
// cualquier otro fallo, null si no hubo error. Sirve para que la pantalla diga
// qué falta en vez de afirmar que la persona no existe.
export function tipoFalloBusqueda(error) {
  if (!error) return null;
  const texto = String(error.message || "");
  return error.code === "PGRST202" || /could not find the function/i.test(texto) ? "sin_funcion" : "error";
}

export function splitApellidosNombres(full) {
  const txt = (full || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (txt.includes(",")) {
    const [ap, no] = txt.split(",");
    return { apellidos: ap.trim(), nombres: (no || "").trim() };
  }
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return { apellidos: txt, nombres: "" };
  return { apellidos: words.slice(0, 2).join(" "), nombres: words.slice(2).join(" ") };
}

// Se construye con Date.UTC/getUTCDay para que el cálculo del día de la
// semana no dependa de la zona horaria del navegador.
export function esFinDeSemana(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

// "Un (01) día hábil, a partir de las 08:00 horas del día siguiente hábil de notificado".
// Salta también feriados y días no laborables (TUO Ley 27444, art. 134.1) y
// toma las fechas en hora de Lima: ver lib/fechas.js.
export { siguienteDiaHabil };

export function fechaLimiteDescargo(caso) {
  if (!caso.imputacion_generada_at) return null;
  return siguienteDiaHabil(fechaLima(caso.imputacion_generada_at));
}

export function plazoDescargoVencido(caso, hoyISO) {
  if (!caso.imputacion_generada_at) return false;
  const hoy = hoyISO || hoyLima();
  const limite = siguienteDiaHabil(fechaLima(caso.imputacion_generada_at));
  return hoy > limite;
}

// "45-2026", "045-2026" o el código completo que trae el documento
// ("045-2026-COMOPPOL-PNP/...") -> "045-2026". Vacío si no se reconoce: un
// número a medias en un oficio es peor que pedir corregirlo.
export function normalizarNumeroOficio(texto = "") {
  const m = String(texto || "").match(/(?:^|[^0-9])0*([0-9]{1,4})\s*-\s*(20[0-9]{2})(?![0-9])/);
  if (!m) return "";
  const correlativo = Number(m[1]);
  if (!correlativo) return "";
  return `${String(correlativo).padStart(3, "0")}-${m[2]}`;
}

// Sanción registrada en el caso ("amonestacion" o los días como texto, según el
// tercio elegido en la Orden) en la forma que usa el oficio de remisión.
export function sancionDelCaso(caso) {
  const etiqueta = String(caso?.sancion_tercio_label || "").trim().toLowerCase();
  if (!etiqueta) return { sancion_dias: null, sancion_tipo: null };
  if (etiqueta === "amonestacion") return { sancion_dias: 0, sancion_tipo: "amonestacion" };
  const dias = Number(etiqueta);
  return Number.isInteger(dias) && dias > 0 ? { sancion_dias: dias, sancion_tipo: "simple" } : { sancion_dias: null, sancion_tipo: null };
}

const MESES_COMPACTOS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];

// "2026-09-10" -> "10SET2026", como lo escriben los roles y las notas de la comisaría.
export function fechaCompacta(fechaISO) {
  const m = String(fechaISO || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}${MESES_COMPACTOS[Number(m[2]) - 1]}${m[1]}`;
}

// Puesto del rol de servicio DENTRO de la redacción del hecho, con la fórmula
// de moral-y-disciplina ("se encontraba nombrado según el rol de servicio de
// la Comisaría PNP Ventanilla ... en el servicio de ..."). Antes se pegaba como
// un párrafo aparte ("al investigado se le asignó: ..."): rompía la hilación y,
// por el salto de línea dentro del párrafo justificado, Word estiraba la última
// línea del hecho.
//
// Se intercala como aposición justo después de la primera mención del
// investigado: "...el investigado, S3 PNP Juan PEREZ LOPEZ, quien según el rol
// de servicio ... se encontraba nombrado en el servicio «...», manifestó...".
// Si el hecho no lo nombra, se intercala tras "el investigado"; si tampoco,
// va como última oración del MISMO párrafo.
export function hechoConRolDeServicio(hecho, caso) {
  const texto = String(hecho || "").trim();
  const puesto = String(caso?.puesto_rol || "").replace(/\s+/g, " ").trim().replace(/[.;,:]+$/, "").replace(/[«»"]/g, "");
  if (!puesto) return texto;
  const fecha = fechaCompacta(caso?.fecha_hecho);
  const rol = `según el rol de servicio de la Comisaría PNP Ventanilla${fecha ? ` del ${fecha}` : ""}`;
  if (!texto) return `El investigado, ${rol}, se encontraba nombrado en el servicio «${puesto}».`;
  // Si la descripción ya cita el rol (p. ej. la redactó «Mejorar con IA»), no se repite.
  if (yaMencionaRol(texto, puesto)) return texto;

  const fin = finDeMencionInvestigado(texto, caso);
  if (fin !== null) {
    const siguiente = texto.slice(fin).match(/^\s*([,.;:)])?/);
    // Si tras la mención ya viene una coma, esa misma cierra la aposición.
    const cierre = siguiente?.[1] ? "" : ",";
    return `${texto.slice(0, fin)}, quien ${rol} se encontraba nombrado en el servicio «${puesto}»${cierre}${texto.slice(fin)}`;
  }
  const conPunto = /[.!?]$/.test(texto) ? texto : `${texto}.`;
  return `${conPunto} Cabe precisar que, ${rol}, el investigado se encontraba nombrado en el servicio «${puesto}».`;
}

// ¿El texto ya menciona el rol de servicio o el propio puesto?
export function yaMencionaRol(texto, puesto) {
  const soloLetras = (s) => plegar(String(s || "")).replace(/[^A-Z0-9]+/g, " ").trim();
  const t = ` ${soloLetras(texto)} `;
  const p = soloLetras(puesto);
  return t.includes(" ROL DE SERVICIO ") || (p.length >= 6 && t.includes(` ${p} `));
}

// Quita tildes y pasa a mayúsculas carácter por carácter, para que cada
// posición del texto plegado sea la misma que en el original.
function plegar(texto) {
  return Array.from(texto, (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0) || c).join("").toUpperCase();
}

// Posición donde termina la primera mención del investigado en el texto, o
// null. Se ubican sus apellidos (sin importar tildes ni mayúsculas) y se
// extiende sobre los nombres que vengan justo después ("PEREZ LOPEZ Juan").
function finDeMencionInvestigado(texto, caso) {
  if (texto.length !== Array.from(texto).length) return null; // caracteres fuera del plano básico: no se arriesga
  const plano = plegar(texto);
  const palabras = (s) => plegar(String(s || "")).split(/[^A-Z0-9Ñ]+/).filter((p) => p.length > 1);
  const apellidos = palabras(caso?.apellidos);
  const nombres = new Set(palabras(caso?.nombres));
  if (apellidos.length) {
    const patron = new RegExp(`(^|[^A-Z0-9Ñ])(${apellidos.join("[\\s,]+")})(?=$|[^A-Z0-9Ñ])`);
    const m = patron.exec(plano);
    if (m) {
      let fin = m.index + m[1].length + m[2].length;
      // Nombres a continuación (formato "APELLIDOS Nombres" o "APELLIDOS, Nombres").
      for (;;) {
        const sig = /^[\s,]+([A-Z0-9Ñ]+)/.exec(plano.slice(fin));
        if (!sig || !nombres.has(sig[1])) break;
        fin += sig[0].length;
      }
      return fin;
    }
  }
  const generico = /(^|[^A-Z0-9Ñ])(EL|AL|DEL) INVESTIGADO(?=$|[^A-Z0-9Ñ])/.exec(plano);
  return generico ? generico.index + generico[0].length : null;
}
