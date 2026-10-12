// Lectura directa (sin IA) del rol de servicio de la Comisaría PNP Ventanilla.
// Funciones puras, sin DOM ni red, para probarlas con `node --test`.
//
// Por qué existe: el rol es una tabla muy regular y su texto (el que extrae
// pdf.js) queda así, fila tras fila:
//
//   ... 58 S1 PNP APELLIDO APELLIDO Nombre Nombre SECTOR 02, SS02A PAT. TMP-0000 - CONDUCTOR 59 S2 PNP ...
//
// N° | grado | PNP | APELLIDOS en mayúsculas | Nombres con inicial mayúscula |
// PUESTO en mayúsculas. Con eso se ubica a la persona y su puesto de forma
// exacta, gratis y sin depender de la función de IA del servidor (que con su
// versión anterior no encontraba a personas que sí figuraban). La IA queda
// solo como respaldo cuando esta lectura no ubica a la persona.
//
// Entre filas aparecen encabezados de grupo ("TURNO DE ...", "PERSONAL PNP
// ADMINISTRATIVO ...", "GRUPO DE INVESTIGACIONES ...", "SERVICIO ELECCIONES
// ..."), que se recortan del puesto de la fila anterior. Quien no tiene puesto
// escrito en su fila pertenece al grupo de ese encabezado. Las filas bajo
// NOVEDADES no son puestos: indican descanso médico, faltos, vacaciones, etc.
//
// Se validó con 31 roles reales (set-oct 2026, ~4 500 filas).

const GRADOS = "MAY|MAYOR|CAP|CAPITAN|TNTE|TENIENTE|ALFZ|ALF|ALFEREZ|CRNL|CMDTE|COMDTE|SB|SS|ST1|ST2|ST3|S1|S2|S3";
const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };

// Mayúsculas sin tildes, carácter por carácter: cada posición del texto
// plegado corresponde a la misma del original.
function plegar(texto) {
  return Array.from(String(texto || ""), (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0) || c).join("").toUpperCase();
}
const palabras = (s) => plegar(s).split(/[^A-Z0-9]+/).filter(Boolean);
const limpiar = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/^[\s,;.\-–*]+|[\s,;.\-–*]+$/g, "");

