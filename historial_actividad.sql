-- ============================================================================
-- Historial de actividad inmutable, igual que en moral-y-disciplina: registra
-- automáticamente (por trigger, no depende de que la app se acuerde de
-- llamarlo) cada INSERT/UPDATE/DELETE en casos y efectivos, con quién lo
-- hizo y el antes/después completo. Nadie puede editarlo ni borrarlo por la
-- API (ni siquiera admin) -- solo el trigger, que corre con privilegios de
-- superusuario.
-- ============================================================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_by uuid references auth.users(id),
  changed_by_email text,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

create index audit_log_changed_at_idx on public.audit_log (changed_at desc);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id);

alter table public.audit_log enable row level security;

create policy "solo admin lee el historial"
  on public.audit_log for select
  to authenticated
  using (es_admin());

create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_log (table_name, record_id, action, changed_by, changed_by_email, old_data, new_data)
  values (
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    v_email,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  return coalesce(NEW, OLD);
end;
$$;

create trigger audit_casos
  after insert or update or delete on public.casos
  for each row execute function public.fn_audit_log();

create trigger audit_efectivos
  after insert or update or delete on public.efectivos
  for each row execute function public.fn_audit_log();
