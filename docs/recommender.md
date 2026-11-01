# Lawyer recommender

Content-based matching of a seeker's matter history against verified
lawyer profiles. No collaborative filtering: there is no interaction
data, and matching runs on-request only (privacy: history never leaves
the per-user query path).

## Pipeline (`src/legalbuddy/matcher.py`, `/api/match-lawyers`)

1. `fetch_history` reads the user's past chat messages from Neon.
2. `classify_matters` asks Spark for the dominant practice area plus a
   one-line matter summary (Bangla-aware; `BN_PATTERN` fallback).
3. The summary is embedded with Voyage `voyage-4` and cosine-matched
   against `lawyer_profiles.profile_embedding` (pgvector-style JSONB;
   the pool is tiny so Postgres beats a new Qdrant collection).
4. `score_lawyers` combines three normalized signals:
   `W_AREA 0.45` (dominant-area overlap) + `W_SIM 0.35` (profile cosine)
   + `W_RATING 0.20` (`bayesian_rating`: 3 x 3.5 prior, so a 5.0 from
   one review scores ~0.64, not 1.0).
5. `explain` renders a templated reason (count of past chats, shared
   areas, rating). New lawyers with no reviews get a neutral
   "New, no ratings yet" badge, never a penalty. Templates only: the
   model must not invent credentials.

## Ratings (`lawyer_reviews`, `/api/lawyers/[id]/review`)

One review per seeker per lawyer (unique constraint), 1-5 stars plus
optional note. Saving a review refetches suggestions so stars update
in place (`refreshAfterRating`). Reason strings pluralize
("1 chat" vs "6 chats", "1 client" vs "N clients").

## Free-tier 429 lesson

Every endpoint built its own `VoyageDense()`, and each instance
carries a zeroed pacing window. Concurrent chat / match / profile
calls raced inside the same 3-RPM minute and Voyage answered 429,
surfacing as `500` on match. Fix: `embedder.shared_dense()` is the
one process-wide encoder (plus an instance lock for threaded uvicorn
endpoints); `api.py` and `chat.py` both route through it. The pacer
then serializes bursts server-side: slower under contention, but it
succeeds. Paid tier: set `VOYAGE_REQUEST_GAP_S=0`.

## Verification

`uv run pytest tests/test_matcher.py` (14 tests) plus browser spec
`/tmp/btest/recommend.spec.mjs`: property history ranks the property
lawyer first with a reason string, review save flips stars to
`5.0 x 1 review`, directory lists both lawyers, zero page errors.
