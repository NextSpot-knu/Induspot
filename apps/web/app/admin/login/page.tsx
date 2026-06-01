'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ShieldCheck, Loader2, Eye, EyeOff, Mail } from 'lucide-react';
import { createPublicClient } from '@/lib/supabase';

// 정적 export 환경에서는 Next 미들웨어(proxy.ts)·서버 라우트(/api/admin/login)가 동작하지 않는다.
// 따라서 관리자 인증도 워커 앱과 동일하게 Supabase Auth(이메일/비밀번호)를 쓰고,
// users.role==='admin' 인지 확인해 통과시킨다. (가드는 admin/layout.tsx 가 담당)
const supabase = createPublicClient();

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !data.session) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        setIsLoading(false);
        return;
      }

      // 관리자 권한 확인: RLS(select_users) 가 본인 행 조회를 허용하므로 안전.
      const { data: profile, error: roleError } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.session.user.id)
        .maybeSingle();

      if (roleError || !profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        setError('관리자 권한이 없는 계정입니다.');
        setIsLoading(false);
        return;
      }

      // 성공: 대시보드로 이동(세션은 supabase-js 가 보관, admin/layout 가드가 재검증)
      router.replace('/admin/dashboard');
    } catch (err) {
      setError('로그인 처리 중 오류가 발생했습니다.');
      setIsLoading(false);
    }
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#070b19] font-sans relative overflow-hidden">
      {/* Background ambient glow effect */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-[0.15] pointer-events-none" />

      <div className="w-full max-w-md px-6 z-10 animate-slide-up">
        {/* Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8 md:p-10 relative overflow-hidden">
          {/* Subtle top light bar */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-80" />

          {/* Logo / Title Section */}
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl mb-4 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
              <ShieldCheck size={28} className="animate-pulse" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              InduSpot <span className="text-blue-500 text-base font-semibold">B2B Admin</span>
            </h1>
            <p className="text-slate-400 text-sm mt-2">
              공단 안전 및 시설 관리를 위한 관리자 인증
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
              >
                이메일
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Mail size={18} />
                </span>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com"
                  className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 transition-all text-sm disabled:opacity-50"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
              >
                비밀번호
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Lock size={18} />
                </span>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="관리자 비밀번호 입력"
                  className="w-full pl-10 pr-10 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/80 transition-all text-sm disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3.5 bg-red-950/40 border border-red-900/60 rounded-xl text-red-200 text-xs font-medium flex items-center gap-2 animate-fade-in">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-semibold text-sm shadow-[0_4px_12px_rgba(59,130,246,0.25)] hover:shadow-[0_4px_20px_rgba(59,130,246,0.4)] hover:-translate-y-[1px] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  인증 처리 중...
                </>
              ) : (
                '관리자 인증'
              )}
            </button>
          </form>

          {/* Footer note */}
          <div className="mt-8 text-center">
            <span className="text-slate-500 text-xs">
              보안 강화를 위해 무단 접근이 엄격히 제한됩니다.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
