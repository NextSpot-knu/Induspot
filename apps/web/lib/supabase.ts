import { createClient, SupabaseClient } from "@supabase/supabase-js";

let publicClient: SupabaseClient | null = null;

// 정적 export(브라우저 전용) 앱이라 service_role 클라이언트는 두지 않는다.
// (NEXT_PUBLIC 이 아닌 SUPABASE_SERVICE_ROLE_KEY 는 브라우저에서 어차피 undefined 이고,
//  service_role 키가 클라이언트 번들에 들어가면 치명적 유출이다.) 관리 작업은 인증된 세션 + RLS,
//  또는 백엔드(FastAPI 의 service_role) 경유로 처리한다.

// Client-side public client (respects RLS)
export function createPublicClient() {
  if (!publicClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://your-supabase-project.supabase.co";
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "your-supabase-anon-key";
    publicClient = createClient(url, key);
  }
  return publicClient;
}
