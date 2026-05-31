import { createPublicClient } from "./supabase";
const supabase = createPublicClient();

// 헬퍼: snake_case -> camelCase
function snakeToCamel(s: string): string {
  return s.replace(/(_\w)/g, (k) => k[1].toUpperCase());
}

// 헬퍼: camelCase -> snake_case
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// 재귀적으로 객체 키를 camelCase로 변환
export function keysToCamel(o: any): any {
  if (o === null || o === undefined) return o;
  if (Array.isArray(o)) {
    return o.map(keysToCamel);
  }
  if (typeof o === "object") {
    const n: { [key: string]: any } = {};
    Object.keys(o).forEach((k) => {
      n[snakeToCamel(k)] = keysToCamel(o[k]);
    });
    return n;
  }
  return o;
}

// 재귀적으로 객체 키를 snake_case로 변환
export function keysToSnake(o: any): any {
  if (o === null || o === undefined) return o;
  if (Array.isArray(o)) {
    return o.map(keysToSnake);
  }
  if (typeof o === "object") {
    const n: { [key: string]: any } = {};
    Object.keys(o).forEach((k) => {
      n[camelToSnake(k)] = keysToSnake(o[k]);
    });
    return n;
  }
  return o;
}

const BASE_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "/api/proxy";

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

async function request(path: string, options: RequestOptions = {}) {
  // 1. Supabase JWT 토큰 추출
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // query parameter 처리
  // query parameter 처리
  let url = `${BASE_URL}${path}`;
  if (options.params) {
    const queryParams = new URLSearchParams(keysToSnake(options.params));
    url += `?${queryParams.toString()}`;
  }

  // body가 존재하는 경우 camelCase -> snake_case 변환 후 전송
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    body = JSON.stringify(keysToSnake(body));
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
  }

  // 응답 데이터 json 파싱 및 snake_case -> camelCase 변환
  const data = await response.json();
  return keysToCamel(data);
}

export const apiClient = {
  get: (path: string, options?: Omit<RequestOptions, "method" | "body">) => 
    request(path, { ...options, method: "GET" }),
  
  post: (path: string, body?: any, options?: Omit<RequestOptions, "method" | "body">) => 
    request(path, { ...options, method: "POST", body }),
  
  put: (path: string, body?: any, options?: Omit<RequestOptions, "method" | "body">) => 
    request(path, { ...options, method: "PUT", body }),
  
  delete: (path: string, options?: Omit<RequestOptions, "method" | "body">) => 
    request(path, { ...options, method: "DELETE" }),
};

// --- TTTV 추천 엔진 연동 API 함수 ---

export interface RecommendationResponse {
  recommendationId: string;
  facility: {
    id: string;
    name: string;
    type: string;
    latitude: number;
    longitude: number;
    capacity: number;
    operatingHours?: any;
    features?: any;
  };
  tttvScore: number;
  breakdown: {
    preference: number;
    waitTime: number;
    travelTime: number;
    incentive: number;
  };
  distanceM: number;
}

export async function getRecommendations(
  originalFacilityId: string,
  userLocation: { lat: number; lng: number }
): Promise<RecommendationResponse[]> {
  // Supabase 세션에서 현재 로그인한 유저 ID 획득
  const { data: { session } } = await supabase.auth.getSession();
  let userId = session?.user?.id;
  
  if (!userId) {
    console.warn("인증 세션이 없습니다. 데모용 모의 사용자 ID(IT-WORKER-01)를 사용합니다.");
    userId = "a2222222-2222-2222-2222-222222222222";
  }

  return apiClient.post("/api/v1/recommendations", {
    userId,
    originalFacilityId,
    userLat: userLocation.lat,
    userLng: userLocation.lng
  });
}

export async function submitFeedback(
  recommendationId: string,
  action: "accepted" | "rejected" | "ignored"
): Promise<{ success: boolean; updatedVector: boolean }> {
  return apiClient.post("/api/v1/feedback", {
    recommendationId,
    action
  });
}
