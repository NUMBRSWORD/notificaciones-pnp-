-- Deshace la migración 20261010120000_registro_de_errores.
-- La web sigue funcionando: si la función no existe, el envío de errores falla en
-- silencio y la sección de Historial muestra que no hay registro.
drop function if exists public.registrar_error_app(text, text, text, text, text, text);
drop table if exists public.errores_app;
