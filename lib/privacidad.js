// Minimización de datos personales antes de enviar algo a la IA (que corre fuera del
// Perú). Funciones puras (sin DOM ni red) para poder probarlas con `node --test`.
//
// El resumen ejecutivo no necesita los NOMBRES para redactar: le basta distinguir a
// una persona de otra. Cada investigado se envía como "E01", "E02"… (la misma
// persona conserva el mismo alias) y al recibir el texto se vuelven a poner los
// nombres, solo en el navegador. Ley 29733 (proporcionalidad y transferencia
// transfronteriza) y art. 26 del Reglamento de la Ley 31814 (privacidad desde el diseño).

// Reemplaza `investigado` por un alias estable. Devuelve los casos con alias y el
// mapa alias -> nombre real (que NO sale del navegador).
export function seudonimizarInvestigados(casos) {
  const aliasPorNombre = new Map();
  const mapa = new Map();
  const conAlias = (casos || []).map((c) => {
    const nombre = String(c?.investigado ?? "");
    if (!aliasPorNombre.has(nombre)) {
      const alias = `E${String(aliasPorNombre.size + 1).padStart(2, "0")}`;
      aliasPorNombre.set(nombre, alias);
      mapa.set(alias, nombre);
    }
    return { ...c, investigado: aliasPorNombre.get(nombre) };
  });
  return { casos: conAlias, mapa };
}

// Devuelve el texto de la IA con los alias cambiados por los nombres reales.
// Un "E07" que no esté en el mapa se deja tal cual.
export function restaurarNombres(texto, mapa) {
  return String(texto ?? "").replace(/\bE\d{2,}\b/g, (alias) => (mapa.has(alias) ? mapa.get(alias) : alias));
}
