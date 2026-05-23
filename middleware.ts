import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Check if trying to access admin pages
  if (request.nextUrl.pathname.startsWith('/admin')) {
    // If it's the login page or an API route, let it pass (or handle API auth separately)
    if (request.nextUrl.pathname === '/admin/login' || request.nextUrl.pathname.startsWith('/api')) {
      return NextResponse.next();
    }

    const adminSession = request.cookies.get('admin_session');

    // If no valid session, redirect to login
    if (!adminSession || adminSession.value !== 'authenticated') {
      // ⚠️ 현재 개발/시연 편의를 위해 로그인 페이지가 없으므로 주석 처리하거나 바로 통과시킬 수 있습니다.
      // 백엔드 명세서를 반영한 권한 체계입니다.
      // return NextResponse.redirect(new URL('/admin/login', request.url));
      
      // 임시로 그냥 통과시키도록 설정 (추후 주석 해제)
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}

// Config to run middleware only on specific paths
export const config = {
  matcher: ['/admin/:path*'],
};
