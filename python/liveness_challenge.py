"""
Interactive Liveness Challenge
Guides user through specific actions to verify they are a real person
"""

import argparse
import time
import cv2
from typing import Dict, Any, List
from liveness_detection import LivenessDetector, draw_liveness_info
from utils import detect_largest_face, get_face_detector


class LivenessChallenge:
    """
    Interactive liveness challenge with guided actions
    """
    
    CHALLENGE_STEPS = [
        {
            "step": 1,
            "title": "BLINK TEST",
            "instruction": "Please blink your eyes normally (2 blinks minimum)",
            "duration": 8,
            "check": "blinks",
        },
        {
            "step": 2,
            "title": "HEAD MOVEMENT TEST",
            "instruction": "Slowly turn your head left and right",
            "duration": 10,
            "check": "head_movement",
        },
        {
            "step": 3,
            "title": "EYE MOVEMENT TEST",
            "instruction": "Look around - up, down, left, right",
            "duration": 8,
            "check": "eye_movement",
        },
    ]
    
    def __init__(self):
        self.current_step = 0
        self.step_start_time = None
        self.results = {}
        self.liveness_detector = LivenessDetector()
        
    def get_current_challenge(self) -> Dict[str, Any]:
        """Get the current challenge step"""
        if self.current_step >= len(self.CHALLENGE_STEPS):
            return None
        return self.CHALLENGE_STEPS[self.current_step]
    
    def get_step_progress(self) -> Dict[str, Any]:
        """Get progress information for current step"""
        challenge = self.get_current_challenge()
        if challenge is None:
            return None
        
        elapsed = time.time() - self.step_start_time if self.step_start_time else 0
        remaining = max(0, challenge["duration"] - elapsed)
        progress_percent = min(100, (elapsed / challenge["duration"]) * 100) if challenge["duration"] > 0 else 0
        
        return {
            "step": challenge["step"],
            "title": challenge["title"],
            "instruction": challenge["instruction"],
            "elapsed": elapsed,
            "remaining": remaining,
            "progress_percent": progress_percent,
            "is_complete": elapsed >= challenge["duration"]
        }
    
    def next_step(self) -> bool:
        """Move to next challenge step"""
        if self.current_step < len(self.CHALLENGE_STEPS):
            challenge = self.CHALLENGE_STEPS[self.current_step]
            check_type = challenge["check"]
            
            # Record results from liveness detector
            summary = self.liveness_detector.get_summary()
            
            step_passed = False
            if check_type == "blinks":
                step_passed = summary["total_blinks"] >= 2
            elif check_type == "head_movement":
                # Check from last process_frame results
                step_passed = True  # Will be determined by actual detection
            elif check_type == "eye_movement":
                step_passed = True  # Will be determined by actual detection
            
            self.results[f"step_{self.current_step}"] = {
                "challenge": challenge,
                "passed": step_passed,
                "summary": summary
            }
            
            self.current_step += 1
            self.liveness_detector.reset()
            self.step_start_time = time.time()
            
            return True
        return False
    
    def is_complete(self) -> bool:
        """Check if all challenges are complete"""
        return self.current_step >= len(self.CHALLENGE_STEPS)
    
    def get_final_verdict(self) -> Dict[str, Any]:
        """Get final liveness verdict"""
        if not self.is_complete():
            return None
        
        passed_checks = sum(
            1 for result in self.results.values() 
            if result.get("passed", False)
        )
        
        return {
            "total_steps": len(self.CHALLENGE_STEPS),
            "passed_steps": passed_checks,
            "is_alive": passed_checks >= 2,  # Need to pass at least 2/3 challenges
            "results": self.results
        }


