"""Camera capture: USB cameras, or network streams such as a phone running an
IP-webcam app. One background thread per camera keeps the newest frame."""
import sys
import threading
import time

import cv2


class Camera:
    def __init__(self, cam_id: int, device, width: int, height: int, fps: int):
        self.id = cam_id
        self.device = device
        self.frame = None
        self.ok = False
        self._size = (width, height, fps)
        self._stop = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _open(self):
        w, h, fps = self._size
        if isinstance(self.device, str):
            # A network stream, e.g. a phone running an "IP webcam" app:
            # http://192.168.1.50:8080/video. The phone decides size and rate.
            return cv2.VideoCapture(self.device)
        # A USB camera. V4L2 is the Linux (Raspberry Pi) camera system; on a
        # Mac or Windows laptop let OpenCV pick.
        cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2 if sys.platform == "linux" else cv2.CAP_ANY)
        # MJPG is essential: three raw (YUYV) 720p streams won't fit on one USB bus.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        cap.set(cv2.CAP_PROP_FPS, fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _run(self):
        cap = None
        while not self._stop:
            if cap is None or not cap.isOpened():
                cap = self._open()
            good, frame = cap.read()
            if good:
                self.frame, self.ok = frame, True
            else:
                self.ok = False
                cap.release()
                cap = None
                time.sleep(2)  # unplugged? keep retrying
        if cap is not None:
            cap.release()

    def stop(self):
        self._stop = True

    def join(self, timeout: float = 5):
        """Wait for a stopped camera to let go of its device."""
        self._thread.join(timeout)


def discover(max_index: int = 10) -> list[int]:
    """Find the camera numbers that deliver pictures. On Linux (the Pi) each
    UVC camera usually exposes two /dev/video nodes, only one of which does, so
    every number is tried. On a Mac or Windows cameras are numbered from 0
    without gaps and trying a missing one is slow, so the search stops after
    two in a row give nothing."""
    found = []
    linux = sys.platform == "linux"
    misses = 0
    for i in range(max_index):
        cap = cv2.VideoCapture(i, cv2.CAP_V4L2 if linux else cv2.CAP_ANY)
        if cap.isOpened() and cap.read()[0]:
            found.append(i)
            misses = 0
        else:
            misses += 1
        cap.release()
        if not linux and misses == 2:
            break
    return found
