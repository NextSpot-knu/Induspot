'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { isAdminAuthed } from '@/lib/admin-auth';

// 정적 export(Firebase 호스팅)에서는 Next 미들웨어가 실행되지 않으므로, /admin/* 보호는
// 이 클라이언트 레이아웃 가드가 담당한다.
//  - 인증 = 로컬 비밀번호 세션(동기). localStorage 의 세션 마커 유무로 판정.
//  - 로그인 페이지(/admin/login)는 공개로 통과.
//  - 그 외 /admin/* 는 세션이 없으면 로그인으로 리다이렉트.
//  - pathname 을 의존성에 포함해 라우트가 바뀔 때마다 일관되게 재검사한다(모든 하위 페이지 동일 게이트).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname === '/admin/login';
  const [status, setStatus] = useState<'checking' | 'allowed'>(
    isLoginRoute ? 'allowed' : 'checking'
  );

  useEffect(() => {
    if (isLoginRoute) {
      setStatus('allowed');
      return;
    }
    if (isAdminAuthed()) {
      setStatus('allowed');
    } else {
      setStatus('checking');
      router.replace('/admin/login');
    }
  }, [isLoginRoute, pathname, router]);

  if (status === 'checking') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#070b19] text-slate-300">
        <Loader2 className="animate-spin" size={20} />
        <span className="ml-2 text-sm">권한 확인 중…</span>
      </div>
    );
  }

  return <>{children}</>;
}
