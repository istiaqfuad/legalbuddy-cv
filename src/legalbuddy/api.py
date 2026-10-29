"""HTTP API for the LegalBuddy chatbot (FastAPI).

Thin layer over :mod:`legalbuddy.chat`: retrieval + Baseten generation stay
in ``chat.py``; this module only validates input, shapes JSON for the web
frontend, and maps failures to HTTP status codes.

Run locally::

    uv run uvicorn legalbuddy.api:app --port 8000

Env (same ``.env`` as the ingestion pipeline): ``QDRANT_URL``,
``QDRANT_API_KEY``, ``VOYAGE_API_KEY``, ``BASETEN_API_KEY``.
``FRONTEND_URL`` optionally restricts CORS (defaults to
``http://localhost:3000``).
"""

from __future__ import annotations

import logging
import os
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from legalbuddy import chat as chat_mod  # noqa: E402
from legalbuddy.store import COLLECTION, make_client  # noqa: E402

log = logging.getLogger("legalbuddy.api")

Language = Literal["english", "bengali"]

app = FastAPI(title="LegalBuddy API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000")],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    language: Language | None = None
    act_year: str | None = Field(default=None, max_length=4)
    limit: int = Field(default=6, ge=1, le=10)


class CitationOut(BaseModel):
    ref: int
    act_title: str
    act_no: str
    act_year: str
    section_label: str
    section_title: str
    excerpt: str
    source_url: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationOut]
    model: str


class HealthResponse(BaseModel):
    status: str
    collection: str
    points: int | None
    detail: str | None = None


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness + Qdrant collection reachability."""
    try:
        points = make_client().get_collection(COLLECTION).points_count
        return HealthResponse(status="ok", collection=COLLECTION, points=points)
    except Exception as exc:  # Qdrant down / auth / network
        log.warning("health check degraded: %r", exc)
        return HealthResponse(
            status="degraded", collection=COLLECTION, points=None, detail=str(exc)[:300])


@app.post("/api/chat", response_model=ChatResponse)
def post_chat(req: ChatRequest) -> ChatResponse:
    """Grounded answer + section citations for one question."""
    try:
        ans = chat_mod.answer(req.question, language=req.language,
                              act_year=req.act_year, limit=req.limit)
    except Exception as exc:  # retrieval or generation failure -> 502, not 500
        log.exception("chat request failed")
        raise HTTPException(status_code=502,
                            detail=f"answer generation failed: {exc}") from exc
    return ChatResponse(
        answer=ans.text,
        citations=[CitationOut(
            ref=c.ref, act_title=c.act_title, act_no=c.act_no, act_year=c.act_year,
            section_label=c.section_label, section_title=c.section_title,
            excerpt=c.excerpt, source_url=c.source_url, score=c.score,
        ) for c in ans.citations],
        model=ans.model,
    )
