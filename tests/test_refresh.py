"""Looking for the cameras again without a restart (POST /api/cameras/refresh).
Run: python -m tests.test_refresh"""
from fastapi import HTTPException

from server import app


PTS = [[0, 0], [100, 0], [100, 100], [0, 100]]


class FakeCamera:
    made, dead = [], set()  # dead: devices that never deliver a picture

    def __init__(self, cam_id, device, width, height, fps):
        self.id, self.device, self.frame = cam_id, device, None
        self.ok = device not in FakeCamera.dead
        self.stopped = self.joined = False
        FakeCamera.made.append(self)

    def stop(self):
        self.stopped = True

    def join(self, timeout=None):
        assert self.stopped  # told to stop before being waited for
        self.joined = True


def refused(code, fn, *a):
    try:
        fn(*a)
    except HTTPException as e:
        assert e.status_code == code, e.status_code
        return e.detail
    raise AssertionError("not refused")


def main():
    plugged = [0]

    def discover():
        # a device still held by an old camera could not be found again
        assert all(c.joined for c in app.cams.values())
        return list(plugged)

    app.cameras.Camera, app.cameras.discover = FakeCamera, discover
    app.config.update(devices=None, added=[], off=[], calibration={"0": PTS})
    app.save_config = lambda: None

    # started with --no-cameras: refreshing must not switch them on
    app.cameras_on = False
    try:
        app.refresh_cameras()
        raise AssertionError("refreshed with cameras switched off")
    except HTTPException as e:
        assert e.status_code == 409
    assert not app.cams
    refused(409, app.add_camera, app.Address(address="http://phone/video"))
    assert app.config["added"] == []

    # never paired with the online site: nothing here may contact it
    def no_network(*a, **k):
        raise AssertionError("an unpaired server tried to reach the online site")
    app.link.Link = app.link.pair = no_network
    assert app.link_status() == {"host": "https://app.dartssam.co.uk", "paired": False, "connected": False, "code": None, "url": None}
    app.config["host"] = "https://my-own.example"  # someone running their own site
    assert app.link_status()["host"] == "https://my-own.example"
    app.config["host"], app.link.DEFAULT_HOST = None, None  # and with no site at all, pairing says so
    assert app.link_status()["host"] is None
    assert "No address is set" in refused(409, app.start_pairing)
    app.link.DEFAULT_HOST = "https://app.dartssam.co.uk"
    assert app.unlink() == {"ok": True} and app.config["link"] is None
    # ...and its problem reports stay on this machine: nothing marks them to be sent
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        real, app.report.DIR = app.report.DIR, Path(tmp)
        (Path(tmp) / "r1").mkdir()
        app.send_report("r1")
        app.send_report("r1", noted=True)
        assert [p.name for p in (Path(tmp) / "r1").iterdir()] == []
        # paired: a new report waits for its note, and the note sends it
        app.config["link"] = {"token": "t"}
        app.send_report("r1")
        assert (Path(tmp) / "r1" / "upload").read_text() == "wait"
        app.send_report("r1", noted=True)
        assert (Path(tmp) / "r1" / "upload").read_text() == "now"
        app.config["link"] = None
        app.report.DIR = real
    assert app.uploader is None

    # startup finds one camera
    app.cameras_on = True
    app.start_cameras()
    first = app.cams[0]
    assert [c.device for c in app.cams.values()] == [0]
    assert app.scoring_cameras() == 1

    # calibration saved by position in an old config.json now belongs to that camera
    assert app.config["calibration"] == {"usb:0": PTS}
    s = app.status()
    assert s["cameras"][0] == {"id": 0, "ok": True, "points": PTS,
                               "name": "usb:0", "label": "USB camera 1", "kind": "usb"}
    assert s["off"] == [] and s["fixed"] is False
    assert app.key(0) == "usb:0" and app.calibration_by_id() == {"0": PTS}

    # a second is plugged in: a refresh lets go of the old ones and finds both
    plugged.append(2)
    r = app.refresh_cameras()
    assert first.stopped and first.joined
    assert app.cams[0] is not first
    assert [c.device for c in app.cams.values()] == [0, 2]
    assert [c["id"] for c in r["cameras"]] == [0, 1]
    assert r["scoring"] == 1  # the new one is not calibrated yet

    # all unplugged: none left, and none counted as scoring
    plugged.clear()
    r = app.refresh_cameras()
    assert r["cameras"] == [] and r["scoring"] == 0 and not app.cams

    # a saved phone runs after the USB cameras, and each keeps its own calibration
    plugged[:] = [0, 2]
    app.config["added"] = ["http://phone/video"]
    app.config["calibration"]["http://phone/video"] = PTS
    r = app.refresh_cameras()
    assert [c["name"] for c in r["cameras"]] == ["usb:0", "usb:2", "http://phone/video"]
    assert [bool(c["points"]) for c in r["cameras"]] == [True, False, True]
    assert sorted(app.tracker.H) == [0, 2] and r["scoring"] == 2

    # one USB camera unplugged: the phone moves up an id and its calibration goes with it
    plugged[:] = [2]
    r = app.refresh_cameras()
    assert [c["name"] for c in r["cameras"]] == ["usb:2", "http://phone/video"]
    assert sorted(app.tracker.H) == [1]

    # switched off: not run, listed as off
    app.config["off"] = ["usb:2"]
    r = app.refresh_cameras()
    assert [c["name"] for c in r["cameras"]] == ["http://phone/video"]
    assert r["off"] == [{"name": "usb:2", "label": "USB camera 3", "kind": "usb"}]

    # calibration for a camera that isn't there is kept, and counts for nothing
    app.config.update(added=[], off=[])
    app.config["calibration"]["usb:9"] = PTS
    plugged.clear()
    r = app.refresh_cameras()
    assert r["cameras"] == [] and r["scoring"] == 0 and "usb:9" in app.config["calibration"]

    # --- changing the cameras from the app ---
    plugged[:] = [0]
    app.config.update(added=[], off=[], calibration={"usb:0": PTS})
    app.refresh_cameras()

    # add a phone, typed without http://
    r = app.add_camera(app.Address(address=" phone:8080/video "))
    assert app.config["added"] == ["http://phone:8080/video"]
    assert [c["name"] for c in r["cameras"]] == ["usb:0", "http://phone:8080/video"]
    assert r["cameras"][1]["kind"] == "added" and r["scoring"] == 1
    assert refused(409, app.add_camera, app.Address(address="http://phone:8080/video"))
    assert refused(400, app.add_camera, app.Address(address="ftp://x/y"))
    assert app.config["added"] == ["http://phone:8080/video"]

    # an address nothing answers at: listed, not ok, and nothing else disturbed
    FakeCamera.dead.add("http://nowhere/video")
    r = app.add_camera(app.Address(address="http://nowhere/video"))
    assert [(c["name"], c["ok"]) for c in r["cameras"]] == [
        ("usb:0", True), ("http://phone:8080/video", True), ("http://nowhere/video", False)]
    assert r["cameras"][0]["points"] == PTS and r["scoring"] == 1

    # calibrate the phone, then remove the dead one: calibration stays put
    app.calibrate(1, app.Calibration(points=PTS))
    r = app.remove_camera(app.CameraName(name="http://nowhere/video"))
    assert app.config["added"] == ["http://phone:8080/video"]
    assert [bool(c["points"]) for c in r["cameras"]] == [True, True]
    refused(404, app.remove_camera, app.CameraName(name="usb:0"))  # USB can't be removed
    refused(404, app.remove_camera, app.CameraName(name="http://nowhere/video"))

    # switch the USB camera off: the phone becomes id 0 and is still calibrated
    r = app.enable_camera(app.CameraOn(name="usb:0", on=False))
    assert app.config["off"] == ["usb:0"]
    assert [c["name"] for c in r["cameras"]] == ["http://phone:8080/video"] and r["scoring"] == 1
    assert [o["name"] for o in r["off"]] == ["usb:0"]
    app.enable_camera(app.CameraOn(name="usb:0", on=False))  # twice is harmless
    assert app.config["off"] == ["usb:0"]
    refused(404, app.enable_camera, app.CameraOn(name="usb:7", on=False))

    # unplugged while off: gone from the list, still off when it comes back
    plugged.clear()
    r = app.refresh_cameras()
    assert r["off"] == [] and app.config["off"] == ["usb:0"]
    plugged[:] = [0]
    r = app.refresh_cameras()
    assert [o["name"] for o in r["off"]] == ["usb:0"]
    r = app.enable_camera(app.CameraOn(name="usb:0", on=True))
    assert app.config["off"] == [] and r["cameras"][0]["points"] == PTS  # its calibration was kept

    # removing an added camera forgets its calibration and its off switch
    app.enable_camera(app.CameraOn(name="http://phone:8080/video", on=False))
    app.remove_camera(app.CameraName(name="http://phone:8080/video"))
    assert app.config["added"] == [] and app.config["off"] == []
    assert "http://phone:8080/video" not in app.config["calibration"]

    # a change while another is under way is refused and changes nothing
    app.refreshing.acquire()
    try:
        assert refused(409, app.add_camera, app.Address(address="http://late/video")) == "Already looking for cameras."
        assert app.config["added"] == []
    finally:
        app.refreshing.release()

    # cameras named on the command line win over auto-detect, as at startup
    app.sources = ["http://phone/video"]
    app.refresh_cameras()
    assert [c.device for c in app.cams.values()] == ["http://phone/video"]
    assert app.fixed() and app.status()["fixed"] is True
    refused(409, app.add_camera, app.Address(address="http://other/video"))
    refused(409, app.enable_camera, app.CameraOn(name="http://phone/video", on=False))
    assert app.config["added"] == [] and app.config["off"] == []
    # the app still calibrates by id; the file keeps it under the camera's name
    app.calibrate(0, app.Calibration(points=PTS))
    assert app.config["calibration"]["http://phone/video"] == PTS
    try:
        app.key(5)
        raise AssertionError("named a camera that isn't there")
    except HTTPException as e:
        assert e.status_code == 404
    print("OK")


if __name__ == "__main__":
    main()
