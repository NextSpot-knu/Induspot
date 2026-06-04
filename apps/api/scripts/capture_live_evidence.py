"""GCP 라이브 증거 자동 캡처 하네스 — 1회 실행으로 배포된 모든 GCP 서비스의 실측 증거를 레포에 박제한다.

배경: 감사 결과 최대 약점이 "코드는 라이브인데 레포에 캡처된 증거가 0건"이었다.
  이 스크립트는 게이트웨이 HTTP 프로브 + gcloud/bq CLI describe/list/SELECT 만으로(절대 mutate 금지)
  배포된 서비스를 '실제로 호출'해 라이브 여부를 판정하고, 커밋 가능한 증거 산출물 2종을 남긴다.
    - evidence/evidence.json     : 구조화된 전체 결과(타임스탬프 포함, 기계 판독용)
    - evidence/LIVE_EVIDENCE.md  : 사람이 읽는 마크다운 요약 표(서비스 | 상태 | 핵심증거 | 확인시각)

실행법(인증 필요 — `gcloud auth login` + ADC 또는 SA 활성화 상태에서):
  cd apps/api
  python scripts/capture_live_evidence.py

  gcloud/bq 경로는 환경변수 GCLOUD_PATH / BQ_PATH 로 덮어쓸 수 있고, 없으면 PATH(shutil.which)에서 찾는다.
  Windows 에서 gcloud 는 .cmd 라 shell=False subprocess 가 PATHEXT 미적용으로 못 찾을 수 있어 which 폴백을 둔다.

검증 프로브(각각 try/except 로 감싸 절대 죽지 않으며, 부분실패도 ERROR/UNAVAILABLE 로 '기록'한다):
  1) Cloud Run + Gateway 헬스 : GET {GATEWAY}/health → 200 + json 이면 게이트웨이→비공개 Cloud Run 경로 LIVE.
  2) Vertex 예측             : POST {GATEWAY}/predict → predicted_congestion(float) 이면 Vertex/모델 경로 LIVE.
  3) Gemini 음성 턴          : POST {GATEWAY}/api/v1/voice/turn → spoken 이 비어있지 않은 자연어면 Gemini LIVE.
  4) BQML 예보              : GET {GATEWAY}/api/v1/forecast/heatmap?hours=24 → source=bqml + points 면 LIVE,
                              source=unavailable 면 lookup 만료/비어있음(UNAVAILABLE).
  5) Cloud Run describe     : gcloud run services describe → latestReadyRevision, env(이름+value/secret 여부), 시크릿 마운트.
  6) Secret Manager         : gcloud secrets list → 시크릿 이름 목록.
  7) Pub/Sub               : gcloud pubsub topics/subscriptions list → 토픽/구독(+push endpoint) 목록.
  8) Cloud Scheduler        : gcloud scheduler jobs list → 잡 이름/스케줄/상태.
  9) Firestore             : gcloud firestore databases describe → name/locationId/type.
 10) BigQuery               : bq query(SELECT only) → congestion_logs 통계 + congestion_forecast_lookup 통계.

상태 판정: 각 프로브는 {service, status: LIVE|PARTIAL|UNAVAILABLE|ERROR, evidence: {...}, checked_at: iso}.
가드레일: 어떤 프로브가 ERROR 라도 비0 종료코드를 쓰지 않는다(증거 수집이 목적이라 부분실패도 그대로 박제).
read-only: 모든 bq 쿼리는 SELECT, gcloud 는 describe/list 뿐 — CREATE/INSERT/UPDATE/DELETE 절대 금지.
"""

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import timezone, datetime

# ── 상수(프로젝트 사실값) ─────────────────────────────────────────────────────
PROJECT = "knudc-henryseo711"
REGION = "asia-northeast3"
BQ_LOCATION = "us-central1"
GATEWAY = "https://induspot-gateway-9t4vof78.uc.gateway.dev"
SERVICE = "induspot-api"

# subprocess 타임아웃(초). gcloud/bq 는 콜드 호출이 느릴 수 있어 넉넉히 둔다.
CLI_TIMEOUT = 120
# HTTP 프로브 타임아웃(초). Cloud Run 콜드스타트 + Vertex/Gemini RPC 여유.
HTTP_TIMEOUT = 45

