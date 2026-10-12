// Interpretación de lo que devuelve la IA al buscar a una persona en el rol de
// servicio (función extraer-puesto-rol). Funciones puras para probarlas con
// `node --test`; la pantalla solo pinta el resultado.

const ddmmaaaa = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

// Avisos según la sección del rol en la que figura la persona (los mismos de
// moral-y-disciplina): si no estaba de servicio, quizá no corresponde imputar.
export const AVISOS_SITUACION_ROL = {
  falto: "⚠ Figura en «FALTOS AL SERVICIO» del rol.",
  descanso_medico: "⚠ Figura con DESCANSO MÉDICO — ¿corresponde imputar?",
  vacaciones: "⚠ Figura de VACACIONES — la ausencia podría estar justificada.",
  permiso: "⚠ Figura con PERMISO — la ausencia podría estar justificada.",
  franco: "⚠ Figura de FRANCO ese día.",
  suspension: "⚠ Figura con SUSPENSIÓN TEMPORAL DEL SERVICIO.",
  otro: "⚠ Figura en las NOVEDADES del rol, sin puesto de servicio.",
};

/**
 * { puesto, mensaje }: el puesto a consignar (null si no corresponde) y lo que
 * se le dice al usuario. `fecha` es la fecha del hecho ("YYYY-MM-DD").
 */
export function interpretarResultadoRol(resultado, fecha) {
  const inicio = resultado?.fecha_rol_inicio || null;
  const fin = resultado?.fecha_rol_fin || inicio;
  if (inicio && fecha && (fecha < inicio || fecha > fin)) {
    const rango = fin && fin !== inicio ? `${ddmmaaaa(inicio)} a ${ddmmaaaa(fin)}` : ddmmaaaa(inicio);
    return { puesto: null, mensaje: `⚠ Ese rol es del ${rango} y el hecho es del ${ddmmaaaa(fecha)}. Use el rol de servicio de ese día.` };
  }
  const puesto = String(resultado?.puesto || "").replace(/\s+/g, " ").trim() || null;
  const situacion = resultado?.situacion;
  const deServicio = !situacion || situacion === "servicio" || situacion === "normal";
  if (puesto && deServicio) {
    return { puesto, mensaje: `✓ Puesto detectado${inicio ? ` (rol del ${ddmmaaaa(inicio)})` : ""}: ${puesto}. Verifíquelo antes de guardar.` };
  }
  if (resultado?.encontrado && deServicio) {
    return { puesto: null, mensaje: "Figura en el rol de ese día, pero su fila no indica puesto. Escríbalo a mano si corresponde." };
  }
  if (resultado?.encontrado && !deServicio) {
    const aviso = AVISOS_SITUACION_ROL[situacion] || AVISOS_SITUACION_ROL.otro;
    return { puesto: null, mensaje: `${aviso}${resultado.detalle_novedad ? ` (${resultado.detalle_novedad})` : ""}` };
  }
  return { puesto: null, mensaje: "No se ubicó a esta persona en el rol de ese día. Escriba el puesto a mano si corresponde." };
}

/**
 * El rol guardado que cubre la fecha del hecho. Si hay varios (un rol de 24 h
 * del día anterior también llega a esta fecha), se prefiere el que EMPIEZA ese
 * día: un hecho de día pertenece al rol de ese día.
 */
export function rolParaFecha(roles, fecha) {
  if (!fecha) return null;
  const cubren = (roles || []).filter((r) => r?.fecha && fecha >= r.fecha && fecha <= (r.fecha_fin || r.fecha));
  return cubren.find((r) => r.fecha === fecha) || cubren.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
}
