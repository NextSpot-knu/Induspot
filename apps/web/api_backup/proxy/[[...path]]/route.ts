import { GoogleAuth } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

const targetAudience = "https://induspot-backend-768699236852.asia-northeast3.run.app";

// GET, POST 등 모든 요청을 처리하는 공통 프록시 함수
async function forwardRequest(request: NextRequest, params: { path?: string[] }) {
  try {
    const rawCredentials = process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (!rawCredentials) {
      console.error("GCP_SERVICE_ACCOUNT_KEY environment variable is missing.");
      return NextResponse.json({ error: "GCP Key missing" }, { status: 500 });
    }
    
    let credentials;
    try {
      credentials = JSON.parse(rawCredentials);
    } catch (parseErr: unknown) {
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON:", parseErr);
      return NextResponse.json({ error: "Invalid GCP_SERVICE_ACCOUNT_KEY format" }, { status: 500 });
    }
    
    // Catch-all 배열을 파싱하여 하위 API 경로 동적 재구성
    const subPath = params.path ? `/${params.path.join("/")}` : "";
    const searchParams = new URL(request.url).search; 
    const finalUrl = `${targetAudience}${subPath}${searchParams}`;

    const auth = new GoogleAuth({ credentials });
    
    const client = await auth.getIdTokenClient(targetAudience);
    // getRequestHeaders()는 환경에 따라 Web Headers 객체 또는 plain object를 반환
    const rawHeaders: unknown = await client.getRequestHeaders(targetAudience);
    
    // Web Headers 객체와 plain object 모두 안전하게 처리
    let authHeaderValue = "";
    if (rawHeaders && typeof (rawHeaders as { get?: unknown }).get === "function") {
      // Web 표준 Headers 객체 → .get() 메서드 사용
      authHeaderValue = (rawHeaders as globalThis.Headers).get("Authorization") ?? "";
    } else if (rawHeaders && typeof rawHeaders === "object") {
      // Plain object → bracket notation 사용
      const obj = rawHeaders as Record<string, string>;
      authHeaderValue = obj["Authorization"] || obj["authorization"] || "";
    }

    const headers = new Headers();
    // 안전한 수신 헤더 복사
    const headersToCopy = ["content-type", "accept", "accept-language"];
    for (const h of headersToCopy) {
      const val = request.headers.get(h);
      if (val) headers.set(h, val);
    }

    // Google OIDC 토큰 주입 (Cloud Run 인증용)
    if (authHeaderValue) {
      headers.set("Authorization", authHeaderValue);
    }

    // 원본 Supabase JWT 토큰을 별도 헤더로 전달
    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) {
      headers.set("X-Forwarded-Authorization", incomingAuth);
    }

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // GET/HEAD는 body를 가질 수 없으므로 제외
    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        const reqBody = await request.json();
        fetchOptions.body = JSON.stringify(reqBody);
      } catch {
        try {
          const textBody = await request.text();
          if (textBody) {
            fetchOptions.body = textBody;
          }
        } catch {
          // body 없는 POST 등 허용
        }
      }
    }

    const response = await fetch(finalUrl, fetchOptions);
    const responseText = await response.text();

    // (a) 빈 본문이면 빈 본문 그대로 반환
    if (responseText.length === 0) {
      return new Response(null, { status: response.status });
    }

    // (b) JSON 파싱 성공 시 파싱 결과를 JSON 으로 반환 (현 엔드포인트는 모두 JSON → 회귀 없음)
    try {
      const responseData = JSON.parse(responseText);
      return NextResponse.json(responseData, { status: response.status });
    } catch {
      // (c) 파싱 실패면 원문 그대로 통과
      const contentType = response.headers.get("content-type") ?? "text/plain";
      return new Response(responseText, {
        status: response.status,
        headers: { "content-type": contentType },
      });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Reverse Proxy error:", message);
    return NextResponse.json({ error: "Internal Server Error", message }, { status: 500 });
  }
}

// Next.js App Router HTTP Method 핸들러 (Next.js 15+ 비동기 params 대응)
export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const resolvedParams = await context.params;
  return forwardRequest(request, resolvedParams);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const resolvedParams = await context.params;
  return forwardRequest(request, resolvedParams);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const resolvedParams = await context.params;
  return forwardRequest(request, resolvedParams);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const resolvedParams = await context.params;
  return forwardRequest(request, resolvedParams);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const resolvedParams = await context.params;
  return forwardRequest(request, resolvedParams);
}
