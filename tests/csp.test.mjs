// La política de seguridad (CSP) de index.html debe autorizar exactamente lo que la
// web usa: su script en línea (por huella sha256), los módulos de esm.sh y el
// Supabase de config.js. Si se edita el script en línea sin recalcular su huella,
// el navegador lo bloquearía en silencio; esta prueba lo detecta antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const raiz = new URL("../", import.meta.url);
// El sitio sirve el archivo tal como está en Git (saltos de línea LF). En Windows la
// copia de trabajo puede tener CRLF, que cambia la huella: se normaliza.
const html = (await readFile(new URL("index.html", raiz), "utf8")).replace(/\r\n/g, "\n");
const politica = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

test("index.html declara su política de seguridad antes de cualquier script", () => {
  assert.ok(politica, "falta la política en index.html");
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"), "la política debe ir antes del primer script");
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'"]) assert.ok(politica.includes(d), d);
  assert.ok(!/'unsafe-eval'/.test(politica), "no debe permitir eval");
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(politica), "no debe permitir scripts en línea sin huella");
});

test("cada script en línea está autorizado por su huella", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const contenido of scripts) {
    const huella = `'sha256-${createHash("sha256").update(contenido, "utf8").digest("base64")}'`;
    assert.ok(politica.includes(huella), `script en línea sin autorizar: ${contenido.trim().slice(0, 60)}…`);
  }
});

test("autoriza el Supabase de config.js y los módulos externos que se importan", async () => {
  const config = await readFile(new URL("config.js", raiz), "utf8");
  const host = new URL(config.match(/SUPABASE_URL = "([^"]+)"/)[1]).host;
  assert.ok(politica.includes(`https://${host}`) && politica.includes(`wss://${host}`));
  const libs = (await readdir(new URL("lib/", raiz))).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  let js = await readFile(new URL("app.js", raiz), "utf8");
  for (const f of libs) js += await readFile(new URL(`lib/${f}`, raiz), "utf8");
  const hosts = new Set([...js.matchAll(/from ["'](https:\/\/[^/"']+)\//g), ...js.matchAll(/import\(["'](https:\/\/[^/"']+)\//g)].map((m) => m[1]));
  assert.ok(hosts.size > 0);
  for (const h of hosts) assert.ok(politica.includes(h), `módulo de ${h} no autorizado en la política`);
});
