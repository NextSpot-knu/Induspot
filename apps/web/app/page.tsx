'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoadingPage() {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 마운트 직후 페이드인
    const timer = setTimeout(() => setIsVisible(true), 100);
    // 3초 후 온보딩(/setup)으로 이동
    const redirectTimer = setTimeout(() => router.push('/setup'), 3000);
    return () => {
      clearTimeout(timer);
      clearTimeout(redirectTimer);
    };
  }, [router]);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[100dvh] overflow-hidden bg-[url('/bg.png')] bg-cover bg-center">
      {/* 1) 현재 배경 이미지를 어둡게 깔기 */}
      <div className="absolute inset-0 z-0 bg-[#080b14]/75" />

      {/* 2) mesh gradient (프랙탈 글래스 톤) */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 15% 50%, rgba(26,32,92,0.45), transparent 50%), radial-gradient(circle at 85% 30%, rgba(56,26,89,0.40), transparent 50%), radial-gradient(circle at 50% 85%, rgba(13,43,77,0.45), transparent 50%)',
        }}
      />

      {/* 3) 그레이니(프랙탈) 노이즈 텍스처 */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          opacity: 0.22,
          mixBlendMode: 'soft-light',
        }}
      />

      {/* 4) 중앙 글로우 */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] rounded-full bg-blue-600/20 blur-[110px] pointer-events-none z-0" />

      {/* 5) 프랙탈 글래스 카드 */}
      <div
        className={`relative z-10 transition-opacity duration-1000 ${
          isVisible ? 'opacity-100 animate-fade-in' : 'opacity-0'
        }`}
      >
        <div
          className="flex flex-col items-center text-center px-10 py-12 rounded-3xl border border-white/[0.08]"
          style={{
            background: 'rgba(10, 15, 30, 0.5)',
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            boxShadow: '0 8px 32px 0 rgba(0,0,0,0.37)',
          }}
        >
          {/* 로고 마크 */}
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/30 to-purple-500/20 shadow-lg shadow-blue-500/20">
            <span className="text-2xl">📍</span>
          </div>

          <h1
            className="mb-3 text-5xl font-black tracking-tight text-white"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          >
            Indu
            <span className="bg-gradient-to-r from-sky-400 to-blue-500 bg-clip-text text-transparent">
              Spot
            </span>
          </h1>

          <p
            className="text-base font-medium text-slate-300"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
          >
            기다림 없는 스마트한 공단 생활
          </p>

          {/* 로딩 인디케이터 */}
          <div className="mt-7 flex items-center gap-1.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
          </div>
        </div>
      </div>
    </div>
  );
}
