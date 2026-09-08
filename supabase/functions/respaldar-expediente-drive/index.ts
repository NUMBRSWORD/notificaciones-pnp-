import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_OAUTH_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_OAUTH_CLIENT_SECRET") || "";
const ROOT_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_EXPEDIENTES_ID") || "";
const cors = {
  "Access-Control-Allow-Origin": "https://numbrsword.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type TipoArchivo = "expediente" | "ht" | "oficio";
type Conexion = { refresh_token: string; access_token: string | null; access_token_expira_at: string | null };

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization) throw new Error("Debe iniciar sesión.");
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await cliente.auth.getUser();
  if (authError || !auth.user) throw new Error("Sesión no válida.");
  const { data: perfil, error: perfilError } = await cliente.from("perfiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (perfilError || perfil?.role !== "admin") throw new Error("Solo el administrador puede respaldar en Drive.");
}

const escapeQuery = (value: string) => value.replaceAll("'", "\\'");

async function accessToken(admin: ReturnType<typeof createClient>): Promise<string> {
  const { data: conexion, error } = await admin.from("google_drive_conexion").select("refresh_token, access_token, access_token_expira_at").eq("id", true).maybeSingle<Conexion>();
  if (error || !conexion?.refresh_token) throw new Error("Drive aún no está conectado. Conéctelo desde Recepción.");
  const vence = conexion.access_token_expira_at ? new Date(conexion.access_token_expira_at).getTime() : 0;
  if (conexion.access_token && vence > Date.now() + 60_000) return conexion.access_token;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: conexion.refresh_token, grant_type: "refresh_token" }),
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error("Google rechazó la autorización guardada. Vuelva a conectar Drive.");
  await admin.from("google_drive_conexion").update({ access_token: token.access_token, access_token_expira_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", true);
  return token.access_token;
}

async function driveFetch(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`Google Drive respondió ${response.status}: ${await response.text()}`);
  return response;
}

async function findOrCreateFolder(name: string, parentId: string, token: string): Promise<string> {
  const query = `'${escapeQuery(name)}' in name and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const search = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`, token);
  const existing = await search.json();
  if (existing.files?.[0]?.id) return existing.files[0].id;
  const create = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const folder = await create.json();
  if (!folder.id) throw new Error("No se pudo crear la carpeta de respaldo en Drive.");
  return folder.id;
}

async function caseFolder(expediente: Record<string, string | null>, token: string) {
  const fecha = expediente.fecha_hecho || new Date().toISOString().slice(0, 10);
  const [anio, mes = "sin-mes"] = fecha.split("-");
  const carpeta = expediente.carpeta_archivo || "expediente-sin-identificar";
  const anioId = await findOrCreateFolder(anio || "sin-anio", ROOT_FOLDER_ID, token);
  const mesId = await findOrCreateFolder(mes, anioId, token);
  return findOrCreateFolder(carpeta, mesId, token);
}

