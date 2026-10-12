// Pruebas del oficio con el que se remite el expediente terminado.
// Personas y números inventados: este repositorio es público.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fechaEnLetras,
  fraseDeSancion,
  documentosRemitidos,
  inicialesDe,
  datosDelOficio,
  faltaParaElOficio,
} from "./oficioRemision.js";

describe("cómo se escriben los datos en el oficio", () => {
  test("la fecha, como la escribe el documento", () => {
    assert.equal(fechaEnLetras("2026-09-30"), "30 de setiembre del 2026");
    assert.equal(fechaEnLetras("2026-01-05"), "5 de enero del 2026");
  });

  test("una fecha que no es fecha no inventa nada", () => {
    assert.equal(fechaEnLetras(""), "");
    assert.equal(fechaEnLetras("30/09/2026"), "");
  });

  test("la sanción, igual que en la orden", () => {
    assert.equal(fraseDeSancion(8, "simple"), "OCHO (08) días de Sanción Simple");
    assert.equal(fraseDeSancion(4, "simple"), "CUATRO (04) días de Sanción Simple");
    assert.equal(fraseDeSancion(5, "rigor"), "CINCO (05) días de Sanción de Rigor");
  });

  test("la amonestación no tiene días", () => {
    assert.equal(fraseDeSancion(0, "amonestacion"), "AMONESTACIÓN");
    assert.equal(fraseDeSancion(null, "amonestacion"), "AMONESTACIÓN");
  });

  test("sin sanción legible, hueco visible en vez de dato inventado", () => {
    assert.equal(fraseDeSancion(null, null), "");
  });

  test("las iniciales con que se firma", () => {
    assert.equal(inicialesDe("Omar Alberto VENTURA ROMAN"), "OAVR");
    assert.equal(inicialesDe("Nestor Elias LINARES PRADO"), "NELP");
    assert.equal(inicialesDe("Hugo Martin MEJIA CORDOVA"), "HMMC");
    assert.equal(inicialesDe(""), "");
  });
});

describe("qué documentos anuncia que remite", () => {
  const conActa = { acta_no_descargo: true, notificacion_firmada: true };

  test("lo normal: acta, notificación de imputación y notificación de la orden", () => {
    assert.equal(documentosRemitidos(conActa, "L-24"),
      "acta de no recepción de descargo, notificación de imputación de infracción leve (L-24) y notificación de la orden de sanción");
  });

  test("si el investigado sí presentó descargo, lo dice así", () => {
    assert.equal(documentosRemitidos({ descargo: true, notificacion_firmada: true }, "L21"),
      "descargo del investigado, notificación de imputación de infracción leve (L-21) y notificación de la orden de sanción");
  });

  test("no anuncia lo que el expediente no trae", () => {
    assert.equal(documentosRemitidos({}, "L-24"),
      "notificación de imputación de infracción leve (L-24)");
  });

  test("sin código, no escribe un paréntesis vacío", () => {
    assert.equal(documentosRemitidos({ acta_no_descargo: true }, ""),
      "acta de no recepción de descargo y notificación de imputación de infracción leve");
  });
});

describe("los datos completos del oficio", () => {
  const nota = {
    grado: "S3", apellidos: "RODRIGUEZ PERAMAS", nombres: "Aython Jhon",
    codigo_infraccion: "L-24", sancion_dias: 8, sancion_tipo: "simple",
  };
  const jefe = { grado: "CORONEL PNP", nombre: "Ricardo Manuel SALGADO VERA" };
  const comisario = { grado: "CAPITAN", nombre: "Omar Alberto VENTURA ROMAN" };
  const piezas = { acta_no_descargo: true, notificacion_firmada: true };

  test("se arma entero con lo registrado y lo confirmado", () => {
    const d = datosDelOficio({
      nota, piezas, jefe, comisario, numeroOficio: "412-2026",
      fecha: "2026-09-30", redactadoPor: "Hugo Martin MEJIA CORDOVA",
    });
    assert.equal(d.fecha, "30 de setiembre del 2026");
    assert.equal(d.numero_oficio, "412-2026");
    assert.equal(d.jefe_grado, "CORONEL PNP");
    assert.equal(d.jefe_nombre, "Ricardo Manuel SALGADO VERA");
    assert.equal(d.jefe_cargo, "JEFE DE LA DIVOPUS 03 VENTANILLA");
    assert.equal(d.sancion, "OCHO (08) días de Sanción Simple");
    assert.equal(d.superior, "CAPITAN PNP Omar Alberto VENTURA ROMAN");
    assert.equal(d.investigado, "S3 PNP Aython Jhon RODRIGUEZ PERAMAS");
    assert.equal(d.iniciales, "OAVR/hmmc");
    assert.match(d.documentos, /acta de no recepción de descargo/);
  });

  test("el cargo del jefe se puede cambiar si cambia la unidad", () => {
    const d = datosDelOficio({ nota, jefe: { ...jefe, cargo: "JEFE DE LA DIVOPUS 02 CALLAO" }, comisario });
    assert.equal(d.jefe_cargo, "JEFE DE LA DIVOPUS 02 CALLAO");
  });

  test("sin datos no revienta", () => {
    const d = datosDelOficio();
    assert.equal(d.fecha, "");
    assert.equal(d.investigado, "PNP");
  });
});

