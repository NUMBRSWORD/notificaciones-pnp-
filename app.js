import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.mjs";
import { createWorker } from "https://esm.sh/tesseract.js@5.1.1";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA } from "./config.js";
import { generarImputacionDocx, puedeGenerarImputacion, buscarOficialConstato, tokens } from "./lib/imputacion.js";
import { generarActaNoDescargoDocx, puedeGenerarActaNoDescargo, plazoDescargoVencido, fechaLimiteDescargo } from "./lib/actaNoDescargo.js";
import { generarOrdenSancionDocx, puedeGenerarOrdenSancion, opcionesTercio, analisisSinDescargoDefault } from "./lib/ordenSancion.js";
import { getInfraccion, normalizarCodigoInfraccion, ANEXO_I } from "./lib/anexoI.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.worker.mjs";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: SUPABASE_SCHEMA },
});

// ---------- Lectura de PDF/imagen (texto seleccionable u OCR) ----------
async function extractPdfText(file, onEstado) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  // Si el PDF es una foto/escaneo sin texto seleccionable, se recurre a OCR.
  if (text.trim().length < 30) {
    onEstado?.("Este archivo parece ser una imagen escaneada: leyendo con reconocimiento de texto (OCR), puede tardar unos segundos...");
    const worker = await createWorker("spa");
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 3 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const { data } = await worker.recognize(canvas);
        text += data.text + "\n";
      }
    } finally {
      await worker.terminate();
    }
  }
  return text;
}

