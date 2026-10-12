# Portación de moral-y-disciplina — octubre 2026

Segunda portación (la primera está en [PORTACION_MORAL_2026_09.md](./PORTACION_MORAL_2026_09.md)).
Trae a Notificaciones PNP lo que moral-y-disciplina ganó entre el 14-set y el
10-oct de 2026 y que aplica a infracciones leves en general.

La web publicada **funciona igual aunque todavía no se ejecuten los SQL ni se
vuelvan a desplegar las funciones**: cada mejora que depende del servidor se
apaga sola y dice qué falta. Lo que sigue activa todo.

## Qué incluye

| Mejora | Dónde | Necesita servidor |
|---|---|---|
| Plazo de descargo con feriados nacionales y fechas en hora de Lima (antes, de noche, los documentos salían con la fecha de mañana y el plazo vencía 5 h antes) | `lib/fechas.js`, `lib/utils.js` | No |
| Anexo I verificado código por código con el D.S. 016-2025-IN (había textos y rangos de sanción distintos, p. ej. L6, L10, L108, L111, L113) | `lib/anexoI.js` | No |
| Archivo del Procedimiento sin sanción (estaba en una rama sin unir a `main`) | `lib/archivoProcedimiento.js` | `archivo_procedimiento.sql` |
| Cambio obligatorio de la clave inicial (= CIP) y botón «Cambiar clave» | `lib/acceso.js` | `seguridad_claves.sql` (sin él, se pide igual al ingresar, pero solo en el navegador) |
| El administrador restablece la clave de quien la olvidó (Efectivos → Restablecer clave) | `app.js` | `seguridad_claves.sql` |
| **Hueco de seguridad cerrado**: con el registro abierto, una cuenta `337xxx@otro-dominio` veía y editaba los casos del oficial con ese CIP | `seguridad_claves.sql` | Sí |
| Quitar un descargo registrado por error | `app.js` | No |
| Las 7 funciones de IA exigen sesión iniciada (antes bastaba la clave pública) | `supabase/functions/*` | Volver a desplegarlas |
| Resumen ejecutivo IA sin nombres reales (E01, E02…) | `lib/privacidad.js` | No (opcional: redesplegar `generar-resumen-casos`) |
| Registro de errores del navegador, visible en Historial | `lib/errores.js` | `registro_de_errores.sql` |
| Política de seguridad del navegador (CSP) | `index.html`, `tests/csp.test.mjs` | No |
| Oficio de remisión desde el modelo real (Cierre administrativo del caso) | `lib/oficioRemision.js` | `oficio_remision.sql` (sin él se genera igual, pero no guarda el número) |
| Arreglos: carpeta de expediente cerrado con `CIP SIN-CIP`, botón Guardar tapado en el celular, enlaces azules ilegibles, asistente visible sin sesión | `app.js`, `styles.css` | No |

## Activación en Supabase (una sola vez, en este orden)

Proyecto: `lymoicdeexusnjdjzfid` → **SQL Editor** → *New query*. Pegue cada
archivo completo y ejecútelo. Todos son aditivos (no borran casos ni
documentos) y se pueden volver a ejecutar sin problema.

1. [`seguridad_claves.sql`](./seguridad_claves.sql) — para deshacerlo: `seguridad_claves-REVERTIR.sql`.
2. [`archivo_procedimiento.sql`](./archivo_procedimiento.sql)
3. [`registro_de_errores.sql`](./registro_de_errores.sql) — para deshacerlo: `registro_de_errores-REVERTIR.sql`.
4. [`oficio_remision.sql`](./oficio_remision.sql)

Después de `seguridad_claves.sql`, quien todavía tenga como clave su propio CIP
verá la ventana de cambio al ingresar y no podrá ver casos hasta cambiarla.

## Volver a desplegar las funciones de IA

Igual que en [DEPLOY_EDGE_FUNCTIONS.md](./DEPLOY_EDGE_FUNCTIONS.md): en **Edge
Functions**, abra cada una, reemplace el código por el del repositorio y pulse
**Deploy**:

`analizar-descargo-sancion`, `asistente-normativa`, `extraer-texto-vision`,
`generar-resumen-casos`, `redactar-hecho-imputacion`, `revisar-documento-ia`,
`sugerir-codigo-infraccion`.

Comprobación: con la sesión iniciada en la app, use «Sugerir código con IA»;
debe responder. Sin sesión, la función responde *401 Debe iniciar sesión*.

## Recomendado

- **Registro público**: hoy cualquiera puede crear una cuenta (Authentication →
  Sign In / Providers → *Allow new users to sign up*). Tras `seguridad_claves.sql`
  ya no puede ver casos ajenos, pero si las cuentas las crea siempre el
  administrador, conviene desactivarlo.
- **Historial del repositorio**: el repositorio es público. En el código actual
  se reemplazaron nombres, CIP y DNI de ejemplo por ficticios, pero siguen en
  commits anteriores (ver «Datos personales fuera del repositorio» en
  `moral-y-disciplina/docs/portar-a-notificaciones.md`).

## Qué NO se portó y por qué

- **Ingreso con Google, token (2FA) y pestaña Cuentas**: requieren configurar el
  proveedor de Google y MFA en el panel de Supabase de este proyecto.
- **Carga en lote de expedientes firmados y Archivo de expedientes (folders)**:
  en moral dependen de su tabla `expedientes` y de OCR por página; aquí el
  legajo firmado se sube por caso y Recepción ya ordena y respalda en Drive.
- **Informe Administrativo (G39/MG32), Continúan faltos, Reincorporación,
  descuento DIRREHUM, avisos Android**: son propios de faltas e
  inasistencias, no de infracciones leves en general.
- **Aviso de privacidad**: el texto de moral dice que la herramienta no
  pertenece a la PNP, lo que no corresponde a esta app; requiere redactarlo
  para este caso.

## Pruebas

```
npm ci
npm test          # 120 pruebas: lógica, fechas, Anexo I, oficio, CSP
npm run test:db   # PostgreSQL aislado (PGlite) para los 4 .sql nuevos
```
