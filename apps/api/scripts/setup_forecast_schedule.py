"""WP2 — BQML 예보 갱신을 BigQuery 스케줄드 쿼리로 등록(예보 재만료 방지).

refresh_forecast.sql 을 'every 12 hours' 스케줄드 쿼리(transfer config)로 생성/갱신한다.
스크립트형 쿼리(CREATE OR REPLACE MODEL/TABLE)라 destination_table 이 필요 없다 — 스크립트가
스스로 lookup 을 재생성한다. 멱등: 같은 display_name 의 기존 config 가 있으면 query/schedule 을 업데이트.

실행:
  cd apps/api
  .venv\\Scripts\\python.exe scripts\\setup_forecast_schedule.py

필요: BigQuery Data Transfer API 활성화 + ADC(스케줄드 쿼리 생성 권한 보유 계정).
효과: 12시간마다 ARIMA_PLUS 재학습 + congestion_forecast_lookup 재생성 → /api/v1/forecast 가
      항상 미래 지평을 갖는다(source=bqml 유지). 즉시 1회 갱신은 scripts/refresh_forecast.py 로.
"""

import os

from google.cloud import bigquery_datatransfer
from google.protobuf import field_mask_pb2

PROJECT = "knudc-henryseo711"
LOCATION = "us-central1"
DISPLAY = "induspot-forecast-refresh"
SCHEDULE = "every 12 hours"
# 스케줄드 쿼리는 서비스계정으로 실행한다(사용자 OAuth 대신). 이 SA 가 BQML 재학습/lookup 재생성 권한을
# 가져야 하고(컴퓨트 기본 SA 는 이미 bigquery.dataEditor/jobUser 보유), 생성 계정은 이 SA 에 actAs 가 필요.
RUN_AS_SA = "768699236852-compute@developer.gserviceaccount.com"
SQL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refresh_forecast.sql")


def main() -> int:
    with open(SQL_PATH, "r", encoding="utf-8") as f:
        query = f.read()

    client = bigquery_datatransfer.DataTransferServiceClient()
    parent = client.common_location_path(PROJECT, LOCATION)

    # 기존 동일 display_name config 탐색(멱등 업데이트)
    existing = None
    for cfg in client.list_transfer_configs(parent=parent):
        if cfg.display_name == DISPLAY:
            existing = cfg
            break

    tc = bigquery_datatransfer.TransferConfig(
        display_name=DISPLAY,
        data_source_id="scheduled_query",
        params={"query": query},
        schedule=SCHEDULE,
    )

    # service_account_name 은 GAPIC request 객체로만 받는다(스케줄드 쿼리를 이 SA 로 실행).
    if existing:
        tc.name = existing.name
        request = bigquery_datatransfer.UpdateTransferConfigRequest(
            transfer_config=tc,
            update_mask=field_mask_pb2.FieldMask(paths=["params", "schedule", "display_name"]),
            service_account_name=RUN_AS_SA,
        )
        updated = client.update_transfer_config(request=request)
        print(f"UPDATED scheduled query: {updated.name}")
    else:
        request = bigquery_datatransfer.CreateTransferConfigRequest(
            parent=parent,
            transfer_config=tc,
            service_account_name=RUN_AS_SA,
        )
        created = client.create_transfer_config(request=request)
        print(f"CREATED scheduled query: {created.name}")

    print(f"SCHEDULE_OK ({SCHEDULE})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
