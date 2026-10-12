// Pruebas de la minimización de datos hacia la IA -- ver lib/privacidad.js. Nombres ficticios.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seudonimizarInvestigados, restaurarNombres } from "./privacidad.js";

const CASOS = [
  { investigado: "S3 Juan LOPEZ GARAY", codigo_infraccion: "L21", descargo_recibido: false },
  { investigado: "S2 Ana LOPEZ CASTRO", codigo_infraccion: "L24", descargo_recibido: true },
  { investigado: "S3 Juan LOPEZ GARAY", codigo_infraccion: "L21", descargo_recibido: true },
];

describe("seudonimizarInvestigados", () => {
  const { casos, mapa } = seudonimizarInvestigados(CASOS);
  test("ningún nombre real queda en lo que se envía", () => {
    const enviado = JSON.stringify(casos);
    assert.ok(!/LOPEZ|Juan|Ana/.test(enviado), enviado);
  });
  test("la misma persona conserva el mismo alias y otra persona, otro", () => {
    assert.deepEqual(casos.map((c) => c.investigado), ["E01", "E02", "E01"]);
  });
  test("el resto de los campos no cambia", () => {
    assert.equal(casos[1].codigo_infraccion, "L24");
    assert.equal(casos[1].descargo_recibido, true);
  });
  test("el mapa guarda los nombres reales solo para el navegador", () => {
    assert.equal(mapa.get("E01"), "S3 Juan LOPEZ GARAY");
    assert.equal(mapa.get("E02"), "S2 Ana LOPEZ CASTRO");
  });
  test("no modifica la lista original", () => {
    assert.equal(CASOS[0].investigado, "S3 Juan LOPEZ GARAY");
  });
  test("lista vacía o ausente", () => {
    assert.deepEqual(seudonimizarInvestigados([]).casos, []);
    assert.deepEqual(seudonimizarInvestigados(undefined).casos, []);
  });
});

describe("restaurarNombres", () => {
  const { mapa } = seudonimizarInvestigados(CASOS);
  test("vuelve a poner los nombres en el texto de la IA", () => {
    assert.equal(
      restaurarNombres("E01 tiene el plazo vencido; revisar a E02 y a E01.", mapa),
      "S3 Juan LOPEZ GARAY tiene el plazo vencido; revisar a S2 Ana LOPEZ CASTRO y a S3 Juan LOPEZ GARAY.",
    );
  });
  test("un alias desconocido y los códigos de infracción no se tocan", () => {
    assert.equal(restaurarNombres("E99 y MG32 y L21 y G39", mapa), "E99 y MG32 y L21 y G39");
  });
  test("texto vacío o ausente", () => {
    assert.equal(restaurarNombres("", mapa), "");
    assert.equal(restaurarNombres(undefined, mapa), "");
  });
});
