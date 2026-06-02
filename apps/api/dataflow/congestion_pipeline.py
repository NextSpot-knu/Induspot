"""[Tier2 / WP5] Dataflow 스트림 파이프라인 — Pub/Sub → 윈도우 집계 → BigQuery.

비어 있던 '스트림(2)' 계층을 GCP 네이티브로 채운다.
  Pub/Sub(induspot-congestion) → Apache Beam 고정 5분 윈도우 → 시설별 평균 혼잡도 →
  BigQuery(induspot.congestion_windowed) 스트리밍 적재.

이는 WP4(원천 이벤트)·WP2(BQ 저장/BQML)와 공존하며, 실시간 처리 계층을 추가한다.
(실시간 단건 예측은 여전히 WP1 Vertex Endpoint, 시계열은 BQML — 역할 분담 유지.)

로컬 검증:
  pip install -r dataflow/requirements.txt
  python -m dataflow.congestion_pipeline --runner=DirectRunner \
    --project=knudc-henryseo711 --topic=induspot-congestion \
    --bq_table=knudc-henryseo711:induspot.congestion_windowed --temp_location=gs://induspot-models-6757/dataflow-temp

Dataflow(라이브) 실행은 launch_dataflow.py 를 사용한다(README.md 참조).
직접 실행도 가능:
  python -m dataflow.congestion_pipeline --runner=DataflowRunner \
    --project=knudc-henryseo711 --region=us-central1 \
    --subscription=projects/knudc-henryseo711/subscriptions/induspot-congestion-dataflow \
    --bq_table=knudc-henryseo711:induspot.congestion_windowed \
    --temp_location=gs://induspot-models-6757/dataflow-temp \
    --staging_location=gs://induspot-models-6757/dataflow-staging \
    --job_name=induspot-congestion-windowing --streaming

설계 메모(스트림 처리 책임 분리):
  - build_pipeline(p, source) 는 변환 그래프만 조립하므로 테스트(TestPipeline)와
    라이브(DataflowRunner) 가 동일한 로직을 공유한다.
  - run(argv) 는 옵션 파싱 + IO(Pub/Sub→BigQuery) 결선 + Pipeline 실행을 담당한다.
"""

import argparse
import json
import logging

# pyrefly: ignore [missing-import]
import apache_beam as beam
# pyrefly: ignore [missing-import]
from apache_beam.options.pipeline_options import PipelineOptions, StandardOptions, GoogleCloudOptions

WINDOW_SECONDS = 300  # 5분 고정 윈도우

# 라이브 기본값(프로젝트 사실과 일치). run() 에서 CLI 로 덮어쓸 수 있다.
DEFAULT_PROJECT = "knudc-henryseo711"
DEFAULT_SUBSCRIPTION = "induspot-congestion-dataflow"  # Dataflow 전용 PULL 구독(push 구독은 pull 불가)
DEFAULT_TOPIC = "induspot-congestion"
DEFAULT_BQ_TABLE = "knudc-henryseo711:induspot.congestion_windowed"

BQ_SCHEMA = ",".join([
    "facility_id:STRING",
    "window_start:TIMESTAMP",
    "window_end:TIMESTAMP",
    "avg_congestion:FLOAT64",
    "sample_count:INT64",
])


def _parse_event(raw: bytes) -> dict:
    """Pub/Sub 메시지(JSON) → dict. 파싱 실패는 폴백(빈 dict)로 흘려보내 파이프라인을 멈추지 않는다."""
    try:
        d = json.loads(raw.decode("utf-8"))
        fid = d.get("facility_id")
        cong = d.get("congestion")
        if fid is None or cong is None:
            return {}
        return {"facility_id": str(fid), "congestion": float(cong)}
    except Exception:
        return {}


class _AddWindowInfo(beam.DoFn):
    """윈도우 경계 + 집계 결과를 BigQuery 행으로 변환."""
    # pyrefly: ignore [missing-import]
    def process(self, element, window=beam.DoFn.WindowParam):
        facility_id, stats = element  # stats = (sum, count) from CombinePerKey
        total, count = stats
        if count <= 0:
            return
        yield {
            "facility_id": facility_id,
            "window_start": window.start.to_utc_datetime().isoformat(),
            "window_end": window.end.to_utc_datetime().isoformat(),
            "avg_congestion": round(total / count, 4),
            "sample_count": int(count),
        }


