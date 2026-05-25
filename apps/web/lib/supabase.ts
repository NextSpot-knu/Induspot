import { createClient, SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

// Server-side admin client (bypasses RLS)
export function createAdminClient() {
  if (!adminClient) {
    const url = process.env.SUPABASE_URL || "https://your-supabase-project.supabase.co";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "your-supabase-service-role-key";
    adminClient = createClient(url, key);
  }
  return adminClient;
}

// Client-side public client (respects RLS)
export function createPublicClient() {
  if (!publicClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://your-supabase-project.supabase.co";
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "your-supabase-anon-key";
    publicClient = createClient(url, key);
  }
  return publicClient;
}
