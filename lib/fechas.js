// Fechas y días hábiles en hora de Lima. Funciones puras (sin DOM ni red) para
// poder probarlas con `node --test`.
//
// Por qué existe: `new Date().toISOString().slice(0, 10)` da la fecha en UTC, y
// Lima es UTC-5 todo el año (el Perú no usa horario de verano). Después de las
// 19:00 en Lima esa expresión devolvía la fecha de MAÑANA: el plazo de descargo
// se daba por vencido unas 5 horas antes de tiempo y los documentos generados de
// noche salían con la fecha del día siguiente. Toda fecha "de hoy" o sacada de
// un instante (timestamp) debe pasar por hoyLima() / fechaLima().

const DESFASE_LIMA_MS = -5 * 3600 * 1000;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// "YYYY-MM-DD" de Lima para un instante (Date, timestamp ISO o milisegundos).
// Una fecha sola ("2026-09-10") ya es una fecha de calendario y se devuelve igual.
export function fechaLima(instante) {
  if (typeof instante === "string" && /^\d{4}-\d{2}-\d{2}$/.test(instante)) return instante;
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return "";
  return iso(d.getTime() + DESFASE_LIMA_MS);
}

export function hoyLima(ahora = new Date()) {
  return fechaLima(ahora);
}

// "HH:MM" de Lima para un instante.
export function horaLima(instante = new Date()) {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + DESFASE_LIMA_MS).toISOString().slice(11, 16);
}

// Domingo de Pascua (algoritmo de Meeus/Jones/Butcher), como milisegundos UTC.
function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(anio, mes - 1, dia);
}

// Feriados nacionales de fecha fija (MM-DD).
const FERIADOS_FIJOS = [
  "01-01", // Año Nuevo
  "05-01", // Día del Trabajo
  "06-07", // Batalla de Arica y Día de la Bandera
  "06-29", // San Pedro y San Pablo
  "07-23", // Día de la Fuerza Aérea del Perú
  "07-28", "07-29", // Fiestas Patrias
  "08-06", // Batalla de Junín
  "08-30", // Santa Rosa de Lima
  "10-08", // Combate de Angamos
  "11-01", // Todos los Santos
  "12-08", // Inmaculada Concepción
  "12-09", // Batalla de Ayacucho
  "12-25", // Navidad
];

// Días no laborables que el Poder Ejecutivo declara cada año por decreto para el
// sector público (los "puentes"), y feriados regionales que apliquen. El TUO de la
// Ley 27444 (art. 134.1) los excluye del cómputo igual que a los feriados. Se
// mantienen a mano: agregar aquí cada fecha "YYYY-MM-DD" cuando se publique el
// decreto. Ejemplo: "2026-10-09".
export const DIAS_NO_LABORABLES_EXTRA = [];

const cache = new Map();

// Set de fechas "YYYY-MM-DD" feriadas de un año: fijas + Jueves y Viernes Santo.
export function feriadosNacionales(anio) {
  if (!cache.has(anio)) {
    const set = new Set(FERIADOS_FIJOS.map((f) => `${anio}-${f}`));
    const domingoPascua = pascua(anio);
    set.add(iso(domingoPascua - 3 * 86400000)); // Jueves Santo
    set.add(iso(domingoPascua - 2 * 86400000)); // Viernes Santo
    cache.set(anio, set);
  }
  return cache.get(anio);
}

export function esFeriado(fechaISO) {
  const anio = Number(String(fechaISO).slice(0, 4));
  return feriadosNacionales(anio).has(fechaISO) || DIAS_NO_LABORABLES_EXTRA.includes(fechaISO);
}

export function esFinDeSemanaISO(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

// Día hábil = ni sábado ni domingo ni feriado ni día no laborable declarado.
export function esDiaHabil(fechaISO) {
  return !esFinDeSemanaISO(fechaISO) && !esFeriado(fechaISO);
}

// Primer día hábil DESPUÉS de la fecha dada ("un día hábil, a partir del día
// siguiente hábil de notificado").
export function siguienteDiaHabil(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  let ms = Date.UTC(y, m - 1, d) + 86400000;
  while (!esDiaHabil(iso(ms))) ms += 86400000;
  return iso(ms);
}
