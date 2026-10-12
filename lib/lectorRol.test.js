// Pruebas de la lectura directa del rol de servicio. El texto imita el formato
// real del rol de Ventanilla (como lo extrae pdf.js), con personas inventadas:
// este repositorio es público.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leerPuestoDelRol, periodoDelRol, textoPorPosicion } from "./lectorRol.js";

const ROL = [
  "ROL DE SERVICIO DEL PERSONAL PNP DE LA COMISARIA PNP VENTANILLA - REGPOL CALLAO DEL 10OCT26 AL 11OCT26 (07:00 A 07:00 HRS.)",
  "1 MAY. PNP ALFA BETA Carlos Andres JEFE DE UNIDAD (E)",
  "2 CAP. PNP GAMMA DELTA Luis OFICIAL DE PERMANENCIA / JEFE DE LA SECCION TRANSITO",
  "PERSONAL PNP ADMINISTRATIVO (08:00 A 17:00 LUN-VIE / 08:00 A 13:00 SAB)",
  "3 S2 PNP EPSILON ZETA Maria Ana SECRETARIA",
  "4 S3 PNP ETA THETA Jose Luis ATENCION AL PUBLICO SECCION DE INVESTIGACIÓN DERIVADAS DEL MINISTERIO PÚBLICO TURNO DE (08:00 A 17:00 LUN-VIE / 08:00 A 13:00 SAB)",
  "5 SS PNP IOTA KAPPA Edgar RECEPCION DE CARPETAS FISCALES",
  "6 S2 PNP LAMBDA MU Victor Santiago",
  "7 S2 PNP NU XI Ana",
  "TURNO DE 07:00 A 07:00 HORAS (PATRULLEROS RENTING)",
  "8 S1 PNP OMICRON PI Jhon Cesar SECTOR 02, SS02A Y SS02B PAT. TMP-0001 - CONDUCTOR",
  "9 S2 PNP RHO SIGMA Juan Jose SECTOR 02, SS02A Y SS02B PAT. TMP-0001 - OPERADOR",
  "10 S2 PNP TAU UPSILON Kevin SECTOR 05, SS05A PAT. TMP-0002 - OPERADOR SERVICIO ELECCIONES REGIONALES Y MUNICIPALES 2026 HORARIO DE FORMACION 17:00 HORAS",
  "11 SB PNP PHI CHI Luis Alberto",
  "12 S2 PNP PSI OMEGA Hans",
  "13 S2 PNP VARGAS VARGAS Pedro SECTOR 04, SS04A PAT. TMP-0003 - OPERADOR",
  "14 S2 PNP VARGAS VARGAS Raul SECTOR 01, SS01A PAT. TMP-0004 - CONDUCTOR",
  "NOVEDADES (DESCANSO MEDICO, FALTOS AL SERVICIO, VEHICULOS INOPERATIVOS Y OTROS) PERSONAL PNP CON DESCANSO MEDICO DOMICILIARIO",
  "15 S2 PNP ALEF BET Jonathan CINCO (05) DIAS DEL 07OCT2026 AL 12OCT2026 DX. ESGUINCE",
  "PERSONAL PNP FALTOS AL SERVICO",
  "16 S3 PNP GIMEL DALET Roberto NOTA INFORMATIVA N° 2026000001 DE FECHA 08OCT2026",
  "VEHICULOS INOPERATIVOS MOTOCICLETAS INOP: PL-00001",
  "OTROS (PERSONAL PNP FRANCO, PERMISO A CUENTA DE VACACIONES, LICENCIAS, DISPONIBILIDAD, ABANDONO DE CARGO,ETC)",
  "17 S2 PNP HE VAV Jesus TREINTA (30) DIAS DEL 07OCT2026 AL 06NOV2026 VACACIONES REGLAMENTARIAS",
  "18 ST2 PNP ZAYIN HET, Jackson VEINTE (20) DIAS DEL 07OCT2026 AL 27OCT2026 VACACIONES COMPLEMENTARIAS",
  "Ventanilla, 10 de octubre del 2026",
].join(" ");

const leer = (apellidos, nombres) => leerPuestoDelRol(ROL, { apellidos, nombres });

describe("textoPorPosicion", () => {
  test("ordena por renglón (arriba-abajo) y dentro de cada uno de izquierda a derecha", () => {
    const pagina = [
      { str: "SECTOR 02 - CONDUCTOR", x: 300, y: 700, h: 8 },
      { str: "NOVEDADES", x: 50, y: 600, h: 10 }, // pdf.js lo entrega al final, pero va más abajo en la hoja
      { str: "1 S1 PNP ALFA BETA Ana", x: 20, y: 700.5, h: 8 },
      { str: "ROL DEL 10OCT26 AL 11OCT26", x: 20, y: 800, h: 12 },
      { str: "   ", x: 0, y: 0, h: 8 },
    ];
    assert.equal(textoPorPosicion([pagina]), "ROL DEL 10OCT26 AL 11OCT26\n1 S1 PNP ALFA BETA Ana SECTOR 02 - CONDUCTOR\nNOVEDADES");
  });
});

