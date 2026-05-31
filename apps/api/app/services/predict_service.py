import os
import json
import pickle
from google.cloud import storage
from app.core.config import settings

# GCP Project ID resolution
project_id = "knudc-henryseo711"
storage_client = None
try:
    if os.environ.get("ENV") == "production":
        storage_client = storage.Client()
    else:
        # Local fallback for development with ADC credentials
        adc_path = os.path.join(os.environ.get("APPDATA", ""), "gcloud", "application_default_credentials.json")
        if os.path.exists(adc_path):
            try:
                with open(adc_path, "r", encoding="utf-8") as f:
                    cred = json.load(f)
                    if "quota_project_id" in cred:
                        project_id = cred["quota_project_id"]
            except Exception:
                pass
        storage_client = storage.Client(project=project_id)
except Exception as e:
    print(f"Failed to initialize GCS storage client (local fallback will be used): {e}")

print(f"Downloading model from GCS bucket: {settings.GCS_BUCKET_NAME} in project: {project_id}...")
try:
    if storage_client is None:
        raise RuntimeError("GCS storage client is not initialized.")
    bucket = storage_client.bucket(settings.GCS_BUCKET_NAME)
    blob = bucket.blob("models/model.pkl")
    model_bytes = blob.download_as_bytes()
    model_data = pickle.loads(model_bytes)
    model = model_data["model"]
    encoder = model_data["encoder"]
    print("Successfully loaded model and encoder from GCS.")
except Exception as e:
    print(f"Error loading model from GCS: {e}")
    # Fallback to local file if available
    local_model_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "model.pkl")
    if os.path.exists(local_model_path):
        print(f"Falling back to local model file: {local_model_path}")
        try:
            with open(local_model_path, "rb") as f:
                model_data = pickle.load(f)
                model = model_data["model"]
                encoder = model_data["encoder"]
        except Exception as err:
            print(f"Failed to load local model: {err}")
            model = None
            encoder = None
    else:
        print("Warning: Could not load model from GCS or local backup. Heuristic fallback will be used.")
        model = None
        encoder = None

def normalize_facility_type(facility_type: str) -> str:
    if facility_type in ["restaurant", "cafe"]:
        return "cafeteria"
    elif facility_type == "gym":
        return "loading_dock"
    elif facility_type == "office":
        return "meeting_room"
    elif facility_type in ["cafeteria", "parking", "meeting_room", "loading_dock"]:
        return facility_type
    return facility_type

def predict_congestion(facility_type: str, hour: int, day_of_week: int) -> float:
    # 1. Normalize type
    norm_type = normalize_facility_type(facility_type)

    # 2. If model or encoder not loaded, use heuristic prediction
    if model is None or encoder is None:
        if norm_type == 'cafeteria':
            if hour >= 11 and hour <= 13: return 0.8
            if hour >= 17 and hour <= 19: return 0.6
            return 0.2
        elif norm_type == 'parking':
            if hour >= 8 and hour <= 18: return 0.7
            return 0.3
        elif norm_type == 'meeting_room':
            if hour >= 9 and hour <= 17: return 0.5
            return 0.1
        else: # loading_dock
            if hour >= 8 and hour <= 20: return 0.4
            return 0.1

    # 3. Check if normalized type is in encoder categories
    if not hasattr(encoder, "categories_") or norm_type not in encoder.categories_[0]:
        return 0.5

    # 4. Transform inputs to one-hot encoding representation
    try:
        # OneHotEncoder was fit on [norm_type, hour_str, day_str]
        features = [[norm_type, str(hour), str(day_of_week)]]
        X_encoded = encoder.transform(features)
        
        # 5. Predict
        prediction = model.predict(X_encoded)[0]
        
        # 5. Clip between 0.0 and 1.0
        return max(0.0, min(1.0, float(prediction)))
    except Exception as e:
        print(f"Prediction error: {e}")
        return 0.5
