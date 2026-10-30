# Reranking (Jina v3.5 cross-encoder)

After hybrid fusion retrieves candidates, `jina-reranker-v3.5` reorders
them before evidence assembly. Fusion finds candidates; the cross-encoder
reads query and chunks together and scores true relevance, which helps
most on Bangla and mixed-language queries where the dense leg can bury
the right section.

## Flow

1. `retrieve` (statutes) over-fetches fusion candidates
   (`max(limit, RERANK_CANDIDATES)`, default 20, within the prefetch
   windows) and keeps the reranked top `limit`. Same pattern in
   `retrieve_docs`, which reranks to `doc_limit`.
2. The rerank query is the resolved question (standalone after memory
   rewrite, plus file facts when a document is attached).
3. `rerank_points` (`src/legalbuddy/rerank.py`) sends texts to
   `POST https://api.jina.ai/v1/rerank` with `return_documents: false`
   and reorders the same point objects, replacing scores with relevance
   scores. Citation numbering (`[1..n]`, `[D1..m]`) is assigned after, so
   it always matches the final order.

## Configuration (`.env` / `.env.example`)

- `JINA_API_KEY`: required; without it retrieval falls back to fusion order.
- `JINA_RERANK_MODEL`: default `jina-reranker-v3.5`.
- `RERANK_CANDIDATES`: default 20.

## Gotchas solved

- Best-effort everywhere: missing key, HTTP error, empty or unusable
  response, and fewer than 2 candidates (nothing to order, so no API call
  is made) all keep fusion order instead of failing the answer.
- The API should honor `top_n`, but results are defensively truncated to
  `top_n` in case it returns more.
- No Qdrant shape changes: reranking is a client-side reorder of the
  already-filtered points, so user-document isolation is untouched.
- Quota is 500 RPM / 1M TPM, far roomier than the Voyage free tier; one
  call per retrieval leg plus one per memory rewrite is the per-question
  ceiling.
