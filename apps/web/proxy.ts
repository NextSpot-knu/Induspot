import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /admin/login 및 /api/admin/login 경로는 인증 없이 접근 허용
  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  // /admin/* 및 /api/admin/* 경로에 대해 권한 검증
  // 세션 토큰은 env(ADMIN_SESSION_TOKEN)로 분리, 미설정 시 데모 기본값 'authenticated' 폴백
  // (login route 의 쿠키 설정값과 동일 폴백을 공유한다).
  const expectedToken = process.env.ADMIN_SESSION_TOKEN || "authenticated";
  const adminSession = request.cookies.get("admin_session")?.value;

  if (!adminSession || adminSession !== expectedToken) {
    // API 요청인 경우 401 반환
    if (pathname.startsWith("/api/admin")) {
      return Response.json(
        { success: false, message: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // 페이지 요청인 경우 로그인 페이지로 리다이렉트
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
