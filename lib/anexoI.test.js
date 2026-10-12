// Corre con: node --test lib/
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getInfraccion, normalizarCodigoInfraccion, ANEXO_I } from "./anexoI.js";

describe("normalizarCodigoInfraccion", () => {
  test("acepta variantes de formato", () => {
    assert.equal(normalizarCodigoInfraccion("L21"), "L21");
    assert.equal(normalizarCodigoInfraccion("l21"), "L21");
    assert.equal(normalizarCodigoInfraccion("L-21"), "L21");
    assert.equal(normalizarCodigoInfraccion("l 21"), "L21");
  });
  test("null para vacío o sin match", () => {
    assert.equal(normalizarCodigoInfraccion(""), null);
    assert.equal(normalizarCodigoInfraccion(null), null);
    assert.equal(normalizarCodigoInfraccion("G39"), null); // G39 no es del Anexo I (Leves), no matchea el patrón "L"
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
  test("el catálogo completo tiene datos coherentes en las 117 infracciones", () => {
    const codigos = Object.keys(ANEXO_I);
    assert.equal(codigos.length, 117);
    for (const c of codigos) {
      const inf = ANEXO_I[c];
      assert.ok(inf.bienJuridico?.length > 0, `${c} sin bienJuridico`);
      assert.ok(inf.infraccion?.length > 0, `${c} sin infraccion`);
      assert.ok(inf.sancion?.length > 0, `${c} sin sancion`);
    }
  });
});

// Valores tomados del texto oficial del D.S. N° 016-2025-IN (El Peruano,
// 12-nov-2025), Anexo I. El art. 11.2 del Reglamento dice que no se pueden
// imponer sanciones distintas a las de la Tabla, bajo sanción de nulidad: un
// rango mal copiado sale impreso tal cual en la Imputación y en la Orden.
describe("Tabla de Infracciones Leves del D.S. 016-2025-IN", () => {
  test("cada sanción es una de las formas que trae la Tabla oficial", () => {
    const permitidas = /^(Desde amonestación hasta 4 días de Sanción Simple|De Amonestación a 4 días de Sanción Simple|De 5 a 7 días de Sanción Simple|De 5 a 10 días de Sanción Simple|De 8 a 10 días de Sanción Simple)\.$/;
    for (const [c, inf] of Object.entries(ANEXO_I)) {
      assert.match(inf.sancion, permitidas, `${c}: sanción fuera de la Tabla: ${inf.sancion}`);
    }
  });
  test("los 9 códigos que estaban con sanción errónea quedaron como en el decreto", () => {
    const oficial = {
      L28: "De 5 a 7", L37: "De 5 a 10", L58: "De 5 a 10", L74: "De 5 a 10", L85: "De 5 a 7",
      L95: "De 5 a 7", L108: "De 5 a 10", L111: "De 5 a 7", L113: "De 5 a 10",
    };
    for (const [c, rango] of Object.entries(oficial)) {
      assert.equal(ANEXO_I[c].sancion, `${rango} días de Sanción Simple.`, c);
    }
  });
  test("las sanciones de los códigos que tramita la app (L21 y L24) son las oficiales", () => {
    assert.equal(ANEXO_I.L21.sancion, "Desde amonestación hasta 4 días de Sanción Simple.");
    assert.equal(ANEXO_I.L24.sancion, "De 8 a 10 días de Sanción Simple.");
  });
  test("el texto de las infracciones corregidas es el literal del decreto", () => {
    assert.match(ANEXO_I.L6.infraccion, /renovar en caso de deterioro e ilegibilidad, el Carné/);
    assert.match(ANEXO_I.L52.infraccion, /gestión o trámite administrativo de la documentación/);
    assert.match(ANEXO_I.L58.infraccion, /con la licencia vencida,/);
    assert.match(ANEXO_I.L108.infraccion, /certificado de lunas oscurecidas/);
    assert.match(ANEXO_I.L115.infraccion, /institucional,/);
  });
  test("existen L12 y L69, que la Tabla oficial sí trae", () => {
    assert.ok(ANEXO_I.L12);
    assert.match(ANEXO_I.L69.infraccion, /sistemas de información de acceso policial/);
  });
  test("bien jurídico por tramo, como los encabezados de la Tabla", () => {
    assert.equal(ANEXO_I.L1.bienJuridico, "Disciplina Policial");
    assert.equal(ANEXO_I.L64.bienJuridico, "Disciplina Policial");
    assert.equal(ANEXO_I.L65.bienJuridico, "Servicio Policial");
    assert.equal(ANEXO_I.L96.bienJuridico, "Servicio Policial");
    assert.equal(ANEXO_I.L97.bienJuridico, "Imagen Institucional");
    assert.equal(ANEXO_I.L109.bienJuridico, "Imagen Institucional");
    assert.equal(ANEXO_I.L110.bienJuridico, "Ética Policial");
    assert.equal(ANEXO_I.L117.bienJuridico, "Ética Policial");
  });
});
