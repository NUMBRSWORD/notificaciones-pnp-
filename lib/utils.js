// Funciones puras, sin ninguna dependencia externa (nada de Supabase, DOM, ni
// paquetes vía CDN) -- se separaron de imputacion.js/actaNoDescargo.js para
// que se puedan probar con `node --test` sin necesitar un navegador ni red.

const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

// Grados que se consideran parte del "grado" y no del nombre, al intentar
// ubicar en `efectivos` a la persona mencionada en un texto libre (p.ej.
// "TNTE. ZEGOBIA QUISPE Antony" o "S2 PNP RAMIREZ CANDIA").
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
// los apellidos en MAYÚSCULAS (p.ej. "Manuel Angelo SOLIS GONZALES").
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
export function siguienteDiaHabil(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  while (esFinDeSemana(dt.toISOString().slice(0, 10))) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export function fechaLimiteDescargo(caso) {
  if (!caso.imputacion_generada_at) return null;
  return siguienteDiaHabil(caso.imputacion_generada_at.slice(0, 10));
}

export function plazoDescargoVencido(caso, hoyISO) {
  if (!caso.imputacion_generada_at) return false;
  const hoy = hoyISO || new Date().toISOString().slice(0, 10);
  const fechaNotif = caso.imputacion_generada_at.slice(0, 10);
  const limite = siguienteDiaHabil(fechaNotif);
  return hoy > limite;
}
