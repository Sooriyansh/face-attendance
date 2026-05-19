import argparse
import time
import cv2
import requests
from config import MARK_COOLDOWN_SECONDS
from utils import detect_largest_face, get_face_detector
from liveness_detection import LivenessDetector, draw_liveness_info


def parse_args():
    parser = argparse.ArgumentParser(description="Recognize faces and mark attendance with liveness detection")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    parser.add_argument(
        "--api-url",
        default="http://localhost:3000/api/attendance/mark",
        help="Attendance API endpoint",
    )
    parser.add_argument(
        "--liveness-threshold",
        type=float,
        default=0.7,
        help="Liveness confidence threshold (0.0 to 1.0)"
    )
    parser.add_argument(
        "--liveness-frames",
        type=int,
        default=60,
        help="Number of frames to analyze for liveness (default: 60 frames ~2 seconds at 30fps)"
    )
    return parser.parse_args()


def mark_attendance(api_url, label, confidence, liveness_confidence=0.0):
    """
    Mark attendance with liveness verification
    
    Args:
        api_url: API endpoint URL
        label: Face label
        confidence: Face recognition confidence
        liveness_confidence: Liveness detection confidence
    """
    payload = {
        "faceLabel": label,
        "confidence": round(confidence, 4),
        "livenessConfidence": round(liveness_confidence, 4),
        "isLive": True,
    }
    response = requests.post(api_url, json=payload, timeout=10)
    response.raise_for_status()
    return response.json()


def main():
    args = parse_args()
    detector = get_face_detector()
    liveness_detector = LivenessDetector()
    
    camera = cv2.VideoCapture(args.camera)

    if not camera.isOpened():
        raise RuntimeError("Unable to open camera")

    recently_marked = {}
    face_detection_counter = 0
    current_label = None
    liveness_check_active = False

    print("=" * 60)
    print("ANTI-SPOOFING ATTENDANCE SYSTEM")
    print("=" * 60)
    print(f"Liveness threshold: {args.liveness_threshold * 100:.1f}%")
    print(f"Analysis frames: {args.liveness_frames}")
    print("=" * 60)
    print("\nTo pass liveness check, person must:")
    print("  1. Blink their eyes (at least 2 times)")
    print("  2. Move their head (left-right or up-down)")
    print("  3. Move their eyes")
    print("\nPress 'q' to quit")
    print("=" * 60)

    frame_count = 0
    
    while True:
        success, frame = camera.read()
        if not success:
            continue

        frame_count += 1
        
        # Always process with liveness detector
        liveness_results = liveness_detector.process_frame(frame)
        
        # Draw liveness information
        frame = draw_liveness_info(frame, liveness_results, position=(10, 30))
        
        face = detect_largest_face(frame, detector)
        display_text = "No face detected"
        display_color = (0, 120, 255)

        if face is not None:
            x, y, w, h = face
            display_text = "Face detected - Checking liveness..."
            display_color = (255, 165, 0)  # Orange for processing
            
            face_detection_counter += 1

            # If we just detected a face, start liveness check
            if face_detection_counter == 1:
                liveness_detector.reset()
                liveness_check_active = True
                current_label = "unknown"  # No recognition in current implementation
                print(f"\n[Frame {frame_count}] Face detected - Starting liveness verification...")

            # Check if we've analyzed enough frames for liveness
            if face_detection_counter >= args.liveness_frames and liveness_check_active:
                summary = liveness_detector.get_summary()
                
                print(f"\n[Frame {frame_count}] Liveness Analysis Complete:")
                print(f"  Frames analyzed: {summary['frames_analyzed']}")
                print(f"  Total blinks: {summary['total_blinks']}")
                print(f"  Alive percentage: {summary['alive_percentage']:.1f}%")
                print(f"  Confidence: {summary['confidence']:.3f}")
                print(f"  Verdict: {summary['verdict']}")
                
                now = time.time()
                label = current_label
                last_marked = recently_marked.get(label, 0)

                # Check if liveness confidence passes threshold
                if summary['confidence'] >= args.liveness_threshold and summary['verdict'] == "ALIVE":
                    if now - last_marked > MARK_COOLDOWN_SECONDS:
                        try:
                            result = mark_attendance(
                                args.api_url,
                                label,
                                confidence=1.0,
                                liveness_confidence=summary['confidence']
                            )
                            recently_marked[label] = now
                            display_text = "✓ ATTENDANCE MARKED (Live person confirmed)"
                            display_color = (0, 255, 0)  # Green
                            print(f"  ✓ ATTENDANCE MARKED!")
                            
                        except requests.RequestException as error:
                            display_text = f"API error: {str(error)[:40]}"
                            display_color = (0, 0, 255)  # Red
                            print(f"  ✗ API Error: {error}")
                    else:
                        cooldown_remaining = MARK_COOLDOWN_SECONDS - (now - last_marked)
                        display_text = f"Cooldown: {cooldown_remaining:.0f}s"
                        display_color = (0, 165, 255)
                        print(f"  ⏱ Cooldown period active ({cooldown_remaining:.0f}s remaining)")
                else:
                    display_text = "✗ SPOOF DETECTED - Not a live person"
                    display_color = (0, 0, 255)  # Red
                    print(f"  ✗ SPOOF DETECTED - Attendance REJECTED")

                # Reset for next detection
                face_detection_counter = 0
                liveness_check_active = False
            else:
                # Still collecting frames
                remaining = args.liveness_frames - face_detection_counter
                display_text = f"Liveness check: {face_detection_counter}/{args.liveness_frames} frames"
                display_color = (255, 165, 0)

        else:
            # Face lost
            if face_detection_counter > 0:
                print(f"\n[Frame {frame_count}] Face lost - Liveness check cancelled")
            face_detection_counter = 0
            liveness_check_active = False

        # Draw face rectangle and status
        if face is not None:
            x, y, w, h = face
            cv2.rectangle(frame, (x, y), (x + w, y + h), display_color, 2)
        
        # Draw status text
        cv2.putText(
            frame,
            display_text,
            (10, frame.shape[0] - 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            display_color,
            2,
        )

        cv2.imshow("Anti-Spoofing Attendance System", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    camera.release()
    cv2.destroyAllWindows()
    print("\n" + "=" * 60)
    print("System closed")
    print("=" * 60)


if __name__ == "__main__":
    main()

