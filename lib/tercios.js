// Calcula las opciones de tercio de sanción (mínimo/medio/máximo) leyendo el
// texto libre del campo "sancion" del Anexo I, en vez de tenerlas tipeadas a
// mano código por código (como hacía moral-y-disciplina, y solo para L21/L24).
// Cubre los 4 patrones que realmente aparecen en las 117 infracciones Leves:
//   "Desde amonestación hasta N días de Sanción Simple."
//   "De Amonestación a N días de Sanción Simple."
//   "De X a Y días de Sanción Simple."
// Si el texto no calza con ninguno (redacción distinta a futuro), devuelve
// null y el llamador debe tratarlo como "no se pudo determinar el tercio".

const NUMEROS_TEXTO = {
  1: "uno", 2: "dos", 3: "tres", 4: "cuatro", 5: "cinco",
  6: "seis", 7: "siete", 8: "ocho", 9: "nueve", 10: "diez",
  11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
};

function diasFragmento(n) {
  const texto = NUMEROS_TEXTO[n] || String(n);
  const numeroPadded = String(n).padStart(2, "0");
  return {
    fragmento: `${texto} (${numeroPadded}) días de Sanción Simple`,
    label: `${texto.charAt(0).toUpperCase()}${texto.slice(1)} (${numeroPadded}) días de Sanción Simple`,
  };
}

export function opcionesTercioDesdeSancion(sancionTexto) {
  const texto = (sancionTexto || "").trim();
  if (!texto) return null;

  // "Desde amonestación hasta N días..." / "De Amonestación a N días..."
  let m = texto.match(/amonestaci[oó]n\D+(\d+)\s*d[ií]as/i);
  if (m) {
    const max = Number(m[1]);
    const medio = Math.max(1, Math.round(max / 2));
    const dMax = diasFragmento(max);
    const opciones = [
      { value: "amonestacion", label: "Amonestación (tercio inferior)", fragmento: "amonestación", extremo: "mínimo" },
    ];
    if (medio !== max) {
      const dMedio = diasFragmento(medio);
      opciones.push({ value: String(medio), label: `${dMedio.label} (tercio medio)`, fragmento: dMedio.fragmento, extremo: "medio" });
    }
    opciones.push({ value: String(max), label: `${dMax.label} (tercio superior)`, fragmento: dMax.fragmento, extremo: "máximo" });
    return opciones;
  }

  // "De X a Y días..."
  m = texto.match(/de\s+(\d+)\s+a\s+(\d+)\s*d[ií]as/i);
  if (m) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    const medio = Math.round((min + max) / 2);
    const dMin = diasFragmento(min);
    const dMax = diasFragmento(max);
    const opciones = [
      { value: String(min), label: `${dMin.label} (tercio inferior)`, fragmento: dMin.fragmento, extremo: "mínimo" },
    ];
    if (medio !== min && medio !== max) {
      const dMedio = diasFragmento(medio);
      opciones.push({ value: String(medio), label: `${dMedio.label} (tercio medio)`, fragmento: dMedio.fragmento, extremo: "medio" });
    }
    opciones.push({ value: String(max), label: `${dMax.label} (tercio superior)`, fragmento: dMax.fragmento, extremo: "máximo" });
    return opciones;
  }

  return null;
}
