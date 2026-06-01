import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * POST /api/admin/login
 * Body: { password: string }
 * Response: { success: true } + Cookie
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;

    // 비밀번호/세션 토큰은 환경변수로 분리한다. 미설정 시 데모 기본값('admin'/'authenticated')으로 폴백해
    // 로컬·데모 동작은 보존하되, 운영에서 ADMIN_PASSWORD/ADMIN_SESSION_TOKEN 을 설정하면 즉시 강화된다.
    // (proxy.ts 가 동일한 ADMIN_SESSION_TOKEN 폴백으로 쿠키값을 검증한다.)
    const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
    const sessionToken = process.env.ADMIN_SESSION_TOKEN || "authenticated";

    if (password === expectedPassword) {
      const cookieStore = await cookies();
      cookieStore.set("admin_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 // 1일 유지
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { success: false, message: "비밀번호가 일치하지 않습니다." },
      { status: 401 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: "잘못된 요청 형식입니다." },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/admin/login (로그아웃)
 */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_session");
  return NextResponse.json({ success: true });
}
