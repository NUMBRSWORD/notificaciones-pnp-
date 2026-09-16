-- Archivo del Procedimiento: cierre de una infracción leve sin sanción.
-- Ejecutar una sola vez en Supabase SQL Editor. No elimina datos.
alter table public.casos add column if not exists archivo_procedimiento_generado_at timestamptz;
alter table public.casos add column if not exists archivo_procedimiento_motivo text;
alter table public.casos add column if not exists archivo_procedimiento_resolucion_numero text;
create index if not exists casos_archivo_procedimiento_idx on public.casos (archivo_procedimiento_generado_at) where archivo_procedimiento_generado_at is not null;