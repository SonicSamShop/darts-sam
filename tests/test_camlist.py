# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Camera names, labels and which cameras run. Run: python -m tests.test_camlist"""
from server import camlist


def discover_off_the_pi():
    from server import cameras

    class Cap:
        opened = []

        def __init__(self, index, backend=None):
            self.index = index
            Cap.opened.append(index)

        def isOpened(self):
            return self.index in (0, 1, 2)

        def read(self):
            return (self.index in (0, 2), None)  # 1 opens but gives no picture

        def release(self):
            pass

    real = cameras.cv2.VideoCapture, cameras.sys.platform
    cameras.cv2.VideoCapture, cameras.sys.platform = Cap, "darwin"
    try:
        assert cameras.discover() == [0, 2]
        assert Cap.opened == [0, 1, 2, 3, 4]  # stopped after 3 and 4 both failed
    finally:
        cameras.cv2.VideoCapture, cameras.sys.platform = real


def windows_uses_directshow():
    """On Windows OpenCV's default (Media Foundation) starts each camera
    uncompressed, so only one fits through a USB hub: DirectShow takes MJPG.
    Finding and opening must use the same system, or the numbers differ."""
    from server import cameras

    class Cap:
        used = []

        def __init__(self, index, backend=None):
            Cap.used.append(backend)

        def isOpened(self):
            return False

        def read(self):
            return False, None

        def set(self, *a):
            return True

        def release(self):
            pass

    real = cameras.cv2.VideoCapture, cameras.sys.platform
    cameras.cv2.VideoCapture, cameras.sys.platform = Cap, "win32"
    try:
        cameras.discover()
        cam = cameras.Camera.__new__(cameras.Camera)  # without its thread
        cam.device, cam._size = 0, (1280, 720, 15)
        cam._open()
        assert Cap.used and set(Cap.used) == {cameras.cv2.CAP_DSHOW}
        cameras.sys.platform = "linux"
        assert cameras.backend() == cameras.cv2.CAP_V4L2
        cameras.sys.platform = "darwin"
        assert cameras.backend() == cameras.cv2.CAP_ANY
    finally:
        cameras.cv2.VideoCapture, cameras.sys.platform = real


def main():
    assert camlist.name(2) == "usb:2"
    assert camlist.name("http://192.168.1.50:8080/video") == "http://192.168.1.50:8080/video"
    assert camlist.device("usb:2") == 2
    assert camlist.device("rtsp://cam/1") == "rtsp://cam/1"
    assert camlist.kind("usb:0") == "usb" and camlist.kind("http://x/video") == "added"
    assert camlist.label("usb:0") == "USB camera 1"
    assert camlist.label("http://192.168.1.50:8080/video") == "Phone 192.168.1.50"

    # addresses as people type them
    assert camlist.clean_address("  http://192.168.1.50:8080/video ") == "http://192.168.1.50:8080/video"
    assert camlist.clean_address("192.168.1.50:8080/video") == "http://192.168.1.50:8080/video"
    assert camlist.clean_address("RTSP://cam/1") == "rtsp://cam/1"
    for bad in ["", "   ", "ftp://x/video", "http://", "usb:0", "3"]:
        try:
            camlist.clean_address(bad)
            raise AssertionError(f"accepted {bad!r}")
        except ValueError as e:
            assert str(e)  # a sentence the app can show

    # USB found first, then added, leaving out any switched off
    assert camlist.running([0, 2], ["http://p/video"], []) == [0, 2, "http://p/video"]
    assert camlist.running([0, 2], ["http://p/video"], ["usb:0"]) == [2, "http://p/video"]
    assert camlist.running([], ["http://p/video"], ["http://p/video"]) == []
    assert camlist.running([], [], []) == []

    # calibration saved by position (old files) moves to the camera in that position
    cal = {"0": "A", "1": "B", "2": "C"}
    assert camlist.adopt(cal, ["usb:0", "usb:2"]) is True
    assert cal == {"usb:0": "A", "usb:2": "B", "2": "C"}  # no third camera yet: kept
    assert camlist.adopt(cal, ["usb:0", "usb:2"]) is False  # nothing left to move
    assert camlist.adopt(cal, ["usb:0", "usb:2", "http://p/video"]) is True
    assert cal == {"usb:0": "A", "usb:2": "B", "http://p/video": "C"}
    # never overwrite a calibration the camera already has
    cal = {"0": "old", "usb:0": "new"}
    assert camlist.adopt(cal, ["usb:0"]) is False and cal == {"0": "old", "usb:0": "new"}
    discover_off_the_pi()
    windows_uses_directshow()
    print("OK")


if __name__ == "__main__":
    main()
