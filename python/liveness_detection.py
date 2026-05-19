"""
Liveness Detection Module
Anti-spoofing detection using MediaPipe, OpenCV, and DeepFace
Detects: blink, eye movement, head movement, and real face
"""

import numpy as np
import cv2
from collections import deque
from typing import Tuple, Dict, Any, Optional
import mediapipe as mp


# Initialize MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils


class LivenessDetector:
    """
    Complete liveness detection system to prevent spoofing attacks
    using photos, videos, or mobile screens.
    """
    
    def __init__(
        self,
        blink_threshold: float = 0.25,
        blink_count_required: int = 2,
        head_movement_threshold: float = 15.0,
        eye_movement_threshold: float = 0.02,
        frame_buffer_size: int = 30
    ):
        """
        Initialize the Liveness Detector
        
        Args:
            blink_threshold: Eye Aspect Ratio (EAR) threshold for blink detection
            blink_count_required: Number of blinks required to pass liveness test
            head_movement_threshold: Minimum head rotation degree required (in degrees)
            eye_movement_threshold: Minimum eye movement required (normalized coordinates)
            frame_buffer_size: Number of frames to keep in buffer for analysis
        """
        self.blink_threshold = blink_threshold
        self.blink_count_required = blink_count_required
        self.head_movement_threshold = head_movement_threshold
        self.eye_movement_threshold = eye_movement_threshold
        
        # Initialize MediaPipe models
        self.face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        self.face_detector = mp_face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=0.5
        )
        
        # Tracking variables
        self.frame_buffer = deque(maxlen=frame_buffer_size)
        self.blink_count = 0
        self.eye_closed_frames = 0
        self.prev_eye_aspect_ratio = None
        self.head_pose_history = deque(maxlen=frame_buffer_size)
        self.eye_center_history = deque(maxlen=frame_buffer_size)
        
    def _calculate_eye_aspect_ratio(self, eye_points: np.ndarray) -> float:
        """
        Calculate Eye Aspect Ratio (EAR) for blink detection
        Formula: (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
        
        Args:
            eye_points: 6 eye landmarks from MediaPipe (in normalized coordinates)
            
        Returns:
            Eye Aspect Ratio (float)
        """
        # Convert normalized coordinates to distances
        p2_p6 = np.linalg.norm(eye_points[1] - eye_points[5])
        p3_p5 = np.linalg.norm(eye_points[2] - eye_points[4])
        p1_p4 = np.linalg.norm(eye_points[0] - eye_points[3])
        
        # Calculate EAR
        ear = (p2_p6 + p3_p5) / (2.0 * p1_p4) if p1_p4 > 0 else 0
        return float(ear)
    
    def _detect_blink(self, left_ear: float, right_ear: float) -> bool:
        """
        Detect if a blink occurred based on eye aspect ratio
        
        Args:
            left_ear: Left eye aspect ratio
            right_ear: Right eye aspect ratio
            
        Returns:
            True if blink detected, False otherwise
        """
        current_ear = (left_ear + right_ear) / 2.0
        
        # Check if eye is closed
        if current_ear < self.blink_threshold:
            self.eye_closed_frames += 1
        else:
            # Eye opened after being closed - blink detected
            if self.eye_closed_frames > 2:  # Minimum frames for valid blink
                self.blink_count += 1
                self.eye_closed_frames = 0
                return True
            self.eye_closed_frames = 0
        
        self.prev_eye_aspect_ratio = current_ear
        return False
    
    def _calculate_head_pose(self, face_landmarks: np.ndarray, frame_shape: Tuple[int, int]) -> Dict[str, float]:
        """
        Calculate head pose using 3D face landmarks
        
        Args:
            face_landmarks: Face landmarks from MediaPipe
            frame_shape: Shape of the frame (height, width)
            
        Returns:
            Dictionary with pitch, yaw, roll angles
        """
        h, w = frame_shape
        
        # Key points for head pose estimation
        # Using nose, eyes, mouth corners
        nose = face_landmarks[1]  # Nose tip
        left_eye = face_landmarks[33]  # Left eye
        right_eye = face_landmarks[263]  # Right eye
        left_mouth = face_landmarks[61]  # Left mouth corner
        right_mouth = face_landmarks[291]  # Right mouth corner
        chin = face_landmarks[152]  # Chin
        
        # Convert normalized to pixel coordinates
        points_2d = np.array([
            [nose[0] * w, nose[1] * h],
            [left_eye[0] * w, left_eye[1] * h],
            [right_eye[0] * w, right_eye[1] * h],
            [left_mouth[0] * w, left_mouth[1] * h],
            [right_mouth[0] * w, right_mouth[1] * h],
            [chin[0] * w, chin[1] * h]
        ], dtype="float32")
        
        # Calculate head position angles
        # Yaw: left-right head rotation
        eye_distance = np.linalg.norm(right_eye - left_eye)
        center_x = (right_eye[0] + left_eye[0]) / 2.0
        yaw = (nose[0] - center_x) * 90 / (eye_distance / 2.0) if eye_distance > 0 else 0
        
        # Pitch: up-down head rotation
        eye_center_y = (right_eye[1] + left_eye[1]) / 2.0
        pitch = (nose[1] - eye_center_y) * 90 / (eye_distance / 2.0) if eye_distance > 0 else 0
        
        # Roll: head tilt
        eye_angle = np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])
        roll = np.degrees(eye_angle)
        
        return {
            "pitch": float(pitch),
            "yaw": float(yaw),
            "roll": float(roll)
        }
    
    def _detect_head_movement(self) -> Tuple[bool, str]:
        """
        Detect if head has moved sufficiently
        
        Returns:
            Tuple of (movement_detected, movement_type)
        """
        if len(self.head_pose_history) < 15:
            return False, "insufficient_frames"
        
        head_poses = list(self.head_pose_history)
        pitch_range = max(p["pitch"] for p in head_poses) - min(p["pitch"] for p in head_poses)
        yaw_range = max(p["yaw"] for p in head_poses) - min(p["yaw"] for p in head_poses)
        roll_range = max(p["roll"] for p in head_poses) - min(p["roll"] for p in head_poses)
        
        movement_type = ""
        if yaw_range > self.head_movement_threshold:
            movement_type = "left_right"
        if pitch_range > self.head_movement_threshold:
            movement_type = "up_down"
        if roll_range > 10.0:
            movement_type = "tilt"
        
        return len(movement_type) > 0, movement_type
    
    def _detect_eye_movement(self) -> bool:
        """
        Detect if eyes have moved sufficiently
        
        Returns:
            True if eyes moved, False otherwise
        """
        if len(self.eye_center_history) < 15:
            return False
        
        eye_centers = list(self.eye_center_history)
        x_coords = [ec[0] for ec in eye_centers]
        y_coords = [ec[1] for ec in eye_centers]
        
        x_range = max(x_coords) - min(x_coords)
        y_range = max(y_coords) - min(y_coords)
        
        return x_range > self.eye_movement_threshold or y_range > self.eye_movement_threshold
    
    def process_frame(self, frame: np.ndarray) -> Dict[str, Any]:
        """
        Process a frame for liveness detection
        
        Args:
            frame: Input frame (BGR format from OpenCV)
            
        Returns:
            Dictionary containing liveness detection results
        """
        h, w, c = frame.shape
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process with face mesh
        results = self.face_mesh.process(rgb_frame)
        
        detection_results = {
            "face_detected": False,
            "blinks": self.blink_count,
            "blinks_required": self.blink_count_required,
            "eye_aspect_ratio": 0.0,
            "head_pose": {"pitch": 0, "yaw": 0, "roll": 0},
            "head_movement_detected": False,
            "head_movement_type": "",
            "eye_movement_detected": False,
            "is_alive": False,
            "confidence": 0.0,
            "message": ""
        }
        
        if results.multi_face_landmarks:
            landmarks = results.multi_face_landmarks[0]
            landmarks_array = np.array([[lm.x, lm.y, lm.z] for lm in landmarks.landmark])
            
            detection_results["face_detected"] = True
            
            # Extract eye landmarks (indices from MediaPipe FaceMesh)
            # Right eye: 33, 160, 158, 133, 153, 144
            # Left eye: 263, 387, 385, 362, 380, 374
            right_eye = landmarks_array[[33, 160, 158, 133, 153, 144]][:, :2]
            left_eye = landmarks_array[[263, 387, 385, 362, 380, 374]][:, :2]
            
            # Calculate eye aspect ratios
            right_ear = self._calculate_eye_aspect_ratio(right_eye)
            left_ear = self._calculate_eye_aspect_ratio(left_eye)
            avg_ear = (right_ear + left_ear) / 2.0
            
            detection_results["eye_aspect_ratio"] = float(avg_ear)
            
            # Detect blink
            self._detect_blink(right_ear, left_ear)
            detection_results["blinks"] = self.blink_count
            
            # Calculate head pose
            head_pose = self._calculate_head_pose(landmarks_array, (h, w))
            self.head_pose_history.append(head_pose)
            detection_results["head_pose"] = head_pose
            
            # Detect head movement
            head_moved, movement_type = self._detect_head_movement()
            detection_results["head_movement_detected"] = head_moved
            detection_results["head_movement_type"] = movement_type
            
            # Track eye center for movement detection
            left_eye_center = landmarks_array[468][:2]  # Iris center
            right_eye_center = landmarks_array[473][:2]
            avg_eye_center = (left_eye_center + right_eye_center) / 2.0
            self.eye_center_history.append(avg_eye_center)
            
            # Detect eye movement
            eye_moved = self._detect_eye_movement()
            detection_results["eye_movement_detected"] = eye_moved
            
            # Determine liveness based on all factors
            detection_results = self._evaluate_liveness(detection_results)
        
        self.frame_buffer.append(detection_results)
        return detection_results
    
    def _evaluate_liveness(self, results: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluate overall liveness based on multiple factors
        
        Args:
            results: Dictionary with detection results
            
        Returns:
            Updated results dictionary with liveness decision
        """
        is_alive = False
        confidence = 0.0
        message_parts = []
        
        # Factor 1: Blink detection (40% weight)
        blink_passed = results["blinks"] >= self.blink_count_required
        blink_score = min(results["blinks"] / max(self.blink_count_required, 1), 1.0) * 0.4
        
        if blink_passed:
            message_parts.append("✓ Blinks detected")
        else:
            message_parts.append(f"✗ Blinks: {results['blinks']}/{self.blink_count_required}")
        
        # Factor 2: Eye movement (30% weight)
        eye_move_passed = results["eye_movement_detected"]
        eye_move_score = 0.3 if eye_move_passed else 0.0
        
        if eye_move_passed:
            message_parts.append("✓ Eye movement detected")
        else:
            message_parts.append("✗ No eye movement")
        
        # Factor 3: Head movement (30% weight)
        head_move_passed = results["head_movement_detected"]
        head_move_score = 0.3 if head_move_passed else 0.0
        
        if head_move_passed:
            message_parts.append(f"✓ Head moved ({results['head_movement_type']})")
        else:
            message_parts.append("✗ Head not moved")
        
        # Overall liveness: need at least 2 out of 3 factors
        factors_passed = sum([blink_passed, eye_move_passed, head_move_passed])
        is_alive = factors_passed >= 2
        confidence = min(blink_score + eye_move_score + head_move_score, 1.0)
        
        results["is_alive"] = is_alive
        results["confidence"] = float(confidence)
        results["message"] = " | ".join(message_parts)
        
        return results
    
    def reset(self) -> None:
        """Reset tracking variables for new session"""
        self.blink_count = 0
        self.eye_closed_frames = 0
        self.prev_eye_aspect_ratio = None
        self.head_pose_history.clear()
        self.eye_center_history.clear()
        self.frame_buffer.clear()
    
    def get_summary(self) -> Dict[str, Any]:
        """
        Get summary of liveness detection results from buffered frames
        
        Returns:
            Summary dictionary
        """
        if not self.frame_buffer:
            return {
                "frames_analyzed": 0,
                "total_blinks": 0,
                "is_alive_frames": 0,
                "alive_percentage": 0.0,
                "confidence": 0.0,
                "verdict": "Insufficient data"
            }
        
        frames = list(self.frame_buffer)
        alive_frames = sum(1 for f in frames if f.get("is_alive", False))
        avg_confidence = np.mean([f.get("confidence", 0.0) for f in frames])
        
        return {
            "frames_analyzed": len(frames),
            "total_blinks": self.blink_count,
            "is_alive_frames": alive_frames,
            "alive_percentage": (alive_frames / len(frames)) * 100 if frames else 0.0,
            "confidence": float(avg_confidence),
            "verdict": "ALIVE" if alive_frames / len(frames) > 0.7 else "SPOOF DETECTED"
        }


def draw_liveness_info(
    frame: np.ndarray,
    detection_results: Dict[str, Any],
    position: Tuple[int, int] = (10, 30)
) -> np.ndarray:
    """
    Draw liveness detection information on frame
    
    Args:
        frame: Input frame
        detection_results: Results from process_frame()
        position: Position to start drawing (x, y)
        
    Returns:
        Frame with drawn information
    """
    x, y = position
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.6
    thickness = 2
    line_height = 25
    
    # Color based on liveness
    color = (0, 255, 0) if detection_results.get("is_alive", False) else (0, 0, 255)
    
    # Draw liveness status
    status = "ALIVE ✓" if detection_results.get("is_alive", False) else "CHECKING"
    cv2.putText(frame, f"Liveness: {status}", (x, y), font, font_scale, color, thickness)
    
    y += line_height
    cv2.putText(
        frame,
        f"Blinks: {detection_results.get('blinks', 0)}/{detection_results.get('blinks_required', 2)}",
        (x, y),
        font,
        font_scale,
        (255, 255, 255),
        thickness
    )
    
    y += line_height
    eye_status = "Yes" if detection_results.get("eye_movement_detected", False) else "No"
    cv2.putText(frame, f"Eye Movement: {eye_status}", (x, y), font, font_scale, (255, 255, 255), thickness)
    
    y += line_height
    head_status = detection_results.get("head_movement_type", "No")
    cv2.putText(frame, f"Head Movement: {head_status}", (x, y), font, font_scale, (255, 255, 255), thickness)
    
    y += line_height
    confidence = detection_results.get("confidence", 0.0) * 100
    cv2.putText(frame, f"Confidence: {confidence:.1f}%", (x, y), font, font_scale, (255, 255, 255), thickness)
    
    return frame
