# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Camera capture: USB cameras, or network streams such as a phone running an
IP-webcam app. One background thread per camera keeps the newest frame."""
import sys
import threading
import time

import cv2


def backend() -> int:
    """Which OpenCV camera system opens USB cameras. V4L2 is Linux's (the
    Raspberry Pi). On Windows it is DirectShow, not OpenCV's default Media
    Foundation: Media Foundation starts each camera uncompressed before MJPG
    can be asked for, and two uncompressed cameras sharing one USB hub don't
    fit, so the second won't open and only one camera ever shows a picture.
    DirectShow takes MJPG (see open_usb). On a Mac let OpenCV pick."""
    if sys.platform == "linux":
        return cv2.CAP_V4L2
    if sys.platform == "win32":
        return cv2.CAP_DSHOW
    return cv2.CAP_ANY


def open_usb(index: int, w: int, h: int, fps: int):
    """Open a USB camera in MJPG at w x h. MJPG is essential: three raw (YUYV)
    720p streams won't fit on one USB bus.

    On Windows DirectShow only takes MJPG, size and rate when they are passed
    in the open call: set afterwards, each camera has already started
    uncompressed, so behind one USB 2 hub only one of three gives pictures.
    If a camera won't open that way, it is opened plainly and asked after."""
    mjpg = cv2.VideoWriter_fourcc(*"MJPG")
    if sys.platform == "win32":
        params = [cv2.CAP_PROP_FOURCC, mjpg, cv2.CAP_PROP_FRAME_WIDTH, w,
                  cv2.CAP_PROP_FRAME_HEIGHT, h, cv2.CAP_PROP_FPS, fps]
        cap = cv2.VideoCapture(index, backend(), params)
        if cap.isOpened():
            return cap
        cap.release()
    cap = cv2.VideoCapture(index, backend())
    cap.set(cv2.CAP_PROP_FOURCC, mjpg)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    cap.set(cv2.CAP_PROP_FOURCC, mjpg)  # DirectShow can drop it when the size changes
    cap.set(cv2.CAP_PROP_FPS, fps)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


class Camera:
    def __init__(self, cam_id: int, device, width: int, height: int, fps: int):
        self.id = cam_id
        self.device = device
        self.frame = None
        self.ok = False
        self._size = (width, height, fps)
        self._stop = False
        self._awake = threading.Event()  # cleared: resting (standby), the device let go
        self._awake.set()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _open(self):
        w, h, fps = self._size
        if isinstance(self.device, str):
            # A network stream, e.g. a phone running an "IP webcam" app:
            # http://192.168.1.50:8080/video. The phone decides size and rate.
            return cv2.VideoCapture(self.device)
        return open_usb(self.device, w, h, fps)

    def _run(self):
        cap = None
        w, h, _ = self._size
        while not self._stop:
            if not self._awake.is_set():
                if cap is not None:
                    cap.release()
                    cap = None
                self.frame, self.ok = None, False
                self._awake.wait(1)
                continue
            if cap is None or not cap.isOpened():
                cap = self._open()
            good, frame = cap.read()
            if good:
                if not isinstance(self.device, str) and frame.shape[:2] != (h, w):
                    # A USB camera that can't give the size asked for: every
                    # picture is the size its calibration is saved at.
                    frame = cv2.resize(frame, (w, h))
                self.frame, self.ok = frame, True
            else:
                self.ok = False
                cap.release()
                cap = None
                time.sleep(2)  # unplugged? keep retrying
        if cap is not None:
            cap.release()

    def sleep(self):
        """Rest: let go of the camera until wake()."""
        self._awake.clear()

    def wake(self):
        self._awake.set()

    def stop(self):
        self._stop = True
        self._awake.set()

    def join(self, timeout: float = 5):
        """Wait for a stopped camera to let go of its device."""
        self._thread.join(timeout)


def discover(max_index: int = 10, size: tuple = (1280, 720, 15)) -> list[int]:
    """Find the camera numbers that deliver pictures. On Linux (the Pi) each
    UVC camera usually exposes two /dev/video nodes, only one of which does, so
    every number is tried. On a Mac or Windows cameras are numbered from 0
    without gaps and trying a missing one is slow, so the search stops after
    two in a row give nothing."""
    found = []
    linux = sys.platform == "linux"
    misses = 0
    for i in range(max_index):
        # The same camera system as Camera uses, so the numbers match. On
        # Windows opened just as Camera opens it, so a camera that only gives
        # pictures in MJPG isn't missed.
        cap = open_usb(i, *size) if sys.platform == "win32" else cv2.VideoCapture(i, backend())
        if cap.isOpened() and cap.read()[0]:
            found.append(i)
            misses = 0
        else:
            misses += 1
        cap.release()
        if not linux and misses == 2:
            break
    return found
