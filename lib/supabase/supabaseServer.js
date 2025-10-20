// lib/supabase/supabaseServer.js

import { createClient } from '@supabase/supabase-js';

export function createServerClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Fallo al inicializar Supabase Server Client. Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_KEY.');
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}