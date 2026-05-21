import numpy as np
from pathlib import Path

from config import DATASET_DIR, EMBEDDINGS_PATH, MIN_TRAINING_IMAGES_PER_USER
from utils import build_embedding_model, compute_embedding, detect_largest_face, extract_face_tensor, get_face_detector

import cv2


def iter_images():
    for label_dir in sorted(DATASET_DIR.iterdir()):
        if not label_dir.is_dir():
            continue
        for image_path in sorted(label_dir.glob("*.jpg")):
            yield label_dir.name, image_path


def main():
    model = build_embedding_model()
    detector = get_face_detector()
    labels = []
    embeddings = []

    per_label_counts = {}

    for label, image_path in iter_images():
        image = cv2.imread(str(image_path))
        if image is None:
            continue

        face = detect_largest_face(image, detector)
        if face is None:
            continue

        face_tensor = extract_face_tensor(image, face)

        embedding = compute_embedding(model, face_tensor)

        embeddings.append(embedding)
        labels.append(label)
        per_label_counts[label] = per_label_counts.get(label, 0) + 1

    if not embeddings:
        raise RuntimeError("No dataset images found. Run capture_faces.py first.")

    np.savez_compressed(
        EMBEDDINGS_PATH,
        labels=np.array(labels),
        embeddings=np.array(embeddings),
    )
    print(f"Saved {len(labels)} embeddings to {EMBEDDINGS_PATH}")

    under_sampled = {
        label: count
        for label, count in sorted(per_label_counts.items())
        if count < MIN_TRAINING_IMAGES_PER_USER
    }
    if under_sampled:
        details = ", ".join(f"{label}: {count}" for label, count in under_sampled.items())
        print(
            f"Warning: recommended minimum is {MIN_TRAINING_IMAGES_PER_USER} training images per user. "
            f"Under-sampled labels: {details}"
        )


if __name__ == "__main__":
    main()
