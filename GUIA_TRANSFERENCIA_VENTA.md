# Guía de transferencia o venta — CPNP Ventanilla

## Qué se entrega

El repositorio contiene la aplicación web/PWA, plantillas de documentos, lógica de generación, scripts SQL, funciones de Supabase y esta guía. Incluye el flujo de Imputación, Descargo o Acta de No Descargo, Orden de Sanción, cargo firmado, recepción del expediente completo, HT, Oficio y alertas móviles del superior investigador.

No se entregan automáticamente las cuentas, secretos, datos personales, expedientes, claves de API ni suscripciones móviles. Esos elementos se transfieren solo con autorización expresa y por un canal seguro.

## Dos formas de entrega

1. **Transferir la operación actual.** Se transfiere el repositorio GitHub y el proyecto Supabase al nuevo responsable. Antes, se deben rotar todas las claves y revisar qué datos históricos se conservan.
2. **Instalación limpia para un comprador.** Es la opción recomendada: el comprador crea su propio GitHub, Supabase y cuenta de IA; se despliega el código sin llevar datos disciplinarios de la unidad anterior.

## Inventario técnico

| Componente | Dónde está | Se transfiere |
|---|---|---|
| Código, estilos, PWA y plantillas | Repositorio GitHub | Sí |
| Base de datos, usuarios, archivos y roles | Proyecto Supabase | Solo si corresponde |
| Funciones Edge | `supabase/functions/` | Código sí; despliegue no |
| Reglas y tablas | Archivos `*.sql` | Sí; ejecución no |
| Alertas web push | VAPID y suscripciones en Supabase | Claves deben renovarse |
| IA de documentos | Cuenta/API de Anthropic | El comprador usa su propia cuenta |

## Instalación limpia

1. Entregar o clonar el repositorio en la cuenta GitHub del comprador.
2. Crear un proyecto Supabase nuevo, propiedad del comprador.
3. Ejecutar `supabase_setup.sql`. Luego ejecutar solo las migraciones aplicables: `permitir_oficiales_gestionar_sus_casos.sql`, `cargo_oficial_en_sello.sql`, `mesa_partes_expedientes_cerrados.sql`, `historial_actividad.sql`, `directivas_internas.sql`, `alertas_movil.sql`, `alertas_movil_superior.sql` y `alertas_automaticas.sql`.
4. Actualizar `config.js` con la URL y la clave pública del proyecto nuevo.
5. Crear el primer usuario y marcar su perfil como `admin` en Supabase.
6. Crear los buckets de Storage y políticas mediante el script inicial; comprobar que se puedan adjuntar PDF/fotos.
7. Desplegar las funciones Edge que use el comprador.
8. Publicar `main` en GitHub Pages, o en el hosting elegido, siempre con HTTPS.

## Funciones Edge y secretos

Las funciones de IA usan `ANTHROPIC_API_KEY`. Las alertas requieren `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Las alertas programadas requieren además `ALERTAS_CRON_SECRET`.

Las claves deben crearse en la cuenta del comprador y agregarse en **Supabase → Functions → Secrets**. Nunca se deben copiar en GitHub, archivos fuente, correos o documentos entregables.

La función de alerta manual se muestra como **notificar-sancion-pendiente**, pero el proyecto actual invoca su ruta técnica histórica `rapid-action`. Al transferir, se debe conservar esa ruta o actualizar simultáneamente la llamada en `app.js` y el nombre técnico de la función.

Para alertas programadas se despliega `alertas-automaticas`, se configura su secreto y se ejecuta `alertas_automaticas.sql`. El programador revisa los expedientes cada día a las 08:00 (hora Perú) y no vuelve a alertar una etapa que ya fue registrada como avanzada.

## Datos y documentos

Antes de transferir una instalación con información real, el titular debe decidir por escrito si entrega, exporta o elimina:

- Casos disciplinarios, archivos PDF/fotos y documentos generados.
- Padrón de efectivos con CIP/DNI.
- Usuarios, perfiles y suscripciones de notificaciones.
- Directivas internas, HT y oficios.

Para una venta a otra unidad o entidad, lo más seguro es entregar una base vacía y conservar los datos de producción en la unidad de origen.

## Prueba de aceptación del comprador

1. Iniciar sesión como administrador y como superior investigador.
2. Crear un caso de prueba y generar la Imputación.
3. Registrar notificación, luego un Descargo de prueba; verificar el análisis con IA.
4. Generar Orden, subir el cargo firmado y confirmar que desaparecen las alertas de esa etapa.
5. En Recepción, adjuntar un único PDF del expediente completo firmado; confirmar que la lista exige Imputación, notificación, Descargo/Acta, Orden y cargo.
6. Adjuntar HT y Oficio como administrador.
7. Instalar la PWA en un celular de prueba y comprobar una alerta pendiente.
8. Confirmar que un caso avanzado o cerrado no vuelve a generar la misma alerta.

## Costos que debe asumir el comprador

- GitHub Pages puede usarse sin costo según el plan y visibilidad del repositorio.
- Supabase puede requerir un plan pagado según usuarios, almacenamiento, funciones y uso de base de datos.
- Anthropic cobra el consumo de IA para lectura, análisis y redacción de documentos.
- Las notificaciones web push no necesitan un proveedor adicional, pero requieren HTTPS y un navegador compatible.

## Entrega comercial recomendada

Entregar: enlace al repositorio, versión/commit de entrega, guía, inventario de funciones, instrucciones de despliegue y acta de conformidad. El acta debe indicar expresamente si se incluyen datos históricos y quién será responsable de la cuenta Supabase, la cuenta de IA y las futuras actualizaciones.
