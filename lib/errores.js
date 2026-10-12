// Errores que la página manda al registro (registrar_error_app). Funciones puras.

// Ruido que no es de Faltos: extensiones del navegador, avisos internos de Chrome y
// el "Script error." opaco de scripts de otros sitios.
const IGNORAR = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /(chrome|moz|safari)-extension:\/\//i,
  /^Non-Error promise rejection captured/i,
];

const corto = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Quita la parte "?token=..." o "#access_token=..." de una dirección: no se guardan secretos. */
export function sinParametros(url) {
  return corto(String(url ?? "").split(/[?#]/)[0], 200);
}

/**
 * Convierte un evento del navegador en una fila para el registro, o null si es ruido.
 * tipo: "error" (fallo de programa), "promesa" (rechazo sin atender), "aviso" (mensaje
 * de error que vio la persona) o "csp" (bloqueo de la política de seguridad).
 */
export function normalizarError(tipo, { mensaje, archivo, linea, columna, pila } = {}) {
  const texto = corto(mensaje, 500);
  if (!texto || IGNORAR.some((r) => r.test(texto) || r.test(String(archivo || "")))) return null;
  let origen = "";
  if (archivo) origen = `${sinParametros(archivo).split("/").pop()}${linea ? `:${linea}` : ""}${columna ? `:${columna}` : ""}`;
  else if (pila) {
    const m = String(pila).match(/([\w.-]+\.m?js):(\d+):(\d+)/);
    if (m) origen = `${m[1]}:${m[2]}:${m[3]}`;
  }
  return { tipo, mensaje: texto, origen: corto(origen, 200) || null };
}

/** Evita mandar lo mismo dos veces y pone un tope por sesión de la página. */
export function crearLimitador(tope = 20) {
  const vistos = new Set();
  return (fila) => {
    if (!fila || vistos.size >= tope) return false;
    const clave = `${fila.tipo}|${fila.mensaje}|${fila.origen || ""}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  };
}
