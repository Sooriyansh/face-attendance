from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple

import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import MobileNetV2, preprocess_input

from config import IMAGE_SIZE


def get_face_detector() -> cv2.CascadeClassifier:
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(str(cascade_path))
    if detector.empty():
        raise RuntimeError("Failed to load Haar cascade for face detection")
    return detector


def build_embedding_model() -> tf.keras.Model:
    base_model = MobileNetV2(
        include_top=False,
        pooling="avg",
        weights="imagenet",
        input_shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
    )
    base_model.trainable = False
    return base_model


def detect_largest_face(frame: np.ndarray, detector: cv2.CascadeClassifier) -> Tuple[int, int, int, int] | None:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = detector.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=8,
        minSize=(80, 80),
    )
    if len(faces) == 0:
        return None
    return max(faces, key=lambda item: item[2] * item[3])


def extract_face_tensor(frame: np.ndarray, face_box: Iterable[int]) -> np.ndarray:
    x, y, w, h = [int(value) for value in face_box]
    face = frame[y : y + h, x : x + w]
    face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
    face = cv2.resize(face, IMAGE_SIZE)
    face = face.astype("float32")
    return preprocess_input(face)


def compute_embedding(model: tf.keras.Model, face_tensor: np.ndarray) -> np.ndarray:
    batch = np.expand_dims(face_tensor, axis=0)
    embedding = model.predict(batch, verbose=0)[0]
    norm = np.linalg.norm(embedding)
    return embedding / norm if norm else embedding


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    left_norm = left / np.linalg.norm(left)
    right_norm = right / np.linalg.norm(right)
    return float(np.dot(left_norm, right_norm))


def check_face_blur(frame: np.ndarray, face_box: Iterable[int]) -> dict:
    x, y, w, h = [int(value) for value in face_box]
    face = frame[y : y + h, x : x + w]
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    is_sharp = laplacian_var > 100
    return {
        "is_sharp": is_sharp,
        "blur_score": float(laplacian_var),
        "message": "Clear" if is_sharp else "Blurry face detected"
    }


def check_face_brightness(frame: np.ndarray, face_box: Iterable[int]) -> dict:
    x, y, w, h = [int(value) for value in face_box]
    face = frame[y : y + h, x : x + w]
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    avg_brightness = np.mean(gray)
    
    is_good_brightness = 50 < avg_brightness < 200
    return {
        "is_good": is_good_brightness,
        "brightness": float(avg_brightness),
        "message": "Good lighting" if is_good_brightness else ("Too dark" if avg_brightness <= 50 else "Too bright")
    }


def check_face_size(face_box: Iterable[int], frame_width: int, frame_height: int) -> dict:
    x, y, w, h = [int(value) for value in face_box]
    face_area_ratio = (w * h) / (frame_width * frame_height)
    
    is_good_size = face_area_ratio > 0.04
    return {
        "is_good": is_good_size,
        "area_ratio": float(face_area_ratio),
        "message": "Good distance" if is_good_size else "Face too far - come closer"
    }


def detect_face_occlusion(frame: np.ndarray, face_box: Iterable[int]) -> dict:
    x, y, w, h = [int(value) for value in face_box]
    face = frame[y : y + h, x : x + w]
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    
    top_third = gray[: h//3, :]
    eye_region_brightness = np.mean(top_third)
    
    has_potential_occlusion = eye_region_brightness < 40
    return {
        "has_occlusion": has_potential_occlusion,
        "eye_brightness": float(eye_region_brightness),
        "message": "Remove glasses/mask if present" if has_potential_occlusion else "Face clear"
    }


def validate_face_quality(frame: np.ndarray, face_box: Iterable[int]) -> dict:
    blur_check = check_face_blur(frame, face_box)
    brightness_check = check_face_brightness(frame, face_box)
    size_check = check_face_size(face_box, frame.shape[1], frame.shape[0])
    occlusion_check = detect_face_occlusion(frame, face_box)
    
    all_checks_pass = (
        blur_check["is_sharp"] and
        brightness_check["is_good"] and
        size_check["is_good"] and
        not occlusion_check["has_occlusion"]
    )
    
    messages = []
    if not blur_check["is_sharp"]:
        messages.append("Face is blurry")
    if not brightness_check["is_good"]:
        messages.append(brightness_check["message"])
    if not size_check["is_good"]:
        messages.append(size_check["message"])
    if occlusion_check["has_occlusion"]:
        messages.append(occlusion_check["message"])
    
    return {
        "is_valid": all_checks_pass,
        "blur": blur_check,
        "brightness": brightness_check,
        "size": size_check,
        "occlusion": occlusion_check,
        "error_messages": messages if not all_checks_pass else []
    }
