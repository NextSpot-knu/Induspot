# Dataflow — Congestion Windowing (Stream Processing, Tier2 / WP5)

A managed Apache Beam streaming job that turns raw congestion events into 5-minute
per-facility averages.

```
Pub/Sub (induspot-congestion / sub: induspot-congestion-push)
  -> Apache Beam fixed 5-min windows
  -> mean congestion per facility
  -> BigQuery induspot.congestion_windowed
```

Roles stay separated: real-time single-point prediction is the Vertex online endpoint,
time-series forecasting is BigQuery ML (ARIMA_PLUS). This Dataflow job only adds the
**windowed-aggregation** stream-processing layer; it does not replace either.

## Why beam is NOT in the Cloud Run image

`apache-beam[gcp]` is intentionally **excluded** from `apps/api/requirements.txt` (the
Cloud Run container). Beam pulls in a very large dependency tree and is only needed to
*submit/run* the Dataflow job — not to serve the API. The pipeline runs as a **separate
managed Dataflow job**, so it lives here in `apps/api/dataflow/requirements.txt` and is
installed into a dedicated virtualenv (`apps/api/.venv_beam`, Python 3.11,
apache-beam 2.59.0). Keeping it out of the image keeps the API build fast and small.

## Files

| File | Purpose |
| --- | --- |
| `congestion_pipeline.py` | Pure Beam transform graph (`build_aggregation`) + IO wiring (`build_pipeline`) + CLI (`run`). Shared by tests and the live job. |
| `test_congestion_pipeline.py` | Unit + end-to-end window tests on `DirectRunner`/`TestPipeline` (no live Pub/Sub or BigQuery). |
| `launch_dataflow.py` | Thin launcher: injects `DataflowRunner` + project/region/SA/temp options into `run()`. |
| `requirements.txt` | Beam-only deps (apache-beam[gcp]==2.59.0). |

## Local validation (no cloud)

```powershell
# from apps/api
python -m venv .venv_beam
.\.venv_beam\Scripts\python -m pip install -r dataflow\requirements.txt
.\.venv_beam\Scripts\python -m pytest dataflow\test_congestion_pipeline.py -q
# pytest 없이도:  .\.venv_beam\Scripts\python dataflow\test_congestion_pipeline.py
```

## Launch on Dataflow (live — requires gcloud ADC auth)

Run from `apps/api`, using the beam venv (beam is not in the API image):

```powershell
# First launch (creates the persistent streaming job):
.\.venv_beam\Scripts\python dataflow\launch_dataflow.py

# Subsequent code/graph changes — update the running job in place (no downtime):
.\.venv_beam\Scripts\python dataflow\launch_dataflow.py --update
```

The launcher submits a **persistent streaming job** named `induspot-congestion-windowing`:

- `--project knudc-henryseo711`
- `--region us-central1`
- `--temp_location gs://induspot-models-6757/dataflow-temp`
- `--staging_location gs://induspot-models-6757/dataflow-staging`
- `--service_account_email 768699236852-compute@developer.gserviceaccount.com`
- `--streaming`, `--max_num_workers 2`

You can also trigger it from the repo root via `deploy.ps1 -WithStreaming` (optional,
heavier step — kept separate from the Cloud Run image build).

## Idempotency

- The job name is fixed (`induspot-congestion-windowing`), so it is the natural
  re-launch key.
- If a job with that name is already `RUNNING`, **do not** start a second one — re-run
  with `--update` (Dataflow drain-and-replace) to roll out new code with no downtime.
- The very first launch must be **without** `--update` (Dataflow errors on `--update`
  when no matching job exists).
- `WriteToBigQuery` uses `CREATE_IF_NEEDED` + `WRITE_APPEND`, so the
  `induspot.congestion_windowed` table is created on first write and re-runs only append.

## Region / cost notes

- Region is `us-central1` to colocate with BigQuery dataset `induspot`
  (`BQ_LOCATION us-central1`) and the GCS temp/staging bucket, avoiding cross-region
  egress on every windowed write.
- A **streaming** Dataflow job keeps at least one worker VM running 24/7, so it bills
  continuously (vCPU + memory + Streaming Engine + Shuffle), unlike batch jobs.
  `--max_num_workers=2` caps autoscaling to keep demo cost predictable.
- After demos, **cancel the job** to stop billing:

  ```powershell
  gcloud dataflow jobs list --region us-central1 --status active
  gcloud dataflow jobs cancel <JOB_ID> --region us-central1
  ```

  (Use `drain` instead of `cancel` if you want in-flight windows to finish and flush to
  BigQuery first.)
