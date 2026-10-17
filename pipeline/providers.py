"""Model access for the harness. One place that talks to the open-weight model.

Switch with MODEL_PROVIDER in .env:
  gemini            -> Gemma 4 via the Gemini API (MODEL_ID, GEMINI_API_KEY)
  openai_compatible -> any OpenAI-style endpoint serving an open-weight model, e.g. Ollama
                       (OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY)

Every call runs at temperature 0, is logged (for the run report) and cached on disk under
data/work/cache/ so re-runs are cheap and repeatable.
"""

import base64
import hashlib
import io
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

CACHE_DIR = ROOT / "data" / "work" / "cache"
MAX_IMAGE_SIDE = 2048  # pages are rendered at 200 dpi; downscale only for transport
MAX_ATTEMPTS = 6  # per model
PRIMARY_ATTEMPTS_WITH_FALLBACK = 3
REQUEST_TIMEOUT_S = 240
RETRYABLE = ("429", "500", "502", "503", "504", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "timeout", "Timeout", "Connection")


def log(msg: str) -> None:
    print(msg, flush=True)


@dataclass
class CallRecord:
    step: str
    model: str
    seconds: float
    cached: bool
    ok: bool
    error: str = ""


@dataclass
class CallLog:
    records: list[CallRecord] = field(default_factory=list)

    def summary(self) -> dict:
        live = [r for r in self.records if not r.cached]
        ok = [r for r in self.records if r.ok]
        return {
            "calls": len(self.records),
            "live_calls": len(live),
            "cached_calls": len(self.records) - len(live),
            "failed_calls": sum(not r.ok for r in self.records),
            "live_seconds": round(sum(r.seconds for r in live), 1),
            "answers_by_model": {m: sum(r.model == m for r in ok) for m in sorted({r.model for r in ok})},
        }


CALLS = CallLog()


def _image_bytes(img: Path | Image.Image) -> bytes:
    """JPEG bytes of a page image, longest side capped at MAX_IMAGE_SIDE."""
    im = Image.open(img) if isinstance(img, Path) else img
    im = im.convert("RGB")
    im.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class Provider:
    name = "base"
    model = ""
    fallback = ""  # optional second open-weight model, used only when `model` keeps failing

    def _generate(self, prompt: str, images: list[bytes], model: str) -> str:
        raise NotImplementedError

    def generate(self, prompt: str, images: list[Path | Image.Image] | None = None, step: str = "") -> str:
        """Send a prompt (+ page images) and return the raw text reply. Cached and logged.

        Raises RuntimeError if the primary and the fallback model both keep failing.
        """
        imgs = [_image_bytes(i) for i in images or []]
        img_digest = b"".join(hashlib.sha256(b).digest() for b in imgs)
        models = [m for m in (self.model, self.fallback) if m]
        cache_files = {
            m: CACHE_DIR / f"{hashlib.sha256(json.dumps([self.name, m, prompt]).encode() + img_digest).hexdigest()}.json"
            for m in models
        }
        # Any model's cached answer first, so re-runs are repeatable and need no live call.
        for model in models:
            if cache_files[model].exists():
                CALLS.records.append(CallRecord(step, model, 0.0, cached=True, ok=True))
                return json.loads(cache_files[model].read_text(encoding="utf-8"))["text"]

        last_err = ""
        for model in models:
            cache_file = cache_files[model]
            # With a fallback available, give up on the primary sooner (it is often overloaded).
            attempts = PRIMARY_ATTEMPTS_WITH_FALLBACK if model == self.model and self.fallback else MAX_ATTEMPTS
            for attempt in range(attempts):
                t0 = time.time()
                try:
                    text = self._generate(prompt, imgs, model)
                except Exception as e:  # network / quota / overload errors: back off and retry
                    last_err = f"{type(e).__name__}: {e}"
                    CALLS.records.append(CallRecord(step, model, time.time() - t0, cached=False, ok=False, error=last_err[:200]))
                    log(f"    [{step}] {model} attempt {attempt + 1} failed: {last_err[:80]}")
                    if not any(s in last_err for s in RETRYABLE):
                        raise
                    time.sleep(min(30, 5 * 2**attempt))
                    continue
                CALLS.records.append(CallRecord(step, model, time.time() - t0, cached=False, ok=True))
                log(f"    [{step}] {model} ok in {time.time() - t0:.0f}s")
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(json.dumps({"model": model, "step": step, "text": text}), encoding="utf-8")
                return text
        raise RuntimeError(f"model call failed after retries: {last_err}")


class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self) -> None:
        from google import genai

        from google.genai import types

        self.model = os.environ.get("MODEL_ID", "")
        self.fallback = os.environ.get("FALLBACK_MODEL_ID", "")
        if not self.model:
            raise RuntimeError("MODEL_ID is not set in .env (pick it from the Google AI Studio model list)")
        self.client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"], http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_S * 1000)
        )

    def _generate(self, prompt: str, images: list[bytes], model: str) -> str:
        from google.genai import types

        parts = [types.Part.from_bytes(data=b, mime_type="image/jpeg") for b in images] + [prompt]
        resp = self.client.models.generate_content(
            model=model,
            contents=parts,
            config=types.GenerateContentConfig(temperature=0),
        )
        return resp.text or ""


class OpenAICompatibleProvider(Provider):
    name = "openai_compatible"

    def __init__(self) -> None:
        from openai import OpenAI

        self.model = os.environ.get("OPENAI_MODEL", "gemma4:e4b")
        self.client = OpenAI(
            base_url=os.environ.get("OPENAI_BASE_URL", "http://localhost:11434/v1"),
            api_key=os.environ.get("OPENAI_API_KEY", "ollama"),
            timeout=REQUEST_TIMEOUT_S,
        )

    def _generate(self, prompt: str, images: list[bytes], model: str) -> str:
        content = [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b).decode()}}
            for b in images
        ] + [{"type": "text", "text": prompt}]
        resp = self.client.chat.completions.create(
            model=model, temperature=0, messages=[{"role": "user", "content": content}]
        )
        return resp.choices[0].message.content or ""


_PROVIDER: Provider | None = None


def get_provider() -> Provider:
    global _PROVIDER
    if _PROVIDER is None:
        kind = os.environ.get("MODEL_PROVIDER", "gemini")
        _PROVIDER = {"gemini": GeminiProvider, "openai_compatible": OpenAICompatibleProvider}[kind]()
    return _PROVIDER


if __name__ == "__main__":
    # Smoke test: python -m pipeline.providers [page.png]
    import sys

    p = get_provider()
    imgs = [Path(sys.argv[1])] if len(sys.argv) > 1 else []
    ask = 'Reply with JSON only: {"ok": true, "what_i_see": "<one short sentence>"}'
    print(p.name, p.model)
    print(p.generate(ask, imgs, step="smoke"))
    print(CALLS.summary())