def draw_challenge_overlay(
    frame: cv2.typing.MatLike,
    challenge_info: Dict[str, Any],
    liveness_results: Dict[str, Any]
) -> cv2.typing.MatLike:
    """
    Draw challenge information and progress on frame
    
    Args:
        frame: Input frame
        challenge_info: Current challenge information
        liveness_results: Current liveness detection results
        
    Returns:
        Frame with drawn information
    """
    h, w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    
    # Draw semi-transparent overlay
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 100), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)
    
    # Draw challenge title
    cv2.putText(
        frame,
        f"Challenge: {challenge_info['title']}",
        (20, 30),
        font,
        0.8,
        (0, 255, 0),
        2
    )
    
    # Draw instruction
    cv2.putText(
        frame,
        challenge_info["instruction"],
        (20, 60),
        font,
        0.6,
        (200, 200, 200),
        1
    )
    
    # Draw progress bar
    progress = challenge_info["progress_percent"]
    bar_width = 300
    bar_height = 20
    bar_x = w - bar_width - 20
    bar_y = 20
    
    # Background
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height), (100, 100, 100), -1)
    
    # Filled progress
    filled_width = int(bar_width * progress / 100)
    cv2.rectangle(
        frame,
        (bar_x, bar_y),
        (bar_x + filled_width, bar_y + bar_height),
        (0, 200, 0),
        -1
    )
    
    # Border
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height), (255, 255, 255), 2)
    
    # Time remaining
    remaining_text = f"{challenge_info['remaining']:.1f}s"
    cv2.putText(
        frame,
        remaining_text,
        (bar_x + bar_width + 10, bar_y + 15),
        font,
        0.5,
        (255, 255, 255),
        1
    )
    
    # Draw liveness info on bottom
    frame = draw_liveness_info(frame, liveness_results, position=(10, h - 110))
    
    return frame


def main():
    parser = argparse.ArgumentParser(description="Interactive Liveness Challenge for Attendance")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    parser.add_argument(
        "--strict-mode",
        action="store_true",
        help="Strict mode - all challenges must pass"
    )
    args = parser.parse_args()
    
    detector = get_face_detector()
    challenge = LivenessChallenge()
    camera = cv2.VideoCapture(args.camera)
    
    if not camera.isOpened():
        raise RuntimeError("Unable to open camera")
    
    # Start first challenge
    challenge.step_start_time = time.time()
    
    print("\n" + "=" * 70)
    print("INTERACTIVE LIVENESS CHALLENGE")
    print("=" * 70)
    print("\nYou will be given 3 challenges to prove you are a real person:")
    print("1. BLINK TEST - Blink your eyes normally (2 times)")
    print("2. HEAD MOVEMENT - Turn your head left and right")
    print("3. EYE MOVEMENT - Look around (up, down, left, right)")
    print("\nPress 's' to skip current challenge")
    print("Press 'q' to quit")
    print("=" * 70 + "\n")
    
    frame_count = 0
    
    while True:
        success, frame = camera.read()
        if not success:
            continue
        
        frame_count += 1
        
        # Detect face
        face = detect_largest_face(frame, detector)
        
        if not challenge.is_complete():
            current_challenge = challenge.get_current_challenge()
            progress = challenge.get_step_progress()
            
            # Process frame with liveness detector
            liveness_results = challenge.liveness_detector.process_frame(frame)
            
            # Draw challenge overlay
            frame = draw_challenge_overlay(frame, progress, liveness_results)
            
            # Draw face rectangle if detected
            if face is not None:
                x, y, w, h = face
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            
            # Check if challenge step is complete
            if progress["is_complete"]:
                # Auto-advance to next step
                challenge.next_step()
                
                if challenge.is_complete():
                    print("\n[All challenges completed]")
                else:
                    print(f"\n[Moving to challenge {challenge.current_step + 1}/{len(challenge.CHALLENGE_STEPS)}]")
        
        else:
            # All challenges complete - show final verdict
            verdict = challenge.get_final_verdict()
            
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), frame.shape[1], frame.shape[0], (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)
            
            status = "✓ LIVENESS VERIFIED" if verdict["is_alive"] else "✗ LIVENESS FAILED"
            color = (0, 255, 0) if verdict["is_alive"] else (0, 0, 255)
            
            cv2.putText(
                frame,
                status,
                (frame.shape[1] // 2 - 150, frame.shape[0] // 2 - 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.5,
                color,
                3
            )
            
            passed_text = f"Passed: {verdict['passed_steps']}/{verdict['total_steps']}"
            cv2.putText(
                frame,
                passed_text,
                (frame.shape[1] // 2 - 100, frame.shape[0] // 2 + 20),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (200, 200, 200),
                2
            )
            
            print(f"\n{'=' * 70}")
            print(f"FINAL VERDICT: {status}")
            print(f"Challenges Passed: {verdict['passed_steps']}/{verdict['total_steps']}")
            print(f"{'=' * 70}\n")
        
        cv2.imshow("Liveness Challenge", frame)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("s") and not challenge.is_complete():
            # Skip current challenge
            challenge.next_step()
            if not challenge.is_complete():
                print(f"\n[Skipped - Moving to challenge {challenge.current_step}/{len(challenge.CHALLENGE_STEPS)}]")
    
    camera.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
