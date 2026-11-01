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

import json
import logging
import os
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

load_dotenv()

from legalbuddy import chat as chat_mod  # noqa: E402
from legalbuddy.store import COLLECTION, make_client  # noqa: E402

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
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
    # Attached user documents: ids scoped to user_id (Next.js injects the
    # session user; retrieval filters both server-side).
    user_id: str | None = Field(default=None, max_length=64)
    doc_ids: list[str] = Field(default_factory=list, max_length=10)
    # Active conversation (Neon conversations.id): loads past turns from the
    # Postgres memory store for follow-ups and records the finished turn.
    conversation_id: str | None = Field(default=None, max_length=64)


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
    kind: str = "statute"
    doc_filename: str = ""
    doc_page: int | None = None


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
            status="degraded", collection=COLLECTION, points=None,
            detail="Index check failed.")


@app.post("/api/chat", response_model=ChatResponse)
def post_chat(req: ChatRequest) -> ChatResponse:
    """Grounded answer + section citations for one question."""
    try:
        ans = chat_mod.answer(req.question, language=req.language,
                              act_year=req.act_year, limit=req.limit,
                              user_id=req.user_id, doc_ids=req.doc_ids,
                              conversation_id=req.conversation_id)
    except Exception:  # retrieval or generation failure -> 502, not 500
        # Never leak internals (tracebacks, hostnames, SDK errors) to callers;
        # the full traceback stays in the server log.
        log.exception("chat request failed")
        raise HTTPException(
            status_code=502,
            detail="Answer generation failed. Please try again.") from None
    return ChatResponse(
        answer=ans.text,
        citations=[_citation_out(c) for c in ans.citations],
        model=ans.model,
    )


def _citation_out(c) -> CitationOut:
    return CitationOut(
        ref=c.ref, act_title=c.act_title, act_no=c.act_no, act_year=c.act_year,
        section_label=c.section_label, section_title=c.section_title,
        excerpt=c.excerpt, source_url=c.source_url, score=c.score,
        kind=c.kind, doc_filename=c.doc_filename, doc_page=c.doc_page,
    )


def _sse(event: str, payload: str) -> str:
    return f"event: {event}\ndata: {payload}\n\n"


class DocumentOut(BaseModel):
    doc_id: str
    filename: str
    mime: str
    chunks: int
    created_at: str


def _require_user(user_id: str | None) -> str:
    user = (user_id or "").strip()
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required.")
    return user


@app.post("/api/documents", response_model=DocumentOut)
async def upload_document(user_id: str | None = Query(default=None, max_length=64),
                          file: UploadFile = File(...)) -> DocumentOut:
    """Ingest one user file: parse, chunk, embed, store (isolated by user).

    ``user_id`` comes from the Next.js session (trusted internal network),
    never from the browser directly. Embedding is synchronous, bounded by
    the per-document chunk cap.
    """
    from datetime import datetime, timezone

    from legalbuddy import documents as docs_mod
    from legalbuddy.embedder import VoyageDense, encode_sparse
    from legalbuddy.store import (
        delete_doc_points,
        ensure_docs_collection,
        make_client,
        upsert_doc_chunks,
    )

    user = _require_user(user_id)
    filename = (file.filename or "upload").strip()[:120] or "upload"
    data = await file.read()
    try:
        segments = docs_mod.parse_document(filename, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    ext = os.path.splitext(filename)[1].lower()
    mime = docs_mod.EXTENSION_MIME.get(ext, "application/octet-stream")
    doc_id = docs_mod.new_doc_id()
    # Tiered enrichment for PDFs: explicit tables first (free), then VLM
    # transcription for textless pages only (bounded token spend). Both
    # are best-effort — the text layer always indexes regardless.
    tables: dict[int, str] = {}
    vision_texts: dict[int, str] = {}
    if ext == ".pdf":
        tables = docs_mod.extract_page_tables(data)
        needy = docs_mod.textless_page_numbers(segments)[:docs_mod.MAX_VISION_PAGES]
        if needy:
            try:
                rendered = docs_mod.render_pages(data, needy)
                order = [p for p in needy if p in rendered]
                texts = docs_mod.transcribe_images([rendered[p] for p in order])
                vision_texts = dict(zip(order, texts))
            except Exception:
                log.exception("vision transcription failed; indexing text layer")
    chunks = docs_mod.chunk_document(doc_id, user, filename, mime, segments,
                                     tables=tables, vision_texts=vision_texts)
    if not chunks:
        raise HTTPException(status_code=400, detail="No readable text found.")
    try:
        client = make_client()
        ensure_docs_collection(client)
        dense = VoyageDense()
        dense_vecs = dense.embed([c.text for c in chunks], input_type="document")
        sparse_vecs = encode_sparse([c.text for c in chunks])
        upsert_doc_chunks(client, chunks, dense_vecs, sparse_vecs)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception:
        log.exception("document ingest failed")
        # Leave no half-ingested document behind.
        try:
            delete_doc_points(make_client(), user, doc_id)
        except Exception:
            pass
        raise HTTPException(
            status_code=502,
            detail="Could not process the file. Please try again.") from None
    return DocumentOut(doc_id=doc_id, filename=filename, mime=mime,
                       chunks=len(chunks),
                       created_at=datetime.now(timezone.utc).isoformat())


@app.get("/api/documents", response_model=list[DocumentOut])
def list_documents(user_id: str | None = Query(default=None, max_length=64)):
    """List the user's documents (distinct doc_ids from the vector store)."""
    from legalbuddy.store import DOCS_COLLECTION, ensure_docs_collection, make_client
    from qdrant_client import models

    user = _require_user(user_id)
    client = make_client()
    try:
        ensure_docs_collection(client)
        seen: dict[str, dict] = {}
        offset = None
        while True:
            points, offset = client.scroll(
                collection_name=DOCS_COLLECTION,
                scroll_filter=models.Filter(must=[
                    models.FieldCondition(key="user_id",
                                          match=models.MatchValue(value=user))]),
                limit=256, offset=offset, with_payload=True, with_vectors=False)
            for p in points:
                pl = p.payload or {}
                did = str(pl.get("doc_id", ""))
                if did and did not in seen:
                    seen[did] = {
                        "doc_id": did,
                        "filename": str(pl.get("filename", "")),
                        "mime": str(pl.get("mime", "")),
                        "chunks": int(pl.get("chunk_count", 0) or 0),
                        "created_at": "",
                    }
            if offset is None:
                break
    except HTTPException:
        raise
    except Exception:
        log.exception("document list failed")
        raise HTTPException(status_code=502,
                            detail="Could not load documents.") from None
    return [DocumentOut(**v) for v in seen.values()]


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str,
                    user_id: str | None = Query(default=None, max_length=64)):
    """Delete one document's vectors (always scoped to the session user)."""
    from legalbuddy.store import delete_doc_points, ensure_docs_collection, make_client

    user = _require_user(user_id)
    try:
        client = make_client()
        ensure_docs_collection(client)
        delete_doc_points(client, user, doc_id)
    except HTTPException:
        raise
    except Exception:
        log.exception("document delete failed")
        raise HTTPException(status_code=502,
                            detail="Could not delete the document.") from None
    return {"ok": True}


class EmbedRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@app.post("/api/profile-embed")
def post_profile_embed(req: EmbedRequest):
    """Single Voyage embedding for a lawyer profile text (internal use:
    the Next.js profile route stores it for cosine matching)."""
    from legalbuddy.embedder import VoyageDense

    vec = VoyageDense().embed([req.text], input_type="document")[0]
    return {"embedding": vec}


class MatchRequest(BaseModel):
    user_id: str = Field(max_length=64)
    limit: int = Field(default=3, ge=1, le=10)


@app.post("/api/match-lawyers")
def post_match_lawyers(req: MatchRequest):
    """Recommend verified lawyers from the user's matter history.

    ``user_id`` comes from the Next.js session (trusted internal network).
    Runs classification + embedding + scoring; returns ranked lawyers with
    templated reasons, or a directory fallback when nothing matches.
    """
    from legalbuddy import matcher as matcher_mod
    from legalbuddy.chat import CHAT_MODEL, _client
    from legalbuddy.embedder import VoyageDense

    history = matcher_mod.fetch_history(req.user_id)
    if not history:
        return {"need": None, "results": [], "fallback": "directory"}
    numbered = "\n".join(f"{i + 1}. {h['content'][:500]}" for i, h in enumerate(history))
    need = matcher_mod.classify_matters(numbered, _client(), CHAT_MODEL)
    if not need.get("dominant"):
        return {"need": need, "results": [], "fallback": "directory"}
    query_text = need.get("summary") or numbered[:2000]
    need["matter_embedding"] = VoyageDense().embed([query_text], input_type="query")[0]
    need["bangla"] = bool(need.get("bangla")) or bool(
        matcher_mod.BN_PATTERN.search(numbered))
    ranked = matcher_mod.score_lawyers(need, matcher_mod.fetch_candidates())
    results = []
    for r in ranked[:req.limit]:
        results.append({
            "user_id": str(r["user_id"]),
            "display_name": r.get("display_name"),
            "practice_areas": r.get("practice_areas") or [],
            "languages": r.get("languages") or [],
            "city": r.get("city"),
            "bio": r.get("bio"),
            "bar_association": r.get("bar_association"),
            "rating_avg": round(float(r.get("rating_avg") or 0), 1),
            "rating_count": int(r.get("rating_count") or 0),
            "score": round(float(r["score"]), 3),
            "reason": matcher_mod.explain(need, r, len(history)),
        })
    return {
        "need": {k: need.get(k) for k in ("areas", "dominant", "summary", "bangla")},
        "results": results,
        "fallback": None if results else "directory",
    }


@app.post("/api/chat/stream")
def post_chat_stream(req: ChatRequest):
    """Token-streaming answer as Server-Sent Events.

    Events: ``meta`` (citations up front), ``token`` (text chunks),
    ``done`` (full answer + citations), ``error`` (generic message only —
    internals stay in server logs, since HTTP status is already sent).
    """
    def events():
        try:
            gen = chat_mod.stream_answer(req.question, language=req.language,
                                         act_year=req.act_year, limit=req.limit,
                                         user_id=req.user_id, doc_ids=req.doc_ids,
                                         conversation_id=req.conversation_id)
            for kind, val in gen:
                if kind == "meta":
                    yield _sse("meta", ChatResponse(
                        answer="", model=val["model"],
                        citations=[_citation_out(c) for c in val["citations"]],
                    ).model_dump_json())
                elif kind == "token":
                    yield _sse("token", json.dumps({"t": val}))
                elif kind == "done":
                    yield _sse("done", ChatResponse(
                        answer=val.text, model=val.model,
                        citations=[_citation_out(c) for c in val.citations],
                    ).model_dump_json())
        except Exception:  # noqa: BLE001 — mid-stream: status is sent, emit generic error
            log.exception("chat stream failed")
            yield _sse("error", '{"detail": "Answer generation failed. Please try again."}')
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
