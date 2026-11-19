"""Signs a desktop app build, so the apps' Update can tell it is genuine (server/release.py).

  python tools/sign_release.py new-key
      Makes the signing key, once. The public half is written to release-key.pub
      (commit it: every build carries it). The private half is printed, once:
      paste it into GitHub as a repository secret named RELEASE_SIGNING_KEY
      (Settings → Secrets and variables → Actions → New repository secret) and
      keep it nowhere else. Anyone who has it can make updates the apps accept.

  python tools/sign_release.py sign APP FILE
      Run by the build workflows (.github/workflows) with the secret in
      RELEASE_SIGNING_KEY. APP is the app's name on the site (windows, mac-arm64,
      mac-x86_64, linux). Writes FILE.sig next to FILE, for tools/fetch_apps.py.
      With no key (a fork's builds) it says so and signs nothing.

Needs: pip install cryptography
"""
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.release import load, public_key, signed_text  # noqa: E402

APPS = ("windows", "mac-arm64", "mac-x86_64", "linux")


def new_key():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    pub_file = ROOT / "release-key.pub"
    if pub_file.exists():
        sys.exit(f"{pub_file} already exists. Making a new key means apps already out there can't update "
                 "to anything signed with it; delete the file first if that is really what you want.")
    private = Ed25519PrivateKey.generate()
    raw = private.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    pub_file.write_text(base64.b64encode(public).decode() + "\n")
    print(f"Wrote the public key to {pub_file}: commit it.\n")
    print("The private key, for the GitHub secret RELEASE_SIGNING_KEY (shown once, not saved anywhere):\n")
    print(base64.b64encode(raw).decode())


def sign(app: str, file: Path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    if app not in APPS:
        sys.exit(f"APP is one of {', '.join(APPS)}")
    secret = os.environ.get("RELEASE_SIGNING_KEY", "").strip()
    if not secret:
        print("No RELEASE_SIGNING_KEY: the build is not signed, and the apps will not update to it.")
        return
    private = Ed25519PrivateKey.from_private_bytes(base64.b64decode(secret, validate=True))
    mine = private.public_key().public_bytes_raw()
    if public_key() != mine:
        sys.exit("RELEASE_SIGNING_KEY is not the key whose public half is in release-key.pub")
    h = hashlib.sha256()
    with open(file, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    version = load(ROOT / "release.json")["version"]
    signature = base64.b64encode(private.sign(signed_text(app, version, h.hexdigest()))).decode()
    out = file.with_name(file.name + ".sig")
    out.write_text(json.dumps({"app": app, "version": version, "sha256": h.hexdigest(), "signature": signature}, indent=1))
    print(f"Signed {file.name}: {app} {version}, sha256 {h.hexdigest()}")


def main():
    args = sys.argv[1:]
    if args == ["new-key"]:
        new_key()
    elif len(args) == 3 and args[0] == "sign":
        sign(args[1], Path(args[2]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