describe("periodoDelRol", () => {
  test("lee el periodo del encabezado", () => {
    assert.deepEqual(periodoDelRol(ROL), { inicio: "2026-10-10", fin: "2026-10-11" });
  });
  test("sin encabezado reconocible", () => {
    assert.deepEqual(periodoDelRol("texto cualquiera"), { inicio: null, fin: null });
  });
});

describe("leerPuestoDelRol", () => {
  test("puesto de patrullaje en su misma fila", () => {
    const r = leer("OMICRON PI", "JHON CESAR");
    assert.equal(r.encontrado, true);
    assert.equal(r.situacion, "servicio");
    assert.equal(r.puesto, "SECTOR 02, SS02A Y SS02B PAT. TMP-0001 - CONDUCTOR");
    assert.equal(r.fecha_rol_inicio, "2026-10-10");
  });
  test("sin tildes ni mayúsculas exactas en los datos del caso", () => {
    assert.equal(leer("Rho Sigma", "Juan José").puesto, "SECTOR 02, SS02A Y SS02B PAT. TMP-0001 - OPERADOR");
  });
  test("no arrastra el encabezado que sigue a la fila", () => {
    assert.equal(leer("ETA THETA", "JOSE LUIS").puesto, "ATENCION AL PUBLICO");
    assert.equal(leer("TAU UPSILON", "KEVIN").puesto, "SECTOR 05, SS05A PAT. TMP-0002 - OPERADOR");
    assert.equal(leer("GAMMA DELTA", "LUIS").puesto, "OFICIAL DE PERMANENCIA / JEFE DE LA SECCION TRANSITO");
  });
  test("sin puesto en su fila: toma el grupo que la encabeza", () => {
    assert.equal(leer("LAMBDA MU", "VICTOR").puesto, "SECCION DE INVESTIGACIÓN DERIVADAS DEL MINISTERIO PÚBLICO");
    assert.equal(leer("NU XI", "ANA").puesto, "SECCION DE INVESTIGACIÓN DERIVADAS DEL MINISTERIO PÚBLICO");
    assert.equal(leer("PHI CHI", "LUIS ALBERTO").puesto, "SERVICIO ELECCIONES REGIONALES Y MUNICIPALES 2026");
    assert.equal(leer("PSI OMEGA", "HANS").puesto, "SERVICIO ELECCIONES REGIONALES Y MUNICIPALES 2026");
  });
  test("una fila con tarea propia dentro de un grupo conserva su tarea", () => {
    assert.equal(leer("IOTA KAPPA", "EDGAR").puesto, "RECEPCION DE CARPETAS FISCALES");
  });
  test("mismos apellidos: decide por los nombres", () => {
    assert.equal(leer("VARGAS VARGAS", "PEDRO").puesto, "SECTOR 04, SS04A PAT. TMP-0003 - OPERADOR");
    assert.equal(leer("VARGAS VARGAS", "RAUL").puesto, "SECTOR 01, SS01A PAT. TMP-0004 - CONDUCTOR");
    assert.equal(leer("VARGAS VARGAS", "").encontrado, false, "sin nombres es ambiguo: decide la IA o la persona");
  });
  test("NOVEDADES: descanso médico, faltos y vacaciones no son puestos", () => {
    const dm = leer("ALEF BET", "JONATHAN");
    assert.deepEqual([dm.situacion, dm.puesto], ["descanso_medico", null]);
    assert.match(dm.detalle_novedad, /CINCO \(05\) DIAS/);
    assert.equal(leer("GIMEL DALET", "ROBERTO").situacion, "falto");
    assert.equal(leer("HE VAV", "JESUS").situacion, "vacaciones");
    assert.equal(leer("ZAYIN HET", "JACKSON").situacion, "vacaciones");
  });
  test("texto con los encabezados fuera de lugar: la propia fila delata la novedad", () => {
    // Así quedaba el texto guardado antes: las filas en orden, los títulos al final.
    const desordenado = "ROL DEL 10OCT26 AL 11OCT26 1 S2 PNP ALEF BET Jonathan CINCO (05) DIAS DEL 07OCT2026 AL 12OCT2026 DX. ESGUINCE "
      + "2 S3 PNP GIMEL DALET Roberto NOTA INFORMATIVA N° 2026000001 DE FECHA 08OCT2026 3 S2 PNP HE VAV Jesus TREINTA (30) DIAS VACACIONES REGLAMENTARIAS "
      + "4 S1 PNP OMICRON PI Jhon CEOPOL / NOTAS INFORMATIVAS NOVEDADES PERSONAL PNP FALTOS AL SERVICO OTROS (FRANCO)";
    const l = (a, n) => leerPuestoDelRol(desordenado, { apellidos: a, nombres: n });
    assert.equal(l("ALEF BET", "JONATHAN").situacion, "descanso_medico");
    assert.equal(l("GIMEL DALET", "ROBERTO").situacion, "falto");
    assert.equal(l("HE VAV", "JESUS").situacion, "vacaciones");
    assert.deepEqual([l("OMICRON PI", "JHON").situacion, l("OMICRON PI", "JHON").puesto], ["servicio", "CEOPOL / NOTAS INFORMATIVAS"]);
  });
  test("quien no figura", () => {
    assert.equal(leer("NADIE NINGUNO", "X").encontrado, false);
    assert.equal(leer("", "").encontrado, false);
  });
});
