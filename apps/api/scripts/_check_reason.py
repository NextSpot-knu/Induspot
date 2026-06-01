"""WP3 검증: reason_service.generate_reason 를 라이브와 동일 설정(Vertex Gemini)으로 직접 호출.
GEMINI_ENABLED=true 로 세팅 후, 실패 시 템플릿 폴백까지 확인. 추천 API 전체(JWT 필요)를 우회해
사유 생성 자체만 검증한다."""
import os, sys, asyncio
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["GEMINI_ENABLED"] = "true"
os.environ["GEMINI_MODEL"] = os.environ.get("TEST_GEMINI_MODEL", "gemini-2.5-flash-lite")
os.environ.setdefault("GCP_PROJECT_ID", "knudc-henryseo711")
os.environ.setdefault("VERTEX_LOCATION", "us-central1")

from dotenv import load_dotenv
load_dotenv()

from app.services.reason_service import generate_reason, _build_template

ctx = {
    "original_facility_name": "푸드스퀘어 한식관",
    "recommended_facility_name": "Indu 뷔페 식당",
    "original_congestion": 0.85,
    "candidate_congestion": 0.32,
    "travel_time": 4,
    "predicted_wait": 6,
    "preference": 0.78,
    "incentive": 0.53,
}

print("TEMPLATE_FALLBACK:", _build_template(ctx))
result = asyncio.run(generate_reason(ctx))
print("GENERATED_REASON:", result)
print("IS_TEMPLATE:", result == _build_template(ctx))
