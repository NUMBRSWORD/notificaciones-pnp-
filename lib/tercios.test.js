// Corre con: node --test lib/*.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { opcionesTercioDesdeSancion } from "./tercios.js";

describe("opcionesTercioDesdeSancion", () => {
  test("Desde amonestación hasta N días -> amonestación / medio / N (como L21)", () => {
    const op = opcionesTercioDesdeSancion("Desde amonestación hasta 4 días de Sanción Simple.");
    assert.deepEqual(op.map((o) => o.value), ["amonestacion", "2", "4"]);
    assert.deepEqual(op.map((o) => o.extremo), ["mínimo", "medio", "máximo"]);
  });
  test("De X a Y días -> 3 tercios (X, medio, Y)", () => {
    const op = opcionesTercioDesdeSancion("De 5 a 7 días de Sanción Simple.");
    assert.deepEqual(op.map((o) => o.value), ["5", "6", "7"]);
  });
  test("De 8 a 10 días -> 8, 9, 10", () => {
    const op = opcionesTercioDesdeSancion("De 8 a 10 días de Sanción Simple.");
    assert.deepEqual(op.map((o) => o.value), ["8", "9", "10"]);
  });
  test("De 5 a 10 días -> redondea el medio a 8", () => {
    const op = opcionesTercioDesdeSancion("De 5 a 10 días de Sanción Simple.");
    assert.deepEqual(op.map((o) => o.value), ["5", "8", "10"]);
  });
  test("texto no reconocido devuelve null", () => {
    assert.equal(opcionesTercioDesdeSancion("Redacción desconocida"), null);
    assert.equal(opcionesTercioDesdeSancion(""), null);
  });
});
