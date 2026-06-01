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

Dataflow(라이브) 실행:
  python -m dataflow.congestion_pipeline --runner=DataflowRunner \
    --project=knudc-henryseo711 --region=us-central1 \
    --topic=induspot-congestion \
    --bq_table=knudc-henryseo711:induspot.congestion_windowed \
    --temp_location=gs://induspot-models-6757/dataflow-temp \
    --staging_location=gs://induspot-models-6757/dataflow-staging \
    --job_name=induspot-congestion-stream --streaming
"""

import argparse
import json
import logging

# pyrefly: ignore [missing-import]
import apache_beam as beam
# pyrefly: ignore [missing-import]
from apache_beam.options.pipeline_options import PipelineOptions, StandardOptions, GoogleCloudOptions

WINDOW_SECONDS = 300  # 5분 고정 윈도우

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


def run(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--topic", default="induspot-congestion", help="Pub/Sub topic 이름(프로젝트 내)")
    parser.add_argument("--subscription", default="", help="구독 경로(있으면 topic 대신 사용)")
    parser.add_argument("--bq_table", required=True, help="project:dataset.table")
    known, pipeline_args = parser.parse_known_args(argv)

    options = PipelineOptions(pipeline_args)
    options.view_as(StandardOptions).streaming = True
    options.view_as(GoogleCloudOptions).project = known.project

    topic_path = f"projects/{known.project}/topics/{known.topic}"

    with beam.Pipeline(options=options) as p:
        if known.subscription:
            source = beam.io.ReadFromPubSub(subscription=known.subscription)
        else:
            source = beam.io.ReadFromPubSub(topic=topic_path)

        (
            p
            | "ReadPubSub" >> source
            | "Parse" >> beam.Map(_parse_event)
            | "DropInvalid" >> beam.Filter(lambda d: bool(d))
            | "Window5m" >> beam.WindowInto(beam.window.FixedWindows(WINDOW_SECONDS))
            | "ToKV" >> beam.Map(lambda d: (d["facility_id"], d["congestion"]))
            | "SumCountPerKey" >> beam.CombinePerKey(_sum_count_combiner())
            | "ToBqRow" >> beam.ParDo(_AddWindowInfo())
            | "WriteBQ" >> beam.io.WriteToBigQuery(
                known.bq_table,
                schema=BQ_SCHEMA,
                write_disposition=beam.io.BigQueryDisposition.WRITE_APPEND,
                create_disposition=beam.io.BigQueryDisposition.CREATE_IF_NEEDED,
            )
        )


if __name__ == "__main__":
    logging.getLogger().setLevel(logging.INFO)
    run()
