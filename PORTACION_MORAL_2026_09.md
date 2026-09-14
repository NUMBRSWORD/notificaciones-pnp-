# Portación de mejoras de Moral y Disciplina

Este repositorio incorpora las mejoras funcionales recientes de `moral-y-disciplina` adaptadas a la tabla `casos` de Notificaciones PNP.

## Incluido

- **Roles de servicio por fecha**: el administrador adjunta el PDF o imagen del rol; al registrar un caso se guarda el puesto asignado. Si existe un puesto, se incorpora igual en la Imputación y en la Orden, sin modificar la descripción base del hecho.
- **Cumplimiento**: política institucional versionada y constancia de firma vinculada a la cuenta autenticada. Cuando el administrador modifica una política, sube su versión y se pide una nueva firma.
- **Panel mensual**: casos por código, cantidad de efectivos y reiterativos sin mostrar su identidad (solo grado, número de casos y códigos).
- **Padrón protegido**: el listado completo de efectivos, DNI y búsqueda de personal quedan reservados para administración; el oficial solo conserva acceso a su propio registro. La Orden usa el `investigado_cip` que quedó guardado en el caso.
- **Calidad continua**: `npm run check`, pruebas existentes y flujo de GitHub Actions.

## Activación en Supabase (una sola vez)

1. Abra **SQL Editor** en el proyecto de Supabase de Notificaciones.
2. Copie y ejecute completo [`roles_cumplimiento_y_padron.sql`](./roles_cumplimiento_y_padron.sql).
3. Recargue la aplicación. Aparecerán las pestañas **Cumplimiento** para todos y **Roles** para el administrador.

El SQL es aditivo: agrega `puesto_rol`, crea las tablas necesarias y cambia solo la lectura del padrón. No elimina expedientes, documentos ni efectivos.

## Rol con IA

El análisis automático del contenido de un rol requiere desplegar una Edge Function adicional que enviaría el texto del rol y el nombre consultado al proveedor de IA configurado. No se despliega automáticamente: debe existir autorización expresa para esa transferencia de datos. Mientras tanto, los roles se pueden archivar y el campo **Puesto / servicio según el rol** se puede completar manualmente.

## Uso recomendado

1. Admin: cargue el rol en **Roles** para la fecha correspondiente.
2. Al crear el caso, revise el puesto detectado o escríbalo manualmente.
3. Antes de generar, use **Revisar**. La Imputación y la Orden emplearán la misma precisión del puesto.
4. En **Panel**, elija el mes para ver patrones operativos sin exponer nombres.
5. En **Cumplimiento**, cada usuario firma la versión vigente de la política.