async function extractImagenTextoConOcr(blob) {
  const worker = await createWorker("spa");
  try {
    const { data } = await worker.recognize(blob);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

const state = {
  session: null,
  role: null,
  email: null,
  cip: null,
  casos: [],
  efectivos: [],
  currentCasoId: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(fechaISO) {
  if (!fechaISO) return "-";
  const [y, m, d] = fechaISO.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ---------- View switching ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  const map = { "view-dashboard": "casos", "view-efectivos": "efectivos" };
  if (map[id]) {
    document.querySelector(`.tab-btn[data-view="${map[id]}"]`)?.classList.add("active");
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.view;
    if (target === "casos") { showView("view-dashboard"); loadCasos(); }
    if (target === "efectivos") { showView("view-efectivos"); loadEfectivos(); }
  });
});

$("btnVolverDashboard").addEventListener("click", () => { showView("view-dashboard"); loadCasos(); });

// ---------- Anexo I datalist ----------
const anexoOptions = Object.entries(ANEXO_I)
  .map(([codigo, inf]) => `<option value="${codigo}">${escapeHtml(inf.infraccion.slice(0, 90))}</option>`)
  .join("");
$("listaAnexoI").innerHTML = anexoOptions;

function actualizarPreviewInfraccion() {
  const el = $("infraccionPreview");
  const codigo = $("fCodigoInfraccion").value.trim();
  const inf = getInfraccion(codigo);
  if (!inf) { el.classList.add("hidden"); return; }
  el.textContent = `${normalizarCodigoInfraccion(codigo)} — ${inf.bienJuridico}: ${inf.infraccion} (${inf.sancion})`;
  el.classList.remove("hidden");
}
$("fCodigoInfraccion").addEventListener("input", actualizarPreviewInfraccion);

// ---------- IA en el formulario de nuevo caso ----------
$("fArchivoSustento").addEventListener("change", (e) => {
  $("btnRedactarHechoIA").disabled = !e.target.files[0];
});

$("btnRedactarHechoIA").addEventListener("click", async () => {
  const file = $("fArchivoSustento").files[0];
  const statusEl = $("hechoIAStatus");
  if (!file) return;
  const btn = $("btnRedactarHechoIA");
  btn.disabled = true;
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Leyendo el archivo de sustento...";
  try {
    const esPdf = file.type === "application/pdf";
    const esImagen = file.type.startsWith("image/");
    const texto = esPdf
      ? await extractPdfText(file, (msg) => { statusEl.textContent = msg; })
      : esImagen
      ? await (async () => { statusEl.textContent = "Leyendo la imagen con reconocimiento de texto (OCR)..."; return extractImagenTextoConOcr(file); })()
      : "";

    statusEl.textContent = "Redactando la descripción del hecho con IA...";
    const codigo = normalizarCodigoInfraccion($("fCodigoInfraccion").value.trim());
    const infraccion = getInfraccion(codigo);
    const { data, error } = await supabase.functions.invoke("redactar-hecho-imputacion", {
      body: {
        investigadoCompleto: `${$("fGrado").value.trim()} ${$("fApellidos").value.trim()} ${$("fNombres").value.trim()}`.trim(),
        fechaHecho: $("fFechaHecho").value,
        codigoInfraccion: codigo || $("fCodigoInfraccion").value.trim(),
        infraccionTexto: infraccion?.infraccion || "",
        textoDocumento: texto,
        notasOficial: $("fDescripcionHecho").value.trim(),
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.descripcion_hecho) {
      $("fDescripcionHecho").value = data.descripcion_hecho;
      statusEl.textContent = "Listo — revise el texto redactado antes de guardar.";
    } else {
      statusEl.textContent = "La IA no devolvió una descripción. Escríbala usted mismo.";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo redactar con IA: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
});

$("btnSugerirCodigoIA").addEventListener("click", async () => {
  const hecho = $("fDescripcionHecho").value.trim();
  const sugEl = $("codigoIASugerencia");
  if (!hecho) {
    sugEl.textContent = "Escriba primero la descripción del hecho.";
    sugEl.classList.remove("hidden");
    return;
  }
  const btn = $("btnSugerirCodigoIA");
  btn.disabled = true;
  sugEl.classList.remove("hidden");
  sugEl.textContent = "Consultando el Anexo I con IA...";
  try {
    const catalogo = Object.entries(ANEXO_I).map(([codigo, inf]) => ({ codigo, ...inf }));
    const { data, error } = await supabase.functions.invoke("sugerir-codigo-infraccion", {
      body: { descripcionHecho: hecho, catalogo },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.codigo_sugerido) {
      $("fCodigoInfraccion").value = data.codigo_sugerido;
      actualizarPreviewInfraccion();
      const alternativas = (data.alternativas || []).length ? ` (alternativas: ${data.alternativas.join(", ")})` : "";
      sugEl.textContent = `IA sugiere ${data.codigo_sugerido}${alternativas}: ${data.justificacion || ""}`;
    } else {
      sugEl.textContent = data?.justificacion || "La IA no pudo determinar un código con certeza. Elíjalo usted mismo.";
    }
  } catch (err) {
    console.error(err);
    sugEl.textContent = "No se pudo consultar la IA: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Auth ----------
async function loadProfile(userId, email) {
  let { data, error } = await supabase
    .from("perfiles")
    .select("email, role")
    .eq("id", userId)
    .single();
  if (error || !data) {
    // El trigger de la base de datos debería crear el perfil automáticamente
    // al registrarse; si por algo no existe todavía, se crea aquí como
    // respaldo (rol viewer por defecto).
    const ins = await supabase.from("perfiles").insert({ id: userId, email }).select("email, role").single();
    data = ins.data;
  }
  state.role = data?.role || "viewer";
  state.email = data?.email || email;
  // Los oficiales inician sesión con "{cip}@imputacionpnp.local" -- de ahí se
  // saca el CIP para poder autocompletar "Oficial que constató" con sus
  // propios datos. Si entró con un correo real (autoregistro), no hay CIP.
  const cipMatch = /^(\d+)@imputacionpnp\.local$/.exec(state.email || "");
  state.cip = cipMatch ? cipMatch[1] : null;
  $("userEmail").textContent = state.email;
  $("userRole").textContent = state.role;
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", state.role !== "admin");
  });
}

async function onAuthed(session) {
  state.session = session;
  $("topbar").classList.remove("hidden");
  await loadProfile(session.user.id, session.user.email);
  showView("view-dashboard");
  await loadEfectivos();
  loadCasos();
}

function onSignedOut() {
  state.session = null;
  state.role = null;
  $("topbar").classList.add("hidden");
  showView("view-login");
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) onAuthed(session); else onSignedOut();
});

supabase.auth.getSession().then(({ data }) => {
  if (data.session) onAuthed(data.session); else onSignedOut();
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").classList.add("hidden");
  let email = $("loginEmail").value.trim();
  if (/^\d+$/.test(email)) email = `${email}@imputacionpnp.local`;
  const password = $("loginPassword").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    $("loginError").textContent = "Correo o clave incorrectos.";
    $("loginError").classList.remove("hidden");
  }
});

$("btnLogout").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// ---------- Registro (autoservicio; nace con rol "viewer") ----------
$("linkMostrarRegistro").addEventListener("click", (e) => {
  e.preventDefault();
  showView("view-registro");
});
$("linkMostrarLogin").addEventListener("click", (e) => {
  e.preventDefault();
  showView("view-login");
});

$("registroForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("registroError");
  const okEl = $("registroOk");
  errEl.classList.add("hidden");
  okEl.classList.add("hidden");
  const email = $("regEmail").value.trim();
  const password = $("regPassword").value;
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.remove("hidden");
      return;
    }
    okEl.textContent = "Cuenta creada. Ya puede ingresar (si su proyecto exige confirmar el correo, revise su bandeja).";
    okEl.classList.remove("hidden");
    $("registroForm").reset();
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Casos ----------
async function loadCasos() {
  const { data, error } = await supabase
    .from("casos")
    .select("*")
    .order("fecha_hecho", { ascending: false });
  if (error) { console.error(error); return; }
  state.casos = data || [];
  renderCasosTable(state.casos);
}

let casosVisibles = [];

function renderCasosTable(list) {
  casosVisibles = list;
  const tbody = $("casosTableBody");
  tbody.innerHTML = "";
  $("casosEmpty").classList.toggle("hidden", list.length > 0);
  for (const c of list) {
    const tr = document.createElement("tr");
    const puedeDescargar = puedeGenerarImputacion(c, state.efectivos);
    tr.innerHTML = `
      <td>${escapeHtml(c.grado || "")}</td>
      <td>${escapeHtml(c.apellidos || "")} ${escapeHtml(c.nombres || "")}</td>
      <td>${formatDate(c.fecha_hecho)}</td>
      <td>${escapeHtml(c.codigo_infraccion || "")}</td>
      <td>${escapeHtml(c.oficial_constato || "-")}</td>
      <td>${c.imputacion_generada_at ? '<span class="pill pill-yes">Sí</span>' : '<span class="pill pill-no">Pendiente</span>'}</td>
      <td class="row-actions">${puedeDescargar ? `<button type="button" class="btn-secondary btn-descargar-imputacion" title="Descargar Inicio de Imputación de Infracción Leve">⬇ Imputación</button>` : ""} <span class="row-chevron">›</span></td>
    `;
    tr.addEventListener("click", () => openCasoDetail(c.id));
    tr.querySelector(".btn-descargar-imputacion")?.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDescargarImputacion(c, e.currentTarget);
    });
    tbody.appendChild(tr);
  }
}

async function handleDescargarImputacion(caso, btnEl) {
  const textoOriginal = btnEl ? btnEl.textContent : null;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Generando..."; }
  try {
    await generarImputacionDocx(caso, state.efectivos);
    // Se registra la primera vez que se genera/descarga: es la fecha que se
    // usa como notificación al investigado para contar el plazo de descargo.
    if (!caso.imputacion_generada_at) {
      const ahora = new Date().toISOString();
      const { error } = await supabase.from("casos").update({ imputacion_generada_at: ahora }).eq("id", caso.id);
      if (!error) caso.imputacion_generada_at = ahora;
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "No se pudo generar el documento de imputación.");
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = textoOriginal; }
  }
}

// Revisión de apoyo (no bloqueante) antes de generar la Imputación: la IA
// mira si la descripción del hecho es coherente con el código elegido, la
// fecha, y el archivo de sustento (si hay uno adjunto).
async function revisarConsistenciaImputacion(caso) {
  const btn = $("btnRevisarConsistencia");
  const resultadoEl = $("revisionIAResultado");
  btn.disabled = true;
  resultadoEl.classList.remove("hidden");
  resultadoEl.textContent = "Revisando con IA...";
  try {
    let textoDocumento = "";
    if (caso.archivo_sustento_path) {
      const { data: blob, error } = await supabase.storage.from("casos-imputacion-pnp").download(caso.archivo_sustento_path);
      if (!error && blob) {
        const esPdf = /\.pdf$/i.test(caso.archivo_sustento_nombre || "") || blob.type === "application/pdf";
        const esImagen = /\.(jpe?g|png|webp|bmp)$/i.test(caso.archivo_sustento_nombre || "") || blob.type.startsWith("image/");
        if (esPdf) textoDocumento = await extractPdfText(blob, () => {});
        else if (esImagen) textoDocumento = await extractImagenTextoConOcr(blob);
      }
    }
    const infraccion = getInfraccion(caso.codigo_infraccion);
    const { data, error } = await supabase.functions.invoke("revisar-documento-ia", {
      body: {
        tipo: "imputacion",
        codigoInfraccion: normalizarCodigoInfraccion(caso.codigo_infraccion),
        infraccionTexto: infraccion?.infraccion || "",
        fechaHecho: caso.fecha_hecho,
        descripcionHecho: caso.descripcion_hecho || "",
        textoDocumento,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.consistente) {
      resultadoEl.textContent = "✓ La IA no encontró inconsistencias evidentes.";
    } else {
      const observaciones = (data?.observaciones || []).join(" · ");
      resultadoEl.textContent = `⚠ ${observaciones || "La IA encontró posibles inconsistencias."}`;
    }
  } catch (err) {
    console.error(err);
    resultadoEl.textContent = "No se pudo revisar con IA: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

function aplicarFiltrosCasos() {
  const q = $("searchCasos").value.toLowerCase();
  const desde = $("filtroDesde").value;
  const hasta = $("filtroHasta").value;
  const filtered = state.casos.filter((c) => {
    const coincideTexto = !q || [c.nombres, c.apellidos, c.codigo_infraccion, c.grado]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
    const coincideDesde = !desde || (c.fecha_hecho && c.fecha_hecho >= desde);
    const coincideHasta = !hasta || (c.fecha_hecho && c.fecha_hecho <= hasta);
    return coincideTexto && coincideDesde && coincideHasta;
  });
  renderCasosTable(filtered);
}

$("searchCasos").addEventListener("input", aplicarFiltrosCasos);
$("filtroDesde").addEventListener("change", aplicarFiltrosCasos);
$("filtroHasta").addEventListener("change", aplicarFiltrosCasos);
$("btnLimpiarFiltroFecha").addEventListener("click", () => {
  $("filtroDesde").value = "";
  $("filtroHasta").value = "";
  aplicarFiltrosCasos();
});

// ---------- Resumen ejecutivo (IA) ----------
function construirResumenEstadoCasos() {
  return state.casos.map((c) => ({
    investigado: `${c.grado || ""} ${c.apellidos || ""} ${c.nombres || ""}`.replace(/\s+/g, " ").trim(),
    codigo_infraccion: c.codigo_infraccion || null,
    fecha_hecho: c.fecha_hecho || null,
    imputacion_notificada: !!c.imputacion_generada_at,
    fecha_notificacion_imputacion: c.imputacion_generada_at ? c.imputacion_generada_at.slice(0, 10) : null,
    plazo_descargo_vencido: plazoDescargoVencido(c),
    descargo_recibido: !!c.fecha_descargo,
    acta_no_descargo_generada: !!c.acta_no_descargo_generada_at,
    sancion_generada: !!c.sancion_generada_at,
    sancion_tercio: c.sancion_tercio_label || null,
    orden_notificada: !!c.orden_notificada_at,
  }));
}

async function generarResumenEjecutivo() {
  const btn = $("btnResumenEjecutivo");
  const panel = $("resumenEjecutivoPanel");
  const statusEl = $("resumenEjecutivoStatus");
  const contenidoEl = $("resumenEjecutivoContenido");
  panel.classList.remove("hidden");
  contenidoEl.textContent = "";
  statusEl.textContent = "Generando resumen ejecutivo con IA...";
  statusEl.classList.remove("hidden");
  btn.disabled = true;
  try {
    const casos = construirResumenEstadoCasos();
    const { data, error } = await supabase.functions.invoke("generar-resumen-casos", {
      body: { fechaHoy: new Date().toISOString().slice(0, 10), casos },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    contenidoEl.textContent = data?.resumen || "No se pudo generar el resumen.";
    statusEl.classList.add("hidden");
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo generar el resumen: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

$("btnResumenEjecutivo").addEventListener("click", generarResumenEjecutivo);
$("btnCerrarResumenEjecutivo").addEventListener("click", () => {
  $("resumenEjecutivoPanel").classList.add("hidden");
});

// ---------- Asistente de consulta flotante ----------
const state_asistenteHistorial = [];
const CATALOGO_ASISTENTE = Object.entries(ANEXO_I).map(([codigo, inf]) => ({ codigo, ...inf }));

function agregarMensajeAsistente(role, texto) {
  state_asistenteHistorial.push({ role, texto });
  const div = document.createElement("div");
  div.className = `asistente-msg ${role === "asistente" ? "asistente-msg-bot" : "asistente-msg-user"}`;
  div.textContent = texto;
  const mensajesEl = $("asistenteMensajes");
  mensajesEl.appendChild(div);
  mensajesEl.scrollTop = mensajesEl.scrollHeight;
}

$("btnAbrirAsistente").addEventListener("click", () => {
  $("asistenteWidget").classList.remove("hidden");
  if (!state_asistenteHistorial.length) {
    agregarMensajeAsistente("asistente", "Hola, soy el asistente de consulta de Notificación de Imputación PNP. Puede preguntarme sobre el procedimiento (Imputación → descargo → Acta de No Descargo u Orden de Sanción) o sobre cualquier código del Anexo I (L1–L117).");
  }
});
$("btnCerrarAsistente").addEventListener("click", () => {
  $("asistenteWidget").classList.add("hidden");
});

$("asistenteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("asistenteInput");
  const pregunta = input.value.trim();
  if (!pregunta) return;
  agregarMensajeAsistente("oficial", pregunta);
  input.value = "";
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const { data, error } = await supabase.functions.invoke("asistente-normativa", {
      body: {
        catalogo: CATALOGO_ASISTENTE,
        historial: state_asistenteHistorial.slice(0, -1).slice(-8),
        pregunta,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    agregarMensajeAsistente("asistente", data?.respuesta || "No se pudo obtener una respuesta.");
  } catch (err) {
    console.error(err);
    agregarMensajeAsistente("asistente", "Ocurrió un error al consultar: " + (err.message || err));
  } finally {
    submitBtn.disabled = false;
  }
});

$("btnExportarExcel").addEventListener("click", () => {
  if (!casosVisibles.length) { alert("No hay casos para exportar (revise el buscador)."); return; }
  const filas = casosVisibles.map((c) => ({
    "Grado": c.grado || "",
    "Apellidos y nombres": `${c.apellidos || ""} ${c.nombres || ""}`.trim(),
    "Fecha del hecho": formatDate(c.fecha_hecho),
    "Código infracción": c.codigo_infraccion || "",
    "Descripción del hecho": c.descripcion_hecho || "",
    "Oficial que constató": c.oficial_constato || "-",
    "Notificado": c.imputacion_generada_at ? "Sí" : "Pendiente",
  }));
  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja["!cols"] = Object.keys(filas[0]).map((k) => ({ wch: Math.max(k.length, 14) }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Casos");
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `casos_imputacion_${fecha}.xlsx`);
});

// ---------- Detalle de caso ----------
async function openCasoDetail(id) {
  const { data: caso, error } = await supabase
    .from("casos")
    .select("*")
    .eq("id", id)
    .single();
  if (error) { console.error(error); return; }
  state.currentCasoId = id;
  await renderCasoDetail(caso);
  showView("view-caso-detail");
}

async function fileLinkHtml(bucket, path, name) {
  if (!path) return '<span class="muted small">No adjuntado</span>';
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) return '<span class="muted small">Error al obtener archivo</span>';
  return `<a class="file-link" href="${data.signedUrl}" target="_blank" rel="noopener">📎 ${escapeHtml(name || "Ver archivo")}</a>`;
}

async function renderCasoDetail(caso) {
  const isAdmin = state.role === "admin";
  const sustentoArchivo = await fileLinkHtml("casos-imputacion-pnp", caso.archivo_sustento_path, caso.archivo_sustento_nombre);
  const descargoArchivo = await fileLinkHtml("casos-imputacion-pnp", caso.archivo_descargo_path, caso.archivo_descargo_nombre);
  const puedeDescargar = puedeGenerarImputacion(caso, state.efectivos);
  const infraccion = getInfraccion(caso.codigo_infraccion);
  const puedeActa = puedeGenerarActaNoDescargo(caso, state.efectivos);
  const plazoVencido = plazoDescargoVencido(caso);
  const fechaLimite = fechaLimiteDescargo(caso);
  const puedeSancion = puedeGenerarOrdenSancion(caso, state.efectivos);
  const opcionesSancion = opcionesTercio(caso.codigo_infraccion) || [];

  $("casoDetailContent").innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <h3>${escapeHtml(caso.grado || "")} ${escapeHtml(caso.apellidos || "")} ${escapeHtml(caso.nombres || "")}</h3>
        <div style="display:flex; gap:8px">
          ${puedeDescargar ? `<button type="button" class="btn-secondary" id="btnRevisarConsistencia">🔍 Revisar con IA</button>` : ""}
          <button type="button" class="btn-secondary" id="btnDescargarImputacion" ${puedeDescargar ? "" : "disabled"}>⬇ Descargar Imputación</button>
        </div>
      </div>
      ${!puedeDescargar ? `<p class="muted small">Para poder generar el documento, verifique que el código de infracción sea Leve válido (Anexo I) y que el oficial que constató ("${escapeHtml(caso.oficial_constato || "")}") esté registrado en Efectivos.</p>` : ""}
      <p id="revisionIAResultado" class="muted small hidden"></p>
      <div class="detail-grid">
        <div class="detail-field"><div class="label">Fecha del hecho</div><div class="value">${formatDate(caso.fecha_hecho)}</div></div>
        <div class="detail-field"><div class="label">Código de infracción</div><div class="value">${escapeHtml(caso.codigo_infraccion || "-")}${infraccion ? ` — ${escapeHtml(infraccion.bienJuridico)}` : ""}</div></div>
        <div class="detail-field"><div class="label">Oficial que constató</div><div class="value">${escapeHtml(caso.oficial_constato || "-")}</div></div>
        <div class="detail-field"><div class="label">Unidad / Sub-unidad</div><div class="value">${escapeHtml(caso.unidad_investigado || "-")}</div></div>
        <div class="detail-field"><div class="label">Archivo de sustento</div><div class="value">${sustentoArchivo}</div></div>
        <div class="detail-field">
          <div class="label">Fecha de notificación de la Imputación</div>
          <div class="value">
            ${isAdmin ? `
              <form id="notificacionForm" class="inline-edit">
                <input type="date" id="fNotificacion" value="${caso.imputacion_generada_at ? caso.imputacion_generada_at.slice(0, 10) : ""}" required />
                <button type="submit" class="btn-secondary">Guardar</button>
              </form>
              <p id="notificacionMsg" class="error small hidden"></p>
            ` : (caso.imputacion_generada_at ? formatDate(caso.imputacion_generada_at) : "Pendiente")}
          </div>
        </div>
      </div>
      <div class="detail-field" style="margin-top:10px">
        <div class="label">Descripción del hecho</div>
        <div class="value">${escapeHtml(caso.descripcion_hecho || "-")}</div>
      </div>
      ${isAdmin ? `<button class="btn-danger" id="btnEliminarCaso" style="margin-top:16px">Eliminar caso</button>` : ""}
    </div>

    <div class="detail-card">
      <h3>Acta de No Descargo</h3>
      ${!caso.imputacion_generada_at ? `
        <p class="muted small">Registre la fecha de notificación de la Imputación (arriba) para calcular el plazo de descargo.</p>
      ` : caso.fecha_descargo ? `
        <p class="muted small">El investigado sí presentó descargo — no corresponde generar el acta.</p>
        <div class="detail-grid">
          <div class="detail-field"><div class="label">Fecha de descargo</div><div class="value">${formatDate(caso.fecha_descargo)}</div></div>
          <div class="detail-field"><div class="label">N.º de documento</div><div class="value">${escapeHtml(caso.numero_descargo || "-")}</div></div>
          <div class="detail-field"><div class="label">Archivo</div><div class="value">${descargoArchivo}</div></div>
        </div>
      ` : `
        <p class="muted small">Plazo de descargo vence el ${formatDate(fechaLimite)}.</p>
        ${plazoVencido ? `
          ${puedeActa ? `<button type="button" class="btn-secondary" id="btnDescargarActa">⬇ Descargar Acta de No Descargo</button>` : `<p class="muted small">Venció el plazo, pero no se pudo ubicar en Efectivos al oficial o al investigado para generar el acta.</p>`}
        ` : `<p class="muted small">El plazo aún está vigente, todavía no corresponde generar el acta.</p>`}
        ${isAdmin ? `
        <form id="descargoForm" style="margin-top:14px">
          <p class="muted small">Si el investigado sí presenta su descargo, regístrelo aquí para que ya no se genere el acta:</p>
          <div class="grid-2">
            <label>Fecha de descargo<input type="date" id="dFecha" required /></label>
            <label>N.º de documento<input type="text" id="dNumero" /></label>
          </div>
          <label>Archivo del descargo<input type="file" id="dArchivo" /></label>
          <p id="descargoError" class="error hidden"></p>
          <button type="submit" class="btn-secondary">Registrar descargo recibido</button>
        </form>` : ""}
      `}
    </div>

    ${isAdmin && (caso.fecha_descargo || plazoVencido) ? `
    <div class="detail-card">
      <h3>Orden de Sanción</h3>
      ${puedeSancion ? `
        <form id="sancionForm">
          <div class="label" style="margin-bottom:8px">Sanción a imponer (evaluando el descargo${caso.fecha_descargo ? " — puede marcarla usted o dejar que la IA la elija" : ""})</div>
          ${opcionesSancion.map((o) => {
            const marcado = caso.sancion_tercio_label === o.value;
            return `<label class="checkbox-row"><input type="radio" name="sancionTercio" value="${o.value}" ${marcado ? "checked" : ""} required /> ${escapeHtml(o.label)}</label>`;
          }).join("")}
          <label>Descargo del investigado (resumen${caso.fecha_descargo ? " — deje en blanco y presione \"Analizar con IA\" para que se lea solo del archivo subido" : ""})
            <textarea id="sSancionDescargo" rows="3" placeholder="${caso.fecha_descargo ? "Déjelo en blanco: 'Analizar con IA' lee el archivo del descargo ya subido. O escriba usted mismo un resumen." : ""}">${escapeHtml(caso.sancion_descargo_texto || (caso.fecha_descargo ? "" : "El investigado no presentó su descargo por escrito dentro del plazo de un (01) día hábil establecido por ley, conforme acta respectiva, precluyendo su derecho a la defensa en la presente etapa procedimental."))}</textarea>
          </label>
          <label>Análisis y evaluación ${caso.fecha_descargo ? "(notas sueltas o texto final)" : "(se completa solo al elegir el tercio; puede editarlo)"}
            <textarea id="sSancionAnalisis" rows="6" required placeholder="Anote qué se acredita, qué alega el investigado, y por qué corresponde el tercio elegido... o escriba el texto final directamente.">${escapeHtml(caso.sancion_analisis_texto || "")}</textarea>
          </label>
          ${caso.fecha_descargo ? `
          <div class="modal-actions" style="justify-content:flex-start; margin-bottom:10px">
            <button type="button" class="btn-secondary" id="btnAnalizarDescargoIA">✨ Analizar descargo con IA</button>
          </div>
          <p class="muted small">La IA lee el descargo, considera los antecedentes del investigado en este sistema, sugiere el tercio y redacta el análisis. Revise siempre antes de guardar.</p>
          <p id="sancionIAStatus" class="muted small hidden"></p>
          ` : `<p class="muted small">Sin descargo: el texto se genera automáticamente según el tercio que elija arriba.</p>`}
          <p id="sancionError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Guardar y descargar Orden de Sanción</button>
        </form>
        ${caso.sancion_generada_at ? `<p class="muted small">Generada por última vez el ${formatDate(caso.sancion_generada_at.slice(0, 10))}.</p>` : ""}
      ` : `<p class="muted small">Para generar la Orden de Sanción, verifique que el oficial que constató y el investigado estén registrados en Efectivos.</p>`}
    </div>
    ` : ""}

    ${isAdmin && caso.sancion_generada_at ? `
    <div class="detail-card">
      <h3>Notificación de la Orden de Sanción</h3>
      ${caso.orden_notificada_at ? `
        <p class="muted small">Notificada el ${formatDate(caso.orden_notificada_at.slice(0, 10))}.</p>
      ` : `
        <p class="muted small">Suba el cargo de notificación firmado por el investigado (la IA verifica que corresponda antes de guardar).</p>
        <form id="ordenNotifForm">
          <label>Cargo de notificación firmado (PDF o foto)
            <input type="file" id="fOrdenNotifArchivo" accept="application/pdf,image/*" required />
          </label>
          <div class="modal-actions" style="justify-content:flex-start; margin:8px 0">
            <button type="button" class="btn-secondary" id="btnVerificarNotifIA">✨ Verificar con IA</button>
          </div>
          <p id="ordenNotifIAStatus" class="muted small hidden"></p>
          <label>Fecha de notificación (la completa la IA si la detecta; verifíquela)
            <input type="date" id="fOrdenNotifFecha" required />
          </label>
          <p id="ordenNotifError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Registrar notificación</button>
        </form>
      `}
    </div>
    ` : ""}
  `;

  $("btnDescargarImputacion")?.addEventListener("click", async (e) => {
    await handleDescargarImputacion(caso, e.currentTarget);
    openCasoDetail(caso.id);
  });
  $("btnRevisarConsistencia")?.addEventListener("click", () => revisarConsistenciaImputacion(caso));
  $("btnDescargarActa")?.addEventListener("click", (e) => handleDescargarActaNoDescargo(caso, e.currentTarget));
  $("notificacionForm")?.addEventListener("submit", (e) => submitNotificacion(e, caso.id));
  $("descargoForm")?.addEventListener("submit", (e) => submitDescargo(e, caso.id));
  $("sancionForm")?.addEventListener("submit", (e) => submitSancion(e, caso));
  $("btnAnalizarDescargoIA")?.addEventListener("click", () => analizarDescargoConIA(caso));
  $("btnVerificarNotifIA")?.addEventListener("click", () => verificarNotificacionOrdenIA(caso));
  $("ordenNotifForm")?.addEventListener("submit", (e) => submitNotificacionOrden(e, caso));

  const analisisEl = $("sSancionAnalisis");
  if (analisisEl && !caso.fecha_descargo) {
    document.querySelectorAll('input[name="sancionTercio"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const esVacioOAutocompletado = !analisisEl.value.trim() || analisisEl.dataset.autofilled === "true";
        if (esVacioOAutocompletado) {
          analisisEl.value = analisisSinDescargoDefault(caso.codigo_infraccion, radio.value);
          analisisEl.dataset.autofilled = "true";
        }
      });
    });
    analisisEl.addEventListener("input", () => {
      analisisEl.dataset.autofilled = "false";
    });
  }

  if (isAdmin) {
    $("btnEliminarCaso")?.addEventListener("click", () => eliminarCaso(caso.id));
  }
}

async function handleDescargarActaNoDescargo(caso, btnEl) {
  const textoOriginal = btnEl ? btnEl.textContent : null;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Generando..."; }
  try {
    await generarActaNoDescargoDocx(caso, state.efectivos);
    if (!caso.acta_no_descargo_generada_at) {
      const ahora = new Date().toISOString();
      const { error } = await supabase.from("casos").update({ acta_no_descargo_generada_at: ahora }).eq("id", caso.id);
      if (!error) caso.acta_no_descargo_generada_at = ahora;
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "No se pudo generar el acta de no descargo.");
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = textoOriginal; }
  }
}

async function submitNotificacion(e, casoId) {
  e.preventDefault();
  const msgEl = $("notificacionMsg");
  msgEl.classList.add("hidden");
  const fecha = $("fNotificacion").value;
  if (!fecha) return;
  const { error } = await supabase.from("casos").update({
    imputacion_generada_at: `${fecha}T12:00:00.000Z`,
  }).eq("id", casoId);
  if (error) { msgEl.textContent = "Error: " + error.message; msgEl.classList.remove("hidden"); return; }
  openCasoDetail(casoId);
}

async function submitDescargo(e, casoId) {
  e.preventDefault();
  const errEl = $("descargoError");
  errEl.classList.add("hidden");
  const fecha = $("dFecha").value;
  const numero = $("dNumero").value.trim();
  const file = $("dArchivo").files[0];

  let archivo_descargo_path = null;
  let archivo_descargo_nombre = null;
  if (file) {
    const path = `${casoId}/descargo_${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("casos-imputacion-pnp").upload(path, file);
    if (upErr) { errEl.textContent = "Error al subir archivo: " + upErr.message; errEl.classList.remove("hidden"); return; }
    archivo_descargo_path = path;
    archivo_descargo_nombre = file.name;
  }

  const { error } = await supabase.from("casos").update({
    fecha_descargo: fecha,
    numero_descargo: numero,
    ...(archivo_descargo_path ? { archivo_descargo_path, archivo_descargo_nombre } : {}),
  }).eq("id", casoId);

  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }
  openCasoDetail(casoId);
}

// Casos previos del mismo investigado (mismo criterio de emparejamiento por
// nombre que el resto de la app: al menos 2 palabras en común). Se le pasa a
// la IA como posible agravante para elegir el tercio.
function buscarAntecedentes(caso, todosCasos) {
  if (!caso?.apellidos || !todosCasos?.length) return [];
  const objetivo = tokens(`${caso.apellidos} ${caso.nombres || ""}`);
  if (!objetivo.length) return [];
  return todosCasos
    .filter((c) => c.id !== caso.id)
    .filter((c) => {
      const t = new Set(tokens(`${c.apellidos || ""} ${c.nombres || ""}`));
      return objetivo.filter((tok) => t.has(tok)).length >= 2;
    })
    .map((c) => ({ codigo_infraccion: c.codigo_infraccion || null, fecha_hecho: c.fecha_hecho || null }))
    .sort((a, b) => (b.fecha_hecho || "").localeCompare(a.fecha_hecho || ""));
}

async function extraerTextoDescargo(caso, onEstado) {
  if (!caso.archivo_descargo_path) return "";
  const { data: blob, error } = await supabase.storage.from("casos-imputacion-pnp").download(caso.archivo_descargo_path);
  if (error || !blob) return "";
  const nombre = caso.archivo_descargo_nombre || "";
  const esPdf = /\.pdf$/i.test(nombre) || blob.type === "application/pdf";
  const esImagen = /\.(jpe?g|png|webp|bmp)$/i.test(nombre) || blob.type.startsWith("image/");
  try {
    if (esPdf) return await extractPdfText(blob, onEstado);
    if (esImagen) {
      onEstado?.("Leyendo el archivo del descargo con reconocimiento de texto (OCR)...");
      return await extractImagenTextoConOcr(blob);
    }
  } catch (err) {
    console.error("No se pudo leer el archivo de descargo:", err);
  }
  return "";
}

async function analizarDescargoConIA(caso) {
  const btn = $("btnAnalizarDescargoIA");
  const statusEl = $("sancionIAStatus");
  const errEl = $("sancionError");
  errEl.classList.add("hidden");

  const opciones = opcionesTercio(caso.codigo_infraccion) || [];
  const infraccion = getInfraccion(caso.codigo_infraccion);

  btn.disabled = true;
  statusEl.classList.remove("hidden");
  try {
    let textoDescargo = $("sSancionDescargo").value.trim();
    if (!textoDescargo && caso.archivo_descargo_path) {
      statusEl.textContent = "Leyendo el archivo del descargo ya subido...";
      textoDescargo = (await extraerTextoDescargo(caso, (msg) => { statusEl.textContent = msg; })).trim();
    }

    statusEl.textContent = "Analizando el descargo con IA...";
    const antecedentes = buscarAntecedentes(caso, state.casos);
    const { data, error } = await supabase.functions.invoke("analizar-descargo-sancion", {
      body: {
        investigadoCompleto: `${caso.grado || ""} ${caso.apellidos || ""} ${caso.nombres || ""}`.replace(/\s+/g, " ").trim(),
        codigoInfraccion: normalizarCodigoInfraccion(caso.codigo_infraccion),
        infraccionTexto: infraccion?.infraccion || "",
        sancionTexto: infraccion?.sancion || "",
        descripcionHecho: caso.descripcion_hecho || "",
        tercios: opciones.map((o) => ({ value: o.value, label: o.label, extremo: o.extremo })),
        antecedentes,
        textoDescargo,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.resumen_descargo) $("sSancionDescargo").value = data.resumen_descargo;
    if (data?.analisis_texto) {
      $("sSancionAnalisis").value = data.analisis_texto;
      $("sSancionAnalisis").dataset.autofilled = "false";
    }
    if (data?.tercio_value) {
      const radio = [...document.querySelectorAll('input[name="sancionTercio"]')].find((r) => r.value === data.tercio_value);
      if (radio) radio.checked = true;
    }
    statusEl.textContent = "Listo — la IA evaluó el descargo y eligió el tercio. Revise antes de guardar.";
  } catch (err) {
    console.error(err);
    statusEl.classList.add("hidden");
    errEl.textContent = "No se pudo analizar con IA: " + (err.message || err);
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

async function verificarNotificacionOrdenIA(caso) {
  const file = $("fOrdenNotifArchivo").files[0];
  const statusEl = $("ordenNotifIAStatus");
  if (!file) { statusEl.textContent = "Seleccione primero el archivo del cargo firmado."; statusEl.classList.remove("hidden"); return; }
  const btn = $("btnVerificarNotifIA");
  btn.disabled = true;
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Leyendo el archivo...";
  try {
    const esPdf = file.type === "application/pdf";
    const esImagen = file.type.startsWith("image/");
    const textoDocumento = esPdf
      ? await extractPdfText(file, (msg) => { statusEl.textContent = msg; })
      : esImagen
      ? await extractImagenTextoConOcr(file)
      : "";

    statusEl.textContent = "Verificando con IA...";
    const infraccion = getInfraccion(caso.codigo_infraccion);
    const sancionImpuesta = caso.sancion_tercio_label === "amonestacion" ? "amonestación" : `${caso.sancion_tercio_label} días de Sanción Simple`;
    const { data, error } = await supabase.functions.invoke("revisar-documento-ia", {
      body: {
        tipo: "notificacion_orden",
        investigadoCompleto: `${caso.grado || ""} ${caso.apellidos || ""} ${caso.nombres || ""}`.replace(/\s+/g, " ").trim(),
        codigoInfraccion: normalizarCodigoInfraccion(caso.codigo_infraccion),
        sancionImpuesta,
        textoDocumento,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.fecha_detectada) $("fOrdenNotifFecha").value = data.fecha_detectada;
    const observaciones = (data?.observaciones || []).join(" · ");
    statusEl.textContent = data?.consistente
      ? `✓ El documento corresponde a esta notificación.${observaciones ? " " + observaciones : ""}`
      : `⚠ ${observaciones || "La IA no pudo confirmar que el documento corresponda. Revise antes de guardar."}`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo verificar con IA: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

async function submitNotificacionOrden(e, caso) {
  e.preventDefault();
  const errEl = $("ordenNotifError");
  errEl.classList.add("hidden");
  const file = $("fOrdenNotifArchivo").files[0];
  const fecha = $("fOrdenNotifFecha").value;
  if (!file || !fecha) return;

  const path = `${caso.id}/orden_notif_${Date.now()}_${file.name}`;
  const { error: upErr } = await supabase.storage.from("casos-imputacion-pnp").upload(path, file);
  if (upErr) { errEl.textContent = "Error al subir archivo: " + upErr.message; errEl.classList.remove("hidden"); return; }

  const { error } = await supabase.from("casos").update({
    orden_notificada_at: `${fecha}T12:00:00.000Z`,
    archivo_orden_notificacion_path: path,
    archivo_orden_notificacion_nombre: file.name,
  }).eq("id", caso.id);
  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }
  openCasoDetail(caso.id);
}

async function submitSancion(e, caso) {
  e.preventDefault();
  const errEl = $("sancionError");
  errEl.classList.add("hidden");
  const tercioValue = document.querySelector('input[name="sancionTercio"]:checked')?.value;
  const analisisTexto = $("sSancionAnalisis").value.trim();
  const descargoTexto = $("sSancionDescargo").value.trim();

  if (!tercioValue) { errEl.textContent = "Seleccione la sanción a imponer."; errEl.classList.remove("hidden"); return; }
  if (!analisisTexto) { errEl.textContent = "Escriba el Análisis y Evaluación."; errEl.classList.remove("hidden"); return; }

  const submitBtn = e.target.querySelector("button[type=submit]");
  const textoOriginal = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Generando...";
  try {
    await generarOrdenSancionDocx(caso, state.efectivos, { tercioValue, analisisTexto, descargoTexto });
    const { error } = await supabase.from("casos").update({
      sancion_generada_at: new Date().toISOString(),
      sancion_tercio_label: tercioValue,
      sancion_analisis_texto: analisisTexto,
      sancion_descargo_texto: descargoTexto,
    }).eq("id", caso.id);
    if (error) { errEl.textContent = "Se generó el documento, pero no se pudo guardar la decisión: " + error.message; errEl.classList.remove("hidden"); return; }
    openCasoDetail(caso.id);
  } catch (err) {
    console.error(err);
    errEl.textContent = err.message || "No se pudo generar la Orden de Sanción.";
    errEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = textoOriginal;
  }
}

async function eliminarCaso(id) {
  if (!confirm("¿Eliminar este caso? Esta acción no se puede deshacer.")) return;
  const { error } = await supabase.from("casos").delete().eq("id", id);
  if (error) { alert("No se pudo eliminar: " + error.message); return; }
  showView("view-dashboard");
  loadCasos();
}

// ---------- Efectivos ----------
async function loadEfectivos() {
  const { data, error } = await supabase
    .from("efectivos")
    .select("*")
    .order("apellidos_nombres", { ascending: true });
  if (error) { console.error(error); return; }
  state.efectivos = data || [];
  renderEfectivosTable(state.efectivos);
}

function renderEfectivosTable(list) {
  const tbody = $("efectivosTableBody");
  tbody.innerHTML = "";
  $("efectivosEmpty").classList.toggle("hidden", list.length > 0);
  for (const ef of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(ef.grado || "")}</td>
      <td>${escapeHtml(ef.apellidos_nombres || "")}</td>
      <td>${escapeHtml(ef.cip || "")}</td>
      <td>${escapeHtml(ef.dni || "")}</td>
    `;
    tbody.appendChild(tr);
  }
}

$("searchEfectivos").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = state.efectivos.filter((ef) =>
    [ef.cip, ef.dni, ef.apellidos_nombres, ef.grado].filter(Boolean).join(" ").toLowerCase().includes(q)
  );
  renderEfectivosTable(filtered);
});

$("btnNuevoEfectivo").addEventListener("click", () => {
  $("efectivoForm").reset();
  $("efectivoFormError").classList.add("hidden");
  $("modalNuevoEfectivo").classList.remove("hidden");
});
$("btnCerrarModalEfectivo").addEventListener("click", () => $("modalNuevoEfectivo").classList.add("hidden"));
$("btnCancelarEfectivo").addEventListener("click", () => $("modalNuevoEfectivo").classList.add("hidden"));

$("efectivoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("efectivoFormError");
  errEl.classList.add("hidden");
  const { error } = await supabase.from("efectivos").insert({
    grado: $("efGrado").value.trim(),
    cip: $("efCip").value.trim(),
    dni: $("efDni").value.trim(),
    apellidos_nombres: $("efApellidosNombres").value.trim(),
  });
  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }
  $("modalNuevoEfectivo").classList.add("hidden");
  loadEfectivos();
});

// ---------- Nuevo caso modal ----------
$("btnNuevoCaso").addEventListener("click", () => {
  $("casoForm").reset();
  $("fUnidad").value = "DIVOPUS 3-CPNP VENTANILLA.";
  $("lookupResult").classList.add("hidden");
  $("casoFormError").classList.add("hidden");
  $("infraccionPreview").classList.add("hidden");
  $("hechoIAStatus").classList.add("hidden");
  $("codigoIASugerencia").classList.add("hidden");
  $("btnRedactarHechoIA").disabled = true;
  // Quien crea el caso normalmente ES el oficial que constató -- se
  // autocompleta con sus propios datos (buscados por su CIP de sesión), sin
  // impedir que lo edite si en realidad está cargando el caso de otro.
  const yoMismo = state.cip ? state.efectivos.find((ef) => ef.cip === state.cip) : null;
  $("fOficialConstato").value = yoMismo ? `${yoMismo.grado || ""} ${yoMismo.apellidos_nombres || ""}`.replace(/\s+/g, " ").trim() : "";
  $("modalNuevoCaso").classList.remove("hidden");
});
$("btnCerrarModal").addEventListener("click", closeModal);
$("btnCancelarCaso").addEventListener("click", closeModal);
function closeModal() { $("modalNuevoCaso").classList.add("hidden"); }

$("btnBuscarEfectivo").addEventListener("click", () => {
  const q = $("lookupCipDni").value.trim();
  const resultEl = $("lookupResult");
  if (!q) return;
  const found = state.efectivos.find((ef) => ef.cip === q || ef.dni === q);
  if (!found) {
    resultEl.textContent = "No se encontró ningún efectivo con ese CIP/DNI.";
    resultEl.classList.remove("hidden");
    return;
  }
  $("fGrado").value = found.grado || "";
  const partes = (found.apellidos_nombres || "").split(",");
  $("fApellidos").value = (partes[0] || "").trim();
  $("fNombres").value = (partes[1] || "").trim();
  resultEl.textContent = `Encontrado: ${found.grado || ""} ${found.apellidos_nombres || ""}`;
  resultEl.classList.remove("hidden");
});

$("casoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("casoFormError");
  errEl.classList.add("hidden");

  const codigo = normalizarCodigoInfraccion($("fCodigoInfraccion").value.trim());
  if (!codigo || !getInfraccion(codigo)) {
    errEl.textContent = "El código de infracción debe ser uno del Anexo I de infracciones Leves (L1 a L117).";
    errEl.classList.remove("hidden");
    return;
  }

  const oficialConstatoTexto = $("fOficialConstato").value.trim();
  const payload = {
    grado: $("fGrado").value.trim(),
    apellidos: $("fApellidos").value.trim(),
    nombres: $("fNombres").value.trim(),
    codigo_infraccion: codigo,
    fecha_hecho: $("fFechaHecho").value,
    descripcion_hecho: $("fDescripcionHecho").value.trim(),
    unidad_investigado: $("fUnidad").value.trim(),
    oficial_constato: oficialConstatoTexto,
    // Igual que en moral-y-disciplina: la política de RLS usa este CIP para
    // decidir qué casos puede ver cada oficial, no solo el admin.
    oficial_constato_cip: buscarOficialConstato(oficialConstatoTexto, state.efectivos)?.cip || null,
  };

  const { data: inserted, error } = await supabase.from("casos").insert(payload).select().single();
  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }

  const file = $("fArchivoSustento").files[0];
  if (file && inserted) {
    const path = `${inserted.id}/sustento_${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("casos-imputacion-pnp").upload(path, file);
    if (!upErr) {
      await supabase.from("casos").update({
        archivo_sustento_path: path, archivo_sustento_nombre: file.name,
      }).eq("id", inserted.id);
    }
  }

  closeModal();
  loadCasos();
});
