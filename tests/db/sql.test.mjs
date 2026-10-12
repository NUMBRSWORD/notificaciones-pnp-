// Prueba PostgreSQL aislada (PGlite) de los .sql que se ejecutan a mano en
// Supabase: seguridad_claves.sql, archivo_procedimiento.sql y
// registro_de_errores.sql. No usa la base real: arma un esquema mínimo con
// las mismas funciones previas (es_admin, cip_actual) y comprueba permisos.
//
// Corre con: npm run test:db  (requiere npm ci)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const raiz = new URL("../../", import.meta.url);
const db = new PGlite({ extensions: { pgcrypto } });
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const OFICIAL = "00000000-0000-0000-0000-000000000001";
const OTRO = "00000000-0000-0000-0000-000000000002";
const INTRUSO = "00000000-0000-0000-0000-000000000003"; // "337635@otro.invalid"
const INICIAL = "00000000-0000-0000-0000-000000000004"; // clave = CIP
const CASO = "10000000-0000-0000-0000-000000000001";
const CASO_SANCIONADO = "10000000-0000-0000-0000-000000000002";
const CASO_SIN_DESCARGO = "10000000-0000-0000-0000-000000000003";

const uno = async (sql, params) => (await db.query(sql, params)).rows[0];
async function como(uid) {
  await db.exec("reset role");
  await db.query("select set_config('qa.uid', $1, false)", [uid || ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
}
async function falla(sql, patron, params) {
  await assert.rejects(db.query(sql, params), (e) => { assert.match(e.message, patron); return true; });
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema extensions;
    create extension pgcrypto schema extensions;
    grant usage on schema public, auth, extensions to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('qa.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text, encrypted_password text, updated_at timestamptz);
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
    create table public.perfiles (id uuid primary key, email text, role text not null default 'viewer');
    create table public.audit_log (id uuid primary key default gen_random_uuid(), table_name text, record_id uuid, action text, changed_by uuid, changed_by_email text, changed_at timestamptz default now(), old_data jsonb, new_data jsonb);
    create table public.casos (
      id uuid primary key, oficial_constato_cip text, fecha_descargo date,
      sancion_generada_at timestamptz
    );
    alter table public.casos enable row level security;
    grant select, update on public.casos to authenticated;

    -- Las funciones tal como están hoy en producción (supabase_setup.sql y
    -- seguridad_visibilidad_por_oficial.sql).
    create function public.es_admin() returns boolean language sql security definer set search_path = public as $$
      select exists (select 1 from public.perfiles where id = auth.uid() and role = 'admin') $$;
    create function public.cip_actual() returns text language sql stable security definer set search_path = public as $$
      select split_part(email, '@', 1) from auth.users where id = auth.uid() $$;
    create policy "ve casos propios o es admin" on public.casos for select to authenticated
      using (public.es_admin() or oficial_constato_cip = public.cip_actual());

    insert into auth.users values
      ('${ADMIN}', 'admin@imputacionpnp.local', extensions.crypt('clave-admin-1', extensions.gen_salt('bf')), now()),
      ('${OFICIAL}', '337635@imputacionpnp.local', extensions.crypt('clave-buena-1', extensions.gen_salt('bf')), now()),
      ('${OTRO}', '400001@imputacionpnp.local', extensions.crypt('clave-buena-2', extensions.gen_salt('bf')), now()),
      ('${INTRUSO}', '337635@otro.invalid', extensions.crypt('clave-intruso', extensions.gen_salt('bf')), now()),
      ('${INICIAL}', '400002@imputacionpnp.local', extensions.crypt('400002', extensions.gen_salt('bf')), now());
    insert into public.perfiles values
      ('${ADMIN}', 'admin@imputacionpnp.local', 'admin'), ('${OFICIAL}', '337635@imputacionpnp.local', 'viewer'),
      ('${OTRO}', '400001@imputacionpnp.local', 'viewer'), ('${INTRUSO}', '337635@otro.invalid', 'viewer'),
      ('${INICIAL}', '400002@imputacionpnp.local', 'viewer');
    insert into public.casos values
      ('${CASO}', '337635', '2026-09-10', null),
      ('${CASO_SANCIONADO}', '337635', '2026-09-10', now()),
      ('${CASO_SIN_DESCARGO}', '337635', null, null);
    insert into auth.sessions (user_id) values ('${OTRO}'), ('${OTRO}');
  `);
  // Antes de los cambios, el intruso con otro dominio sí veía el caso: es el
  // hueco que corrige seguridad_claves.sql.
  await como(INTRUSO);
  assert.equal((await db.query("select id from public.casos")).rows.length, 3);
  await db.exec("reset role");
  for (const archivo of ["seguridad_claves.sql", "archivo_procedimiento.sql", "registro_de_errores.sql"]) {
    await db.exec(await readFile(new URL(archivo, raiz), "utf8"));
  }
});

test("cip_actual solo reconoce cuentas internas @imputacionpnp.local", async () => {
  await como(INTRUSO);
  assert.equal((await uno("select public.cip_actual() cip")).cip, null);
  assert.equal((await db.query("select id from public.casos")).rows.length, 0);
  await como(OFICIAL);
  assert.equal((await uno("select public.cip_actual() cip")).cip, "337635");
  assert.equal((await db.query("select id from public.casos")).rows.length, 3);
});

test("la clave inicial (= CIP) deja la cuenta sin acceso hasta cambiarla", async () => {
  await como(INICIAL);
  assert.equal((await uno("select public.exigir_cambio_si_clave_inicial() m")).m, true);
  assert.equal((await uno("select public.necesita_cambiar_clave() n")).n, true);
  assert.equal((await uno("select public.cip_actual() cip")).cip, null);
  // Sin cambiar la clave, confirmar no levanta la marca.
  assert.equal((await uno("select public.confirmar_cambio_clave() c")).c, false);
  await db.exec("reset role");
  await db.query("update auth.users set encrypted_password = extensions.crypt('Nueva-clave-9', extensions.gen_salt('bf')) where id = $1", [INICIAL]);
  await como(INICIAL);
  assert.equal((await uno("select public.confirmar_cambio_clave() c")).c, true);
  assert.equal((await uno("select public.necesita_cambiar_clave() n")).n, false);
  assert.equal((await uno("select public.cip_actual() cip")).cip, "400002");
  // Una clave distinta del CIP no marca nada.
  await como(OFICIAL);
  assert.equal((await uno("select public.exigir_cambio_si_clave_inicial() m")).m, false);
});

test("restablecer clave: solo admin, no a otro admin ni a sí mismo", async () => {
  await como(null);
  await falla("select public.restablecer_clave_usuario('400001')", /permission denied/);
  await como(OFICIAL);
  await falla("select public.restablecer_clave_usuario('400001')", /Solo un administrador/);
  await como(ADMIN);
  await falla("select public.restablecer_clave_usuario('40a001')", /CIP válido/);
  await falla("select public.restablecer_clave_usuario('999999')", /No hay una cuenta/);
  const { clave } = await uno("select public.restablecer_clave_usuario(' 400001 ') clave");
  assert.match(clave, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await db.exec("reset role");
  const u = await uno("select encrypted_password = extensions.crypt($1, encrypted_password) ok from auth.users where id = $2", [clave, OTRO]);
  assert.equal(u.ok, true);
  assert.equal((await uno("select count(*)::int n from auth.sessions where user_id = $1", [OTRO])).n, 0);
  assert.equal((await uno("select count(*)::int n from public.cambios_clave_pendientes where user_id = $1", [OTRO])).n, 1);
  assert.equal((await uno("select count(*)::int n from public.audit_log where record_id = $1 and new_data->>'evento' = 'clave_restablecida'", [OTRO])).n, 1);
  assert.ok(!JSON.stringify((await db.query("select new_data from public.audit_log")).rows).includes(clave), "la clave no queda en el historial");
  // La cuenta restablecida no accede a nada hasta cambiar la clave temporal.
  await como(OTRO);
  assert.equal((await uno("select public.necesita_cambiar_clave() n")).n, true);
  assert.equal((await uno("select public.es_admin() a")).a, false);
});

test("archivo del procedimiento: solo el dueño o admin, con descargo y sin orden", async () => {
  await como(INTRUSO);
  await falla("select * from public.reservar_correlativo_archivo_procedimiento($1, 2026)", /No tiene permiso/, [CASO]);
  await como(OTRO);
  await falla("select * from public.reservar_correlativo_archivo_procedimiento($1, 2026)", /No tiene permiso/, [CASO]);
  await como(OFICIAL);
  await falla("select * from public.reservar_correlativo_archivo_procedimiento($1, 2026)", /Orden de Sanción/, [CASO_SANCIONADO]);
  await falla("select * from public.reservar_correlativo_archivo_procedimiento($1, 2026)", /registre el descargo/, [CASO_SIN_DESCARGO]);
  const r1 = await uno("select * from public.reservar_correlativo_archivo_procedimiento($1, 2026)", [CASO]);
  assert.deepEqual([r1.correlativo, r1.resolucion_numero], [1, "N.º 001-2026-COMVENT-A"]);
  // Un reintento conserva el número y no consume otro.
  const r2 = await uno("select * from public.reservar_correlativo_archivo_procedimiento($1, 2026)", [CASO]);
  assert.deepEqual([r2.correlativo, r2.resolucion_numero], [1, "N.º 001-2026-COMVENT-A"]);
});

test("archivo del procedimiento: el contador de un año nuevo no choca con el anterior", async () => {
  await db.exec("reset role");
  await db.exec("insert into public.casos values ('10000000-0000-0000-0000-000000000009', '337635', '2027-01-05', null)");
  await como(ADMIN);
  const r = await uno("select * from public.reservar_correlativo_archivo_procedimiento('10000000-0000-0000-0000-000000000009', 2027)");
  assert.deepEqual([r.correlativo, r.resolucion_numero], [1, "N.º 001-2027-COMVENT-A"]);
});

test("registro de errores: escribe con sesión, suma repetidos y solo lo lee el admin", async () => {
  await como(null);
  await falla("select public.registrar_error_app('error', 'x')", /permission denied/);
  await como(OFICIAL);
  await db.query("select public.registrar_error_app('error', 'TypeError: algo', 'app.js:1:1')");
  await db.query("select public.registrar_error_app('error', 'TypeError: algo', 'app.js:1:1')");
  await falla("insert into public.errores_app (dia, firma, tipo, mensaje) values (current_date, 'x', 'error', 'y')", /permission denied/);
  assert.equal((await db.query("select * from public.errores_app")).rows.length, 0, "un viewer no lee los errores");
  await como(ADMIN);
  const filas = (await db.query("select veces, tipo from public.errores_app")).rows;
  assert.deepEqual(filas, [{ veces: 2, tipo: "error" }]);
});
