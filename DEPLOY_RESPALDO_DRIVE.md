# Activar respaldo automático en Google Drive

Este respaldo es **solo del administrador**. Los oficiales no inician sesión en
Google, no ven la carpeta y no pueden autorizar ni descargar copias de Drive.
El PDF firmado, HT y oficio primero se guardan en Supabase y luego se copian a
Drive. Si Drive falla, el expediente no se pierde y el administrador puede
presionar **“Respaldar en Drive”** para reintentarlo.

## 1. Preparar la base de datos

En Supabase, abra **SQL Editor**, cree una consulta nueva, copie el contenido
completo de `respaldo_google_drive.sql` y presione **Run** una vez.

## 2. Crear el acceso OAuth de Drive

En el proyecto de Google Cloud donde ya se habilitó **Google Drive API**:

1. Abra **APIs y servicios → Pantalla de consentimiento OAuth**.
2. Seleccione **Interna** si su organización lo permite. Si no aparece,
   seleccione **Externa**, deje la aplicación en pruebas y agregue solamente
   su correo de administrador como usuario de prueba.
3. En **Credenciales → Crear credenciales → ID de cliente OAuth**, elija
   **Aplicación web** y use como nombre `CPNP Ventanilla Respaldo`.
4. En **URI de redireccionamiento autorizado** agregue exactamente:

   `https://lymoicdeexusnjdjzfid.supabase.co/functions/v1/google-drive-callback`

5. Guarde el **Client ID** y el **Client Secret**. No los copie a GitHub ni al
   código de la página.

El permiso solicitado será Google Drive completo porque se requiere crear y
ordenar carpetas por año, mes y expediente. La aplicación usa ese permiso solo
para escribir dentro de la carpeta configurada abajo.

## 3. Registrar secretos en Supabase

En **Edge Functions → Secrets**, cree estos tres secretos:

| Secreto | Valor |
| --- | --- |
| `GOOGLE_DRIVE_OAUTH_CLIENT_ID` | Client ID creado en Google Cloud |
| `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` | Client Secret creado en Google Cloud |
| `GOOGLE_DRIVE_FOLDER_EXPEDIENTES_ID` | `18VAuwqj9T8R1prGyD4kGGoMo3Clx1eux` |

El último valor corresponde a **01 Expedientes finalizados**, dentro de la
carpeta institucional `RESPALDO APP CPNP VENTANILLA` ya creada en Drive.

## 4. Desplegar las tres Edge Functions

Copie el archivo `index.ts` de cada carpeta al editor de una función nueva con
el mismo nombre técnico:

| Función | Requiere JWT |
| --- | --- |
| `google-drive-conectar` | Sí |
| `respaldar-expediente-drive` | Sí |
| `google-drive-callback` | **No** |

Para `google-drive-callback`, desactive **Verify JWT / Require JWT** antes de
desplegar. Google llega a esa URL después de la autorización y no posee una
sesión de Supabase. La propia función valida un estado temporal de 10 minutos.

## 5. Conectar la cuenta una sola vez

1. Abra la aplicación como **admin**.
2. Entre a **Recepción**.
3. Pulse **“Conectar Drive”**.
4. Elija su cuenta institucional de Google y acepte el permiso.
5. Debe aparecer la página **“Drive conectado”**. Al volver a Recepción se
   mostrará la cuenta conectada.

## Resultado esperado en Drive

Cada expediente se ordena así:

`01 Expedientes finalizados / AÑO / MES / FECHA - NOMBRES APELLIDOS - CIP - CÓDIGO /`

Dentro se guarda el PDF final firmado y, cuando los adjunte, el HT y el Oficio.
La aplicación conserva además la copia original privada de Supabase y muestra
la fecha de copia o un aviso para reintentar.
