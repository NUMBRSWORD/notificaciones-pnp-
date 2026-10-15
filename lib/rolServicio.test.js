import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { interpretarResultadoRol, rolParaFecha } from "./rolServicio.js";

describe("interpretarResultadoRol", () => {
  test("de servicio: devuelve el puesto", () => {
    const r = interpretarResultadoRol({ encontrado: true, puesto: " SECTOR 02,  SS02B - PAT. TMP-6694 - OPERADOR ", situacion: "servicio", fecha_rol_inicio: "2026-10-10", fecha_rol_fin: "2026-10-11" }, "2026-10-10");
    assert.equal(r.puesto, "SECTOR 02, SS02B - PAT. TMP-6694 - OPERADOR");
    assert.match(r.mensaje, /^✓ Puesto detectado \(rol del 10\/10\/2026\)/);
  });
  test("la versión anterior de la función decía «normal»: también vale", () => {
    assert.equal(interpretarResultadoRol({ encontrado: true, puesto: "PATRULLA", situacion: "normal" }, "2026-10-10").puesto, "PATRULLA");
  });
  test("en NOVEDADES no se consigna puesto y se avisa", () => {
    const r = interpretarResultadoRol({ encontrado: true, puesto: null, situacion: "descanso_medico", detalle_novedad: "DM 3 DIAS" }, "2026-10-10");
    assert.equal(r.puesto, null);
    assert.match(r.mensaje, /DESCANSO MÉDICO.*\(DM 3 DIAS\)/);
  });
  test("en OTROS (franco): se aclara que el puesto es el habitual", () => {
    const r = interpretarResultadoRol({ encontrado: true, puesto: null, situacion: "otro", detalle_novedad: "SECCION DE FAMILIA" }, "2026-10-06");
    assert.equal(r.puesto, null);
    assert.match(r.mensaje, /«OTROS».*no estaba nombrado de servicio\. Puesto habitual: SECCION DE FAMILIA\./);
  });
  test("rol de otra fecha: no se usa", () => {
    const r = interpretarResultadoRol({ encontrado: true, puesto: "X", situacion: "servicio", fecha_rol_inicio: "2026-10-01" }, "2026-10-10");
    assert.equal(r.puesto, null);
    assert.match(r.mensaje, /01\/10\/2026.*10\/10\/2026/);
  });
  test("figura sin puesto escrito en su fila", () => {
    const r = interpretarResultadoRol({ encontrado: true, puesto: null, situacion: "servicio" }, "2026-10-10");
    assert.equal(r.puesto, null);
    assert.match(r.mensaje, /no indica puesto/);
  });
  test("no figura", () => {
    assert.equal(interpretarResultadoRol({ encontrado: false }, "2026-10-10").puesto, null);
    assert.equal(interpretarResultadoRol(null, "2026-10-10").puesto, null);
  });
});

describe("rolParaFecha", () => {
  const roles = [
    { id: "a", fecha: "2026-10-09", fecha_fin: "2026-10-10" },
    { id: "b", fecha: "2026-10-10", fecha_fin: "2026-10-11" },
  ];
  test("prefiere el rol que empieza ese día", () => {
    assert.equal(rolParaFecha(roles, "2026-10-10").id, "b");
    assert.equal(rolParaFecha([roles[1], roles[0]], "2026-10-10").id, "b");
  });
  test("si solo hay el del día anterior que lo cubre, usa ese", () => {
    assert.equal(rolParaFecha([roles[0]], "2026-10-10").id, "a");
  });
  test("sin rol para la fecha", () => {
    assert.equal(rolParaFecha(roles, "2026-10-20"), null);
    assert.equal(rolParaFecha(roles, ""), null);
  });
});
