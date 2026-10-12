// Carga perezosa de las dependencias pesadas de generación de .docx (PizZip,
// docxtemplater, file-saver — todas solo de navegador, vía esm.sh). Al NO
// importarlas en el nivel superior de imputacion.js / actaNoDescargo.js /
// ordenSancion.js, esos módulos se pueden cargar con `node --test` para
// probar las funciones puras construirDatos*() sin necesitar red ni DOM.
let _cache;

export async function cargarDocxDeps() {
  if (!_cache) {
    const [pz, dt, fs] = await Promise.all([
      import("https://esm.sh/pizzip@3.1.7"),
      import("https://esm.sh/docxtemplater@3.50.0"),
      import("https://esm.sh/file-saver@2.0.5"),
    ]);
    _cache = { PizZip: pz.default, Docxtemplater: dt.default, saveAs: fs.default };
  }
  return _cache;
}
