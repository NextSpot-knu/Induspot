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
    
    console.log("[Proxy] Using service account:", credentials.client_email ?? "UNKNOWN");
    
    // Catch-all 배열을 파싱하여 하위 API 경로 동적 재구성
    const subPath = params.path ? `/${params.path.join("/")}` : "";
    const searchParams = new URL(request.url).search; 
    const finalUrl = `${targetAudience}${subPath}${searchParams}`;

    const auth = new GoogleAuth({ credentials });
    
    const client = await auth.getIdTokenClient(targetAudience);
    // getRequestHeaders()는 { Authorization: 'Bearer xxx' } 형태의 plain object를 반환
    const idTokenHeaders = await client.getRequestHeaders(targetAudience) as unknown as Record<string, string>;
    // Authorization 키에서 토큰 추출
    const authHeaderValue = idTokenHeaders["Authorization"] || idTokenHeaders["authorization"] || "";

    console.log("[Proxy] OIDC token present:", !!authHeaderValue, "| Target:", finalUrl);

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

    // [디버그] 루트 GET 진단 — 배포 후 /api/proxy 접속 시 상태 확인용
    if (!subPath && request.method === "GET") {
      return NextResponse.json({
        debug: true,
        serviceAccount: credentials.client_email ?? "UNKNOWN",
        targetAudience,
        finalUrl,
        backendStatus: response.status,
        backendStatusText: response.statusText,
        oidcTokenPresent: !!authHeaderValue,
        oidcTokenPrefix: authHeaderValue ? String(authHeaderValue).substring(0, 30) + "..." : "NONE",
        backendResponse: responseText.substring(0, 500),
      }, { status: 200 });
    }

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    return NextResponse.json(responseData, {
      status: response.status,
      statusText: response.statusText,
    });

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
