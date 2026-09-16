# Activar Archivo del Procedimiento

Esta mejora permite cerrar un caso leve **sin sanción** cuando, luego de evaluar el descargo y los actuados, la conducta no se adecúa a un código del Anexo I.

## Activación única en Supabase

1. Abra el proyecto de Notificaciones PNP en Supabase.
2. Entre a **SQL Editor** y cree una consulta nueva.
3. Copie y ejecute por completo [`archivo_procedimiento.sql`](./archivo_procedimiento.sql).
4. Recargue la aplicación con `Ctrl + F5`.

El SQL agrega los campos del Archivo, un contador anual compartido y una función de reserva. No borra ni modifica expedientes existentes.

## Uso

1. Registre la Imputación y el descargo del investigado.
2. Abra el detalle del caso.
3. En **Archivo del Procedimiento (sin sanción)**, consigne únicamente el motivo. El número se asigna automáticamente, en orden correlativo para todos los oficiales.
4. Confirme la acción. Se descargará el documento Word y se guardará una versión en el Centro de documentos.

El expediente quedará como **Archivado sin sanción**, se quitará de pendientes y la Orden de Sanción ya no estará disponible para ese caso. Si se reintenta la descarga del mismo expediente, conservará su primer número asignado y no consumirá otro correlativo.