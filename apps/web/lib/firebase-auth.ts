// GCP 베이스 관리자 인증 — Firebase Authentication(Identity Platform)을 REST API로 사용.
// JS SDK 없이(번들 경량) 이메일/비밀번호 로그인 → Firebase ID 토큰 발급. 백엔드는 이 토큰을
// google-auth(verify_firebase_token)로 검증한다. (워커 앱의 Supabase 인증과는 분리된 별도 경로)
//
// 필요한 환경변수(공개): NEXT_PUBLIC_FIREBASE_API_KEY
//   = Firebase 콘솔 > 프로젝트 설정 > 일반 > 웹 API 키
// 선행: Firebase 콘솔 > Authentication 에서 이메일/비밀번호 사용설정 + 관리자 user 추가.

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
const STORE_KEY = "induspot_admin_fb";

interface AdminSession {
  idToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email: string;
}

export function firebaseConfigured(): boolean {
  return Boolean(API_KEY);
}

function save(idToken: string, refreshToken: string, expiresInSec: number, email: string) {
  const s: AdminSession = {
    idToken,
    refreshToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    email,
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

function load(): AdminSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    return null;
  }
}

export function adminEmail(): string | null {
  return load()?.email ?? null;
}

export function signOutAdmin() {
  if (typeof window !== "undefined") localStorage.removeItem(STORE_KEY);
}

/** 이메일/비밀번호로 Firebase 로그인(REST). 실패 시 throw. */
export async function signInAdmin(email: string, password: string): Promise<void> {
  if (!API_KEY) throw new Error("Firebase 미설정: NEXT_PUBLIC_FIREBASE_API_KEY 환경변수가 필요합니다.");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code: string = data?.error?.message || "LOGIN_FAILED";
    if (/INVALID|EMAIL_NOT_FOUND|MISSING_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code))
      throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
    throw new Error(code);
  }
  save(data.idToken, data.refreshToken, Number(data.expiresIn || 3600), data.email || email);
}

/** 유효한 Firebase ID 토큰 반환(만료 임박 시 refresh). 없으면 null. */
export async function getAdminIdToken(): Promise<string | null> {
  const s = load();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.idToken; // 1분 이상 남음
  if (!API_KEY || !s.refreshToken) return null;
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    save(d.id_token, d.refresh_token, Number(d.expires_in || 3600), s.email);
    return d.id_token;
  } catch {
    return null;
  }
}

export async function isAdminAuthed(): Promise<boolean> {
  return Boolean(await getAdminIdToken());
}
