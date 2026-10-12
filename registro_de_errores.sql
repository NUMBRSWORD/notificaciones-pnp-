-- Registro de errores de la web y de la app (para enterarse cuando algo falla).
--
-- Antes, si a un usuario le salía un error, nadie se enteraba salvo que lo contara.
-- Ahora la página manda cada error (fallo de programa, aviso de error mostrado,
-- bloqueo de la política de seguridad) a registrar_error_app() y el administrador
-- los ve en Historial.
--
-- Cuidados:
--   - Solo cuentas con sesión; nadie escribe la tabla directamente.
--   - El mismo error de la misma persona en el mismo día suma «veces» en vez de
--     repetir filas, y hay un tope de 100 errores distintos por persona y día.
--   - Textos recortados; se guardan 30 días (se borran solos al registrar).
--   - Solo el administrador puede leerlos (pueden mencionar datos de un caso).
-- Ejecutar una vez en el SQL Editor de Supabase. Reversión: registro_de_errores-REVERTIR.sql

create table if not exists public.errores_app (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dia         date not null,
  firma       text not null,
  tipo        text not null check (tipo in ('error', 'promesa', 'aviso', 'csp')),
  mensaje     text not null,
  origen      text,
  ruta        text,
  version     text,
  agente      text,
  veces       integer not null default 1,
  primero_at  timestamptz not null default now(),
  ultimo_at   timestamptz not null default now(),
  unique (user_id, dia, firma)
);
create index if not exists errores_app_ultimo_idx on public.errores_app (ultimo_at desc);
create index if not exists errores_app_dia_idx on public.errores_app (dia);

alter table public.errores_app enable row level security;
revoke all on public.errores_app from anon, authenticated;
grant select on public.errores_app to authenticated;
drop policy if exists "solo admin lee los errores" on public.errores_app;
create policy "solo admin lee los errores" on public.errores_app
  for select to authenticated using (public.es_admin());

create or replace function public.registrar_error_app(
  p_tipo text, p_mensaje text, p_origen text default null, p_ruta text default null,
  p_version text default null, p_agente text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user    uuid := auth.uid();
  v_dia     date := (now() at time zone 'America/Lima')::date;
  v_tipo    text := case when p_tipo in ('error', 'promesa', 'aviso', 'csp') then p_tipo else 'error' end;
  v_mensaje text := left(coalesce(nullif(btrim(p_mensaje), ''), '(sin mensaje)'), 500);
  v_origen  text := left(nullif(btrim(p_origen), ''), 200);
  v_firma   text;
begin
  if v_user is null then return; end if;
  v_firma := md5(v_tipo || '|' || v_mensaje || '|' || coalesce(v_origen, ''));

  update public.errores_app
     set veces = veces + 1, ultimo_at = now()
   where user_id = v_user and dia = v_dia and firma = v_firma;
  if found then return; end if;

  if (select count(*) from public.errores_app where user_id = v_user and dia = v_dia) >= 100 then
    return;
  end if;

  insert into public.errores_app (user_id, dia, firma, tipo, mensaje, origen, ruta, version, agente)
  values (v_user, v_dia, v_firma, v_tipo, v_mensaje, v_origen,
          left(nullif(btrim(p_ruta), ''), 200), left(nullif(btrim(p_version), ''), 60),
          left(nullif(btrim(p_agente), ''), 160))
  on conflict (user_id, dia, firma) do update set veces = public.errores_app.veces + 1, ultimo_at = now();

  delete from public.errores_app where dia < v_dia - 30;
end;
$$;

revoke all on function public.registrar_error_app(text, text, text, text, text, text) from public, anon;
grant execute on function public.registrar_error_app(text, text, text, text, text, text) to authenticated;