def _sum_count_combiner():
    """평균을 위해 (합, 개수)를 결합하는 CombineFn."""
    class SumCount(beam.CombineFn):
        def create_accumulator(self):
            return (0.0, 0)

        def add_input(self, acc, inp):
            s, c = acc
            return (s + inp, c + 1)

        def merge_accumulators(self, accs):
            s = sum(a[0] for a in accs)
            c = sum(a[1] for a in accs)
            return (s, c)

        def extract_output(self, acc):
            return acc  # (sum, count) — 윈도우 DoFn 에서 평균 계산
    return SumCount()


def build_aggregation(pcoll):
    """원천 PCollection(파싱 전 bytes 요소) → BQ 행 dict 의 PCollection 으로 변환.

    이 함수는 IO(ReadFromPubSub / WriteToBigQuery) 와 완전히 분리된 순수 변환 그래프이므로
    TestPipeline(DirectRunner) 과 라이브 DataflowRunner 가 동일한 로직을 공유한다.
    (test_congestion_pipeline.py 가 검증하는 단계 이름/함수와 1:1 대응.)
    """
    return (
        pcoll
        | "Parse" >> beam.Map(_parse_event)
        | "DropInvalid" >> beam.Filter(lambda d: bool(d))
        | "Window5m" >> beam.WindowInto(beam.window.FixedWindows(WINDOW_SECONDS))
        | "ToKV" >> beam.Map(lambda d: (d["facility_id"], d["congestion"]))
        | "SumCountPerKey" >> beam.CombinePerKey(_sum_count_combiner())
        | "ToBqRow" >> beam.ParDo(_AddWindowInfo())
    )


def build_pipeline(p, known):
    """파싱된 옵션(known)으로 Pub/Sub→집계→BigQuery 전체 그래프를 파이프라인 p 에 결선한다.

    known 은 _parse_args() 가 반환한 Namespace (project / topic / subscription / bq_table).
    구독이 주어지면 구독을, 아니면 토픽을 읽는다.
    """
    if known.subscription:
        source = beam.io.ReadFromPubSub(subscription=known.subscription)
    else:
        topic_path = f"projects/{known.project}/topics/{known.topic}"
        source = beam.io.ReadFromPubSub(topic=topic_path)

    raw = p | "ReadPubSub" >> source
    rows = build_aggregation(raw)
    (
        rows
        | "WriteBQ" >> beam.io.WriteToBigQuery(
            known.bq_table,
            schema=BQ_SCHEMA,
            write_disposition=beam.io.BigQueryDisposition.WRITE_APPEND,
            create_disposition=beam.io.BigQueryDisposition.CREATE_IF_NEEDED,
        )
    )
    return rows


def _parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--topic", default=DEFAULT_TOPIC, help="Pub/Sub topic 이름(프로젝트 내)")
    parser.add_argument(
        "--subscription",
        default=DEFAULT_SUBSCRIPTION,
        help="구독 이름 또는 전체 경로(있으면 topic 대신 사용). 빈 문자열이면 topic 사용.",
    )
    parser.add_argument("--bq_table", default=DEFAULT_BQ_TABLE, help="project:dataset.table")
    known, pipeline_args = parser.parse_known_args(argv)
    # 구독을 짧은 이름으로 준 경우 전체 경로로 정규화한다(라이브 편의).
    if known.subscription and not known.subscription.startswith("projects/"):
        known.subscription = f"projects/{known.project}/subscriptions/{known.subscription}"
    return known, pipeline_args


def run(argv=None):
    """CLI 진입점. 옵션을 파싱하고 streaming 파이프라인을 빌드/실행한다.

    DataflowRunner / DirectRunner 는 --runner 로 PipelineOptions 를 통해 전달된다
    (launch_dataflow.py 가 --runner=DataflowRunner 등을 주입).
    """
    known, pipeline_args = _parse_args(argv)

    options = PipelineOptions(pipeline_args)
    options.view_as(StandardOptions).streaming = True
    options.view_as(GoogleCloudOptions).project = known.project

    with beam.Pipeline(options=options) as p:
        build_pipeline(p, known)


if __name__ == "__main__":
    logging.getLogger().setLevel(logging.INFO)
    run()
