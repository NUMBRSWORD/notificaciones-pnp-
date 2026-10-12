-- Oficio de remisión: el número de oficio con el que se remite el expediente
-- queda en el caso, para no repetirlo entre casos ni perderlo.
-- Ejecutar una vez en el SQL Editor de Supabase. Es aditivo: no borra datos.
-- Sin este SQL el oficio se genera igual, pero su número no se guarda ni se
-- comprueba que no se repita.
alter table public.casos add column if not exists oficio_remision_numero text;

-- Dos expedientes con el mismo número de oficio se confunden en el archivo.
create unique index if not exists casos_oficio_remision_numero_unico
  on public.casos (oficio_remision_numero)
  where oficio_remision_numero is not null;
