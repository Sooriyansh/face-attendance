import argparse
import json
from pathlib import Path

import cv2

from liveness_detection import LivenessDetector


def parse_args():
    parser = argparse.ArgumentParser(description="Check liveness across a sequence of camera frames")
    parser.add_argument("images", nargs="+", help="Frame image paths in capture order")
    return parser.parse_args()


def main():
    args = parse_args()
    detector = LivenessDetector()
    processed = 0

    for image_path in args.images:
        image = cv2.imread(str(Path(image_path)))
        if image is None:
            continue
        detector.process_frame(image)
        processed += 1

    summary = detector.get_summary()
    head_moved, movement_type = detector._detect_head_movement()
    eye_moved = detector._detect_eye_movement()
    blink_passed = detector.blink_count >= detector.blink_count_required
    passed_checks = sum([blink_passed, head_moved, eye_moved])
    confidence = min(
        (0.4 if blink_passed else min(detector.blink_count / max(detector.blink_count_required, 1), 1.0) * 0.4)
        + (0.3 if head_moved else 0.0)
        + (0.3 if eye_moved else 0.0),
        1.0,
    )
    is_live = passed_checks >= 2 and confidence >= 0.55

    print(
        json.dumps(
            {
                "success": True,
                "isLive": is_live,
                "confidence": round(confidence, 4),
                "framesAnalyzed": processed,
                "blinks": summary.get("total_blinks", 0),
                "headMovement": bool(head_moved),
                "headMovementType": movement_type,
                "eyeMovement": bool(eye_moved),
                "alivePercentage": round(float(summary.get("alive_percentage", 0.0)), 2),
                "verdict": "ALIVE" if is_live else "SPOOF DETECTED",
            }
        )
    )


if __name__ == "__main__":
    main()
