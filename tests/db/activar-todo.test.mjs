// ACTIVAR_TODO_2026_10.sql: lo que se pega de una sola vez en el SQL Editor.
// Se comprueba que esté al día con sus 4 partes y que se pueda ejecutar dos
// veces seguidas (si alguien lo vuelve a correr por error) sin fallar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unirSql } from "../../scripts/unir-sql.mjs";
import { readFileSync } from "node:fs";

const raiz = new URL("../../", import.meta.url);
const leer = (p) => readFileSync(new URL(p, raiz), "utf8");

test("ACTIVAR_TODO_2026_10.sql está al día con sus 4 partes", async () => {
  const actual = (await readFile(new URL("ACTIVAR_TODO_2026_10.sql", raiz), "utf8")).replace(/\r\n/g, "\n");
  assert.equal(actual, unirSql(leer), "ejecute: node scripts/unir-sql.mjs");
});

test("se ejecuta completo dos veces seguidas sobre el esquema actual", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
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
    create table public.casos (id uuid primary key, oficial_constato_cip text, fecha_descargo date, sancion_generada_at timestamptz);
    create function public.es_admin() returns boolean language sql security definer set search_path = public as $$
      select exists (select 1 from public.perfiles where id = auth.uid() and role = 'admin') $$;
    create function public.cip_actual() returns text language sql stable security definer set search_path = public as $$
      select split_part(email, '@', 1) from auth.users where id = auth.uid() $$;
  `);
  const sql = await readFile(new URL("ACTIVAR_TODO_2026_10.sql", raiz), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const funciones = (await db.query(`select proname from pg_proc where proname in
    ('restablecer_clave_usuario','reservar_correlativo_archivo_procedimiento','registrar_error_app','confirmar_cambio_clave') order by 1`)).rows.map((r) => r.proname);
  assert.deepEqual(funciones, ["confirmar_cambio_clave", "registrar_error_app", "reservar_correlativo_archivo_procedimiento", "restablecer_clave_usuario"]);
  const columnas = (await db.query(`select column_name from information_schema.columns where table_name = 'casos' and column_name in ('oficio_remision_numero','archivo_procedimiento_resolucion_numero') order by 1`)).rows.map((r) => r.column_name);
  assert.deepEqual(columnas, ["archivo_procedimiento_resolucion_numero", "oficio_remision_numero"]);
});
