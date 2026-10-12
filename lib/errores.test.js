import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarError, crearLimitador, sinParametros } from "./errores.js";

test("arma la fila con archivo y línea, sin parámetros de la dirección", () => {
  assert.deepEqual(
    normalizarError("error", { mensaje: "TypeError: x is undefined", archivo: "https://a.invalid/web/app.js?v=3#x", linea: 10, columna: 5 }),
    { tipo: "error", mensaje: "TypeError: x is undefined", origen: "app.js:10:5" });
  assert.equal(sinParametros("https://a.invalid/index.html#access_token=SECRETO"), "https://a.invalid/index.html");
});

test("saca el origen de la pila cuando no hay archivo", () => {
  const f = normalizarError("promesa", { mensaje: "falló", pila: "Error: falló\n    at cargar (https://a.invalid/lib/archivo.js:42:7)" });
  assert.equal(f.origen, "archivo.js:42:7");
});

test("descarta el ruido que no es de Faltos y recorta lo largo", () => {
  assert.equal(normalizarError("error", { mensaje: "Script error." }), null);
  assert.equal(normalizarError("error", { mensaje: "ResizeObserver loop limit exceeded" }), null);
  assert.equal(normalizarError("error", { mensaje: "x", archivo: "chrome-extension://abc/content.js" }), null);
  assert.equal(normalizarError("aviso", { mensaje: "   " }), null);
  assert.equal(normalizarError("aviso", { mensaje: "a".repeat(900) }).mensaje.length, 500);
});

test("el limitador no repite y respeta el tope", () => {
  const pasa = crearLimitador(2);
  const a = { tipo: "error", mensaje: "a", origen: null };
  assert.equal(pasa(a), true);
  assert.equal(pasa({ ...a }), false);
  assert.equal(pasa({ tipo: "error", mensaje: "b", origen: null }), true);
  assert.equal(pasa({ tipo: "error", mensaje: "c", origen: null }), false);
  assert.equal(pasa(null), false);
});
