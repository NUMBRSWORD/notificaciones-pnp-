// Corre con: node --test lib/*.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getInfraccion, normalizarCodigoInfraccion, ANEXO_I } from "./anexoI.js";

describe("normalizarCodigoInfraccion", () => {
  test("acepta variantes de formato", () => {
    assert.equal(normalizarCodigoInfraccion("L21"), "L21");
    assert.equal(normalizarCodigoInfraccion("l21"), "L21");
    assert.equal(normalizarCodigoInfraccion("L-21"), "L21");
  });
  test("null para vacío o sin match", () => {
    assert.equal(normalizarCodigoInfraccion(""), null);
    assert.equal(normalizarCodigoInfraccion(null), null);
  });
});

describe("getInfraccion", () => {
  test("devuelve los 3 campos esperados para un código válido", () => {
    const inf = getInfraccion("L21");
    assert.ok(inf);
    assert.equal(typeof inf.bienJuridico, "string");
    assert.equal(typeof inf.infraccion, "string");
    assert.equal(typeof inf.sancion, "string");
  });
  test("null para un código que no existe", () => {
    assert.equal(getInfraccion("L999"), null);
  });
  test("el catálogo completo tiene las 117 infracciones Leves", () => {
    assert.equal(Object.keys(ANEXO_I).length, 117);
  });
});
