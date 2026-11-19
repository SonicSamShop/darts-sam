"""Checking a "Sign in with Apple" token. Run: python -m tests.test_auth"""
import time

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from server import auth


def main():
    apples, someone = rsa.generate_private_key(65537, 2048), rsa.generate_private_key(65537, 2048)
    auth._apple_key = lambda credential: apples.public_key()  # in place of fetching Apple's keys
    now = int(time.time())
    good = {"iss": "https://appleid.apple.com", "aud": "uk.co.dartssam.web", "sub": "000123.abc.456",
            "iat": now, "exp": now + 600, "email": "ann@example.com", "email_verified": "true"}

    def token(changes=None, key=apples, alg="RS256"):
        return jwt.encode({**good, **(changes or {})}, key, algorithm=alg)

    def rejected(credential):
        try:
            auth.check_apple(credential, "uk.co.dartssam.web")
        except auth.Rejected:
            return True
        return False

    assert auth.check_apple(token(), "uk.co.dartssam.web") == {"sub": "000123.abc.456", "email": "ann@example.com", "name": ""}
    # an address Apple has not checked is not believed (it decides who is an admin)
    assert auth.check_apple(token({"email_verified": "false"}), "uk.co.dartssam.web")["email"] == ""
    assert auth.check_apple(token({"email_verified": True}), "uk.co.dartssam.web")["email"] == "ann@example.com"

    assert rejected("garbage")
    assert rejected(token(key=someone))                          # not signed by Apple
    assert rejected(token({"aud": "some.other.app"}))            # meant for another app
    assert rejected(token({"iss": "https://evil.example"}))
    assert rejected(token({"exp": now - 600}))                   # run out
    assert rejected(jwt.encode(good, "secret", algorithm="HS256"))  # signed some other way
    no_sub = {k: v for k, v in good.items() if k != "sub"}
    assert rejected(jwt.encode(no_sub, apples, algorithm="RS256"))
    print("OK")


if __name__ == "__main__":
    main()
