# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""Checking a sign-in with Google or with Apple.

The page's sign-in button hands the page a token signed by Google or Apple
saying who the person is. The host must check it before believing it.
"""

APPLE = "https://appleid.apple.com"


class Rejected(Exception):
    pass


def check_google(credential: str, client_id: str) -> dict:
    """Who a sign-in token is for: {"sub": Google's number for the account,
    "email": its address, "name": the person's first name}. Raises Rejected
    unless Google signed it, for this app (client_id), and it has not run out."""
    # imported here so that everything else in the host can be tested without it installed
    from google.auth.transport import requests
    from google.oauth2 import id_token
    try:
        claims = id_token.verify_oauth2_token(credential, requests.Request(), client_id)
        return {"sub": claims["sub"], "email": claims.get("email", ""),
                "name": claims.get("given_name") or claims.get("name") or ""}
    except Exception as e:  # badly formed, wrong app, expired, Google unreachable
        raise Rejected(str(e))


_apple_keys = None


def _apple_key(credential: str):
    """The key of Apple's that signed this token (Apple's keys are fetched once and kept)."""
    import jwt
    global _apple_keys
    _apple_keys = _apple_keys or jwt.PyJWKClient(APPLE + "/auth/keys")
    return _apple_keys.get_signing_key_from_jwt(credential).key


def check_apple(credential: str, client_id: str) -> dict:
    """The same for a "Sign in with Apple" token; client_id is the Services ID.
    Apple's token never says the person's name, so "name" is always empty."""
    import jwt  # PyJWT, imported here for the same reason
    try:
        claims = jwt.decode(credential, _apple_key(credential), algorithms=["RS256"], audience=client_id,
                            issuer=APPLE, options={"require": ["exp", "iat", "sub"]})
        verified = claims.get("email_verified") in (True, "true")  # Apple has sent it both ways
        return {"sub": claims["sub"], "email": claims.get("email", "") if verified else "", "name": ""}
    except Exception as e:  # badly formed, wrong app, expired, Apple unreachable
        raise Rejected(str(e))
