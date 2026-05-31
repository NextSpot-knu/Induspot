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
    } catch (parseErr: any) {
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON:", parseErr);
      return NextResponse.json({ error: "Invalid GCP_SERVICE_ACCOUNT_KEY format" }, { status: 500 });
    }
    
    // [디버그] 서비스 계정 이메일 확인 — 403 IAM 권한 진단용
    console.log("[Proxy] Using service account:", credentials.client_email ?? "UNKNOWN");
    
    // Catch-all 배열을 파싱하여 하위 API 경로 동적 재구성
    const subPath = params.path ? `/${params.path.join("/")}` : "";
    // 기존 URL의 쿼리 스트링(?key=value)이 있다면 그대로 추출하여 결합
    const searchParams = new URL(request.url).search; 
    const finalUrl = `${targetAudience}${subPath}${searchParams}`;

    const auth = new GoogleAuth({
      credentials,
      // scopes는 OAuth2 액세스 토큰 방식 전용 — getIdTokenClient(OIDC)와 공존 불가
    });
    
    const client = await auth.getIdTokenClient(targetAudience);
    const authHeaders = (await client.getRequestHeaders()) as Record<string, any>;

    const headers = new Headers();
    // Copy incoming headers that are safe to copy
    const headersToCopy = ["content-type", "accept", "accept-language"];
    for (const h of headersToCopy) {
      const val = request.headers.get(h);
      if (val) headers.set(h, val);
    }

    // Attach Google OIDC Token
    const authHeaderValue = authHeaders["Authorization"] || authHeaders["authorization"] || "";
    if (authHeaderValue) {
      headers.set("authorization", authHeaderValue);
    }

    // Attach original Supabase JWT token as X-Forwarded-Authorization
    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) {
      headers.set("X-Forwarded-Authorization", incomingAuth);
    }

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // GET 및 HEAD 메서드는 body를 가질 수 없으므로 제외
    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        const reqBody = await request.json();
        fetchOptions.body = JSON.stringify(reqBody);
      } catch (jsonErr) {
        // Fallback to text body if JSON parsing fails
        try {
          const textBody = await request.text();
          if (textBody) {
            fetchOptions.body = textBody;
          }
        } catch {
          // Do nothing
        }
      }
    }

    const response = await fetch(finalUrl, fetchOptions);
    const responseText = await response.text();

    // [디버그] 루트 진단: /api/proxy 루트 요청 시 상세 정보 반환
    if (!subPath && request.method === "GET") {
      return NextResponse.json({
        debug: true,
        serviceAccount: credentials.client_email ?? "UNKNOWN",
        targetAudience,
        finalUrl,
        backendStatus: response.status,
        backendStatusText: response.statusText,
        authHeaderSent: authHeaderValue ? `${authHeaderValue.substring(0, 30)}...` : "EMPTY",
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

  } catch (error: any) {
    console.error("Reverse Proxy error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Next.js App Router 규격에 맞추어 HTTP Method 핸들러들을 개방 (Next.js 15+ 비동기 params 처리 대응)
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
