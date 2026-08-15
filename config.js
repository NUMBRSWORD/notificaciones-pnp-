// Mismo proyecto Supabase que "MORAL Y DISCIPLINA" (misma URL/anon key: la
// anon key es a nivel de proyecto, no de esquema), pero esta app trabaja
// exclusivamente en el esquema "imputacion_pnp" — ver db.schema en app.js.
// No lee ni escribe nada del esquema "public" (notas_informativas, efectivos,
// expedientes, profiles) que usa moral-y-disciplina.
export const SUPABASE_URL = "https://tndjulaitywtoocqeeiy.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuZGp1bGFpdHl3dG9vY3FlZWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMTM2OTAsImV4cCI6MjEwMTg4OTY5MH0.PS6H11vN4jd_JIhAVVg1VPw4cy8s2L4_7VuTtLUNFiw";
export const SUPABASE_SCHEMA = "imputacion_pnp";
