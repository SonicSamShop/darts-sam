# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Which cameras run, and what each is called.

Every camera has a name that stays the same from one start to the next: a
network stream's name is its address, a USB camera's is "usb:" and its number.
Calibration and "switched off" are saved in config.json under that name, so
adding or removing one camera never moves another's calibration. (While
running, cameras are still numbered 0, 1, 2… in the order they are listed here;
app.py translates.)
"""
from urllib.parse import urlsplit

SCHEMES = ("http", "https", "rtsp")


def name(device) -> str:
    return f"usb:{device}" if isinstance(device, int) else device


def device(name: str):
    """What OpenCV opens: a camera number, or a stream address."""
    return int(name[4:]) if kind(name) == "usb" else name


def kind(name: str) -> str:
    return "usb" if name.startswith("usb:") else "added"


def label(name: str) -> str:
    if kind(name) == "usb":
        return f"USB camera {device(name) + 1}"
    return f"Phone {urlsplit(name).hostname or name}"


def clean_address(text: str) -> str:
    """A stream address as someone typed it, tidied; ValueError says what is wrong with it."""
    example = "Type the address the phone app shows, such as http://192.168.1.50:8080/video."
    text = text.strip()
    if not text or text.startswith("usb:") or text.isdigit():
        raise ValueError(example)
    if "://" not in text:
        text = "http://" + text  # phone apps show it both ways
    scheme, rest = text.split("://", 1)
    text = f"{scheme.lower()}://{rest}"
    if scheme.lower() not in SCHEMES:
        raise ValueError("The address must start with http://, https:// or rtsp://.")
    try:
        host = urlsplit(text).hostname
    except ValueError:
        host = None
    if not host:
        raise ValueError(example)
    return text


def running(found: list[int], added: list[str], off: list[str]) -> list:
    """The devices to open: the USB cameras found, then the saved addresses,
    leaving out any that are switched off."""
    return [device(n) for n in [*map(name, found), *added] if n not in off]


def adopt(calibration: dict, names: list[str]) -> bool:
    """config.json used to save calibration by position ("0", "1", "2"). Move
    each to the camera now in that position; one with no camera there waits.
    True if anything moved."""
    moved = False
    for key in [k for k in calibration if k.isdigit()]:
        i = int(key)
        if i < len(names) and names[i] not in calibration:
            calibration[names[i]] = calibration.pop(key)
            moved = True
    return moved
