import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("FACE_DATA_DIR", BASE_DIR.parent / "github-face-data")).resolve()
DATASET_DIR = DATA_DIR / "dataset"
MODELS_DIR = DATA_DIR / "models"
EMBEDDINGS_PATH = MODELS_DIR / "face_embeddings.npz"

IMAGE_SIZE = (160, 160)
FACE_DETECTOR_BACKEND = os.environ.get("FACE_DETECTOR_BACKEND", "retinaface")
FACE_RECOGNITION_MODEL = os.environ.get("FACE_RECOGNITION_MODEL", "ArcFace")
CONFIDENCE_THRESHOLD = float(os.environ.get("FACE_CONFIDENCE_THRESHOLD", "0.68"))
MARK_COOLDOWN_SECONDS = 20
MIN_TRAINING_IMAGES_PER_USER = int(os.environ.get("MIN_TRAINING_IMAGES_PER_USER", "2"))
MAX_TRAINING_IMAGES_PER_USER = int(os.environ.get("MAX_TRAINING_IMAGES_PER_USER", "2"))
FRAME_SKIP = int(os.environ.get("FACE_FRAME_SKIP", "2"))

for directory in (DATA_DIR, DATASET_DIR, MODELS_DIR):
    directory.mkdir(parents=True, exist_ok=True)
