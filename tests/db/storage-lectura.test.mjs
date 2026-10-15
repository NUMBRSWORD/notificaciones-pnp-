// storage_lectura_por_caso.sql: cada usuario solo lee y sube archivos de los
// casos que le corresponden (misma regla que la tabla casos). Esquema mínimo
// en PGlite con las políticas que hoy tiene producción.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const raiz = new URL("../../", import.meta.url);
const db = new PGlite();
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const OFICIAL = "00000000-0000-0000-0000-000000000001"; // CIP 400001
const OTRO = "00000000-0000-0000-0000-000000000002"; // CIP 400002
const INVESTIGADO = "00000000-0000-0000-0000-000000000003"; // CIP 400003
const CASO_OFICIAL = "10000000-0000-0000-0000-000000000001";
const CASO_OTRO = "10000000-0000-0000-0000-000000000002";
const CASO_BORRADO = "10000000-0000-0000-0000-000000000009";

async function como(uid) {
  await db.exec("reset role");
  await db.query("select set_config('qa.uid', $1, false)", [uid]);
  await db.exec("set role authenticated");
}
const lee = async (nombre) => (await db.query("select name from storage.objects where name = $1", [nombre])).rows.length === 1;
async function sube(nombre) {
  try { await db.query("insert into storage.objects (bucket_id, name, owner_id) values ('casos-imputacion-pnp', $1, (select auth.uid())::text)", [nombre]); return true; }
  catch (e) { if (/row-level security/.test(e.message)) return false; throw e; }
}

before(async () => {
  await db.exec(`
    create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema public, auth, storage to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('qa.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    create table public.perfiles (id uuid primary key, role text);
    create function public.es_admin() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.perfiles where id = auth.uid() and role = 'admin') $$;
    create function public.cip_actual() returns text language sql stable security definer set search_path = public as $$
      select split_part(email, '@', 1) from auth.users where id = auth.uid() $$;
    create table public.casos (id uuid primary key, oficial_constato_cip text, investigado_cip text);
    alter table public.casos enable row level security;
    grant select on public.casos to authenticated;
    create policy "ve casos propios, investigado o es admin" on public.casos for select to authenticated
      using (public.es_admin() or oficial_constato_cip = public.cip_actual() or investigado_cip = public.cip_actual());
    create table storage.objects (id serial primary key, bucket_id text, name text, owner_id text);
    alter table storage.objects enable row level security;
    grant select, insert, delete on storage.objects to authenticated;
    grant usage on sequence storage.objects_id_seq to authenticated;
    -- Políticas de hoy en producción para este bucket y otro bucket que no se toca:
    create policy "imputacion_pnp autenticados leen sustento" on storage.objects for select to authenticated using (bucket_id = 'casos-imputacion-pnp');
    create policy "imputacion_pnp autenticados suben sustento" on storage.objects for insert to authenticated with check (bucket_id = 'casos-imputacion-pnp');
    create policy "directivas_storage_select_authenticated" on storage.objects for select to authenticated using (bucket_id = 'directivas');

    insert into auth.users values ('${ADMIN}', 'admin@imputacionpnp.local'), ('${OFICIAL}', '400001@imputacionpnp.local'),
      ('${OTRO}', '400002@imputacionpnp.local'), ('${INVESTIGADO}', '400003@imputacionpnp.local');
    insert into public.perfiles values ('${ADMIN}', 'admin'), ('${OFICIAL}', 'viewer'), ('${OTRO}', 'viewer'), ('${INVESTIGADO}', 'viewer');
    insert into public.casos values ('${CASO_OFICIAL}', '400001', '400003'), ('${CASO_OTRO}', '400002', null);
    insert into storage.objects (bucket_id, name, owner_id) values
      ('casos-imputacion-pnp', '${CASO_OFICIAL}/descargo_1.pdf', '${OFICIAL}'),
      ('casos-imputacion-pnp', '${CASO_OTRO}/descargo_2.pdf', '${OTRO}'),
      ('casos-imputacion-pnp', '${CASO_BORRADO}/sustento_viejo.pdf', '${OTRO}'),
      ('casos-imputacion-pnp', 'roles_servicio/2026-10-10_rol.pdf', '${ADMIN}'),
      ('directivas', 'd1/archivo.pdf', '${ADMIN}');
  `);
  // Antes del cambio: un oficial leía el descargo de un caso ajeno.
  await como(OFICIAL);
  assert.equal(await lee(`${CASO_OTRO}/descargo_2.pdf`), true);
  await db.exec("reset role");
  await db.exec(await readFile(new URL("storage_lectura_por_caso.sql", raiz), "utf8"));
});

test("el oficial lee los archivos de sus casos y no los de casos ajenos", async () => {
  await como(OFICIAL);
  assert.equal(await lee(`${CASO_OFICIAL}/descargo_1.pdf`), true);
  assert.equal(await lee(`${CASO_OTRO}/descargo_2.pdf`), false);
  assert.equal(await lee(`${CASO_BORRADO}/sustento_viejo.pdf`), false);
});

test("los roles de servicio los lee cualquiera con sesión", async () => {
  await como(OTRO);
  assert.equal(await lee("roles_servicio/2026-10-10_rol.pdf"), true);
});

test("el investigado lee los archivos de su propio caso (misma regla que la tabla casos)", async () => {
  await como(INVESTIGADO);
  assert.equal(await lee(`${CASO_OFICIAL}/descargo_1.pdf`), true);
  assert.equal(await lee(`${CASO_OTRO}/descargo_2.pdf`), false);
});

test("el admin lee todo, incluso archivos de casos eliminados", async () => {
  await como(ADMIN);
  for (const n of [`${CASO_OFICIAL}/descargo_1.pdf`, `${CASO_OTRO}/descargo_2.pdf`, `${CASO_BORRADO}/sustento_viejo.pdf`]) assert.equal(await lee(n), true, n);
});

test("subir: el oficial solo a sus casos; el investigado no; roles solo el admin", async () => {
  await como(OFICIAL);
  assert.equal(await sube(`${CASO_OFICIAL}/generados/imputacion_1.docx`), true);
  assert.equal(await sube(`${CASO_OTRO}/intruso.pdf`), false);
  assert.equal(await sube("roles_servicio/falso.pdf"), false);
  assert.equal(await sube("cualquier/cosa.pdf"), false);
  await como(INVESTIGADO);
  assert.equal(await sube(`${CASO_OFICIAL}/descargo_propio.pdf`), false);
  await como(ADMIN);
  assert.equal(await sube("roles_servicio/2026-10-11_rol.pdf"), true);
  assert.equal(await sube(`${CASO_OTRO}/descargo_admin.pdf`), true);
});

test("el otro bucket no cambia y el SQL se puede ejecutar dos veces; REVERTIR vuelve atrás", async () => {
  await como(OFICIAL);
  assert.equal(await lee("d1/archivo.pdf"), true);
  await db.exec("reset role");
  await db.exec(await readFile(new URL("storage_lectura_por_caso.sql", raiz), "utf8"));
  await db.exec(await readFile(new URL("storage_lectura_por_caso-REVERTIR.sql", raiz), "utf8"));
  await como(OFICIAL);
  assert.equal(await lee(`${CASO_OTRO}/descargo_2.pdf`), true, "tras revertir, vuelve la regla anterior");
  await db.exec("reset role");
  await db.exec(await readFile(new URL("storage_lectura_por_caso.sql", raiz), "utf8"));
});
