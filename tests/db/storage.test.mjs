// storage_borrado_propio.sql: en el bucket de los casos cada usuario solo
// borra lo que subió; el administrador, cualquier archivo. Los otros buckets
// no cambian. Se prueba con una tabla storage.objects mínima (PGlite).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const raiz = new URL("../../", import.meta.url);
const db = new PGlite();
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const OFICIAL = "00000000-0000-0000-0000-000000000001";
const OTRO = "00000000-0000-0000-0000-000000000002";

async function como(uid) {
  await db.exec("reset role");
  await db.query("select set_config('qa.uid', $1, false)", [uid]);
  await db.exec("set role authenticated");
}
const borrar = async (nombre) => (await db.query("delete from storage.objects where name = $1 returning name", [nombre])).rows.length;

before(async () => {
  await db.exec(`
    create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema public, auth, storage to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('qa.uid', true), '')::uuid $$;
    create table public.perfiles (id uuid primary key, role text);
    create function public.es_admin() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.perfiles where id = auth.uid() and role = 'admin') $$;
    create table storage.objects (id serial primary key, bucket_id text, name text, owner_id text);
    alter table storage.objects enable row level security;
    grant select, delete on storage.objects to authenticated;
    create policy "todos leen" on storage.objects for select to authenticated using (true);
    -- La política de hoy en producción:
    create policy "imputacion_pnp autenticados eliminan sustento" on storage.objects for delete to authenticated using (bucket_id = 'casos-imputacion-pnp');
    insert into public.perfiles values ('${ADMIN}', 'admin'), ('${OFICIAL}', 'viewer'), ('${OTRO}', 'viewer');
    insert into storage.objects (bucket_id, name, owner_id) values
      ('casos-imputacion-pnp', 'caso1/descargo_oficial.pdf', '${OFICIAL}'),
      ('casos-imputacion-pnp', 'caso1/sustento_oficial.pdf', '${OFICIAL}'),
      ('casos-imputacion-pnp', 'caso2/descargo_otro.pdf', '${OTRO}'),
      ('casos-imputacion-pnp', 'roles_servicio/rol.pdf', '${ADMIN}'),
      ('casos-imputacion-pnp', 'antiguo/sin_dueno.pdf', null),
      ('directivas', 'd1/archivo.pdf', '${OTRO}');
  `);
  // Antes del cambio: un oficial podía borrar el archivo de otro.
  await como(OFICIAL);
  await db.exec("begin");
  assert.equal(await borrar("caso2/descargo_otro.pdf"), 1);
  await db.exec("rollback");
  await db.exec("reset role");
  await db.exec(await readFile(new URL("storage_borrado_propio.sql", raiz), "utf8"));
});

test("un oficial no puede borrar archivos de otro ni del administrador", async () => {
  await como(OFICIAL);
  assert.equal(await borrar("caso2/descargo_otro.pdf"), 0);
  assert.equal(await borrar("roles_servicio/rol.pdf"), 0);
  assert.equal(await borrar("antiguo/sin_dueno.pdf"), 0);
});

test("un oficial sí puede borrar lo que él subió", async () => {
  await como(OFICIAL);
  assert.equal(await borrar("caso1/sustento_oficial.pdf"), 1);
});

test("el administrador puede borrar cualquier archivo del bucket", async () => {
  await como(ADMIN);
  assert.equal(await borrar("caso2/descargo_otro.pdf"), 1);
  assert.equal(await borrar("antiguo/sin_dueno.pdf"), 1);
  assert.equal(await borrar("roles_servicio/rol.pdf"), 1);
});

test("leer no cambia y los otros buckets no se tocan", async () => {
  await como(OTRO);
  assert.equal((await db.query("select count(*)::int n from storage.objects where name = 'caso1/descargo_oficial.pdf'")).rows[0].n, 1);
  assert.equal(await borrar("d1/archivo.pdf"), 0, "en directivas no hay política de borrado para no-admin");
});

test("se puede ejecutar dos veces y el REVERTIR deja todo como antes", async () => {
  await db.exec("reset role");
  await db.exec(await readFile(new URL("storage_borrado_propio.sql", raiz), "utf8"));
  await db.exec(await readFile(new URL("storage_borrado_propio-REVERTIR.sql", raiz), "utf8"));
  const politicas = (await db.query("select policyname from pg_policies where tablename = 'objects' and cmd = 'DELETE'")).rows.map((r) => r.policyname);
  assert.deepEqual(politicas, ["imputacion_pnp autenticados eliminan sustento"]);
  await db.exec(await readFile(new URL("storage_borrado_propio.sql", raiz), "utf8"));
});
