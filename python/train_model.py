from collections import defaultdict

import numpy as np

import cv2

from config import DATASET_DIR, EMBEDDINGS_PATH, MIN_TRAINING_IMAGES_PER_USER
from utils import (
    build_embedding_model,
    compute_embedding,
    cosine_similarity,
    detect_largest_face,
    extract_face_tensor,
    get_face_detector,
    normalize_embedding,
    validate_face_quality,
)


def iter_images():
    for label_dir in sorted(DATASET_DIR.iterdir()):
        if not label_dir.is_dir():
            continue
        for image_path in sorted(list(label_dir.glob("*.jpg")) + list(label_dir.glob("*.jpeg")) + list(label_dir.glob("*.png"))):
            yield label_dir.name, image_path


def is_duplicate_embedding(embedding, existing_embeddings, threshold=0.995):
    return any(cosine_similarity(embedding, existing) >= threshold for existing in existing_embeddings)


def main():
    model = build_embedding_model()
    detector = get_face_detector()
    embeddings_by_label = defaultdict(list)
    sample_labels = []
    sample_embeddings = []
    per_label_counts = {}
    skipped = []

    for label, image_path in iter_images():
        image = cv2.imread(str(image_path))
        if image is None:
            skipped.append((str(image_path), "unable to read image"))
            continue

        face = detect_largest_face(image, detector)
        if face is None:
            skipped.append((str(image_path), "no face detected"))
            continue

        quality = validate_face_quality(image, face)
        if quality["blur"]["blur_score"] < 20:
            skipped.append((str(image_path), "face too blurry for training"))
            continue

        try:
            face_tensor = extract_face_tensor(image, face)
            embedding = compute_embedding(model, face_tensor)
        except Exception as error:
            skipped.append((str(image_path), str(error)))
            continue

        if is_duplicate_embedding(embedding, embeddings_by_label[label]):
            skipped.append((str(image_path), "duplicate face sample"))
            continue

        embeddings_by_label[label].append(embedding)
        sample_labels.append(label)
        sample_embeddings.append(embedding)
        per_label_counts[label] = per_label_counts.get(label, 0) + 1

    if not sample_embeddings:
        raise RuntimeError("No dataset images found. Run capture_faces.py first.")

    labels = []
    embeddings = []
    label_counts = []
    for label, label_embeddings in sorted(embeddings_by_label.items()):
        centroid = normalize_embedding(np.mean(np.array(label_embeddings), axis=0))
        labels.append(label)
        embeddings.append(centroid)
        label_counts.append(len(label_embeddings))

    np.savez_compressed(
        EMBEDDINGS_PATH,
        labels=np.array(labels),
        embeddings=np.array(embeddings),
        sample_labels=np.array(sample_labels),
        sample_embeddings=np.array(sample_embeddings),
        label_counts=np.array(label_counts),
    )
    print(f"Saved {len(labels)} student centroid embedding(s) and {len(sample_embeddings)} sample embedding(s) to {EMBEDDINGS_PATH}")

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

    if skipped:
        print(f"Skipped {len(skipped)} bad/duplicate image(s):")
        for image_path, reason in skipped[:20]:
            print(f"- {image_path}: {reason}")


if __name__ == "__main__":
    main()
