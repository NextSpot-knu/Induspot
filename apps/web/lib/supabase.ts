import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://your-supabase-project.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "your-supabase-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const getSupabaseServerClient = () => {
  const isServer = typeof window === "undefined";
  const serviceKey = isServer ? process.env.SUPABASE_SERVICE_ROLE_KEY : null;
  if (serviceKey) {
    return createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabase;
};

