import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

async function handleProxy(request: NextRequest, method: string) {
  try {
    const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      console.error("GCP_SERVICE_ACCOUNT_KEY environment variable is missing.");
      return NextResponse.json(
        { error: "Internal Server Error", message: "GCP_SERVICE_ACCOUNT_KEY is missing." },
        { status: 500 }
      );
    }

    let credentials;
    try {
      credentials = JSON.parse(serviceAccountKey);
    } catch (parseErr: any) {
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON:", parseErr);
      return NextResponse.json(
        { error: "Internal Server Error", message: "Invalid GCP_SERVICE_ACCOUNT_KEY format." },
        { status: 500 }
      );
    }

    // Target audience URL (Cloud Run API)
    const targetAudience = "https://induspot-backend-knudc-henryseo711-an.a.run.app";

    // 1. Get query parameter for target endpoint path (e.g. ?path=/api/v1/recommendations)
    const searchParams = request.nextUrl.searchParams;
    const subPath = searchParams.get("path") || searchParams.get("subPath") || "";

    // Forward other query parameters if they exist
    const forwardedSearchParams = new URLSearchParams(searchParams);
    forwardedSearchParams.delete("path");
    forwardedSearchParams.delete("subPath");
    const queryString = forwardedSearchParams.toString();

    // Construct target request URL
    const targetUrl = `${targetAudience.replace(/\/$/, "")}${subPath}${queryString ? `?${queryString}` : ""}`;
    console.log(`Proxying ${method} request to target: ${targetUrl}`);

    // 2. Generate Google OIDC ID Token using the parsed credentials
    let authHeaderValue = "";
    try {
      const auth = new GoogleAuth({
        credentials,
        scopes: "https://www.googleapis.com/auth/cloud-platform",
      });
      const client = await auth.getIdTokenClient(targetAudience);
      const gcpHeaders = await client.getRequestHeaders() as Record<string, any>;
      authHeaderValue = gcpHeaders["Authorization"] || gcpHeaders["authorization"] || "";
    } catch (authErr: any) {
      console.error("Failed to generate Google ID Token:", authErr);
      return NextResponse.json(
        { error: "Internal Server Error", message: `Authentication failure: ${authErr.message}` },
        { status: 500 }
      );
    }

    // 3. Prepare headers
    const headers = new Headers();
    // Copy incoming headers that are safe to copy
    const headersToCopy = ["content-type", "accept", "accept-language"];
    for (const h of headersToCopy) {
      const val = request.headers.get(h);
      if (val) headers.set(h, val);
    }

    // Attach Google OIDC Token
    if (authHeaderValue) {
      headers.set("authorization", authHeaderValue);
    }

    // Attach original Supabase JWT token as X-Forwarded-Authorization
    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) {
      headers.set("X-Forwarded-Authorization", incomingAuth);
    }

    // 4. Parse body from incoming request if not GET/HEAD
    let body: any = null;
    if (method !== "GET" && method !== "HEAD") {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          body = JSON.stringify(await request.json());
        } catch {
          body = null;
        }
      } else {
        body = await request.text();
      }
    }

    // 5. Send fetch request to GCP Cloud Run target
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    // Return the response directly
    return NextResponse.json(responseData, {
      status: response.status,
      statusText: response.statusText,
    });

  } catch (error: any) {
    console.error("Reverse Proxy error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handleProxy(request, "POST");
}

export async function GET(request: NextRequest) {
  return handleProxy(request, "GET");
}

export async function PUT(request: NextRequest) {
  return handleProxy(request, "PUT");
}

export async function DELETE(request: NextRequest) {
  return handleProxy(request, "DELETE");
}

export async function PATCH(request: NextRequest) {
  return handleProxy(request, "PATCH");
}