describe("qué falta antes de poder generarlo", () => {
  const completo = {
    numero_oficio: "412-2026", jefe_nombre: "Ricardo Manuel SALGADO VERA",
    superior: "CAPITAN PNP Omar Alberto VENTURA ROMAN",
    comisario_nombre: "Firmante DEMOSTRACIÓN", comisario_oa: "OA-000000",
    sancion: "OCHO (08) días de Sanción Simple", fecha: "30 de setiembre del 2026",
  };

  test("con todo puesto, no falta nada", () => {
    assert.deepEqual(faltaParaElOficio(completo), []);
  });

  test("dice en palabras lo que falta", () => {
    assert.deepEqual(faltaParaElOficio({ ...completo, numero_oficio: "", jefe_nombre: "" }),
      ["el número de oficio", "el jefe de la DIVOPUS"]);
  });

  test("un comisario vacío no pasa por firmante", () => {
    assert.deepEqual(faltaParaElOficio({ ...completo, comisario_nombre: "  " }), ["el comisario que firma"]);
  });
  test("el oficial sancionador no sustituye al firmante ni su OA", () => {
    const datos = datosDelOficio({ nota: { sancion_dias: 3 }, jefe: { nombre: "JEFE DE PRUEBA" },
      sanciona: { nombre: "OFICIAL DE PRUEBA", grado: "TNTE" }, comisario: {},
      numeroOficio: "001", fecha: "2026-09-30" });
    assert.deepEqual(faltaParaElOficio(datos), ["el comisario que firma", "el OA del comisario"]);
  });
  test("separa la ausencia del sancionador y rechaza datos de solo espacios", () => {
    assert.deepEqual(faltaParaElOficio({ ...completo, superior: " PNP " }), ["el oficial que impuso la sanción"]);
    assert.deepEqual(faltaParaElOficio({ ...completo, numero_oficio: " ", jefe_nombre: " " }),
      ["el número de oficio", "el jefe de la DIVOPUS"]);
  });
  test("el generador rechaza datos incompletos antes de cargar dependencias o plantillas", async () => {
    const { renderizarOficioRemisionDocx } = await import("./oficioRemision.js");
    await assert.rejects(renderizarOficioRemisionDocx({ ...completo, comisario_nombre: "" }), /comisario que firma/);
  });
});

describe("quién impuso la sanción y quién firma el oficio", () => {
  const nota = { grado: "S2", apellidos: "ANGULO TREJO", nombres: "Didier Fabian", sancion_dias: 4, sancion_tipo: "simple" };
  const comisario = { grado: "CAPITAN", nombre: "Omar Alberto VENTURA ROMAN" };
  const sanciona = { grado: "TNTE", nombre: "Ariel BALLENA SOTO" };

  test("el oficio dice quién impuso, que sale del caso", () => {
    const d = datosDelOficio({ nota, comisario, sanciona, redactadoPor: "Hugo Martin MEJIA CORDOVA" });
    assert.equal(d.superior, "TNTE PNP Ariel BALLENA SOTO");
  });

  test("las iniciales son las del comisario que firma, no las de quien impuso", () => {
    const d = datosDelOficio({ nota, comisario, sanciona, redactadoPor: "Hugo Martin MEJIA CORDOVA" });
    assert.equal(d.iniciales, "OAVR/hmmc");
  });

  test("si el caso no dice quién impuso, se asume el comisario", () => {
    const d = datosDelOficio({ nota, comisario });
    assert.equal(d.superior, "CAPITAN PNP Omar Alberto VENTURA ROMAN");
  });
});

describe("el bloque de firma del pie", () => {
  const nota = { grado: "S2", apellidos: "BARRIOS PAREDES", nombres: "Kevin Alonso", sancion_dias: 10, sancion_tipo: "simple" };

  test("lleva al comisario que se confirmó, no uno fijo", () => {
    const d = datosDelOficio({
      nota,
      comisario: { grado: "CAPITAN", nombre: "Sergio Ivan MENDOZA LEON", oa: "315820" },
    });
    assert.equal(d.comisario_oa, "OA-315820");
    assert.equal(d.comisario_nombre, "Sergio Ivan MENDOZA LEON");
    assert.equal(d.comisario_grado, "CAPITAN PNP");
    assert.equal(d.comisario_cargo, "COMISARIO DE VENTANILLA");
  });

  test("el OA se acepta escrito de las dos formas", () => {
    assert.equal(datosDelOficio({ nota, comisario: { oa: "OA-315820" } }).comisario_oa, "OA-315820");
    assert.equal(datosDelOficio({ nota, comisario: { oa: "315820" } }).comisario_oa, "OA-315820");
    assert.equal(datosDelOficio({ nota, comisario: {} }).comisario_oa, "");
  });

  test("el grado no repite PNP si ya lo traía", () => {
    assert.equal(datosDelOficio({ nota, comisario: { grado: "CAPITAN PNP" } }).comisario_grado, "CAPITAN PNP");
  });

  test("el cargo se puede cambiar si firma otra dependencia", () => {
    assert.equal(datosDelOficio({ nota, comisario: { cargo: "JEFE DE LA SECCION" } }).comisario_cargo, "JEFE DE LA SECCION");
  });
});

describe("grado del investigado", () => {
  test("un grado que ya trae PNP no lo repite", () => {
    const conPnp = datosDelOficio({ nota: { grado: "S3 PNP", apellidos: "PRUEBA", nombres: "Juan" } });
    const sinPnp = datosDelOficio({ nota: { grado: "S3", apellidos: "PRUEBA", nombres: "Juan" } });
    assert.equal(conPnp.investigado, sinPnp.investigado);
    assert.doesNotMatch(conPnp.investigado, /PNP PNP/);
  });
});
