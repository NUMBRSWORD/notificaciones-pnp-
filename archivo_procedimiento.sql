-- Archivo del Procedimiento: cierre de una infracción leve sin sanción.
-- Ejecutar una sola vez en Supabase SQL Editor. No elimina datos existentes.
alter table public.casos add column if not exists archivo_procedimiento_generado_at timestamptz;
alter table public.casos add column if not exists archivo_procedimiento_motivo text;
alter table public.casos add column if not exists archivo_procedimiento_resolucion_numero text;
alter table public.casos add column if not exists archivo_procedimiento_correlativo integer;

create index if not exists casos_archivo_procedimiento_idx
  on public.casos (archivo_procedimiento_generado_at)
  where archivo_procedimiento_generado_at is not null;
create unique index if not exists casos_archivo_procedimiento_correlativo_unico
  on public.casos (archivo_procedimiento_correlativo)
  where archivo_procedimiento_correlativo is not null;

-- Un solo contador por año para todos los oficiales de la aplicación.
create table if not exists public.correlativos_documentos (
  clave text primary key,
  ultimo_numero integer not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);
alter table public.correlativos_documentos enable row level security;

-- La función bloquea el expediente mientras asigna el número. Si el mismo caso
-- se intenta generar otra vez, devuelve su número reservado y no incrementa el contador.
drop function if exists public.reservar_correlativo_archivo_procedimiento(integer);
create or replace function public.reservar_correlativo_archivo_procedimiento(
  p_caso_id uuid,
  p_anio integer default extract(year from now())::integer
)
returns table(correlativo integer, resolucion_numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correlativo integer;
  v_numero text;
begin
  if p_anio < 2020 or p_anio > 2100 then
    raise exception 'Año de correlativo no válido';
  end if;

  select archivo_procedimiento_correlativo, archivo_procedimiento_resolucion_numero
    into v_correlativo, v_numero
    from public.casos
   where id = p_caso_id
   for update;

  if not found then
    raise exception 'No se encontró el caso solicitado';
  end if;

  -- Una segunda descarga o reintento conserva el número que ya recibió el caso.
  if v_correlativo is not null then
    v_numero := coalesce(v_numero, 'N.º ' || lpad(v_correlativo::text, 3, '0') || '-' || p_anio::text || '-COMVENT-A');
    update public.casos
       set archivo_procedimiento_resolucion_numero = v_numero
     where id = p_caso_id
       and archivo_procedimiento_resolucion_numero is null;
    return query select v_correlativo, v_numero;
    return;
  end if;

  insert into public.correlativos_documentos (clave, ultimo_numero)
  values ('archivo-procedimiento:' || p_anio::text, 1)
  on conflict (clave) do update
    set ultimo_numero = public.correlativos_documentos.ultimo_numero + 1,
        updated_at = now()
  returning ultimo_numero into v_correlativo;

  v_numero := 'N.º ' || lpad(v_correlativo::text, 3, '0') || '-' || p_anio::text || '-COMVENT-A';
  update public.casos
     set archivo_procedimiento_correlativo = v_correlativo,
         archivo_procedimiento_resolucion_numero = v_numero
   where id = p_caso_id;

  return query select v_correlativo, v_numero;
end;
$$;

revoke all on table public.correlativos_documentos from anon, authenticated;
revoke all on function public.reservar_correlativo_archivo_procedimiento(uuid, integer) from public;
grant execute on function public.reservar_correlativo_archivo_procedimiento(uuid, integer) to authenticated;