"""Transport-safe fuzzing hooks for the PR-only Prism mock suite.

The real staging suite intentionally does not load these hooks. They exist only
because Prism's Node HTTP boundary can leave connections open for generated
control/non-ASCII payloads before a contract response reaches Schemathesis.
"""

import schemathesis


def _printable(value):
    if isinstance(value, str):
        return "".join(character if 0x20 <= ord(character) <= 0x7E else "_" for character in value)
    if isinstance(value, bytes):
        return bytes(byte if 0x20 <= byte <= 0x7E else 0x5F for byte in value)
    if isinstance(value, list):
        return [_printable(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_printable(item) for item in value)
    if isinstance(value, dict):
        return {_printable(key): _printable(item) for key, item in value.items()}
    return value


@schemathesis.hook
def before_call(ctx, case, kwargs):
    # Mutate only the serialized mock request. Doing this as a generation hook
    # makes Hypothesis treat normalized values as duplicates and can trigger a
    # filter_too_much health check before the operation is exercised.
    case.body = _printable(case.body)
    if case.headers:
        case.headers = {key: _printable(value) for key, value in case.headers.items()}
    if case.query:
        case.query = {key: _printable(value) for key, value in case.query.items()}
    if case.path_parameters:
        case.path_parameters = {key: _printable(value) for key, value in case.path_parameters.items()}
    # Prism's mock enforces the apiKey security the contract declares, so an
    # authenticated operation answers 401 when its x-orderak-secret header is
    # absent. The mock never validates the secret's value; a deterministic
    # placeholder lets the fuzzing phase keep exercising response shapes instead
    # of failing on "missing authentication" for the first constrained operation
    # that happens to require a seller device credential.
    headers = dict(case.headers) if case.headers else {}
    headers["x-orderak-secret"] = "prism-mock"
    case.headers = headers
