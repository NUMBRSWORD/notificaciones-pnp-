// Corre con: node --test lib/*.test.js
// Sin dependencias -- node:test y node:assert vienen incluidos en Node.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conPnp, limpiarNombreVisible, nombreCompletoVisible, nombreParaSello, normalizarMencionInvestigado, tokens, buscarOficialConstato, splitApellidosNombres,
  fechaLarga, fechaCorta, cipDelEfectivoBuscado, tipoFalloBusqueda,
  esFinDeSemana, siguienteDiaHabil, plazoDescargoVencido, fechaLimiteDescargo,
  normalizarNumeroOficio, sancionDelCaso, fechaCompacta, hechoConRolDeServicio,
} from "./utils.js";

describe("conPnp", () => {
  test("agrega PNP cuando falta", () => {
    assert.equal(conPnp("S2"), "S2 PNP");
  });
  test("no lo duplica si ya lo tiene", () => {
    assert.equal(conPnp("TENIENTE PNP"), "TENIENTE PNP");
  });
});

describe("limpiarNombreVisible", () => {
  test("muestra primero nombres y luego apellidos (con coma)", () => {
    assert.equal(limpiarNombreVisible("ROJAS GUINEA,ALDO CANZIANI"), "Aldo Canziani ROJAS GUINEA");
  });
  test("muestra primero nombres y luego apellidos (sin coma)", () => {
    assert.equal(limpiarNombreVisible("MENDOZA QUISPE ANTONIO"), "Antonio MENDOZA QUISPE");
  });
  test("sin nombres identificables, aplica formato título", () => {
    assert.equal(limpiarNombreVisible("MENDOZA QUISPE"), "MENDOZA QUISPE");
  });
});

describe("nombreParaSello", () => {
  test("mantiene los nombres en formato título y pone los apellidos en mayúsculas", () => {
    assert.equal(nombreParaSello("ROJAS VEGA", "CARLOS ALBERTO"), "Carlos Alberto ROJAS VEGA");
  });
});

describe("nombreCompletoVisible", () => {
  test("usa nombres en formato título y apellidos en mayúsculas", () => {
    assert.equal(nombreCompletoVisible("SALGADO CHOQUE", "FREDDY"), "Freddy SALGADO CHOQUE");
  });
});

describe("normalizarMencionInvestigado", () => {
  test("corrige las dos formas anteriores dentro de un texto libre", () => {
    const fuente = "El ST1 PNP SALGADO CHOQUE Freddy fue notificado. Freddy Salgado Choque presentó su descargo.";
    assert.equal(
      normalizarMencionInvestigado(fuente, "SALGADO CHOQUE", "FREDDY"),
      "El ST1 PNP Freddy SALGADO CHOQUE fue notificado. Freddy SALGADO CHOQUE presentó su descargo.",
    );
  });
});

describe("tokens", () => {
  test("quita tildes, puntuación y mayúsculas todo", () => {
    assert.deepEqual(tokens("TNTE. Méndoza Quíspe Antonio"), ["TNTE", "MENDOZA", "QUISPE", "ANTONIO"]);
  });
});

describe("buscarOficialConstato", () => {
  const efectivos = [
    { cip: "400006", apellidos_nombres: "MENDOZA QUISPE ANTONIO", grado: "TENIENTE PNP" },
    { cip: "363060", apellidos_nombres: "RAMOS VALDEZ, IRVING", grado: "CAPITAN PNP" },
  ];
  test("empareja ignorando el grado", () => {
    assert.equal(buscarOficialConstato("TNTE. MENDOZA QUISPE Antonio", efectivos)?.cip, "400006");
    assert.equal(buscarOficialConstato("CAP. RAMOS VALDEZ Irving", efectivos)?.cip, "363060");
  });
  test("no empareja con una sola palabra en común", () => {
    assert.equal(buscarOficialConstato("TNTE. MENDOZA Desconocido", efectivos)?.cip, undefined);
  });
});

describe("splitApellidosNombres", () => {
  test("corta por coma cuando existe (formato oficiales)", () => {
    assert.deepEqual(splitApellidosNombres("ROJAS VEGA,CARLOS ALBERTO"), { apellidos: "ROJAS VEGA", nombres: "CARLOS ALBERTO" });
  });
  test("sin coma, asume 2 primeras palabras como apellidos (formato suboficiales)", () => {
    assert.deepEqual(splitApellidosNombres("TORRES SALAS LUIS ENRIQUE"), { apellidos: "TORRES SALAS", nombres: "LUIS ENRIQUE" });
  });
});

describe("formato de fechas", () => {
  test("fechaLarga", () => {
    assert.equal(fechaLarga("2026-08-15"), "15 de agosto del 2026");
  });
  test("fechaCorta", () => {
    assert.equal(fechaCorta("2026-08-15"), "15/08/2026");
  });
});