// Encabezados que pueden quedar pegados al final del puesto de una fila.
const ENCABEZADOS = [
  /\bTURNO DE\b/, /\bPERSONAL PNP\b/, /\bNOVEDADES\b/, /\bVEHICULOS? (MOTORIZADOS|INOPERATIVOS)\b/,
  /\*\s*VEHICULO INOPERATIVO/, /\*?\s*(\d{1,3}\s+)?NO SE CUENTA CON PERSONAL/, /\bOTROS \(/, /\bRETEN\s*-/,
  /\bSECCION DE (INVESTIGACION DERIVADAS|PARTICIPACION CIUDADANA)\b/, /\bGRUPO DE INVESTIGACIONES\b/,
  /\bSERVICIO ELECCIONES\b/, /\bHORARIO DE FORMACION\b/, /\bPERSONAL DE APOYO\b(?=.*\bHORARIO\b)/,
  /\bVENTANILLA,\s*\d/, /\bROL DE SERVICIO DEL PERSONAL\b/, /\bMOTOCICLETAS INOP/,
];
// Restos que no son el nombre de un grupo de servicio.
const NO_ES_GRUPO = /NOVEDADES|NO SE CUENTA|VEHICULO|DESCANSO MEDICO|FALTOS|OTROS \(|ROL DE SERVICIO DEL PERSONAL|VENTANILLA,/;

/**
 * Arma el texto del rol según la POSICIÓN de cada fragmento en la hoja: de
 * arriba hacia abajo y, en cada renglón, de izquierda a derecha. pdf.js entrega
 * las filas en orden, pero los encabezados de sección (celdas combinadas:
 * "NOVEDADES", "PERSONAL PNP CON DESCANSO MEDICO", "SECCION DE ...") los deja
 * todos juntos al final de la página; así no se sabría en qué sección está
 * cada persona. `paginas`: por página, fragmentos { str, x, y, h } (y crece
 * hacia arriba, como en PDF).
 */
export function textoPorPosicion(paginas) {
  return (paginas || []).map((items) => {
    const orden = (items || []).filter((it) => it && String(it.str || "").trim())
      .map((it) => ({ str: String(it.str).trim(), x: Number(it.x) || 0, y: Number(it.y) || 0, h: Number(it.h) || 8 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const renglones = [];
    for (const it of orden) {
      const r = renglones.at(-1);
      if (r && Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.45)) r.items.push(it);
      else renglones.push({ y: it.y, h: it.h, items: [it] });
    }
    return renglones.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")).join("\n");
  }).join("\n");
}

/** Periodo del encabezado: "DEL 10OCT26 AL 11OCT26" -> { inicio, fin } en "YYYY-MM-DD". */
export function periodoDelRol(texto) {
  const m = /\bDEL\s+(\d{1,2})\s*([A-Z]{3})\s*(\d{2,4})\s+AL\s+(\d{1,2})\s*([A-Z]{3})\s*(\d{2,4})/.exec(plegar(texto).slice(0, 3000));
  if (!m) return { inicio: null, fin: null };
  const fecha = (d, mes, a) => {
    const n = MESES[mes];
    if (!n) return null;
    const anio = a.length === 2 ? `20${a}` : a;
    return `${anio}-${String(n).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  };
  return { inicio: fecha(m[1], m[2], m[3]), fin: fecha(m[4], m[5], m[6]) };
}

// Nombre de grupo a partir de un encabezado: sin horarios ni paréntesis.
function nombreDeGrupo(encabezado) {
  let s = String(encabezado || "");
  const corte = [/\s\(/, /\bTURNO DE\b/i, /\bHORARIO\b/i, /\bRETEN\s*-/i, /\b\d{1,2}:\d{2}/]
    .map((re) => re.exec(s)?.index ?? -1).filter((i) => i > 0);
  if (corte.length) s = s.slice(0, Math.min(...corte));
  s = limpiar(s);
  // Un horario suelto ("TURNO DE 07:00 A 07:00") no es un grupo de servicio.
  if (/^(TURNO|HORARIO|RETEN)\b/i.test(s)) return null;
  return s.length >= 6 ? s : null;
}

/**
 * Filas del rol con sus partes: posición, palabras de nombre (plegadas),
 * puesto propio y encabezado pegado al final ("cola").
 */
function filasDelRol(original, plano) {
  const inicioFila = new RegExp(`(?:^|\\s)(\\d{1,3})\\s+(?:${GRADOS})\\.?\\s+PNP\\.?\\s+`, "g");
  const marcas = [];
  let m;
  while ((m = inicioFila.exec(plano))) marcas.push({ cabeza: m.index, inicio: m.index + m[0].length });
  const palabraApellido = /^[\s,]*([A-ZÁÉÍÓÚÑÜ'’-]+)(?=[\s,]|$)/;
  const palabraNombre = /^[\s,]+([A-ZÁÉÍÓÚÑÜ][a-záéíóúñü'’]+|[A-ZÁÉÍÓÚÑ]\.)(?=[\s,]|$)/;
  return marcas.map((marca, i) => {
    const fin = i + 1 < marcas.length ? marcas[i + 1].cabeza : original.length;
    let pos = marca.inicio;
    const apellidos = [];
    const nombres = [];
    // Apellidos: palabras en MAYÚSCULAS hasta la primera palabra de nombre.
    for (let a; (a = palabraApellido.exec(original.slice(pos, fin)));) {
      apellidos.push(a[1]);
      pos += a[0].length;
      if (palabraNombre.test(original.slice(pos, fin))) break;
    }
    for (let n; (n = palabraNombre.exec(original.slice(pos, fin)));) { nombres.push(n[1]); pos += n[0].length; }
    // Sin nombres no se sabe dónde termina el nombre y empieza el puesto.
    const separable = nombres.length > 0;
    const restoPlano = plano.slice(pos, fin);
    let corte = restoPlano.length;
    for (const re of ENCABEZADOS) {
      const c = re.exec(restoPlano);
      if (c && c.index < corte) corte = c.index;
    }
    return {
      cabeza: marca.cabeza,
      apellidos: apellidos.map((p) => plegar(p).replace(/[^A-Z0-9]/g, "")).filter(Boolean),
      nombres: nombres.map((p) => plegar(p).replace(/[^A-Z]/g, "")),
      separable,
      puesto: separable ? limpiar(original.slice(pos, pos + corte)) : "",
      cola: separable ? limpiar(original.slice(pos + corte, fin)) : "",
    };
  });
}

function situacionPorSeccion(plano, posicion) {
  const antes = plano.slice(0, posicion);
  const ultima = (re) => { let ult = -1, m; const g = new RegExp(re.source, "g"); while ((m = g.exec(antes))) ult = m.index; return ult; };
  const novedades = ultima(/\bNOVEDADES\b/);
  if (novedades < 0) return "servicio";
  const secciones = [
    ["descanso_medico", ultima(/DESCANSO MEDICO/)],
    ["falto", ultima(/FALTOS AL SERVIC/)],
    ["otro", ultima(/\bOTROS \(/)],
  ].filter(([, i]) => i > novedades).sort((a, b) => b[1] - a[1]);
  return secciones[0]?.[0] || "otro";
}

// Grupo al que pertenece una fila sin puesto: el encabezado más cercano hacia
// arriba (quedó pegado al final de alguna fila anterior). Dentro de un grupo
// algunas filas tienen su tarea propia y otras no; las que no, son del grupo.
function grupoDeLaFila(filas, indice) {
  for (let j = indice - 1; j >= 0 && j >= indice - 30; j--) {
    const f = filas[j];
    if (f.cola) return NO_ES_GRUPO.test(plegar(f.cola)) ? null : nombreDeGrupo(f.cola);
  }
  return null;
}

function situacionPorContenido(texto) {
  const t = plegar(texto);
  if (!t) return null;
  if (/\bDX\b|DESCANSO MEDICO/.test(t)) return "descanso_medico";
  if (/VACACIONES/.test(t)) return "vacaciones";
  if (/NOTA INFORMATIVA N/.test(t)) return "falto";
  if (/\bPERMISO\b/.test(t)) return "permiso";
  if (/SUSPENSION TEMPORAL/.test(t)) return "suspension";
  if (/\bLICENCIA\b/.test(t)) return "otro";
  return null;
}

/**
 * Ubica a una persona en el texto del rol.
 * Devuelve la misma forma que la función de IA:
 * { encontrado, puesto, situacion, detalle_novedad, fecha_rol_inicio, fecha_rol_fin }.
 */
export function leerPuestoDelRol(texto, { apellidos, nombres } = {}) {
  const { inicio, fin } = periodoDelRol(texto);
  const base = { encontrado: false, puesto: null, situacion: null, detalle_novedad: null, fecha_rol_inicio: inicio, fecha_rol_fin: fin };
  const original = String(texto || "");
  if (original.length !== Array.from(original).length) return base; // caracteres fuera del plano básico
  const ap = palabras(apellidos);
  const nom = new Set(palabras(nombres));
  if (!ap.length) return base;
  const plano = plegar(original);
  const filas = filasDelRol(original, plano);

  const candidatas = [];
  filas.forEach((fila, i) => {
    if (!fila.separable) return;
    if (fila.apellidos.join(" ") !== ap.join(" ")) return;
    const coincidenNombres = fila.nombres.filter((n) => nom.has(n)).length;
    const puesto = fila.puesto || grupoDeLaFila(filas, i) || "";
    candidatas.push({ fila, puesto, coincidenNombres, situacion: situacionPorSeccion(plano, fila.cabeza) });
  });
  if (!candidatas.length) return base;
  candidatas.sort((a, b) => b.coincidenNombres - a.coincidenNombres);
  const [primera, segunda] = candidatas;
  // Mismos apellidos en dos filas: si no se distinguen por los nombres y dicen
  // cosas distintas, es ambiguo y decide la IA o la persona. (A veces el rol
  // repite a la misma persona con el mismo puesto: eso no es ambiguo.)
  if (segunda && segunda.coincidenNombres === primera.coincidenNombres
    && (segunda.puesto !== primera.puesto || segunda.situacion !== primera.situacion)) return base;

  const { puesto } = primera;
  let { situacion } = primera;
  // Respaldo para textos guardados con el orden de pdf.js (encabezados de
  // sección fuera de lugar): lo que dice la propia fila delata la novedad.
  if (situacion === "servicio") situacion = situacionPorContenido(primera.fila.puesto) || "servicio";
  if (situacion !== "servicio") {
    const detalle = primera.fila.puesto || null;
    let sit = situacion;
    if (sit === "otro" && detalle) {
      const d = plegar(detalle);
      if (/VACACION/.test(d)) sit = "vacaciones";
      else if (/PERMISO/.test(d)) sit = "permiso";
      else if (/FRANCO/.test(d)) sit = "franco";
      else if (/SUSPENSION/.test(d)) sit = "suspension";
    }
    return { ...base, encontrado: true, situacion: sit, detalle_novedad: detalle };
  }
  return { ...base, encontrado: true, puesto: puesto || null, situacion: "servicio" };
}