# 상태 라벨(콘솔/마크다운 공용).
LIVE = "LIVE"
PARTIAL = "PARTIAL"
UNAVAILABLE = "UNAVAILABLE"
ERROR = "ERROR"


# ── CLI 경로 해석(Windows 친화) ──────────────────────────────────────────────
def _resolve_cli(env_var: str, name: str) -> str:
    """gcloud/bq 실행 파일 경로 해석. 우선순위: 환경변수 → PATH(which, .cmd 해석) → 맨이름.

    Windows 에서 subprocess(shell=False)는 PATHEXT 를 적용하지 않아 "gcloud" 가 gcloud.cmd 를
    못 찾고 WinError 2 로 죽는다. shutil.which 는 PATHEXT 를 적용해 .cmd 전체경로를 돌려준다.
    """
    p = os.environ.get(env_var)
    if p and os.path.exists(p):
        return p
    w = shutil.which(name)
    if w:
        return w
    return name


GCLOUD = _resolve_cli("GCLOUD_PATH", "gcloud")
BQ = _resolve_cli("BQ_PATH", "bq")


def _now_iso() -> str:
    """확인 시각(UTC, ISO8601). 모든 프로브가 동일 포맷으로 checked_at 을 남긴다."""
    return datetime.now(timezone.utc).isoformat()


def _result(service: str, status: str, evidence: dict) -> dict:
    """프로브 결과 표준 형태로 포장."""
    return {
        "service": service,
        "status": status,
        "evidence": evidence,
        "checked_at": _now_iso(),
    }


# ── 저수준 헬퍼: HTTP / CLI ───────────────────────────────────────────────────
def _http(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    """게이트웨이 HTTP 호출(표준 라이브러리만). (status_code, parsed_json_or_text) 반환.

    requests 의존 금지 — 배포환경에 없을 수 있어 urllib 로만 동작한다.
    HTTPError(4xx/5xx)도 코드와 본문을 살려 반환한다(403/503 도 '증거'다).
    """
    url = path if path.startswith("http") else f"{GATEWAY}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            raw = r.read().decode("utf-8", "ignore")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw[:500]
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", "ignore")
        except Exception:
            pass
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:500]


def _run_cli(argv: list[str]) -> tuple[bool, str, str]:
    """gcloud/bq subprocess 호출. (성공여부, stdout, stderr_or_err) 반환 — 절대 예외를 던지지 않는다.

    성공여부=False 이면 stderr/예외명에 사유가 담긴다. 타임아웃/미설치/비0 종료 모두 포착한다.
    read-only 명령(describe/list/query SELECT)만 호출하는 책임은 호출자에게 있다.
    """
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT,
        )
        if proc.returncode != 0:
            return False, proc.stdout or "", (proc.stderr or "").strip()
        return True, proc.stdout or "", (proc.stderr or "").strip()
    except FileNotFoundError as e:
        return False, "", f"CLI 미발견: {e}"
    except subprocess.TimeoutExpired:
        return False, "", f"timeout({CLI_TIMEOUT}s) 초과"
    except Exception as e:  # 어떤 사유든 죽지 않는다 — 증거 수집이 목적.
        return False, "", f"{type(e).__name__}: {str(e)[:200]}"


def _bq_query(sql: str) -> tuple[bool, object]:
    """bq CLI 로 SELECT 1건 실행(read-only). (성공여부, rows_list_or_err) 반환.

    --format=json 으로 받아 첫 행 dict 를 그대로 증거에 싣는다. mutate 쿼리는 절대 호출하지 않는다.
    """
    argv = [
        BQ,
        f"--project_id={PROJECT}",
        f"--location={BQ_LOCATION}",
        "query",
        "--use_legacy_sql=false",
        "--format=json",
        sql,
    ]
    ok, out, err = _run_cli(argv)
    if not ok:
        return False, err
    try:
        return True, json.loads(out) if out.strip() else []
    except Exception as e:
        return False, f"JSON 파싱 실패: {type(e).__name__}: {out[:200]}"