describe("días hábiles y plazo de descargo", () => {
  test("esFinDeSemana reconoce sábado y domingo", () => {
    assert.equal(esFinDeSemana("2026-08-15"), true); // sábado
    assert.equal(esFinDeSemana("2026-08-16"), true); // domingo
    assert.equal(esFinDeSemana("2026-08-14"), false); // viernes
  });
  test("siguienteDiaHabil salta el fin de semana", () => {
    assert.equal(siguienteDiaHabil("2026-08-14"), "2026-08-17"); // viernes -> lunes
    assert.equal(siguienteDiaHabil("2026-08-13"), "2026-08-14"); // jueves -> viernes
  });
  test("fechaLimiteDescargo usa el mismo cálculo", () => {
    assert.equal(fechaLimiteDescargo({ imputacion_generada_at: "2026-08-13T12:00:00.000Z" }), "2026-08-14");
    assert.equal(fechaLimiteDescargo({ imputacion_generada_at: null }), null);
  });
  test("plazoDescargoVencido: el mismo día límite todavía no está vencido", () => {
    assert.equal(plazoDescargoVencido({ imputacion_generada_at: "2026-08-13T12:00:00.000Z" }, "2026-08-14"), false);
  });
  test("plazoDescargoVencido: al día siguiente del límite ya venció", () => {
    assert.equal(plazoDescargoVencido({ imputacion_generada_at: "2026-08-13T12:00:00.000Z" }, "2026-08-15"), true);
  });
});

describe("cipDelEfectivoBuscado", () => {
  const BUSCADO = { grado: "S2", apellidos_nombres: "VICTIMA TRES Carlos", cip: "100003" };
  test("devuelve el CIP cuando el formulario sigue con la misma persona", () => {
    assert.equal(cipDelEfectivoBuscado("VICTIMA TRES", "Carlos", BUSCADO), "100003");
  });
  test("tolera tildes, mayúsculas y que el nombre vaya sin coma", () => {
    assert.equal(cipDelEfectivoBuscado("Víctima Tres", "CARLOS", BUSCADO), "100003");
  });
  test("si se cambió el nombre a mano por otra persona, no asigna el CIP ajeno", () => {
    assert.equal(cipDelEfectivoBuscado("OTRO CUATRO", "Dario", BUSCADO), null);
  });
  test("un solo apellido en común no alcanza", () => {
    assert.equal(cipDelEfectivoBuscado("TRES", "Pedro", BUSCADO), null);
  });
  test("sin búsqueda previa o sin CIP en el resultado, null", () => {
    assert.equal(cipDelEfectivoBuscado("VICTIMA TRES", "Carlos", null), null);
    assert.equal(cipDelEfectivoBuscado("VICTIMA TRES", "Carlos", { apellidos_nombres: "VICTIMA TRES Carlos" }), null);
    assert.equal(cipDelEfectivoBuscado("", "Carlos", BUSCADO), null);
  });
});

describe("tipoFalloBusqueda", () => {
  test("función aún no instalada en el servidor", () => {
    assert.equal(tipoFalloBusqueda({ code: "PGRST202", message: "x" }), "sin_funcion");
    assert.equal(tipoFalloBusqueda({ message: "Could not find the function public.buscar_efectivo(p_q) in the schema cache" }), "sin_funcion");
  });
  test("cualquier otro fallo es un error genérico", () => {
    assert.equal(tipoFalloBusqueda({ code: "42501", message: "permission denied for function buscar_efectivo" }), "error");
    assert.equal(tipoFalloBusqueda({ message: "Failed to fetch" }), "error");
  });
  test("sin error, null", () => {
    assert.equal(tipoFalloBusqueda(null), null);
    assert.equal(tipoFalloBusqueda(undefined), null);
  });
});

describe("normalizarNumeroOficio", () => {
  test("correlativo y año, con ceros a la izquierda", () => {
    assert.equal(normalizarNumeroOficio("45-2026"), "045-2026");
    assert.equal(normalizarNumeroOficio(" 045 - 2026 "), "045-2026");
    assert.equal(normalizarNumeroOficio("OFICIO N° 412-2026-COMOPPOL-PNP/DIRNOS"), "412-2026");
  });
  test("vacío si no se reconoce", () => {
    assert.equal(normalizarNumeroOficio(""), "");
    assert.equal(normalizarNumeroOficio("412"), "");
    assert.equal(normalizarNumeroOficio("0-2026"), "");
  });
});

describe("sancionDelCaso", () => {
  test("amonestación y días según el tercio guardado", () => {
    assert.deepEqual(sancionDelCaso({ sancion_tercio_label: "amonestacion" }), { sancion_dias: 0, sancion_tipo: "amonestacion" });
    assert.deepEqual(sancionDelCaso({ sancion_tercio_label: "4" }), { sancion_dias: 4, sancion_tipo: "simple" });
  });
  test("sin sanción legible no inventa nada", () => {
    assert.deepEqual(sancionDelCaso({}), { sancion_dias: null, sancion_tipo: null });
    assert.deepEqual(sancionDelCaso({ sancion_tercio_label: "x" }), { sancion_dias: null, sancion_tipo: null });
  });
});

describe("rol de servicio en el hecho", () => {
  test("fechaCompacta", () => {
    assert.equal(fechaCompacta("2026-09-10"), "10SET2026");
    assert.equal(fechaCompacta(""), "");
  });
  test("el puesto va antes del hecho con la fórmula de moral-y-disciplina", () => {
    assert.equal(
      hechoConRolDeServicio("No se presentó a la formación.", { puesto_rol: "PATRULLAJE MOTORIZADO PAT. TMP-3096 - CONDUCTOR.", fecha_hecho: "2026-09-10" }),
      "El investigado se encontraba nombrado según el rol de servicio de la Comisaría PNP Ventanilla del 10SET2026, en el servicio de PATRULLAJE MOTORIZADO PAT. TMP-3096 - CONDUCTOR.\n\nNo se presentó a la formación.");
  });
  test("sin puesto, el hecho queda igual", () => {
    assert.equal(hechoConRolDeServicio("Hecho.", { puesto_rol: "  " }), "Hecho.");
  });
});
