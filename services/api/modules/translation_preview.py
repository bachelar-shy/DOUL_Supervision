"""Optional local Gemma 4 translation preview; never mutates official records."""
from __future__ import annotations

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import Request
from fastapi.responses import JSONResponse

MAX_CHARS = 3000
MODEL = "doul-gemma4-v2-agentic:q4"
DEFAULT_URL = "http://127.0.0.1:11434/api/generate"
PROTECTED = re.compile(r"(?<![\w])(?:(?:[A-Z]{1,5}-\d+(?:[A-Z0-9.]*))|\d+(?:[.,]\d+)*)(?![\w])")


def protected_tokens(value):
    return sorted(PROTECTED.findall(value))


def translate_text(text, source, target, *, endpoint=None, model=None, timeout=75):
    if source not in ("ko", "vi") or target not in ("ko", "vi") or source == target:
        raise ValueError("TRANSLATION_LANGUAGE_INVALID")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_CHARS:
        raise ValueError("TRANSLATION_TEXT_INVALID")
    endpoint = endpoint or os.getenv("DOUL_TRANSLATION_OLLAMA_URL", DEFAULT_URL)
    parsed = urlparse(endpoint)
    # Avoid server-side requests to arbitrary endpoints.
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.path != "/api/generate":
        raise ValueError("TRANSLATION_BACKEND_INVALID")
    model = model or os.getenv("DOUL_TRANSLATION_MODEL", MODEL)
    prompt = (
        "You translate construction supervision site records accurately. "
        "Translate ONLY from " + source + " to " + target + ". "
        "Preserve drawing references, dates, quantities, units, requirements, "
        "negative meanings, and approval status. Never invent information. "
        "Return only the translation, without markdown.\nSOURCE:\n" + text
    )
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": 480},
        "keep_alive": "1m",
    }, ensure_ascii=False).encode("utf-8")
    req = UrlRequest(endpoint, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read(200000).decode("utf-8"))
    translated = body.get("response", "").strip()
    if not translated:
        raise ValueError("TRANSLATION_EMPTY")
    tokens_match = protected_tokens(text) == protected_tokens(translated)
    return {
        "original": text,
        "translated": translated,
        "sourceLanguage": source,
        "targetLanguage": target,
        "model": model,
        "reviewStatus": "automatic_unverified",
        "protectedTokensMatch": tokens_match,
        "usableForOfficialIssue": False,
        "metrics": {
            "totalDurationMs": round(body.get("total_duration", 0) / 1e6),
            "outputTokens": body.get("eval_count", 0),
        },
    }


def install_translation_routes(app, store, *, identity, role_for):
    @app.post("/projects/{project_id}/parallel/translation/preview")
    async def translation_preview(project_id: str, request: Request):
        try:
            actor = identity(request)
            # Enforce real project membership before model invocation; never
            # send a record to the model merely because the browser knows an ID.
            with store.transaction():
                role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
            raw = await request.body()
            if len(raw) > 16000:
                return JSONResponse({"code": "TRANSLATION_TEXT_INVALID"}, status_code=422)
            body = json.loads(raw)
            if not isinstance(body, dict) or set(body) != {"text", "sourceLanguage", "targetLanguage"}:
                return JSONResponse({"code": "TRANSLATION_REQUEST_INVALID"}, status_code=422)
            value = translate_text(body["text"], body["sourceLanguage"], body["targetLanguage"])
            return JSONResponse(value, headers={"Cache-Control": "no-store"})
        except ValueError as exc:
            return JSONResponse({"code": str(exc)}, status_code=422)
        except (URLError, HTTPError, TimeoutError, OSError, KeyError, json.JSONDecodeError):
            return JSONResponse({"code": "TRANSLATION_SERVICE_UNAVAILABLE"}, status_code=503)
