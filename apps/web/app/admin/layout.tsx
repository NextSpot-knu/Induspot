'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getAdminIdToken } from '@/lib/firebase-auth';

// 정적 export(Firebase 호스팅)에서는 Next 미들웨어가 실행되지 않으므로, /admin/* 보호는
// 이 클라이언트 레이아웃 가드가 담당한다.
//  - 인증 = GCP 베이스(Firebase Auth, REST). 로컬스토리지의 Firebase ID 토큰 유효성으로 판정.
//  - 로그인 페이지(/admin/login)는 공개로 통과.
//  - 그 외 /admin/* 는 유효 토큰 없으면 로그인으로. (프로토타입: 인증된 Firebase 사용자=관리자)
//  - 민감 백엔드 작업(simulate-peak)은 FastAPI 가 Firebase ID 토큰을 재검증(이중 방어).
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
      const token = await getAdminIdToken();
      if (!active) return;
      if (token) {
        setStatus('allowed');
      } else {
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
