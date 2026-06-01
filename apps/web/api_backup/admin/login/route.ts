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

    // 개발용 간이 비밀번호 확인
    if (password === "admin") {
      const cookieStore = await cookies();
      cookieStore.set("admin_session", "authenticated", {
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
