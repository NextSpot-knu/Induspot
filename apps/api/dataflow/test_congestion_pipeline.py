"""congestion_pipeline 의 변환 로직 단위 테스트 (라이브 Pub/Sub·BigQuery 불필요).

DirectRunner + TestPipeline 으로 파싱 → 5분 고정 윈도우 → 시설별 평균 → BQ 행 변환을
인메모리(Create)로 검증한다. 실제 ReadFromPubSub/WriteToBigQuery IO 는 우회한다.

실행(dataflow venv 또는 apache-beam 설치 후):
    pip install -r dataflow/requirements.txt   # 또는: pip install apache-beam
    python -m pytest dataflow/test_congestion_pipeline.py -q
    # pytest 없이:  python dataflow/test_congestion_pipeline.py
"""

# pyrefly: ignore [missing-import]
import apache_beam as beam
# pyrefly: ignore [missing-import]
from apache_beam.testing.test_pipeline import TestPipeline
# pyrefly: ignore [missing-import]
from apache_beam.testing.util import assert_that, equal_to
# pyrefly: ignore [missing-import]
from apache_beam.transforms.window import TimestampedValue, FixedWindows

from dataflow.congestion_pipeline import (
    _parse_event,
    _sum_count_combiner,
    _AddWindowInfo,
    WINDOW_SECONDS,
)


# --- 순수 함수 단위 테스트 (파이프라인 불필요) ---

def test_parse_event_valid():
    raw = b'{"facility_id": "fac-1", "congestion": 0.42}'
    assert _parse_event(raw) == {"facility_id": "fac-1", "congestion": 0.42}


def test_parse_event_numeric_facility_id_coerced_to_str():
    raw = b'{"facility_id": 7, "congestion": 0.5}'
    assert _parse_event(raw) == {"facility_id": "7", "congestion": 0.5}


def test_parse_event_missing_fields_returns_empty():
    assert _parse_event(b'{"facility_id": "x"}') == {}          # congestion 누락
    assert _parse_event(b'{"congestion": 0.3}') == {}           # facility_id 누락


def test_parse_event_malformed_json_returns_empty():
    assert _parse_event(b'not json at all') == {}
    assert _parse_event(b'\xff\xfe invalid bytes') == {}


# --- 엔드투엔드 윈도우 집계 (DirectRunner) ---

def _bq_row(fid, start_iso, end_iso, avg, n):
    return {
        "facility_id": fid,
        "window_start": start_iso,
        "window_end": end_iso,
        "avg_congestion": avg,
        "sample_count": n,
    }


def test_windowed_aggregation_produces_per_facility_averages():
    """두 시설 × 두 개의 5분 윈도우에 걸친 이벤트를 평균낸다.

    윈도우 0: [0, 300)   윈도우 1: [300, 600)
      fac-1: 윈도우0 에 0.2, 0.4  → 평균 0.3 (n=2)
      fac-1: 윈도우1 에 0.6        → 평균 0.6 (n=1)
      fac-2: 윈도우0 에 0.8, 1.0  → 평균 0.9 (n=2)
    """
    raw_events = [
        (b'{"facility_id": "fac-1", "congestion": 0.2}', 10),
        (b'{"facility_id": "fac-1", "congestion": 0.4}', 100),
        (b'{"facility_id": "fac-1", "congestion": 0.6}', 310),   # 다음 윈도우
        (b'{"facility_id": "fac-2", "congestion": 0.8}', 20),
        (b'{"facility_id": "fac-2", "congestion": 1.0}', 200),
        (b'invalid', 50),                                        # 폴백으로 버려짐
    ]

    # 주의: 파이프라인은 beam Timestamp.to_utc_datetime() (naive UTC) 의 isoformat 을 쓰므로
    # 오프셋 접미사(+00:00)가 없는 문자열을 만든다. BigQuery TIMESTAMP 는 이를 UTC 로 해석한다.
    expected = [
        _bq_row("fac-1", "1970-01-01T00:00:00", "1970-01-01T00:05:00", 0.3, 2),
        _bq_row("fac-1", "1970-01-01T00:05:00", "1970-01-01T00:10:00", 0.6, 1),
        _bq_row("fac-2", "1970-01-01T00:00:00", "1970-01-01T00:05:00", 0.9, 2),
    ]

    with TestPipeline() as p:
        rows = (
            p
            | "Create" >> beam.Create(raw_events)
            | "Timestamp" >> beam.Map(lambda kv: TimestampedValue(kv[0], kv[1]))
            | "Parse" >> beam.Map(_parse_event)
            | "DropInvalid" >> beam.Filter(lambda d: bool(d))
            | "Window5m" >> beam.WindowInto(FixedWindows(WINDOW_SECONDS))
            | "ToKV" >> beam.Map(lambda d: (d["facility_id"], d["congestion"]))
            | "SumCountPerKey" >> beam.CombinePerKey(_sum_count_combiner())
            | "ToBqRow" >> beam.ParDo(_AddWindowInfo())
        )
        assert_that(rows, equal_to(expected))


if __name__ == "__main__":
    # pytest 없이도 구동되도록 간이 러너.
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
