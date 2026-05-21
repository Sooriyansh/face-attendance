import json
import os
import sys
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import cv2
import numpy as np

from config import CONFIDENCE_THRESHOLD, EMBEDDINGS_PATH, FACE_DISTANCE_THRESHOLD, FACE_MATCH_MARGIN
from utils import (
    build_embedding_model,
    compute_embedding,
    cosine_similarity,
    detect_largest_face,
    euclidean_distance,
    extract_face_tensor,
    get_face_detector,
    validate_face_quality,
)


def load_embeddings():
    if not EMBEDDINGS_PATH.exists():
        raise RuntimeError("Embeddings file not found. Run train_model.py first.")

    data = np.load(EMBEDDINGS_PATH, allow_pickle=True)
    labels = data["labels"]
    embeddings = data["embeddings"]
    sample_labels = data["sample_labels"] if "sample_labels" in data.files else labels
    sample_embeddings = data["sample_embeddings"] if "sample_embeddings" in data.files else embeddings
    return labels, embeddings, sample_labels, sample_embeddings


def best_from_store(embedding, labels, embeddings):
    candidates = []
    for label, stored in zip(labels, embeddings):
        candidates.append({
            "label": str(label),
            "similarity": cosine_similarity(embedding, stored),
            "distance": euclidean_distance(embedding, stored),
        })

    if not candidates:
        return None, None

    candidates.sort(key=lambda item: (-item["similarity"], item["distance"]))
    return candidates[0], candidates[1] if len(candidates) > 1 else None


def find_best_match(embedding, labels, embeddings, sample_labels, sample_embeddings):
    centroid_best, centroid_second = best_from_store(embedding, labels, embeddings)
    sample_best, sample_second = best_from_store(embedding, sample_labels, sample_embeddings)
    candidates = [item for item in [centroid_best, sample_best] if item]

    if not candidates:
        return None, 0.0, 1.0, "no-candidates"

    best = sorted(candidates, key=lambda item: (-item["similarity"], item["distance"]))[0]
    second_options = [item for item in [centroid_second, sample_second] if item and item["label"] != best["label"]]
    second_similarity = max([item["similarity"] for item in second_options], default=0.0)
    margin = best["similarity"] - second_similarity
    is_confident = (
        best["similarity"] >= CONFIDENCE_THRESHOLD
        and best["distance"] <= FACE_DISTANCE_THRESHOLD
        and margin >= FACE_MATCH_MARGIN
    )

    if not is_confident:
        return None, best["similarity"], best["distance"], f"margin={margin:.4f}"

    return best["label"], best["similarity"], best["distance"], f"margin={margin:.4f}"


def recognize_image(model, detector, labels, embeddings, sample_labels, sample_embeddings, image_path):
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError("Unable to read image")

    face = detect_largest_face(image, detector)
    if face is None:
        return {"success": True, "matched": False, "message": "Face Not Detected"}

    quality = validate_face_quality(image, face)
    face_tensor = extract_face_tensor(image, face)
    embedding = compute_embedding(model, face_tensor)
    label, score, distance, debug = find_best_match(embedding, labels, embeddings, sample_labels, sample_embeddings)

    if not label or score < CONFIDENCE_THRESHOLD:
        return {
            "success": True,
            "matched": False,
            "message": "Face Not Registered",
            "confidence": round(score, 4),
            "distance": round(distance, 4),
            "quality_issues": quality["error_messages"],
            "debug": debug,
        }

    return {
        "success": True,
        "matched": True,
        "label": label,
        "confidence": round(score, 4),
        "distance": round(distance, 4),
        "quality_issues": quality["error_messages"],
        "box": {
            "x": int(face[0]),
            "y": int(face[1]),
            "w": int(face[2]),
            "h": int(face[3]),
        },
    }


def emit(payload):
    print(json.dumps(payload), flush=True)


def main():
    try:
        model = build_embedding_model()
        detector = get_face_detector()
        labels, embeddings, sample_labels, sample_embeddings = load_embeddings()
        emit({"type": "ready"})
    except Exception as error:
        emit({"type": "fatal", "message": str(error)})
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request["id"]
            image_path = Path(request["imagePath"])
            result = recognize_image(model, detector, labels, embeddings, sample_labels, sample_embeddings, image_path)
            emit({"type": "result", "id": request_id, "result": result})
        except Exception as error:
            emit(
                {
                    "type": "result",
                    "id": request.get("id") if "request" in locals() else None,
                    "result": {"success": False, "message": str(error)},
                }
            )


if __name__ == "__main__":
    main()