# ── 프로브 1: Cloud Run + Gateway 헬스 ───────────────────────────────────────
def probe_gateway_health() -> dict:
    """GET {GATEWAY}/health → 200 + json 이면 게이트웨이→비공개 Cloud Run 경로 LIVE."""
    try:
        code, data = _http("GET", "/health")
        if code == 200:
            return _result(
                "Cloud Run + API Gateway",
                LIVE,
                {"http_status": 200, "body": data, "url": f"{GATEWAY}/health"},
            )
        return _result(
            "Cloud Run + API Gateway",
            ERROR,
            {"http_status": code, "body": data, "url": f"{GATEWAY}/health"},
        )
    except Exception as e:
        return _result(
            "Cloud Run + API Gateway",
            ERROR,
            {"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )


# ── 프로브 2: Vertex 예측 ─────────────────────────────────────────────────────
def probe_vertex_predict() -> dict:
    """POST {GATEWAY}/predict → predicted_congestion(float) 이면 Vertex/모델 예측 경로 LIVE."""
    body = {"facility_type": "cafeteria", "hour": 12, "day_of_week": 2}
    try:
        code, data = _http("POST", "/predict", body)
        pred = data.get("predicted_congestion") if isinstance(data, dict) else None
        if code == 200 and isinstance(pred, (int, float)):
            return _result(
                "Vertex AI 예측",
                LIVE,
                {
                    "http_status": 200,
                    "request": body,
                    "predicted_congestion": pred,
                    "url": f"{GATEWAY}/predict",
                },
            )
        # 200 인데 예측값 형식이 어긋나면 부분동작.
        status = PARTIAL if code == 200 else ERROR
        return _result(
            "Vertex AI 예측",
            status,
            {"http_status": code, "request": body, "body": data},
        )
    except Exception as e:
        return _result(
            "Vertex AI 예측",
            ERROR,
            {"error": f"{type(e).__name__}: {str(e)[:200]}", "request": body},
        )


# ── 프로브 3: Gemini 음성 턴 ─────────────────────────────────────────────────
def probe_gemini_voice() -> dict:
    """POST /api/v1/voice/turn → spoken 이 비어있지 않은 자연어면 Gemini 라이브 판정.

    spoken 이 없거나 빈 문자열이면 결정적 폴백만 동작한 것(PARTIAL). action 은 항상 존재한다.
    """
    body = {
        "utterance": "고향순대 메뉴 뭐 있는지 자세히 알려줘",
        "facility_type": "cafeteria",
        "current_name": "고향순대",
        "candidates": [
            {
                "id": "54c6f633-dff5-4e0a-9bee-23887f02ee59",
                "name": "고향순대",
                "congestion": 0.28,
                "distance_m": 140,
            }
        ],
    }
    try:
        code, data = _http("POST", "/api/v1/voice/turn", body)
        if code != 200 or not isinstance(data, dict):
            return _result(
                "Gemini (voice/turn)",
                ERROR,
                {"http_status": code, "body": data},
            )
        action = data.get("action")
        spoken = data.get("spoken")
        # spoken 이 비어있지 않은 문자열(=Gemini 생성 자연어)이면 LIVE, 아니면 결정적 폴백(PARTIAL).
        is_live = isinstance(spoken, str) and bool(spoken.strip())
        return _result(
            "Gemini (voice/turn)",
            LIVE if is_live else PARTIAL,
            {
                "http_status": 200,
                "request_utterance": body["utterance"],
                "action": action,
                "spoken": spoken,
                "url": f"{GATEWAY}/api/v1/voice/turn",
            },
        )
    except Exception as e:
        return _result(
            "Gemini (voice/turn)",
            ERROR,
            {"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )


# ── 프로브 4: BQML 예보 히트맵 ───────────────────────────────────────────────
def probe_bqml_forecast() -> dict:
    """GET /api/v1/forecast/heatmap?hours=24 → source=bqml 이면 LIVE, unavailable 이면 lookup 만료/비어있음."""
    try:
        code, data = _http("GET", "/api/v1/forecast/heatmap?hours=24")
        if code != 200 or not isinstance(data, dict):
            return _result(
                "BQML 예보(forecast/heatmap)",
                ERROR,
                {"http_status": code, "body": data},
            )
        source = data.get("source")
        points = data.get("points") or []
        n_points = len(points) if isinstance(points, list) else 0
        if source == "bqml" and n_points > 0:
            status = LIVE
        else:
            # source=unavailable 또는 빈 points = 예보 lookup 만료/비어있음(배포 자체는 응답).
            status = UNAVAILABLE
        return _result(
            "BQML 예보(forecast/heatmap)",
            status,
            {
                "http_status": 200,
                "source": source,
                "points_count": n_points,
                "url": f"{GATEWAY}/api/v1/forecast/heatmap?hours=24",
            },
        )
    except Exception as e:
        return _result(
            "BQML 예보(forecast/heatmap)",
            ERROR,
            {"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )


# ── 프로브 5: Cloud Run describe(gcloud) ─────────────────────────────────────
def probe_cloud_run_describe() -> dict:
    """gcloud run services describe → latestReadyRevision, env(이름+value/secret 여부), 마운트 시크릿 추출."""
    argv = [
        GCLOUD,
        "run",
        "services",
        "describe",
        SERVICE,
        "--region",
        REGION,
        "--project",
        PROJECT,
        "--format",
        "json",
    ]
    ok, out, err = _run_cli(argv)
    if not ok:
        return _result("Cloud Run(describe)", ERROR, {"error": err})
    try:
        svc = json.loads(out)
    except Exception as e:
        return _result(
            "Cloud Run(describe)",
            ERROR,
            {"error": f"JSON 파싱 실패: {type(e).__name__}", "raw": out[:200]},
        )
    try:
        status = svc.get("status", {}) or {}
        spec = svc.get("spec", {}) or {}
        latest_ready = status.get("latestReadyRevisionName")
        url = status.get("url")
        # 컨테이너 env 추출: value 직접노출 vs secret 참조 구분(값 자체는 싣지 않고 '출처'만 기록).
        env_summary = []
        mounted_secrets = set()
        containers = (
            spec.get("template", {}).get("spec", {}).get("containers", []) or []
        )
        for c in containers:
            for e in c.get("env", []) or []:
                name = e.get("name")
                if "valueFrom" in e and e.get("valueFrom"):
                    ref = (
                        e["valueFrom"].get("secretKeyRef", {})
                        if isinstance(e["valueFrom"], dict)
                        else {}
                    )
                    secret_name = ref.get("name") or ref.get("key")
                    if secret_name:
                        mounted_secrets.add(secret_name)
                    env_summary.append({"name": name, "source": "secret", "secret": secret_name})
                else:
                    # 값이 있으면 '설정됨' 만 표시(민감값 회피 — 단 길이/존재만 증거로).
                    env_summary.append(
                        {"name": name, "source": "value", "has_value": e.get("value") is not None}
                    )
        return _result(
            "Cloud Run(describe)",
            LIVE if latest_ready else PARTIAL,
            {
                "service": SERVICE,
                "region": REGION,
                "url": url,
                "latest_ready_revision": latest_ready,
                "env": env_summary,
                "mounted_secrets": sorted(mounted_secrets),
            },
        )
    except Exception as e:
        return _result(
            "Cloud Run(describe)",
            ERROR,
            {"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )


# ── 프로브 6: Secret Manager ─────────────────────────────────────────────────
def probe_secret_manager() -> dict:
    """gcloud secrets list → 시크릿 이름 목록(값은 절대 조회하지 않음)."""
    argv = [
        GCLOUD,
        "secrets",
        "list",
        "--project",
        PROJECT,
        "--format=value(name)",
    ]
    ok, out, err = _run_cli(argv)
    if not ok:
        return _result("Secret Manager", ERROR, {"error": err})
    names = [ln.strip() for ln in out.splitlines() if ln.strip()]
    return _result(
        "Secret Manager",
        LIVE if names else UNAVAILABLE,
        {"count": len(names), "secrets": names},
    )


# ── 프로브 7: Pub/Sub ─────────────────────────────────────────────────────────
def probe_pubsub() -> dict:
    """gcloud pubsub topics list + subscriptions list(push endpoint 포함) → 토픽/구독 목록."""
    evidence: dict = {}
    status = LIVE

    topics_argv = [
        GCLOUD,
        "pubsub",
        "topics",
        "list",
        "--project",
        PROJECT,
        "--format=value(name)",
    ]
    ok_t, out_t, err_t = _run_cli(topics_argv)
    if ok_t:
        evidence["topics"] = [ln.strip() for ln in out_t.splitlines() if ln.strip()]
    else:
        evidence["topics_error"] = err_t
        status = PARTIAL

    subs_argv = [
        GCLOUD,
        "pubsub",
        "subscriptions",
        "list",
        "--project",
        PROJECT,
        "--format=value(name,pushConfig.pushEndpoint)",
    ]
    ok_s, out_s, err_s = _run_cli(subs_argv)
    if ok_s:
        subs = []
        for ln in out_s.splitlines():
            ln = ln.strip()
            if not ln:
                continue
            # value(name,pushEndpoint) 는 탭 구분. push endpoint 가 없으면 빈 칸.
            parts = ln.split("\t")
            subs.append(
                {"name": parts[0], "push_endpoint": parts[1] if len(parts) > 1 else ""}
            )
        evidence["subscriptions"] = subs
    else:
        evidence["subscriptions_error"] = err_s
        status = PARTIAL

    # 토픽/구독 둘 다 실패면 ERROR.
    if not ok_t and not ok_s:
        status = ERROR
    elif status == LIVE and not evidence.get("topics") and not evidence.get("subscriptions"):
        status = UNAVAILABLE
    return _result("Pub/Sub", status, evidence)


# ── 프로브 8: Cloud Scheduler ────────────────────────────────────────────────
def probe_scheduler() -> dict:
    """gcloud scheduler jobs list → 잡 이름/스케줄/상태."""
    argv = [
        GCLOUD,
        "scheduler",
        "jobs",
        "list",
        "--location",
        REGION,
        "--project",
        PROJECT,
        "--format=value(name,schedule,state)",
    ]
    ok, out, err = _run_cli(argv)
    if not ok:
        return _result("Cloud Scheduler", ERROR, {"error": err})
    jobs = []
    for ln in out.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        parts = ln.split("\t")
        jobs.append(
            {
                "name": parts[0],
                "schedule": parts[1] if len(parts) > 1 else "",
                "state": parts[2] if len(parts) > 2 else "",
            }
        )
    return _result(
        "Cloud Scheduler",
        LIVE if jobs else UNAVAILABLE,
        {"count": len(jobs), "jobs": jobs},
    )


# ── 프로브 9: Firestore ───────────────────────────────────────────────────────
def probe_firestore() -> dict:
    """gcloud firestore databases describe → name/locationId/type."""
    argv = [
        GCLOUD,
        "firestore",
        "databases",
        "describe",
        '--database=(default)',
        "--project",
        PROJECT,
        "--format=value(name,locationId,type)",
    ]
    ok, out, err = _run_cli(argv)
    if not ok:
        return _result("Firestore", ERROR, {"error": err})
    line = out.strip()
    if not line:
        return _result("Firestore", UNAVAILABLE, {"raw": ""})
    parts = line.split("\t")
    return _result(
        "Firestore",
        LIVE,
        {
            "name": parts[0],
            "location_id": parts[1] if len(parts) > 1 else "",
            "type": parts[2] if len(parts) > 2 else "",
        },
    )


# ── 프로브 10: BigQuery(읽기 전용 통계) ──────────────────────────────────────
def probe_bigquery() -> dict:
    """bq query(SELECT only) → congestion_logs 통계 + congestion_forecast_lookup 통계.

    주의: ROWS 는 BigQuery 예약어라 COUNT(*) 의 별칭으로 cnt 를 쓴다(예약어 충돌 회피).
    read-only: 두 쿼리 모두 SELECT 뿐 — 어떤 mutate 도 생성하지 않는다.
    """
    evidence: dict = {}
    status = LIVE

    # congestion_logs: 행수/최신 타임스탬프/시설 수.
    logs_sql = (
        "SELECT count(*) AS cnt, max(timestamp) AS max_ts, "
        "count(DISTINCT facility_id) AS facilities "
        "FROM induspot.congestion_logs"
    )
    ok_l, rows_l = _bq_query(logs_sql)
    if ok_l:
        evidence["congestion_logs"] = rows_l[0] if isinstance(rows_l, list) and rows_l else rows_l
    else:
        evidence["congestion_logs_error"] = rows_l
        status = PARTIAL

    # congestion_forecast_lookup: 행수/예보 시간범위/최근 계산시각.
    lookup_sql = (
        "SELECT count(*) AS cnt, min(forecast_timestamp) AS min_ft, "
        "max(forecast_timestamp) AS max_ft, max(computed_at) AS max_computed "
        "FROM induspot.congestion_forecast_lookup"
    )
    ok_f, rows_f = _bq_query(lookup_sql)
    if ok_f:
        evidence["forecast_lookup"] = (
            rows_f[0] if isinstance(rows_f, list) and rows_f else rows_f
        )
    else:
        evidence["forecast_lookup_error"] = rows_f
        status = PARTIAL

    if not ok_l and not ok_f:
        status = ERROR
    return _result("BigQuery(congestion_logs + forecast_lookup)", status, evidence)


# ── 산출물 기록 ───────────────────────────────────────────────────────────────
def _md_escape(text: object) -> str:
    """마크다운 표 셀에서 파이프(|)/개행이 표를 깨지 않게 정리."""
    s = str(text)
    return s.replace("|", "\\|").replace("\n", " ").strip()


def _evidence_summary(r: dict) -> str:
    """프로브 결과에서 표에 넣을 '핵심증거' 한 줄 요약을 만든다(서비스별로 가장 강한 신호 발췌)."""
    ev = r.get("evidence", {}) or {}
    svc = r.get("service", "")
    if "error" in ev:
        return _md_escape(ev["error"])
    if svc.startswith("Cloud Run + API Gateway"):
        return _md_escape(f"HTTP {ev.get('http_status')} {ev.get('body')}")
    if svc.startswith("Vertex"):
        return _md_escape(f"predicted_congestion={ev.get('predicted_congestion')}")
    if svc.startswith("Gemini"):
        return _md_escape(f"action={ev.get('action')} spoken=\"{ev.get('spoken')}\"")
    if svc.startswith("BQML"):
        return _md_escape(f"source={ev.get('source')} points={ev.get('points_count')}")
    if svc.startswith("Cloud Run(describe)"):
        return _md_escape(
            f"revision={ev.get('latest_ready_revision')} "
            f"secrets={ev.get('mounted_secrets')}"
        )
    if svc.startswith("Secret Manager"):
        return _md_escape(f"count={ev.get('count')} {ev.get('secrets')}")
    if svc.startswith("Pub/Sub"):
        return _md_escape(
            f"topics={ev.get('topics')} subs={len(ev.get('subscriptions', []) or [])}"
        )
    if svc.startswith("Cloud Scheduler"):
        return _md_escape(f"count={ev.get('count')} jobs={ev.get('jobs')}")
    if svc.startswith("Firestore"):
        return _md_escape(
            f"location={ev.get('location_id')} type={ev.get('type')} name={ev.get('name')}"
        )
    if svc.startswith("BigQuery"):
        return _md_escape(
            f"logs={ev.get('congestion_logs')} forecast={ev.get('forecast_lookup')}"
        )
    # 기본: evidence 통째로(잘라서).
    return _md_escape(json.dumps(ev, ensure_ascii=False))[:300]


def write_outputs(results: list[dict], evidence_dir: str, captured_at: str) -> tuple[str, str]:
    """evidence.json + LIVE_EVIDENCE.md 를 evidence/ 아래에 기록하고 두 경로를 반환."""
    os.makedirs(evidence_dir, exist_ok=True)

    json_path = os.path.join(evidence_dir, "evidence.json")
    md_path = os.path.join(evidence_dir, "LIVE_EVIDENCE.md")

    payload = {
        "captured_at": captured_at,
        "project": PROJECT,
        "region": REGION,
        "bq_location": BQ_LOCATION,
        "gateway": GATEWAY,
        "service": SERVICE,
        "results": results,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 마크다운 요약 표.
    lines = []
    lines.append("# InduSpot — GCP 라이브 실측 증거")
    lines.append("")
    lines.append("> 이 파일은 capture_live_evidence.py가 생성한 실측 증거입니다.")
    lines.append(">")
    lines.append("> 재생성:")
    lines.append("> ```")
    lines.append("> cd apps/api")
    lines.append("> python scripts/capture_live_evidence.py")
    lines.append("> ```")
    lines.append("")
    lines.append(f"- 캡처 시각(UTC): `{captured_at}`")
    lines.append(f"- 프로젝트: `{PROJECT}` / 리전: `{REGION}` / BQ 위치: `{BQ_LOCATION}`")
    lines.append(f"- 게이트웨이: `{GATEWAY}`")
    lines.append("")
    lines.append("| 서비스 | 상태 | 핵심증거 | 확인시각 |")
    lines.append("| --- | --- | --- | --- |")
    for r in results:
        lines.append(
            f"| {_md_escape(r.get('service'))} "
            f"| {_md_escape(r.get('status'))} "
            f"| {_evidence_summary(r)} "
            f"| {_md_escape(r.get('checked_at'))} |"
        )
    lines.append("")
    lines.append("상태 정의: LIVE=실제 호출 성공, PARTIAL=일부만 동작, "
                 "UNAVAILABLE=응답하나 데이터 비어있음/만료, ERROR=호출 실패.")
    lines.append("")
    lines.append("전체 구조화 결과는 `evidence.json` 참조.")
    lines.append("")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return json_path, md_path


# ── 콘솔 라벨 매핑 ────────────────────────────────────────────────────────────
def _console_label(status: str) -> str:
    """콘솔 한 줄 출력용 라벨. LIVE→PASS, PARTIAL→PARTIAL, UNAVAILABLE→UNAVAILABLE, ERROR→ERROR."""
    return {
        LIVE: "PASS",
        PARTIAL: "PARTIAL",
        UNAVAILABLE: "UNAVAILABLE",
        ERROR: "ERROR",
    }.get(status, status)


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    print("=== InduSpot GCP 라이브 증거 캡처 (capture_live_evidence.py) ===")
    captured_at = _now_iso()

    # 프로브 실행 순서: HTTP(게이트웨이) → gcloud describe/list → bq SELECT.
    probes = [
        probe_gateway_health,
        probe_vertex_predict,
        probe_gemini_voice,
        probe_bqml_forecast,
        probe_cloud_run_describe,
        probe_secret_manager,
        probe_pubsub,
        probe_scheduler,
        probe_firestore,
        probe_bigquery,
    ]

    results: list[dict] = []
    for probe in probes:
        try:
            r = probe()
        except Exception as e:
            # 프로브 함수 자체가 예외를 던지는 일은 없어야 하지만, 최후 가드.
            r = _result(
                getattr(probe, "__name__", "unknown"),
                ERROR,
                {"error": f"{type(e).__name__}: {str(e)[:200]}"},
            )
        results.append(r)
        print(f"[{_console_label(r['status'])}] {r['service']}")

    # 산출물 기록. scripts/ 의 부모(apps/api) 기준 evidence/ 에 쓴다.
    api_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    evidence_dir = os.path.join(api_dir, "evidence")
    json_path, md_path = write_outputs(results, evidence_dir, captured_at)

    print(
        "산출물 기록됨: evidence/evidence.json, evidence/LIVE_EVIDENCE.md"
    )
    # 가드레일: 하나라도 ERROR 여도 비0 종료코드를 쓰지 않는다(증거 수집이 목적, 부분실패도 박제).


if __name__ == "__main__":
    main()
