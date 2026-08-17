// Base de conocimiento de "Directivas internas" de la PNP.
//
// Objetivo: que la IA de esta aplicación (análisis del descargo para la
// Orden de Sanción) se base en el texto REAL de directivas vigentes que el
// admin carga aquí — por ejemplo, los requisitos para que un descanso médico
// particular sea considerado exonerante — en vez de que la IA "adivine" ese
// tipo de reglas institucionales. Si no hay una directiva cargada sobre algo,
// la IA debe decirlo en vez de inventar el requisito.

export async function listarDirectivas(supabase) {
  const { data, error } = await supabase
    .from("directivas")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Solo las directivas activas, y solo los campos que la IA necesita (sin
// metadatos internos como id/archivo_path), listas para mandar como contexto
// a los Edge Functions de IA.
export function directivasParaIA(directivas) {
  return (directivas || [])
    .filter((d) => d.activa)
    .map((d) => ({
      titulo: d.titulo,
      numero_documento: d.numero_documento || "",
      contenido: d.contenido,
    }));
}

export async function guardarDirectiva(supabase, { id, titulo, numero_documento, contenido, activa, archivo_path, archivo_nombre, userId }) {
  const payload = {
    titulo,
    numero_documento: numero_documento || null,
    contenido,
    activa,
    ...(archivo_path !== undefined ? { archivo_path, archivo_nombre } : {}),
  };
  if (id) {
    const { error } = await supabase.from("directivas").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from("directivas").insert({ ...payload, created_by: userId }).select().single();
  if (error) throw error;
  return data.id;
}

export async function eliminarDirectiva(supabase, id) {
  const { error } = await supabase.from("directivas").delete().eq("id", id);
  if (error) throw error;
}

export async function subirArchivoDirectiva(supabase, id, file) {
  const path = `${id}/${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from("directivas").upload(path, file);
  if (error) throw error;
  return { path, nombre: file.name };
}
