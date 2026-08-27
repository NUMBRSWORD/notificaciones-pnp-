import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.mjs";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA } from "./config.js";
import { renderizarImputacionDocx, puedeGenerarImputacion, buscarOficialConstato, tokens } from "./lib/imputacion.js";
import { renderizarActaNoDescargoDocx, puedeGenerarActaNoDescargo, plazoDescargoVencido, fechaLimiteDescargo } from "./lib/actaNoDescargo.js";
import { renderizarOrdenSancionDocx, puedeGenerarOrdenSancion, opcionesTercio, analisisSinDescargoDefault } from "./lib/ordenSancion.js";
import { getInfraccion, normalizarCodigoInfraccion, ANEXO_I } from "./lib/anexoI.js";
import { listarDirectivas, directivasParaIA, guardarDirectiva, eliminarDirectiva, subirArchivoDirectiva } from "./lib/directivas.js";
import { Chart } from "https://esm.sh/chart.js@4.4.4/auto";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { nombreCompletoVisible } from "./lib/utils.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.worker.mjs";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: SUPABASE_SCHEMA },
});

// ---------- Lectura de PDF/imagen (texto seleccionable o IA con visión) ----------
// Antes esto usaba tesseract.js (OCR genérico corriendo en el navegador):
// lentísimo en documentos largos (minutos) y con errores frecuentes en
// escaneos reales (sellos, membretes, mala calidad). Ahora, cuando el PDF no
// tiene texto seleccionable, cada página se manda como imagen a la función
// "extraer-texto-vision" (Claude con visión) -- mucho más preciso, y corre
// en el servidor en vez de trabar el navegador del oficial.
const PAGINAS_POR_LOTE_VISION = 4;

function canvasABase64Jpeg(canvas) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function blobABase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function transcribirPaginasConIA(paginas, onEstado) {
  const lotes = [];
  for (let i = 0; i < paginas.length; i += PAGINAS_POR_LOTE_VISION) {
    lotes.push(paginas.slice(i, i + PAGINAS_POR_LOTE_VISION));
  }
  const textos = [];
  for (let i = 0; i < lotes.length; i++) {
    const desde = i * PAGINAS_POR_LOTE_VISION + 1;
    const hasta = Math.min((i + 1) * PAGINAS_POR_LOTE_VISION, paginas.length);
    onEstado?.(paginas.length > 1
      ? `Transcribiendo con IA: página${hasta > desde ? "s" : ""} ${desde}${hasta > desde ? `-${hasta}` : ""} de ${paginas.length}...`
      : "Transcribiendo la imagen con IA...");
    const { data, error } = await supabase.functions.invoke("extraer-texto-vision", {
      body: { paginas: lotes[i] },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    textos.push(data?.texto || "");
  }
  return textos.join("\n\n");
}

async function extractPdfText(file, onEstado) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  // Si el PDF es una foto/escaneo sin texto seleccionable, se recurre a IA con visión.
  if (text.trim().length < 30) {
    onEstado?.("Este archivo parece ser una imagen escaneada: preparando las páginas para leerlas con IA...");
    const paginas = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      paginas.push({ data: canvasABase64Jpeg(canvas), mediaType: "image/jpeg" });
    }
    text = await transcribirPaginasConIA(paginas, onEstado);
  }
  return text;
}

async function extractImagenTextoConOcr(blob, onEstado) {
  const base64 = await blobABase64(blob);
  return await transcribirPaginasConIA([{ data: base64, mediaType: blob.type || "image/jpeg" }], onEstado);
}

