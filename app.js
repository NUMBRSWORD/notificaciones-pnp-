import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA } from "./config.js";
import { generarImputacionDocx, puedeGenerarImputacion, buscarOficialConstato } from "./lib/imputacion.js";
import { getInfraccion, normalizarCodigoInfraccion, ANEXO_I } from "./lib/anexoI.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: SUPABASE_SCHEMA },
});

const state = {
  session: null,
  role: null,
  email: null,
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
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
    return;
  }
  okEl.textContent = "Cuenta creada. Ya puede ingresar (si su proyecto exige confirmar el correo, revise su bandeja).";
  okEl.classList.remove("hidden");
  $("registroForm").reset();
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
  const puedeDescargar = puedeGenerarImputacion(caso, state.efectivos);
  const infraccion = getInfraccion(caso.codigo_infraccion);

  $("casoDetailContent").innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <h3>${escapeHtml(caso.grado || "")} ${escapeHtml(caso.apellidos || "")} ${escapeHtml(caso.nombres || "")}</h3>
        <button type="button" class="btn-secondary" id="btnDescargarImputacion" ${puedeDescargar ? "" : "disabled"}>⬇ Descargar Imputación</button>
      </div>
      ${!puedeDescargar ? `<p class="muted small">Para poder generar el documento, verifique que el código de infracción sea Leve válido (Anexo I) y que el oficial que constató ("${escapeHtml(caso.oficial_constato || "")}") esté registrado en Efectivos.</p>` : ""}
      <div class="detail-grid">
        <div class="detail-field"><div class="label">Fecha del hecho</div><div class="value">${formatDate(caso.fecha_hecho)}</div></div>
        <div class="detail-field"><div class="label">Código de infracción</div><div class="value">${escapeHtml(caso.codigo_infraccion || "-")}${infraccion ? ` — ${escapeHtml(infraccion.bienJuridico)}` : ""}</div></div>
        <div class="detail-field"><div class="label">Oficial que constató</div><div class="value">${escapeHtml(caso.oficial_constato || "-")}</div></div>
        <div class="detail-field"><div class="label">Unidad / Sub-unidad</div><div class="value">${escapeHtml(caso.unidad_investigado || "-")}</div></div>
        <div class="detail-field"><div class="label">Archivo de sustento</div><div class="value">${sustentoArchivo}</div></div>
        <div class="detail-field"><div class="label">Notificado</div><div class="value">${caso.imputacion_generada_at ? formatDate(caso.imputacion_generada_at) : "Pendiente"}</div></div>
      </div>
      <div class="detail-field" style="margin-top:10px">
        <div class="label">Descripción del hecho</div>
        <div class="value">${escapeHtml(caso.descripcion_hecho || "-")}</div>
      </div>
      ${isAdmin ? `<button class="btn-danger" id="btnEliminarCaso" style="margin-top:16px">Eliminar caso</button>` : ""}
    </div>
  `;

  $("btnDescargarImputacion")?.addEventListener("click", async (e) => {
    await handleDescargarImputacion(caso, e.currentTarget);
    openCasoDetail(caso.id);
  });
  if (isAdmin) {
    $("btnEliminarCaso")?.addEventListener("click", () => eliminarCaso(caso.id));
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

  const payload = {
    grado: $("fGrado").value.trim(),
    apellidos: $("fApellidos").value.trim(),
    nombres: $("fNombres").value.trim(),
    codigo_infraccion: codigo,
    fecha_hecho: $("fFechaHecho").value,
    descripcion_hecho: $("fDescripcionHecho").value.trim(),
    unidad_investigado: $("fUnidad").value.trim(),
    oficial_constato: $("fOficialConstato").value.trim(),
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
