// Proyecto Supabase propio de "Notificación de Imputación PNP" — totalmente
// separado de "MORAL Y DISCIPLINA" (cuenta, proyecto y base de datos
// distintos). Las tablas viven directo en el esquema "public" (creadas por
// supabase_setup.sql), así que no hace falta indicar un esquema aparte.
export const SUPABASE_URL = "https://lymoicdeexusnjdjzfid.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_IU60ZqZJn86OnA7XJDAUfA_qllMLFsk";
export const SUPABASE_SCHEMA = "public";

// Clave pública para que Android pueda autorizar alertas en la aplicación
// instalada. La clave privada vive únicamente como secreto de Supabase.
export const VAPID_PUBLIC_KEY = "BBXm4Q5gqE4O19pYekspjI_9_9Ca03EilH1kTRo7NxIDVndpFJF8SWfWYGibS1p5OYk5cnOXX9EUZjwTlwEoVK8";
