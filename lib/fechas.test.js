// Pruebas de fechas de Lima y días hábiles -- ver lib/fechas.js.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fechaLima, hoyLima, horaLima, feriadosNacionales, esFeriado, esDiaHabil, siguienteDiaHabil } from "./fechas.js";

describe("fechaLima / hoyLima (Lima es UTC-5, sin horario de verano)", () => {
  test("de noche en Lima NO es todavía el día siguiente (el fallo de toISOString)", () => {
    // 20:30 del 10-sep en Lima = 01:30 UTC del 11-sep
    const instante = new Date("2026-09-11T01:30:00Z");
    assert.equal(instante.toISOString().slice(0, 10), "2026-09-11"); // lo que daba antes: mañana
    assert.equal(hoyLima(instante), "2026-09-10");
  });
  test("justo antes y después de medianoche en Lima", () => {
    assert.equal(hoyLima(new Date("2026-09-11T04:59:59Z")), "2026-09-10"); // 23:59:59 Lima
    assert.equal(hoyLima(new Date("2026-09-11T05:00:00Z")), "2026-09-11"); // 00:00:00 Lima
  });
  test("acepta timestamps de la base de datos y milisegundos", () => {
    assert.equal(fechaLima("2026-09-11T01:30:00+00:00"), "2026-09-10");
    assert.equal(fechaLima("2026-09-10T20:30:00-05:00"), "2026-09-10");
    assert.equal(fechaLima(Date.parse("2026-09-11T01:30:00Z")), "2026-09-10");
  });
  test("una fecha sola ya es una fecha de calendario: no se mueve", () => {
    assert.equal(fechaLima("2026-09-10"), "2026-09-10");
  });
  test("valor inválido da cadena vacía", () => {
    assert.equal(fechaLima("no es fecha"), "");
    assert.equal(fechaLima(undefined), "");
  });
});

describe("horaLima", () => {
  test("HH:MM de Lima", () => {
    assert.equal(horaLima(new Date("2026-09-11T01:30:00Z")), "20:30");
    assert.equal(horaLima(new Date("2026-09-10T12:05:00Z")), "07:05");
  });
});

describe("feriados nacionales", () => {
  test("2026: fijos y Semana Santa (Pascua = 5 de abril)", () => {
    const f = feriadosNacionales(2026);
    for (const dia of ["2026-01-01", "2026-04-02", "2026-04-03", "2026-05-01", "2026-06-07", "2026-06-29", "2026-07-23", "2026-07-28", "2026-07-29", "2026-08-06", "2026-08-30", "2026-10-08", "2026-11-01", "2026-12-08", "2026-12-09", "2026-12-25"]) {
      assert.ok(f.has(dia), `falta ${dia}`);
    }
    assert.equal(f.size, 16);
  });
  test("Semana Santa de otros años (Pascua 2025 = 20 abr, 2027 = 28 mar)", () => {
    assert.ok(esFeriado("2025-04-17") && esFeriado("2025-04-18"));
    assert.ok(esFeriado("2027-03-25") && esFeriado("2027-03-26"));
  });
  test("un día común no es feriado", () => {
    assert.equal(esFeriado("2026-09-10"), false);
  });
});

describe("días hábiles", () => {
  test("sábado, domingo y feriado no son hábiles", () => {
    assert.equal(esDiaHabil("2026-09-12"), false); // sábado
    assert.equal(esDiaHabil("2026-09-13"), false); // domingo
    assert.equal(esDiaHabil("2026-08-30"), false); // Santa Rosa (domingo en 2026, igual feriado)
    assert.equal(esDiaHabil("2026-10-08"), false); // jueves feriado
    assert.equal(esDiaHabil("2026-09-14"), true);
  });
  test("siguiente día hábil de un día normal es el día siguiente", () => {
    assert.equal(siguienteDiaHabil("2026-09-09"), "2026-09-10");
  });
  test("saltea fin de semana", () => {
    assert.equal(siguienteDiaHabil("2026-09-11"), "2026-09-14"); // viernes -> lunes
  });
  test("saltea feriados: la víspera de Angamos vence el viernes, no el jueves 8 de octubre", () => {
    assert.equal(siguienteDiaHabil("2026-10-07"), "2026-10-09");
  });
  test("saltea feriado + fin de semana: víspera de Navidad 2026 (viernes 25 es feriado)", () => {
    assert.equal(siguienteDiaHabil("2026-12-24"), "2026-12-28");
  });
  test("saltea Jueves y Viernes Santo de 2026", () => {
    assert.equal(siguienteDiaHabil("2026-04-01"), "2026-04-06");
  });
  test("desde un día no hábil: el primer hábil después", () => {
    assert.equal(siguienteDiaHabil("2026-09-12"), "2026-09-14"); // desde sábado
  });
});
