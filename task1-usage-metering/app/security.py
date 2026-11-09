import hashlib
import hmac


def sign(secret: bytes, body: bytes) -> str:
    return hmac.new(secret, body, hashlib.sha256).hexdigest()


def verify_signature(secret: bytes, body: bytes, signature_header: str | None) -> bool:
    """Check X-Signature against an HMAC-SHA256 of the raw body bytes.

    The body must be the exact bytes received. Parsing and re-serialising the
    JSON first can reorder keys or change whitespace and break the check.
    """
    if not signature_header:
        return False
    received = signature_header.strip().lower().encode()
    expected = sign(secret, body).encode()
    return hmac.compare_digest(expected, received)


def is_valid_api_key(candidate: str, valid_keys: tuple[str, ...]) -> bool:
    # Check every key (no early return) so timing doesn't reveal which one matched.
    matched = False
    for key in valid_keys:
        if hmac.compare_digest(candidate.encode(), key.encode()):
            matched = True
    return matched
