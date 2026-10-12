// Pruebas de las reglas de clave -- ver lib/acceso.js.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esClaveInicial, validarClaveNueva, LARGO_MINIMO_CLAVE } from "./acceso.js";

describe("esClaveInicial", () => {
  test("CIP como usuario y la misma cifra como clave: es la inicial", () => {
    assert.equal(esClaveInicial("30000001", "30000001"), true);
  });
  test("ignora espacios alrededor del usuario", () => {
    assert.equal(esClaveInicial("  30000001 ", "30000001"), true);
  });
  test("una clave distinta no es la inicial", () => {
    assert.equal(esClaveInicial("30000001", "Cambiada-2026"), false);
  });
  test("un correo como usuario nunca cuenta (esas cuentas no usan el CIP)", () => {
    assert.equal(esClaveInicial("persona@ejemplo.pe", "persona@ejemplo.pe"), false);
  });
  test("vacíos y nulos no cuentan", () => {
    assert.equal(esClaveInicial("", ""), false);
    assert.equal(esClaveInicial(null, null), false);
    assert.equal(esClaveInicial(undefined, "123"), false);
  });
});

describe("validarClaveNueva", () => {
  test("una clave razonable pasa", () => {
    assert.equal(validarClaveNueva("Ventanilla2026", "Ventanilla2026", "30000001"), null);
  });
  test("exige el largo mínimo", () => {
    assert.match(validarClaveNueva("Ab1", "Ab1"), new RegExp(String(LARGO_MINIMO_CLAVE)));
  });
  test("las dos claves deben coincidir", () => {
    assert.match(validarClaveNueva("Ventanilla2026", "Ventanilla2027"), /no coinciden/);
  });
  test("no puede repetir la clave actual", () => {
    assert.match(validarClaveNueva("Ventanilla2026", "Ventanilla2026", "Ventanilla2026"), /distinta de la actual/);
  });
  test("sin clave actual conocida (cambio voluntario) no compara", () => {
    assert.equal(validarClaveNueva("Ventanilla2026", "Ventanilla2026", ""), null);
  });
  test("rechaza un mismo carácter repetido", () => {
    assert.match(validarClaveNueva("aaaaaaaaaa", "aaaaaaaaaa"), /predecible/);
  });
  test("rechaza una clave solo de números (se parece a un CIP o DNI)", () => {
    assert.match(validarClaveNueva("48291056", "48291056"), /al menos una letra/);
  });
  test("tolera valores ausentes sin lanzar", () => {
    assert.ok(validarClaveNueva(undefined, undefined));
  });
});
