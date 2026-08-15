# Notificación de Imputación PNP

Genera el documento oficial **"Inicio de Imputación de Infracción Leve"** (cargo de Notificación y Entrega de Acto Administrativo Disciplinario, PNP – Ley N° 30714) para **cualquier hecho leve constatado**, no solo ausencia/reincorporación. El oficial describe libremente lo ocurrido; el sistema arma el documento con los datos del investigado, la infracción (Anexo I) y el superior que lo notifica.

Es un proyecto **totalmente independiente** de `moral-y-disciplina`: código propio, y en Supabase usa su propio esquema (`imputacion_pnp`) dentro del mismo proyecto "MORAL Y DISCIPLINA" — no toca `notas_informativas`, `efectivos`, `expedientes` ni `profiles` de esa otra app.

## Antes de usarlo: 1 paso manual obligatorio en Supabase

Las tablas y políticas de seguridad ya están creadas (esquema `imputacion_pnp`), pero Supabase solo expone por API los esquemas que uno marca explícitamente como "Exposed schemas". Hazlo una sola vez:

1. Entra al [dashboard del proyecto MORAL Y DISCIPLINA](https://supabase.com/dashboard/project/tndjulaitywtoocqeeiy/settings/api).
2. Ve a **Project Settings → API → Exposed schemas**.
3. Agrega `imputacion_pnp` a la lista (debe quedar algo como `public, imputacion_pnp`, sin borrar `public`).
4. Guarda.

Sin este paso la app cargará pero dará error "schema not found" al iniciar sesión.

## Primer usuario administrador

1. Abre la app y usa **"Regístrese aquí"** para crear tu cuenta (nace con rol `viewer`, solo puede ver, no crear casos).
2. En el dashboard de Supabase, ve a **Table Editor → esquema `imputacion_pnp` → tabla `perfiles`**, busca tu fila y cambia `role` a `admin`.
3. Vuelve a entrar a la app (cierra sesión y entra de nuevo) — ya podrás crear casos, efectivos, etc.
4. Desde ahí, para dar de alta a otros oficiales, cada uno se registra y tú (admin) le cambias el rol igual que en el paso 2.

## Cargar el catálogo de Efectivos

Esta app no comparte el catálogo de `efectivos` de `moral-y-disciplina` (son esquemas separados). Empieza vacío. Un admin puede:
- Agregarlos uno por uno con el botón **"+ Nuevo efectivo"** en la pestaña Efectivos, o
- Insertarlos en bloque directamente en Supabase (Table Editor → `imputacion_pnp.efectivos`, botón "Insert" → "Import data from CSV") si tienes un CSV con columnas `grado, cip, dni, apellidos_nombres`.

Como mínimo, deben estar registrados los oficiales que van a figurar como **"Oficial que constató"** en los casos (para que el sistema pueda completar automáticamente su CIP y armar el sello de la notificación).

## Publicarlo (GitHub Pages)

1. Crea un repositorio nuevo en GitHub (por ejemplo `notificacion-imputacion-pnp`) y sube todos estos archivos.
2. En el repo, ve a **Settings → Pages → Build and deployment → Source: GitHub Actions**. El workflow en `.github/workflows/jekyll-gh-pages.yml` (ya incluido, igual al de `moral-y-disciplina`) lo despliega automáticamente en cada push a `main`.
3. Tu app quedará en `https://<tu-usuario>.github.io/notificacion-imputacion-pnp/` — un link distinto al de `moral-y-disciplina`.

## Cómo funciona la generación del documento

- `lib/anexoI.js`: catálogo de las 117 infracciones **Leves** con su Bien Jurídico y sanción (mismo Anexo I que ya usas).
- `lib/imputacion.js`: arma los datos del documento a partir de un **caso** (`grado`, `apellidos`, `nombres`, `codigo_infraccion`, `descripcion_hecho` libre, `oficial_constato`, `unidad_investigado`) y los inserta en `plantillas/plantilla_imputacion_leve.docx` (la plantilla oficial exacta, sin cambios) con `docxtemplater`.
- A diferencia de `moral-y-disciplina`, aquí **no existe** ningún narrador de texto fijo tipo "ausencia y reincorporación": la `descripcion_hecho` la escribe el oficial en el formulario, tal cual va a salir en el documento.
- Sigue restringido a infracciones **Leves** (L1–L117 del Anexo I), como se acordó — Graves y Muy Graves quedan fuera de este generador por ahora.

## Estructura

```
index.html          Interfaz (login, registro, lista de casos, efectivos, detalle)
app.js               Lógica de la app (Supabase, tablas, modales, exportar Excel)
config.js            URL/clave de Supabase + esquema a usar
styles.css           Estilos (idénticos a moral-y-disciplina)
lib/anexoI.js         Catálogo Anexo I (infracciones Leves)
lib/imputacion.js      Construcción de datos + generación del .docx
plantillas/plantilla_imputacion_leve.docx   Plantilla oficial (idéntica, sin cambios)
```

## Próximos pasos posibles (no incluidos todavía)

- Acta de No Recepción de Descargos y Orden de Sanción para casos generales (hoy solo existen para `moral-y-disciplina`; se pueden portar con el mismo patrón que `imputacion.js` si hace falta).
- Extender a infracciones Graves/Muy Graves.
- Registrar el descargo recibido desde la vista de detalle del caso.
