# Activar la revisión del expediente firmado

Esta versión cambia el antiguo campo «cargo de notificación» por el **expediente firmado completo**. Antes de que el botón «Verificar con IA que esté completo» funcione en producción, hay que desplegar la función actualizada una vez en el proyecto Supabase de Notificaciones.

## Pasos en Supabase

1. Abra el proyecto `lymoicdeexusnjdjzfid`.
2. Entre a **Edge Functions** y abra `revisar-documento-ia`.
3. En **Code**, reemplace el contenido de `index.ts` con el archivo del repositorio: `supabase/functions/revisar-documento-ia/index.ts`.
4. Pulse **Deploy / Deploy updates** y espere el mensaje de actualización exitosa.
5. En **Secrets**, confirme que existe `ANTHROPIC_API_KEY`. No la copie al repositorio ni la pegue en la aplicación.

## Prueba final

1. Abra un caso con Orden de Sanción generada.
2. En «Cargo del expediente firmado», seleccione un solo PDF que contenga: Imputación, constancia de notificación, Descargo o Acta de no descargo, Orden y cargo de la Orden.
3. Pulse **Verificar con IA que esté completo**. La pantalla mostrará los documentos identificados o los que deben revisarse.
4. Compruebe la fecha sugerida y pulse **Registrar expediente firmado**.

La IA es una revisión de apoyo: el superior debe revisar el legajo y su fecha antes de guardarlo.