const state = {
  session: null,
  role: null,
  email: null,
  cip: null,
  casos: [],
  efectivos: [],
  directivas: [],
  currentCasoId: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Tema claro/oscuro ----------
function actualizarIconoTema() {
  const claro = document.documentElement.getAttribute("data-theme") === "light";
  $("btnTemaToggle").textContent = claro ? "☀️" : "🌙";
  $("btnTemaToggle").title = claro ? "Cambiar a tema oscuro" : "Cambiar a tema claro";
}
actualizarIconoTema();
$("btnTemaToggle").addEventListener("click", () => {
  const claroAhora = document.documentElement.getAttribute("data-theme") === "light";
  if (claroAhora) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("tema", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("tema", "light");
  }
  actualizarIconoTema();
});

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

function formatFechaHora(fecha, hora) {
  const f = formatDate(fecha);
  if (f === "-") return "-";
  return hora ? `${f} ${hora.slice(0, 5)}` : f;
}

// Archiva en Storage y registra en documentos_generados cada versión de un
// documento generado -- "mejor esfuerzo": si falla (red, permisos), se deja
// constancia en consola pero NUNCA bloquea la descarga real del oficial,
// que ya ocurrió antes de llamar a esta función.
async function registrarVersionDocumento(casoId, tipo, blob, nombreArchivo) {
  try {
    const path = `${casoId}/generados/${tipo}_${Date.now()}_${nombreArchivo}`;
    const { error: upErr } = await supabase.storage.from("casos-imputacion-pnp").upload(path, blob);
    if (upErr) { console.error("No se pudo archivar la versión del documento:", upErr); return; }
    const { error } = await supabase.from("documentos_generados").insert({
      caso_id: casoId,
      tipo,
      archivo_path: path,
      archivo_nombre: nombreArchivo,
      generado_por: state.session.user.id,
      generado_por_email: state.email,
    });
    if (error) console.error("No se pudo registrar la versión del documento:", error);
  } catch (err) {
    console.error("No se pudo archivar la versión del documento:", err);
  }
}

function nombreArchivoDocumento(prefijo, caso) {
  return `${prefijo} - ${nombreInvestigadoVisible(caso, true)}.docx`.replace(/\s+/g, " ").trim();
}

function nombreInvestigadoVisible(caso, incluirGrado = false) {
  const nombre = nombreCompletoVisible(caso?.apellidos, caso?.nombres);
  return `${incluirGrado ? (caso?.grado || "").trim() : ""} ${nombre}`.replace(/\s+/g, " ").trim();
}

// ---------- View switching ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  const map = { "view-dashboard": "casos", "view-efectivos": "efectivos", "view-directivas": "directivas", "view-agenda": "agenda", "view-documentos": "documentos", "view-panel": "panel", "view-historial": "historial" };
  if (map[id]) {
    document.querySelector(`.tab-btn[data-view="${map[id]}"]`)?.classList.add("active");
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.view;
    if (target === "casos") { showView("view-dashboard"); loadCasos(); }
    if (target === "efectivos") { showView("view-efectivos"); loadEfectivos(); }
    if (target === "directivas") { showView("view-directivas"); loadDirectivasView(); }
    if (target === "agenda") { showView("view-agenda"); renderAgenda(); }
    if (target === "documentos") { showView("view-documentos"); loadDocumentosGenerados(); }
    if (target === "panel") { showView("view-panel"); renderPanel(); }
    if (target === "historial") { showView("view-historial"); loadHistorial(); }
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
// El botón sirve para dos cosas distintas según lo que haya: si hay un
// archivo de sustento, la IA redacta la descripción desde ese documento
// (como antes); si no hay archivo pero el oficial ya escribió algo, la IA
// en cambio pule esa redacción propia (coherencia, formalidad, ortografía)
// sin inventar un documento que no existe -- antes esto solo estaba
// disponible con archivo, aunque la función ya recibía el texto propio.
function actualizarBotonRedactarIA() {
  const btn = $("btnRedactarHechoIA");
  const hayArchivo = !!$("fArchivoSustento").files[0];
  const hayTexto = !!$("fDescripcionHecho").value.trim();
  btn.disabled = !hayArchivo && !hayTexto;
  if (hayArchivo) {
    btn.textContent = "✨ Redactar con IA (desde el sustento)";
    btn.title = "";
  } else if (hayTexto) {
    btn.textContent = "✨ Mejorar redacción con IA";
    btn.title = "";
  } else {
    btn.textContent = "✨ Redactar con IA (desde el sustento)";
    btn.title = "Suba un archivo de sustento o escriba una descripción primero";
  }
}
$("fArchivoSustento").addEventListener("change", actualizarBotonRedactarIA);
$("fDescripcionHecho").addEventListener("input", actualizarBotonRedactarIA);

$("btnRedactarHechoIA").addEventListener("click", async () => {
  const file = $("fArchivoSustento").files[0];
  const statusEl = $("hechoIAStatus");
  const notasPrevias = $("fDescripcionHecho").value.trim();
  if (!file && !notasPrevias) return;
  const btn = $("btnRedactarHechoIA");
  btn.disabled = true;
  statusEl.classList.remove("hidden");
  try {
    let texto = "";
    if (file) {
      statusEl.textContent = "Leyendo el archivo de sustento...";
      const esPdf = file.type === "application/pdf";
      const esImagen = file.type.startsWith("image/");
      texto = esPdf
        ? await extractPdfText(file, (msg) => { statusEl.textContent = msg; })
        : esImagen
        ? await extractImagenTextoConOcr(file, (msg) => { statusEl.textContent = msg; })
        : "";
    }

    statusEl.textContent = texto
      ? "Redactando la descripción del hecho con IA..."
      : "Mejorando la redacción con IA...";
    const codigo = normalizarCodigoInfraccion($("fCodigoInfraccion").value.trim());
    const infraccion = getInfraccion(codigo);
    const { data, error } = await supabase.functions.invoke("redactar-hecho-imputacion", {
      body: {
        investigadoCompleto: `${$("fGrado").value.trim()} ${$("fNombres").value.trim()} ${$("fApellidos").value.trim()}`.trim(),
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
    actualizarBotonRedactarIA();
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
  // Se precarga en segundo plano (no se espera) para que estén listas en
  // cuanto se abra el formulario de Orden de Sanción, sin retrasar el login.
  loadDirectivasView();
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

function renderResumenRapido() {
  const casos = state.casos || [];
  const pendientes = casos.filter((c) => !c.imputacion_generada_at).length;
  const vencidos = casos.filter((c) => c.imputacion_generada_at && !c.fecha_descargo && !c.sancion_generada_at && plazoDescargoVencido(c)).length;
  const conDescargo = casos.filter((c) => c.fecha_descargo && !c.sancion_generada_at).length;
  $("casosResumenRapido").innerHTML = `
    <div class="quick-summary-copy">
      <span class="eyebrow">Vista rápida</span>
      <strong>${casos.length ? "Así está la carga de trabajo hoy" : "Aún no hay expedientes registrados"}</strong>
      <span class="muted small">${casos.length ? "Priorice los casos con plazo vencido o documentos pendientes." : "Cree el primer caso para iniciar el seguimiento."}</span>
    </div>
    <div class="quick-summary-stats">
      <div><b>${pendientes}</b><span>por notificar</span></div>
      <div class="${vencidos ? "is-urgent" : ""}"><b>${vencidos}</b><span>plazo vencido</span></div>
      <div><b>${conDescargo}</b><span>con descargo</span></div>
    </div>`;
}

function obtenerAccionesPrioritarias() {
  return (state.casos || []).flatMap((caso) => {
    const nombre = nombreInvestigadoVisible(caso, true) || "Caso sin nombre";
    if (caso.imputacion_generada_at && !caso.fecha_descargo && !caso.sancion_generada_at && plazoDescargoVencido(caso)) {
      return [{ caso, nombre, prioridad: 1, tipo: "Plazo vencido", detalle: "Defina el siguiente trámite: acta de no descargo u orden de sanción.", clase: "is-urgent" }];
    }
    if (caso.fecha_descargo && !caso.sancion_generada_at) {
      return [{ caso, nombre, prioridad: 2, tipo: "Descargo recibido", detalle: "Revise el descargo y prepare la orden de sanción.", clase: "is-ready" }];
    }
    if (!caso.imputacion_generada_at) {
      return [{ caso, nombre, prioridad: 3, tipo: "Generar imputación", detalle: "Complete o verifique los datos para notificar la imputación.", clase: "is-pending" }];
    }
    return [];
  }).sort((a, b) => a.prioridad - b.prioridad);
}

function renderBandejaAcciones() {
  const acciones = obtenerAccionesPrioritarias();
  const bandeja = $("bandejaAcciones");
  bandeja.classList.toggle("hidden", acciones.length === 0);
  if (!acciones.length) return;
  $("bandejaAccionesCount").textContent = `${acciones.length} pendiente${acciones.length === 1 ? "" : "s"}`;
  $("bandejaAccionesLista").innerHTML = acciones.slice(0, 5).map((accion) => `
    <article class="action-item ${accion.clase}">
      <div class="action-item-copy">
        <span class="action-type">${escapeHtml(accion.tipo)}</span>
        <strong>${escapeHtml(accion.nombre)}</strong>
        <span class="muted small">${escapeHtml(accion.detalle)}</span>
      </div>
      <button type="button" class="btn-secondary btn-abrir-accion" data-id="${escapeHtml(accion.caso.id)}">Resolver</button>
    </article>`).join("");
  document.querySelectorAll(".btn-abrir-accion").forEach((btn) => {
    btn.addEventListener("click", () => openCasoDetail(btn.dataset.id));
  });
}

function renderAgenda() {
  const query = $("buscarAgenda").value.trim().toLowerCase();
  const acciones = obtenerAccionesPrioritarias().filter((accion) =>
    !query || `${accion.nombre} ${accion.tipo} ${accion.detalle}`.toLowerCase().includes(query)
  );
  $("agendaEmpty").classList.toggle("hidden", acciones.length > 0);
  $("agendaLista").innerHTML = acciones.map((accion, index) => `
    <article class="agenda-item ${accion.clase}">
      <div class="agenda-order">${index + 1}</div>
      <div class="action-item-copy">
        <span class="action-type">${escapeHtml(accion.tipo)}</span>
        <strong>${escapeHtml(accion.nombre)}</strong>
        <span class="muted small">${escapeHtml(accion.detalle)}</span>
      </div>
      <button type="button" class="btn-primary btn-abrir-agenda" data-id="${escapeHtml(accion.caso.id)}">Abrir expediente</button>
    </article>`).join("");
  document.querySelectorAll(".btn-abrir-agenda").forEach((btn) => btn.addEventListener("click", () => openCasoDetail(btn.dataset.id)));
}

$("buscarAgenda").addEventListener("input", renderAgenda);

function exportarAgendaCalendario() {
  const fechaIcs = (fecha) => String(fecha || new Date().toISOString().slice(0, 10)).slice(0, 10).replaceAll("-", "");
  const escaparIcs = (texto) => String(texto || "").replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
  const eventos = obtenerAccionesPrioritarias().map((accion, index) => {
    const fecha = accion.tipo === "Plazo vencido" ? fechaLimiteDescargo(accion.caso) : (accion.caso.created_at || new Date().toISOString());
    const stamp = `${Date.now()}-${index}@notificaciones-pnp`;
    return ["BEGIN:VEVENT", `UID:${stamp}`, `DTSTAMP:${fechaIcs(new Date().toISOString())}T000000Z`, `DTSTART;VALUE=DATE:${fechaIcs(fecha)}`, `SUMMARY:${escaparIcs(`${accion.tipo}: ${accion.nombre}`)}`, `DESCRIPTION:${escaparIcs(accion.detalle)}`, "END:VEVENT"].join("\r\n");
  });
  const contenido = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Notificaciones PNP//Agenda//ES", ...eventos, "END:VCALENDAR"].join("\r\n");
  saveAs(new Blob([contenido], { type: "text/calendar;charset=utf-8" }), `agenda_notificaciones_${new Date().toISOString().slice(0, 10)}.ics`);
}

$("btnExportarAgenda").addEventListener("click", exportarAgendaCalendario);

let documentosGenerados = [];

async function loadDocumentosGenerados() {
  const { data, error } = await supabase.from("documentos_generados").select("*").order("generado_at", { ascending: false });
  if (error) { console.error(error); return; }
  documentosGenerados = data || [];
  await renderDocumentosGenerados();
}

async function renderDocumentosGenerados() {
  const query = $("buscarDocumentos").value.trim().toLowerCase();
  const docs = documentosGenerados.filter((doc) => !query || `${doc.tipo || ""} ${doc.archivo_nombre || ""} ${doc.generado_por_email || ""}`.toLowerCase().includes(query));
  $("documentosEmpty").classList.toggle("hidden", docs.length > 0);
  const etiquetas = { imputacion: "Imputación", acta_no_descargo: "Acta de No Descargo", orden_sancion: "Orden de Sanción" };
  const filas = await Promise.all(docs.map(async (doc) => {
    const enlace = await fileLinkHtml("casos-imputacion-pnp", doc.archivo_path, doc.archivo_nombre);
    return `<article class="document-item"><div><span class="action-type">${escapeHtml(etiquetas[doc.tipo] || doc.tipo || "Documento")}</span><strong>${escapeHtml(doc.archivo_nombre || "Sin nombre")}</strong><span class="muted small">Generado ${formatFechaHora(String(doc.generado_at || "").slice(0, 10), String(doc.generado_at || "").slice(11, 16))} · ${escapeHtml(doc.generado_por_email || "-")}</span></div><div>${enlace}</div></article>`;
  }));
  $("documentosLista").innerHTML = filas.join("");
}

$("buscarDocumentos").addEventListener("input", () => { renderDocumentosGenerados(); });

function renderCasosTable(list) {
  casosVisibles = list;
  renderResumenRapido();
  renderBandejaAcciones();
  const tbody = $("casosTableBody");
  tbody.innerHTML = "";
  $("casosEmpty").classList.toggle("hidden", list.length > 0);
  for (const c of list) {
    const tr = document.createElement("tr");
    const puedeDescargar = puedeGenerarImputacion(c, state.efectivos);
    tr.innerHTML = `
      <td>${escapeHtml(c.grado || "")}</td>
      <td>${escapeHtml(nombreInvestigadoVisible(c))}</td>
      <td>${formatDate(c.fecha_hecho)}</td>
      <td>${escapeHtml(c.codigo_infraccion || "")}</td>
      <td>${escapeHtml(c.oficial_constato || "-")}</td>
      <td>${progresoCasoHtml(c)}</td>
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
    const blob = await renderizarImputacionDocx(caso, state.efectivos);
    const nombreArchivo = nombreArchivoDocumento("IMPUTACION LEVE", caso);
    saveAs(blob, nombreArchivo);
    registrarVersionDocumento(caso.id, "imputacion", blob, nombreArchivo);
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
    investigado: nombreInvestigadoVisible(c, true),
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
    const directivas = directivasParaIA(state.directivas.length ? state.directivas : await listarDirectivas(supabase));
    const { data, error } = await supabase.functions.invoke("asistente-normativa", {
      body: {
        catalogo: CATALOGO_ASISTENTE,
        directivas,
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

// ---------- Panel de métricas ----------
let chartsPanel = {};

function estadoDeCaso(c) {
  if (!c.imputacion_generada_at) return "Notificación pendiente";
  if (c.sancion_generada_at) return "Sanción generada";
  if (c.fecha_descargo) return "Con descargo, evaluando";
  if (plazoDescargoVencido(c)) return "Plazo vencido, pendiente";
  return "Plazo de descargo vigente";
}

function claseEstadoCaso(c) {
  if (c.sancion_generada_at) return "pill-yes";
  if (c.fecha_descargo) return "pill-info";
  if (c.imputacion_generada_at && plazoDescargoVencido(c)) return "pill-danger";
  if (c.imputacion_generada_at) return "pill-warning";
  return "pill-neutral";
}

function progresoCasoHtml(c) {
  const paso = c.sancion_generada_at ? 4 : c.fecha_descargo ? 3 : c.imputacion_generada_at ? 2 : 1;
  const etiquetas = ["Registro", "Imputación", "Descargo", "Sanción"];
  return `<div class="case-progress" title="${escapeHtml(estadoDeCaso(c))}">
    <div class="case-progress-steps">${etiquetas.map((etiqueta, i) => `<span class="${i + 1 <= paso ? "is-done" : ""} ${i + 1 === paso ? "is-current" : ""}">${i + 1}</span>`).join("")}</div>
    <span class="pill ${claseEstadoCaso(c)}">${escapeHtml(estadoDeCaso(c))}</span>
  </div>`;
}

function cronologiaCasoHtml(caso) {
  const pasos = [
    { titulo: "Caso registrado", fecha: caso.created_at, listo: true },
    { titulo: "Imputación notificada", fecha: caso.imputacion_generada_at, listo: !!caso.imputacion_generada_at },
    { titulo: "Descargo recibido", fecha: caso.fecha_descargo, listo: !!caso.fecha_descargo },
    { titulo: "Orden de sanción generada", fecha: caso.sancion_generada_at, listo: !!caso.sancion_generada_at },
    { titulo: "Orden notificada", fecha: caso.orden_notificada_at, listo: !!caso.orden_notificada_at },
  ];
  return `<ol class="case-timeline">${pasos.map((paso) => `<li class="${paso.listo ? "is-complete" : ""}"><span class="timeline-dot"></span><div><strong>${paso.titulo}</strong><small>${paso.listo && paso.fecha ? formatDate(String(paso.fecha).slice(0, 10)) : "Pendiente"}</small></div></li>`).join("")}</ol>`;
}

function colorTema(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

const MESES_CORTO_PANEL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function renderPanel() {
  const casos = state.casos;
  $("panelEmpty").classList.toggle("hidden", casos.length > 0);
  $("panelContenido").classList.toggle("hidden", casos.length === 0);
  Object.values(chartsPanel).forEach((c) => c.destroy());
  chartsPanel = {};
  if (!casos.length) return;

  const text = colorTema("--text");
  const textMuted = colorTema("--text-muted");
  const border = colorTema("--border");
  const accent = colorTema("--accent");
  const accentSoft = colorTema("--accent-soft");

  const pendientesVencidos = casos.filter((c) =>
    c.imputacion_generada_at && !c.fecha_descargo && !c.sancion_generada_at && plazoDescargoVencido(c)
  ).length;
  const sancionados = casos.filter((c) => c.sancion_generada_at).length;
  $("panelStats").innerHTML = `
    <div class="stat-tile"><div class="stat-value">${casos.length}</div><div class="stat-label">Casos totales</div></div>
    <div class="stat-tile"><div class="stat-value">${pendientesVencidos}</div><div class="stat-label">Plazo vencido sin resolver</div></div>
    <div class="stat-tile"><div class="stat-value">${sancionados}</div><div class="stat-label">Con sanción generada</div></div>
  `;

  const estadoCounts = {};
  casos.forEach((c) => { const e = estadoDeCaso(c); estadoCounts[e] = (estadoCounts[e] || 0) + 1; });
  const paletaEstado = ["#1f9d55", "#d99a2b", "#4a90d9", "#8a6fd6", "#e5484d"];

  const codigoCounts = {};
  casos.forEach((c) => { const cod = (c.codigo_infraccion || "").trim() || "Sin código"; codigoCounts[cod] = (codigoCounts[cod] || 0) + 1; });
  const codigosOrdenados = Object.entries(codigoCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const mesesCounts = {};
  casos.forEach((c) => {
    if (!c.fecha_hecho) return;
    const mes = c.fecha_hecho.slice(0, 7);
    mesesCounts[mes] = (mesesCounts[mes] || 0) + 1;
  });
  const mesesOrdenados = Object.keys(mesesCounts).sort();
  const mesesLabels = mesesOrdenados.map((m) => {
    const [y, mm] = m.split("-");
    return `${MESES_CORTO_PANEL[Number(mm) - 1]} ${y}`;
  });

  chartsPanel.estado = new Chart($("chartEstado"), {
    type: "doughnut",
    data: {
      labels: Object.keys(estadoCounts),
      datasets: [{ data: Object.values(estadoCounts), backgroundColor: paletaEstado, borderColor: border, borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: text, boxWidth: 12, padding: 10, font: { size: 11 } } } },
    },
  });

  chartsPanel.codigo = new Chart($("chartCodigo"), {
    type: "bar",
    data: {
      labels: codigosOrdenados.map((e) => e[0]),
      datasets: [{ data: codigosOrdenados.map((e) => e[1]), backgroundColor: accent, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textMuted, precision: 0 }, grid: { color: border } },
        y: { ticks: { color: text }, grid: { display: false } },
      },
    },
  });

  chartsPanel.tendencia = new Chart($("chartTendencia"), {
    type: "line",
    data: {
      labels: mesesLabels,
      datasets: [{
        data: mesesOrdenados.map((m) => mesesCounts[m]),
        borderColor: accent, backgroundColor: accentSoft,
        fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: accent,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textMuted }, grid: { display: false } },
        y: { ticks: { color: textMuted, precision: 0 }, grid: { color: border }, beginAtZero: true },
      },
    },
  });
}

$("btnExportarExcel").addEventListener("click", () => {
  if (!casosVisibles.length) { alert("No hay casos para exportar (revise el buscador)."); return; }
  const filas = casosVisibles.map((c) => ({
    "Grado": c.grado || "",
    "Nombres y apellidos": nombreInvestigadoVisible(c),
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
  // El admin gestiona cualquier caso; un oficial gestiona el suyo (donde su
  // propio CIP quedó como oficial_constato_cip al crearlo) -- RLS exige
  // exactamente esto mismo del lado del servidor, esto solo decide qué
  // formularios mostrar.
  const puedeGestionar = isAdmin || (!!state.cip && caso.oficial_constato_cip === state.cip);
  const sustentoArchivo = await fileLinkHtml("casos-imputacion-pnp", caso.archivo_sustento_path, caso.archivo_sustento_nombre);
  const descargoArchivo = await fileLinkHtml("casos-imputacion-pnp", caso.archivo_descargo_path, caso.archivo_descargo_nombre);
  const puedeDescargar = puedeGenerarImputacion(caso, state.efectivos);
  const infraccion = getInfraccion(caso.codigo_infraccion);
  const puedeActa = puedeGenerarActaNoDescargo(caso, state.efectivos);
  const plazoVencido = plazoDescargoVencido(caso);
  const fechaLimite = fechaLimiteDescargo(caso);
  const puedeSancion = puedeGenerarOrdenSancion(caso, state.efectivos);
  const opcionesSancion = opcionesTercio(caso.codigo_infraccion) || [];

  const { data: versionesDocs } = await supabase
    .from("documentos_generados")
    .select("*")
    .eq("caso_id", caso.id)
    .order("generado_at", { ascending: false });
  const TIPO_DOCUMENTO_LABEL = { imputacion: "Imputación", acta_no_descargo: "Acta de No Descargo", orden_sancion: "Orden de Sanción" };
  const versionesHtml = versionesDocs?.length
    ? (await Promise.all(versionesDocs.map(async (v) => {
        const link = await fileLinkHtml("casos-imputacion-pnp", v.archivo_path, v.archivo_nombre);
        return `<div class="detail-field"><div class="label">${escapeHtml(TIPO_DOCUMENTO_LABEL[v.tipo] || v.tipo)} — ${formatFechaHora(v.generado_at.slice(0, 10), v.generado_at.slice(11, 16))}</div><div class="value">${link} <span class="muted small">(${escapeHtml(v.generado_por_email || "-")})</span></div></div>`;
      }))).join("")
    : "";

  $("casoDetailContent").innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <h3>${escapeHtml(nombreInvestigadoVisible(caso, true))}</h3>
        <div style="display:flex; gap:8px">
          ${puedeDescargar ? `<button type="button" class="btn-secondary" id="btnRevisarConsistencia">🔍 Revisar con IA</button>` : ""}
          <button type="button" class="btn-secondary" id="btnDescargarImputacion" ${puedeDescargar ? "" : "disabled"}>⬇ Descargar Imputación</button>
        </div>
      </div>
      <div class="detail-progress">
        <span class="detail-progress-label">Estado del expediente</span>
        ${progresoCasoHtml(caso)}
      </div>
      <div class="timeline-card">
        <div class="detail-card-header"><h3>Ruta del expediente</h3><span class="muted small">Seguimiento cronológico</span></div>
        ${cronologiaCasoHtml(caso)}
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
            ${puedeGestionar ? `
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
        ${puedeGestionar ? `
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

    ${puedeGestionar && (caso.fecha_descargo || plazoVencido) ? `
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

    ${puedeGestionar && caso.sancion_generada_at ? `
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

    ${versionesDocs?.length ? `
    <div class="detail-card">
      <h3>Versiones generadas</h3>
      <p class="muted small">Cada vez que se genera un documento queda archivada esta copia exacta, aunque después se regenere con datos distintos.</p>
      <div class="detail-grid">${versionesHtml}</div>
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
    const blob = await renderizarActaNoDescargoDocx(caso, state.efectivos);
    const nombreArchivo = nombreArchivoDocumento("ACTA NO DESCARGO", caso);
    saveAs(blob, nombreArchivo);
    registrarVersionDocumento(caso.id, "acta_no_descargo", blob, nombreArchivo);
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
    if (esImagen) return await extractImagenTextoConOcr(blob, onEstado);
  } catch (err) {
    console.error("No se pudo leer el archivo de descargo:", err);
  }
  return "";
}

// La lectura de un PDF puede incluir cientos de páginas, sellos repetidos o
// texto OCR. Enviar todo a la vez puede hacer que el proveedor rechace la
// petición por tamaño. Se conserva el inicio y el cierre, donde normalmente
// están los fundamentos y la firma del descargo, y se informa la omisión.
function recortarTextoParaIA(texto, limite, etiqueta) {
  const limpio = String(texto || "").trim();
  if (limpio.length <= limite) return limpio;
  const inicio = Math.ceil(limite * 0.7);
  const cierre = limite - inicio;
  return `${limpio.slice(0, inicio)}\n\n[Se omitió una parte extensa de ${etiqueta} para que el análisis pueda continuar.]\n\n${limpio.slice(-cierre)}`;
}

function prepararDirectivasParaAnalisis(directivas, limiteTotal = 45000) {
  let disponible = limiteTotal;
  return (directivas || []).map((directiva) => {
    if (disponible <= 0) return null;
    const contenido = recortarTextoParaIA(directiva.contenido, disponible, "las directivas internas");
    disponible -= contenido.length;
    return { ...directiva, contenido };
  }).filter(Boolean);
}

const CARACTERES_POR_BLOQUE_DESCARGO = 40000;

function dividirDescargoEnBloques(texto, limite = CARACTERES_POR_BLOQUE_DESCARGO) {
  const limpio = String(texto || "").trim();
  if (!limpio || limpio.length <= limite) return limpio ? [limpio] : [];

  const bloques = [];
  let bloqueActual = "";
  for (const parrafo of limpio.split(/\n\s*\n/)) {
    const fragmento = parrafo.trim();
    if (!fragmento) continue;
    if (fragmento.length > limite) {
      if (bloqueActual) bloques.push(bloqueActual);
      for (let inicio = 0; inicio < fragmento.length; inicio += limite) {
        bloques.push(fragmento.slice(inicio, inicio + limite));
      }
      bloqueActual = "";
      continue;
    }
    if (bloqueActual && bloqueActual.length + fragmento.length + 2 > limite) {
      bloques.push(bloqueActual);
      bloqueActual = fragmento;
    } else {
      bloqueActual += `${bloqueActual ? "\n\n" : ""}${fragmento}`;
    }
  }
  if (bloqueActual) bloques.push(bloqueActual);
  return bloques;
}

async function invocarAnalisisDescargoIA(body) {
  const { data, error } = await supabase.functions.invoke("analizar-descargo-sancion", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function detalleErrorAnalisisIA(err) {
  const respuesta = err?.context;
  if (respuesta?.clone) {
    try {
      const cuerpo = await respuesta.clone().json();
      if (cuerpo?.error) return cuerpo.error;
    } catch (_) {
      // Cuando la respuesta no es JSON se usa el mensaje estándar de abajo.
    }
  }
  return err?.message || String(err);
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

    statusEl.textContent = "Consultando directivas internas y antecedentes...";
    const directivas = prepararDirectivasParaAnalisis(
      directivasParaIA(state.directivas.length ? state.directivas : await listarDirectivas(supabase))
    );
    const antecedentes = buscarAntecedentes(caso, state.casos);
    const datosBase = {
      investigadoCompleto: nombreInvestigadoVisible(caso, true),
      codigoInfraccion: normalizarCodigoInfraccion(caso.codigo_infraccion),
      infraccionTexto: infraccion?.infraccion || "",
      sancionTexto: infraccion?.sancion || "",
      descripcionHecho: caso.descripcion_hecho || "",
      tercios: opciones.map((o) => ({ value: o.value, label: o.label, extremo: o.extremo })),
    };

    const bloques = dividirDescargoEnBloques(textoDescargo);
    let textoParaAnalisis = textoDescargo;
    if (bloques.length > 1) {
      const resumenes = [];
      for (let indice = 0; indice < bloques.length; indice += 1) {
        statusEl.textContent = `Leyendo el descargo: parte ${indice + 1} de ${bloques.length}...`;
        const resultadoBloque = await invocarAnalisisDescargoIA({
          ...datosBase,
          modo: "resumir_bloque",
          textoDescargo: bloques[indice],
          antecedentes: [],
          directivas: [],
        });
        const resumen = String(resultadoBloque.resumen_descargo || "").trim();
        if (resumen) resumenes.push(`Parte ${indice + 1}: ${resumen}`);
      }
      if (!resumenes.length) throw new Error("No se pudo obtener un resumen de las partes del descargo.");
      textoParaAnalisis = `El siguiente es un resumen completo por partes de un descargo extenso (${bloques.length} partes). Valore todas las partes como un solo descargo:\n\n${resumenes.join("\n\n")}`;
    }

    statusEl.textContent = "Analizando el descargo con IA...";
    const data = await invocarAnalisisDescargoIA({
      ...datosBase,
      antecedentes,
      textoDescargo: textoParaAnalisis,
      directivas,
    });
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
    errEl.textContent = "No se pudo analizar con IA: " + await detalleErrorAnalisisIA(err);
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
      ? await extractImagenTextoConOcr(file, (msg) => { statusEl.textContent = msg; })
      : "";

    statusEl.textContent = "Verificando con IA...";
    const infraccion = getInfraccion(caso.codigo_infraccion);
    const sancionImpuesta = caso.sancion_tercio_label === "amonestacion" ? "amonestación" : `${caso.sancion_tercio_label} días de Sanción Simple`;
    const { data, error } = await supabase.functions.invoke("revisar-documento-ia", {
      body: {
        tipo: "notificacion_orden",
        investigadoCompleto: nombreInvestigadoVisible(caso, true),
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
    const blob = await renderizarOrdenSancionDocx(caso, state.efectivos, { tercioValue, analisisTexto, descargoTexto });
    const nombreArchivo = nombreArchivoDocumento("ORDEN DE SANCION", caso);
    saveAs(blob, nombreArchivo);
    registrarVersionDocumento(caso.id, "orden_sancion", blob, nombreArchivo);
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
  actualizarBotonRedactarIA();
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

// Separa "apellidos_nombres" en sus dos partes. Si trae coma (formato de los
// oficiales, p.ej. "SOLIS GONZALES,MANUEL ANGELO") corta ahí; si no (la
// mayoría de suboficiales, p.ej. "HIDALGO FERRARI HANS BRANDON") asume que
// las primeras 1-2 palabras son los apellidos.
function splitApellidosNombres(full) {
  const txt = (full || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (txt.includes(",")) {
    const [ap, no] = txt.split(",");
    return { apellidos: ap.trim(), nombres: (no || "").trim() };
  }
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return { apellidos: txt, nombres: "" };
  return { apellidos: words.slice(0, 2).join(" "), nombres: words.slice(2).join(" ") };
}

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
  // La mayoría de los efectivos NO tienen coma en apellidos_nombres (solo los
  // oficiales, p.ej. "SOLIS GONZALES,MANUEL ANGELO") -- para el resto (p.ej.
  // "HIDALGO FERRARI HANS BRANDON") hay que asumir que las primeras 1-2
  // palabras son los apellidos, igual que ya hace el resto de la app.
  const { apellidos, nombres } = splitApellidosNombres(found.apellidos_nombres);
  $("fApellidos").value = apellidos;
  $("fNombres").value = nombres;
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

// ---------- Historial de actividad ----------
async function loadHistorial() {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(200);
  if (error) { console.error(error); return; }
  renderHistorialTable(data || []);
}

// Para UPDATE, arma una lista legible de "campo: antes → después" comparando
// el jsonb guardado por el trigger; para INSERT/DELETE no hay comparación
// posible (solo existe un lado), así que se muestra un texto fijo.
function diffResumenHistorial(entry) {
  if (entry.action === "INSERT") return "Registro creado.";
  if (entry.action === "DELETE") return "Registro eliminado.";
  const anterior = entry.old_data || {};
  const nuevo = entry.new_data || {};
  const campos = new Set([...Object.keys(anterior), ...Object.keys(nuevo)]);
  const cambios = [];
  campos.forEach((c) => {
    if (c === "updated_at" || c === "created_at") return;
    const a = anterior[c];
    const b = nuevo[c];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      cambios.push(`${escapeHtml(c)}: ${escapeHtml(String(a ?? "-"))} → ${escapeHtml(String(b ?? "-"))}`);
    }
  });
  return cambios.length ? cambios.join(" · ") : "Sin cambios en los campos.";
}

// ---------- Directivas internas ----------
async function loadDirectivasView() {
  try {
    state.directivas = await listarDirectivas(supabase);
  } catch (err) {
    console.error(err);
    state.directivas = [];
  }
  renderDirectivasList(state.directivas);
}

function renderDirectivasList(list) {
  const container = $("directivasList");
  if (!container) return;
  $("directivasEmpty").classList.toggle("hidden", list.length > 0);
  const isAdmin = state.role === "admin";
  container.innerHTML = list.map((d) => `
    <div class="directiva-card" data-id="${d.id}">
      <div class="directiva-card-header">
        <h3>${escapeHtml(d.titulo)}${d.numero_documento ? ` <span class="muted small">(${escapeHtml(d.numero_documento)})</span>` : ""}</h3>
        <span class="pill ${d.activa ? "pill-yes" : "pill-inactive"}">${d.activa ? "Activa" : "Inactiva"}</span>
      </div>
      <div class="directiva-contenido">${escapeHtml(d.contenido)}</div>
      ${isAdmin ? `
        <div class="directiva-actions">
          <button type="button" class="btn-secondary btn-editar-directiva">Editar</button>
          <button type="button" class="btn-danger btn-eliminar-directiva">Eliminar</button>
        </div>
      ` : ""}
    </div>
  `).join("");

  if (!isAdmin) return;
  container.querySelectorAll(".btn-editar-directiva").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.closest(".directiva-card").dataset.id;
      const directiva = state.directivas.find((d) => String(d.id) === id);
      if (directiva) abrirModalDirectiva(directiva);
    });
  });
  container.querySelectorAll(".btn-eliminar-directiva").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.closest(".directiva-card").dataset.id;
      if (!confirm("¿Eliminar esta directiva? Esta acción no se puede deshacer.")) return;
      try {
        await eliminarDirectiva(supabase, id);
        loadDirectivasView();
      } catch (err) {
        alert("No se pudo eliminar: " + (err.message || err));
      }
    });
  });
}

function abrirModalDirectiva(directiva) {
  $("directivaForm").reset();
  $("dvId").value = directiva?.id || "";
  $("dvTitulo").value = directiva?.titulo || "";
  $("dvNumero").value = directiva?.numero_documento || "";
  $("dvContenido").value = directiva?.contenido || "";
  $("dvActiva").checked = directiva ? !!directiva.activa : true;
  $("dvArchivoStatus").classList.add("hidden");
  $("directivaError").classList.add("hidden");
  $("directivaModalTitulo").textContent = directiva ? "Editar directiva" : "Nueva directiva";
  $("modalDirectiva").classList.remove("hidden");
}
function closeModalDirectiva() { $("modalDirectiva").classList.add("hidden"); }

$("btnNuevaDirectiva")?.addEventListener("click", () => abrirModalDirectiva(null));
$("btnCerrarModalDirectiva")?.addEventListener("click", closeModalDirectiva);
$("btnCancelarDirectiva")?.addEventListener("click", closeModalDirectiva);

$("dvArchivo")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const statusEl = $("dvArchivoStatus");
  if (!file) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = "Leyendo archivo...";
  statusEl.classList.remove("hidden");
  try {
    let texto = "";
    if (file.type === "application/pdf") {
      texto = await extractPdfText(file, (msg) => { statusEl.textContent = msg; });
    } else if (file.type.startsWith("image/")) {
      texto = await extractImagenTextoConOcr(file, (msg) => { statusEl.textContent = msg; });
    }
    texto = texto.trim();
    if (texto) {
      if (!$("dvContenido").value.trim()) $("dvContenido").value = texto;
      statusEl.textContent = "Texto extraído del archivo con IA. Revíselo antes de guardar — puede tener errores puntuales en fragmentos poco legibles.";
    } else {
      statusEl.textContent = "No se pudo extraer texto del archivo. Péguelo usted mismo en el campo de abajo.";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo leer el archivo automáticamente. Péguelo usted mismo en el campo de abajo.";
  }
});

$("directivaForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("directivaError");
  errEl.classList.add("hidden");
  const id = $("dvId").value || null;
  const titulo = $("dvTitulo").value.trim();
  const numero_documento = $("dvNumero").value.trim();
  const contenido = $("dvContenido").value.trim();
  const activa = $("dvActiva").checked;
  if (!titulo || !contenido) return;

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const savedId = await guardarDirectiva(supabase, { id, titulo, numero_documento, contenido, activa, userId: state.session.user.id });
    const file = $("dvArchivo").files[0];
    if (file) {
      const { path, nombre } = await subirArchivoDirectiva(supabase, savedId, file);
      await guardarDirectiva(supabase, { id: savedId, titulo, numero_documento, contenido, activa, archivo_path: path, archivo_nombre: nombre });
    }
    closeModalDirectiva();
    loadDirectivasView();
  } catch (err) {
    console.error(err);
    errEl.textContent = "Error: " + (err.message || err);
    errEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
  }
});

function renderHistorialTable(entries) {
  const tbody = $("historialTableBody");
  tbody.innerHTML = "";
  $("historialEmpty").classList.toggle("hidden", entries.length > 0);
  for (const e of entries) {
    const tr = document.createElement("tr");
    const pillClase = e.action === "INSERT" ? "pill-yes" : e.action === "DELETE" ? "pill-no" : "pill-inactive";
    const fecha = e.changed_at.slice(0, 10);
    const hora = e.changed_at.slice(11, 16);
    tr.innerHTML = `
      <td>${formatFechaHora(fecha, hora)}</td>
      <td>${escapeHtml(e.changed_by_email || "-")}</td>
      <td>${escapeHtml(e.table_name)}</td>
      <td><span class="pill ${pillClase}">${escapeHtml(e.action)}</span></td>
      <td class="small">${diffResumenHistorial(e)}</td>
    `;
    tbody.appendChild(tr);
  }
}
