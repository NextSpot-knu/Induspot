import os
import sys
from google.cloud import storage

def main():
    # apps/api/model.pkl path
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    model_path = os.path.join(parent_dir, "model.pkl")

    if not os.path.exists(model_path):
        print(f"Error: model.pkl not found at {model_path}. Please run train.py first.")
        sys.exit(1)

    bucket_name = "induspot-models-6757"
    destination_blob_name = "models/model.pkl"

    # Attempt to retrieve project_id from Application Default Credentials
    project_id = "knudc-henryseo711"
    # ADC 경로 크로스플랫폼 해석(CLOUDSDK_CONFIG 우선, Windows=%APPDATA%/gcloud, 그 외=~/.config/gcloud).
    _base = os.environ.get("CLOUDSDK_CONFIG") or (
        os.path.join(os.environ.get("APPDATA", ""), "gcloud")
        if os.name == "nt"
        else os.path.expanduser("~/.config/gcloud")
    )
    adc_path = os.path.join(_base, "application_default_credentials.json")
    if os.path.exists(adc_path):
        try:
            import json
            with open(adc_path, "r", encoding="utf-8") as f:
                cred = json.load(f)
                if "quota_project_id" in cred:
                    project_id = cred["quota_project_id"]
        except Exception:
            pass

    try:
        # Initialize Google Cloud Storage client with explicit project ID
        storage_client = storage.Client(project=project_id)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(destination_blob_name)

        print(f"Uploading {model_path} to gs://{bucket_name}/{destination_blob_name} using project {project_id}...")
        blob.upload_from_filename(model_path)
        print(f"업로드 완료: gs://{bucket_name}/{destination_blob_name}")
    except Exception as e:
        print(f"Error uploading model to GCS: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
