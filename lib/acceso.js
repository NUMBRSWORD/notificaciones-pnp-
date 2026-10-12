// Reglas de clave para el acceso con CIP. Funciones puras (sin DOM ni red) para
// poder probarlas con `node --test`.
//
// Por qué existe: una cuenta puede quedar con una clave temporal. El cambio se
// exige en el SERVIDOR (migración cambio_clave_pendiente_en_servidor: una cuenta
// marcada no accede a ningún dato hasta cambiarla); esto solo permite mostrar la
// ventana de cambio en el mismo momento del ingreso y validar la clave nueva.

export const LARGO_MINIMO_CLAVE = 8;

// Lo escrito en el campo de usuario es un número puro (un CIP) y la clave es ese
// mismo número: es una clave temporal.
export function esClaveInicial(identificador, clave) {
  const id = String(identificador ?? "").trim();
  return /^\d+$/.test(id) && String(clave ?? "") === id;
}

// Devuelve el motivo por el que la clave nueva no sirve, o null si está bien.
// `claveActual` puede venir vacía (cambio voluntario, no se conoce): en ese caso
// es Supabase quien rechaza repetir la misma.
export function validarClaveNueva(nueva, repite, claveActual = "") {
  const n = String(nueva ?? "");
  if (n.length < LARGO_MINIMO_CLAVE) return `La clave nueva debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`;
  if (n !== String(repite ?? "")) return "Las dos claves no coinciden.";
  if (claveActual && n === String(claveActual)) return "La clave nueva debe ser distinta de la actual.";
  if (/^(.)\1+$/.test(n)) return "Elija una clave menos predecible: no un mismo carácter repetido.";
  if (/^\d+$/.test(n)) return "Incluya al menos una letra: una clave solo de números se adivina con facilidad (CIP, DNI).";
  return null;
}