async function uploadFile(fileId: string | null, name: string, parent: string, blob: Blob, token: string) {
  if (fileId) {
    const update = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,webViewLink`, token, {
      method: "PATCH", headers: { "Content-Type": blob.type || "application/pdf" }, body: blob,
    });
    return update.json();
  }
  const boundary = `pnp-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parent] });
  const payload = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type || "application/pdf"}\r\n\r\n`, blob,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const create = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", token, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: payload,
  });
  return create.json();
}

async function probarDrive(token: string) {
  const nombreCarpeta = `PRUEBA AUTOMATICA - ${new Date().toISOString()}`;
  const crearCarpeta = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombreCarpeta, mimeType: "application/vnd.google-apps.folder", parents: [ROOT_FOLDER_ID] }),
  });
  const carpeta = await crearCarpeta.json();
  if (!carpeta.id) throw new Error("No se pudo crear la carpeta temporal de prueba.");
  let archivoId = "";
  try {
    const contenido = new Blob(["Prueba automática de respaldo CPNP Ventanilla. Este archivo se elimina inmediatamente."], { type: "text/plain" });
    const archivo = await uploadFile(null, "PRUEBA_RESPALDO_SE_ELIMINA.txt", carpeta.id, contenido, token);
    if (!archivo.id) throw new Error("Drive no confirmó la carga temporal.");
    archivoId = archivo.id;
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${archivoId}`, token, { method: "DELETE" });
  } finally {
    // La carpeta tiene nombre único; se elimina incluso si la prueba falla.
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${carpeta.id}`, token, { method: "DELETE" }).catch((error) => console.error("No se pudo borrar la carpeta temporal:", error));
  }
  return { archivoId, carpetaEliminada: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !ROOT_FOLDER_ID) return json({ error: "El respaldo de Drive aún no está configurado." }, 503);
  let admin: ReturnType<typeof createClient> | null = null;
  let expedienteId = "";
  try {
    await requireAdmin(req);
    const body = await req.json();
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (body?.modo === "prueba") {
      const token = await accessToken(admin);
      const resultado = await probarDrive(token);
      return json({ ok: true, prueba: true, ...resultado });
    }
    expedienteId = typeof body.expedienteId === "string" ? body.expedienteId : "";
    const tipo: TipoArchivo = ["expediente", "ht", "oficio"].includes(body.tipo) ? body.tipo : "expediente";
    if (!expedienteId) return json({ error: "Falta identificar el expediente." }, 400);
    const { data: expediente, error: expedienteError } = await admin.from("expedientes_remitidos").select("id, fecha_hecho, carpeta_archivo, archivo_path, archivo_nombre, archivo_ht_path, archivo_ht_nombre, archivo_oficio_path, archivo_oficio_nombre, drive_expediente_file_id, drive_ht_file_id, drive_oficio_file_id").eq("id", expedienteId).maybeSingle();
    if (expedienteError || !expediente) return json({ error: "No se encontró el expediente." }, 404);
    const campos = tipo === "expediente"
      ? { path: expediente.archivo_path, name: expediente.archivo_nombre, fileId: expediente.drive_expediente_file_id, idField: "drive_expediente_file_id", urlField: "drive_expediente_url" }
      : tipo === "ht"
        ? { path: expediente.archivo_ht_path, name: expediente.archivo_ht_nombre, fileId: expediente.drive_ht_file_id, idField: "drive_ht_file_id", urlField: "drive_ht_url" }
        : { path: expediente.archivo_oficio_path, name: expediente.archivo_oficio_nombre, fileId: expediente.drive_oficio_file_id, idField: "drive_oficio_file_id", urlField: "drive_oficio_url" };
    if (!campos.path || !campos.name) return json({ error: `Aún no hay ${tipo === "ht" ? "HT" : tipo === "oficio" ? "Oficio" : "PDF final"} para respaldar.` }, 409);
    const token = await accessToken(admin);
    const folder = await caseFolder(expediente, token);
    const { data: blob, error: downloadError } = await admin.storage.from("expedientes-terminados-pnp").download(campos.path);
    if (downloadError || !blob) throw downloadError || new Error("No se pudo descargar el archivo desde Supabase.");
    const uploaded = await uploadFile(campos.fileId, campos.name, folder, blob, token);
    if (!uploaded.id) throw new Error("Drive no devolvió la identificación del archivo respaldado.");
    const { error: updateError } = await admin.from("expedientes_remitidos").update({ [campos.idField]: uploaded.id, [campos.urlField]: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`, drive_sync_at: new Date().toISOString(), drive_error: null }).eq("id", expedienteId);
    if (updateError) throw updateError;
    return json({ ok: true, tipo, fileId: uploaded.id, url: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}` });
  } catch (error) {
    console.error(error);
    if (admin && expedienteId) await admin.from("expedientes_remitidos").update({ drive_error: error instanceof Error ? error.message.slice(0, 500) : "Error al respaldar en Drive." }).eq("id", expedienteId);
    return json({ error: error instanceof Error ? error.message : "No se pudo respaldar en Drive." }, 500);
  }
});
