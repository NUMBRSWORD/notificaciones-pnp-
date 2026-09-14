// Políticas institucionales y firma electrónica simple. La firma conserva
// usuario, fecha, cargo y la versión exacta del texto aceptado.

export async function listarDocumentosInstitucionales(supabase) {
  const { data, error } = await supabase.from("documentos_institucionales").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listarFirmasDocumentos(supabase) {
  const { data, error } = await supabase.from("firmas_documentos").select("*").order("firmado_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function firmarDocumento(supabase, datos) {
  const { error } = await supabase.from("firmas_documentos").insert({
    documento_id: datos.documentoId,
    documento_version: datos.version,
    firmante_id: datos.firmanteId,
    firmante_nombre: datos.nombre,
    firmante_grado: datos.grado || null,
    firmante_cargo: datos.cargo,
  });
  if (error) throw error;
}

export async function actualizarContenidoDocumentoInstitucional(supabase, datos) {
  const { error } = await supabase.from("documentos_institucionales").update({
    contenido: datos.contenido,
    version: datos.version + 1,
    updated_by: datos.userId,
    updated_at: new Date().toISOString(),
  }).eq("id", datos.id);
  if (error) throw error;
}