// Une los SQL de la portación de octubre 2026 en ACTIVAR_TODO_2026_10.sql,
// para pegarlos de una sola vez en el SQL Editor de Supabase.
// Uso: node scripts/unir-sql.mjs   (tests/db comprueba que esté al día)
import { readFileSync, writeFileSync } from "node:fs";

export const PARTES = ["seguridad_claves.sql", "archivo_procedimiento.sql", "registro_de_errores.sql", "oficio_remision.sql"];

export function unirSql(leer = (p) => readFileSync(p, "utf8")) {
  let cuerpo = `-- ============================================================================
-- ACTIVAR TODO (octubre 2026): los 4 SQL de la portación en un solo archivo.
-- Pegue TODO este archivo en Supabase -> SQL Editor -> New query -> Run.
-- Es aditivo (no borra casos, efectivos ni documentos) y se puede ejecutar
-- más de una vez sin problema. Contiene, en este orden:
--   1. seguridad_claves.sql       2. archivo_procedimiento.sql
--   3. registro_de_errores.sql    4. oficio_remision.sql
-- Se genera con scripts/unir-sql.mjs; no lo edite a mano.
-- ============================================================================
`;
  for (const p of PARTES) {
    cuerpo += `\n-- ######################## ${p} ########################\n\n` + leer(p).replace(/\r\n/g, "\n").trimEnd() + "\n";
  }
  return cuerpo;
}

if (process.argv[1]?.endsWith("unir-sql.mjs")) {
  writeFileSync("ACTIVAR_TODO_2026_10.sql", unirSql());
  console.log("ACTIVAR_TODO_2026_10.sql actualizado");
}
