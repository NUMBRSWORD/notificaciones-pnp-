// Corre con: node --test lib/*.test.js
// Sin dependencias -- node:test y node:assert vienen incluidos en Node.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conPnp, limpiarNombreVisible, tokens, buscarOficialConstato, splitApellidosNombres,
  fechaLarga, fechaCorta,
  esFinDeSemana, siguienteDiaHabil, plazoDescargoVencido, fechaLimiteDescargo,
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
  test("apellidos en mayúsculas, nombres en formato título (con coma)", () => {
    assert.equal(limpiarNombreVisible("ROJAS GUINEA,ALDO CANZIANI"), "ROJAS GUINEA, Aldo Canziani");
  });
  test("apellidos en mayúsculas, nombres en formato título (sin coma)", () => {
    assert.equal(limpiarNombreVisible("ZEGOBIA QUISPE ANTONY"), "ZEGOBIA QUISPE Antony");
  });
  test("sin nombres identificables, se deja todo en mayúsculas", () => {
    assert.equal(limpiarNombreVisible("ZEGOBIA QUISPE"), "ZEGOBIA QUISPE");
  });
});

describe("tokens", () => {
  test("quita tildes, puntuación y mayúsculas todo", () => {
    assert.deepEqual(tokens("TNTE. Zegóbia Quíspe Antony"), ["TNTE", "ZEGOBIA", "QUISPE", "ANTONY"]);
  });
});

describe("buscarOficialConstato", () => {
  const efectivos = [
    { cip: "400474", apellidos_nombres: "ZEGOBIA QUISPE ANTONY", grado: "TENIENTE PNP" },
    { cip: "363060", apellidos_nombres: "RAMOS VALDEZ, IRVING", grado: "CAPITAN PNP" },
  ];
  test("empareja ignorando el grado", () => {
    assert.equal(buscarOficialConstato("TNTE. ZEGOBIA QUISPE Antony", efectivos)?.cip, "400474");
    assert.equal(buscarOficialConstato("CAP. RAMOS VALDEZ Irving", efectivos)?.cip, "363060");
  });
  test("no empareja con una sola palabra en común", () => {
    assert.equal(buscarOficialConstato("TNTE. ZEGOBIA Desconocido", efectivos)?.cip, undefined);
  });
});

describe("splitApellidosNombres", () => {
  test("corta por coma cuando existe (formato oficiales)", () => {
    assert.deepEqual(splitApellidosNombres("SOLIS GONZALES,MANUEL ANGELO"), { apellidos: "SOLIS GONZALES", nombres: "MANUEL ANGELO" });
  });
  test("sin coma, asume 2 primeras palabras como apellidos (formato suboficiales)", () => {
    assert.deepEqual(splitApellidosNombres("HIDALGO FERRARI HANS BRANDON"), { apellidos: "HIDALGO FERRARI", nombres: "HANS BRANDON" });
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
