# pyrefly: ignore [missing-import]
import jwt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
# pyrefly: ignore [missing-import]
from supabase import create_client, Client
from app.core.config import settings

# 1. Supabase Python Client 초기화 (BFF 및 백엔드 직접 DB 조회/CUD용)
supabase_client: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

# 1-1. 서버→서버 신뢰 경로용 클라이언트(WP4 Pub/Sub 적재 등).
#      service_role 키가 있으면 RLS 를 우회해 congestion_logs 에 insert 할 수 있다.
#      (없으면 anon 으로 폴백 — 기존 동작과 동일.)
supabase_admin: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)

# 2. HTTP Bearer 인증 체계 정의 (프록시 상황에서 누락 에러 방지를 위해 auto_error=False 설정)
security = HTTPBearer(auto_error=False)

def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """
    X-Forwarded-Authorization 헤더 또는 HTTP Authorization Header로부터 Supabase JWT를 획득하여 검증하고,
    디코딩된 사용자 세션 정보를 반환합니다.
    """
    token = None

    # 1. X-Forwarded-Authorization 헤더 우선 확인 (GCP 프록시를 통과한 요청)
    forwarded_auth = request.headers.get("x-forwarded-authorization") or request.headers.get("x-supabase-authorization")
    if forwarded_auth and forwarded_auth.startswith("Bearer "):
        token = forwarded_auth.split(" ")[1]

    # 2. Authorization 헤더 확인 (직접 API 요청)
    if not token and credentials:
        token = credentials.credentials

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="인증 헤더(Authorization 또는 X-Forwarded-Authorization)가 누락되었거나 Bearer 형식이 아닙니다.",
        )

    try:
        # Supabase JWT 디코딩 검증 (Gotrue JWT secret 사용)
        # Supabase는 기본적으로 HS256 알고리즘 사용
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )
        
        # payload에서 유저 UUID 추출 (Supabase JWT는 sub 필드가 user_id)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="JWT 토큰에 sub(user_id) 필드가 존재하지 않습니다.",
            )
            
        return {
            "id": user_id,
            "email": payload.get("email"),
            "role": payload.get("role"),
            "payload": payload
        }
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="만료된 JWT 토큰입니다.",
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"유효하지 않은 JWT 토큰입니다: {str(e)}",
        )


def require_firebase_admin(request: Request) -> dict:
    """관리자 전용 가드 — GCP 베이스(Firebase Authentication).

    워커 경로(Supabase JWT, get_current_user)와 분리된다. 관리자 프런트(admin/*)는 Firebase Auth 로
    로그인하고 Firebase ID 토큰을 X-Admin-Authorization 헤더로 보낸다. 여기서 google-auth 로 그 토큰을
    검증한다(issuer=securetoken.google.com/<project>, audience=<project>). 게이트웨이가 Authorization 을
    백엔드 인증용 OIDC 로 덮어쓰므로 admin 토큰은 별도 헤더로 받는다.
    프로토타입 정책: 인증된 Firebase 사용자를 관리자로 간주한다(보안강화 불요 — 사용자 결정).
    """
    auth = request.headers.get("x-admin-authorization") or request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="관리자 인증 토큰(Firebase ID token)이 없습니다.",
        )
    token = auth.split(" ", 1)[1]
    try:
        # pyrefly: ignore [missing-import]
        from google.oauth2 import id_token as google_id_token
        # pyrefly: ignore [missing-import]
        from google.auth.transport import requests as g_requests

        claims = google_id_token.verify_firebase_token(
            token, g_requests.Request(), audience=settings.GCP_PROJECT_ID
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Firebase 토큰 검증 실패: {e}",
        )
    if not claims:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 Firebase 토큰입니다.",
        )
    return claims
