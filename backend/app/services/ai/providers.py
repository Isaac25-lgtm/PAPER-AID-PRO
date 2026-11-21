"""LLM + embedding provider adapters behind one small interface.

- Anthropic: official `anthropic` SDK, Claude Opus 5.5 by default, structured JSON output via
  `output_config.format`, server-side refusal fallback enabled (`fallbacks="default"`).
- OpenAI / Gemini: their public REST APIs over httpx. These require AI_MODEL / EMBEDDING_MODEL to be set
  explicitly (no guessed defaults).

Nothing here fabricates output: if no provider is configured, callers get AINotConfigured (HTTP 503).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

import anthropic
import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import AINotConfigured, AIOutputInvalid, AIRefused, RateLimited, UpstreamError

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5"
OPENAI_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"  # native 1536 dimensions


@dataclass
class LLMResult:
    text: str
    model: str


class LLM(Protocol):
    model: str

    async def generate_text(self, *, system: str, prompt: str, max_tokens: int) -> LLMResult: ...

    async def generate_json(self, *, system: str, prompt: str, schema: type[T], max_tokens: int) -> tuple[T, str]: ...


def _strict_schema(schema: type[BaseModel]) -> dict[str, Any]:
    """JSON schema with additionalProperties=false everywhere and every property required (structured-output rules)."""
    raw = schema.model_json_schema()

    def fix(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node["properties"].keys())
            node.pop("default", None)
            node.pop("title", None)
            for value in node.values():
                fix(value)
        elif isinstance(node, list):
            for value in node:
                fix(value)

    fix(raw)
    return raw


def _parse[M: BaseModel](schema: type[M], text: str) -> M:
    try:
        return schema.model_validate_json(text)
    except ValidationError as exc:
        raise AIOutputInvalid("The AI response did not match the expected structure and was discarded.") from exc


# ------------------------------------------------------------------------------------------------ Anthropic
class AnthropicLLM:
    def __init__(self, api_key: str, model: str, effort: str) -> None:
        self.model = model or ANTHROPIC_DEFAULT_MODEL
        self.effort = effort
        self._client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=2, timeout=120.0)

    async def _create(self, *, system: str, prompt: str, max_tokens: int, fmt: dict[str, Any] | None) -> Any:
        output_config: dict[str, Any] = {"effort": self.effort}
        if fmt is not None:
            output_config["format"] = fmt
        # Built as plain data and passed by keyword: the SDK's TypedDict overloads cannot narrow these dicts.
        request: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
            "output_config": output_config,
            "betas": ["server-side-fallback-2026-07-01"],
            "fallbacks": "default",
        }
        try:
            response = await self._client.beta.messages.create(**request)
        except anthropic.RateLimitError as exc:
            raise RateLimited(
                "The AI provider is rate limiting requests. Please retry shortly.", retry_after=20
            ) from exc
        except anthropic.AuthenticationError as exc:
            raise UpstreamError("The configured Anthropic API key was rejected.") from exc
        except anthropic.BadRequestError as exc:
            log.error("anthropic.bad_request", extra={"error": str(exc)[:500]})
            raise UpstreamError("The AI provider rejected the request.") from exc
        except anthropic.APIStatusError as exc:
            raise UpstreamError(f"The AI provider returned an error (HTTP {exc.status_code}).") from exc
        except anthropic.APIConnectionError as exc:
            raise UpstreamError("Could not reach the AI provider.") from exc
        if response.stop_reason == "refusal":
            raise AIRefused("The AI model declined to answer this request.")
        if response.stop_reason == "max_tokens":
            raise AIOutputInvalid("The AI response was cut off before it finished; it was discarded.")
        text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
        return text, getattr(response, "model", self.model)

    async def generate_text(self, *, system: str, prompt: str, max_tokens: int) -> LLMResult:
        text, model = await self._create(system=system, prompt=prompt, max_tokens=max_tokens, fmt=None)
        return LLMResult(text=text.strip(), model=model)

    async def generate_json(self, *, system: str, prompt: str, schema: type[T], max_tokens: int) -> tuple[T, str]:
        fmt = {"type": "json_schema", "schema": _strict_schema(schema)}
        text, model = await self._create(system=system, prompt=prompt, max_tokens=max_tokens, fmt=fmt)
        return _parse(schema, text), model


async def _post_json(url: str, body: dict[str, Any], headers: dict[str, str]) -> Any:
    """POST to a model provider over plain HTTP. Every failure leaves as an application error (Deep Research audit
    F06): transport problems as UpstreamError, refusals of service as RateLimited/UpstreamError, and a body that is
    not JSON as AIOutputInvalid. Nothing provider-specific escapes to callers."""
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise UpstreamError("Could not reach the AI provider.") from exc
    if response.status_code == 429:
        raise RateLimited("The AI provider is rate limiting requests. Please retry shortly.", retry_after=20)
    if response.status_code >= 400:
        raise UpstreamError(f"The AI provider returned an error (HTTP {response.status_code}).")
    try:
        return response.json()
    except ValueError as exc:
        raise AIOutputInvalid("The AI provider sent an unreadable response; it was discarded.") from exc


def _malformed(exc: Exception) -> AIOutputInvalid:
    log.warning("ai.malformed_response", extra={"error": type(exc).__name__})
    return AIOutputInvalid("The AI provider sent a response in an unexpected shape; it was discarded.")


# --------------------------------------------------------------------------------------------------- OpenAI
class OpenAILLM:
    url = "https://api.openai.com/v1/chat/completions"

    def __init__(self, api_key: str, model: str) -> None:
        if not model:
            raise AINotConfigured("AI_MODEL must be set when AI_PROVIDER=openai.")
        self.model = model
        self._headers = {"Authorization": f"Bearer {api_key}"}

    async def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        data = await _post_json(self.url, body, self._headers)
        try:
            choice = data["choices"][0]
            refusal = choice["message"].get("refusal")
            finish = choice.get("finish_reason")
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            raise _malformed(exc) from exc
        if finish == "length":
            raise AIOutputInvalid("The AI response was cut off before it finished; it was discarded.")
        if refusal:
            raise AIRefused("The AI model declined to answer this request.")
        return data

    async def generate_text(self, *, system: str, prompt: str, max_tokens: int) -> LLMResult:
        data = await self._post(
            {
                "model": self.model,
                "max_completion_tokens": max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            }
        )
        try:
            text = (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise _malformed(exc) from exc
        return LLMResult(text=text, model=data.get("model", self.model))

    async def generate_json(self, *, system: str, prompt: str, schema: type[T], max_tokens: int) -> tuple[T, str]:
        data = await self._post(
            {
                "model": self.model,
                "max_completion_tokens": max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": schema.__name__, "strict": True, "schema": _strict_schema(schema)},
                },
            }
        )
        try:
            content = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise _malformed(exc) from exc
        return _parse(schema, content), data.get("model", self.model)


# --------------------------------------------------------------------------------------------------- Gemini
class GeminiLLM:
    def __init__(self, api_key: str, model: str) -> None:
        if not model:
            raise AINotConfigured("AI_MODEL must be set when AI_PROVIDER=gemini.")
        self.model = model
        self._key = api_key

    async def _generate(self, system: str, prompt: str, max_tokens: int, schema: dict[str, Any] | None) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        config: dict[str, Any] = {"maxOutputTokens": max_tokens}
        if schema is not None:
            config.update({"responseMimeType": "application/json", "responseJsonSchema": schema})
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": config,
        }
        data = await _post_json(url, body, {"x-goog-api-key": self._key})
        try:
            candidates = data.get("candidates") or []
            if not candidates:
                raise AIRefused("The AI model declined to answer this request.")
            candidate = candidates[0]
            finish = candidate.get("finishReason")
            text = "".join(p.get("text", "") for p in (candidate.get("content") or {}).get("parts", []))
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            raise _malformed(exc) from exc
        if finish == "MAX_TOKENS":
            raise AIOutputInvalid("The AI response was cut off before it finished; it was discarded.")
        if finish in {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"}:
            raise AIRefused("The AI model declined to answer this request.")
        return text

    async def generate_text(self, *, system: str, prompt: str, max_tokens: int) -> LLMResult:
        return LLMResult(text=(await self._generate(system, prompt, max_tokens, None)).strip(), model=self.model)

    async def generate_json(self, *, system: str, prompt: str, schema: type[T], max_tokens: int) -> tuple[T, str]:
        text = await self._generate(system, prompt, max_tokens, _strict_schema(schema))
        return _parse(schema, text), self.model


# --------------------------------------------------------------------------------------------- factories
_llm_override: LLM | None = None


def set_llm(llm: LLM | None) -> None:
    """Test hook (never used in production code paths)."""
    global _llm_override
    _llm_override = llm


def llm_available() -> bool:
    """Whether get_llm() would return a model (a configured provider, or the test hook)."""
    return _llm_override is not None or get_settings().ai_enabled


def get_llm(feature: str = "This feature") -> LLM:
    if _llm_override is not None:
        return _llm_override
    s = get_settings()
    if not s.ai_enabled:
        raise AINotConfigured(feature)
    if s.ai_provider == "anthropic":
        return AnthropicLLM(s.anthropic_api_key, s.ai_model, s.ai_effort)
    if s.ai_provider == "openai":
        return OpenAILLM(s.openai_api_key, s.ai_model)
    return GeminiLLM(s.gemini_api_key, s.ai_model)


class Embedder(Protocol):
    model: str

    async def embed(self, texts: list[str], *, task: str) -> list[list[float]]: ...


class OpenAIEmbedder:
    def __init__(self, api_key: str, model: str, dimensions: int) -> None:
        self.model = model or OPENAI_DEFAULT_EMBEDDING_MODEL
        self.dimensions = dimensions
        self._headers = {"Authorization": f"Bearer {api_key}"}

    async def embed(self, texts: list[str], *, task: str) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers=self._headers,
                json={"model": self.model, "input": texts, "dimensions": self.dimensions},
            )
        if response.status_code >= 400:
            raise UpstreamError(f"Embedding provider error (HTTP {response.status_code}).")
        return [row["embedding"] for row in sorted(response.json()["data"], key=lambda r: r["index"])]


class GeminiEmbedder:
    def __init__(self, api_key: str, model: str, dimensions: int) -> None:
        if not model:
            raise AINotConfigured("EMBEDDING_MODEL must be set when EMBEDDING_PROVIDER=gemini.")
        self.model = model
        self.dimensions = dimensions
        self._key = api_key

    async def embed(self, texts: list[str], *, task: str) -> list[list[float]]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:batchEmbedContents"
        task_type = "RETRIEVAL_QUERY" if task == "query" else "RETRIEVAL_DOCUMENT"
        body = {
            "requests": [
                {
                    "model": f"models/{self.model}",
                    "content": {"parts": [{"text": t}]},
                    "taskType": task_type,
                    "outputDimensionality": self.dimensions,
                }
                for t in texts
            ]
        }
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, json=body, headers={"x-goog-api-key": self._key})
        if response.status_code >= 400:
            raise UpstreamError(f"Embedding provider error (HTTP {response.status_code}).")
        return [e["values"] for e in response.json()["embeddings"]]


_embedder_override: Embedder | None = None


def set_embedder(embedder: Embedder | None) -> None:
    global _embedder_override
    _embedder_override = embedder


def get_embedder() -> Embedder | None:
    if _embedder_override is not None:
        return _embedder_override
    s = get_settings()
    if not s.embeddings_enabled:
        return None
    if s.embedding_provider == "openai":
        return OpenAIEmbedder(s.openai_api_key, s.embedding_model, s.embedding_dimensions)
    return GeminiEmbedder(s.gemini_api_key, s.embedding_model, s.embedding_dimensions)


def dumps_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
