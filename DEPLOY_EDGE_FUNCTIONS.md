# Desplegar las Edge Functions de IA

Estas funciones ya están escritas y guardadas en `supabase/functions/<nombre>/index.ts` dentro de este repo. Como no tengo acceso a tu cuenta de Supabase nueva, tienes que desplegarlas tú mismo — es el mismo tipo de paso manual que ya hiciste con `supabase_setup.sql`.

## Paso 1: configurar el secreto ANTHROPIC_API_KEY (una sola vez, antes de la primera función)

Todas las funciones necesitan tu clave de la API de Anthropic (Claude) para funcionar.

1. Ve al [dashboard de tu proyecto](https://supabase.com/dashboard/project/lymoicdeexusnjdjzfid) → **Edge Functions** → **Manage secrets** (o **Settings → Edge Functions → Secrets**).
2. Agrega un secreto nuevo: nombre `ANTHROPIC_API_KEY`, valor tu clave de Anthropic (la obtienes en [console.anthropic.com](https://console.anthropic.com/settings/keys) si no tienes una — **no me la pegues a mí en el chat**, ponla directo ahí).
3. Guarda.

## Paso 2: desplegar cada función (repetir 7 veces)

Para cada una de estas 7 funciones:

- `redactar-hecho-imputacion`
- `sugerir-codigo-infraccion`
- `revisar-documento-ia`
- `analizar-descargo-sancion`
- `asistente-normativa`
- `generar-resumen-casos`
- `extraer-texto-vision` — nueva: reemplaza el OCR débil que corría en el navegador (tesseract.js) por lectura de documentos escaneados con IA de visión. Si ya tenías las otras 6 desplegadas, esta es la única que falta agregar.

Haz esto:

1. Ve a **Edge Functions** en el dashboard de tu proyecto.
2. Click en **Deploy a new function** → elige la opción de **editor en el navegador** (no necesitas instalar nada).
3. Nombre de la función: escribe EXACTAMENTE el nombre de la lista de arriba (p. ej. `redactar-hecho-imputacion`) — la app llama a la función por ese nombre, si lo escribes distinto no la va a encontrar.
4. Borra el código de ejemplo que trae el editor.
5. Abre el archivo correspondiente en `supabase/functions/<nombre>/index.ts` de este repo, copia TODO el contenido, y pégalo en el editor.
6. Click en **Deploy**.
7. Repite con las otras.

## Paso 3: verificar

Cuando termines, entra a la app (`http://localhost:5501` o tu link publicado) y prueba:
- Crear un caso nuevo y usar "✨ Sugerir código con IA" y "✨ Redactar con IA".
- En el detalle de un caso, "🔍 Revisar con IA".
- El botón "✨ Resumen ejecutivo IA" del dashboard.
- El botón de chat 💬 abajo a la derecha (asistente).
- En un caso con descargo, "✨ Analizar descargo con IA" (dentro de Orden de Sanción).
- En Directivas, subir un PDF o foto escaneada y confirmar que el texto sale legible (esto ya no usa OCR del navegador, usa `extraer-texto-vision`).

Si alguna da error "Edge Function not found" o similar, revisa que el nombre esté escrito exactamente igual (sin mayúsculas ni espacios de más) y que el `ANTHROPIC_API_KEY` esté configurado.

## Nota para más adelante: Supabase CLI

Si en algún momento instalas la [Supabase CLI](https://supabase.com/docs/guides/cli) en tu computadora, podrás desplegar todas de una sola vez sin copiar y pegar, ejecutando esto desde esta carpeta:

```bash
supabase link --project-ref lymoicdeexusnjdjzfid
supabase functions deploy redactar-hecho-imputacion
supabase functions deploy sugerir-codigo-infraccion
supabase functions deploy revisar-documento-ia
supabase functions deploy analizar-descargo-sancion
supabase functions deploy asistente-normativa
supabase functions deploy generar-resumen-casos
supabase functions deploy extraer-texto-vision
supabase secrets set ANTHROPIC_API_KEY=tu-clave-aqui
```

Por ahora, con el método de copiar/pegar del Paso 2 es suficiente.
