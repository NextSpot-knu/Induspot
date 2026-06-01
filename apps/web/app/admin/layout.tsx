'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createPublicClient } from '@/lib/supabase';

// 정적 export(Firebase 호스팅)에서는 Next 미들웨어가 실행되지 않으므로, /admin/* 보호는
// 이 클라이언트 레이아웃 가드가 담당한다. (과거 proxy.ts + admin_session 쿠키 흐름 대체)
//  - 로그인 페이지(/admin/login)는 공개로 통과시킨다.
//  - 그 외 /admin/* 는 Supabase 세션 + users.role==='admin' 을 확인하고, 아니면 로그인으로 보낸다.
//  - 민감한 admin 백엔드 작업은 FastAPI 가 JWT 로 role 을 한 번 더 재검증한다(이중 방어).
const supabase = createPublicClient();

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname === '/admin/login';
  const [status, setStatus] = useState<'checking' | 'allowed'>(
    isLoginRoute ? 'allowed' : 'checking'
  );

  useEffect(() => {
    let active = true;

    if (isLoginRoute) {
      setStatus('allowed');
      return;
    }

    setStatus('checking');
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (active) router.replace('/admin/login');
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!active) return;
      if (profile?.role === 'admin') {
        setStatus('allowed');
      } else {
        await supabase.auth.signOut();
        router.replace('/admin/login');
      }
    })();

    return () => {
      active = false;
    };
  }, [isLoginRoute, router]);

  if (!isLoginRoute && status === 'checking') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#070b19] text-slate-300">
        <Loader2 className="animate-spin" size={20} />
        <span className="ml-2 text-sm">권한 확인 중…</span>
      </div>
    );
  }

  return <>{children}</>;
}
