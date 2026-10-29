# Retrieval fusion: why weighted dense-heavy won

## Problem

A Bangla question about murder punishment (`খুনের শাস্তি কী?`) returned
8 sections of which only 3 were Penal Code; the rest were VAT, insurance,
and city-corporation law. Same-script BM25 matches were outvoting meaning.

## Diagnosis

Hybrid retrieval is dense (Voyage-4) + sparse (BM25) fused with RRF
(`store.hybrid_search`). RRF is rank-based: it ignores score magnitudes,
so a flood of same-script BM25 surface matches can outrank the
semantically correct dense hits. Measured on the 7 golden EN/BN queries
(`scripts/eval_retrieval.py`, recall + mean precision):

| Fusion | Recall@8 | Mean precision@8 |
|---|---|---|
| RRF | 7/7 | 0.50 |
| DBSF | 6/7 | 0.42 |
| Weighted (new) | 7/7 | **0.57** |

Per current Qdrant guidance (skills.qdrant.tech, hybrid-search branch):
compare RRF vs DBSF first, then tune weights last. We did exactly that.
DBSF lost recall outright, so weighting was the remaining lever — except
client 1.20.0's `Prefetch` has no weight field, so weights live in a
client-side fusion instead of the query.

## Fix

`store.weighted_search`: one dense + one sparse `query_points` call with
the same filter, min-max normalize each list, combine as
`w*dense + (1-w)*sparse`, where `w` comes from `dense_weight_for`:

- `DENSE_WEIGHT` (default 0.7) normally,
- `DENSE_WEIGHT_BN` (default 0.85) when the query carries Bengali-script
  tokens (pure or mixed), detected by Unicode block, no dependencies.

`chat.retrieve` picks the fusion via `FUSION` (`weighted` default,
`rrf`, `dbsf` fallback). The returned shape (`.points` with
id/payload/score) is unchanged, so callers are untouched.

## Verification

- Unit: fusion math (dense outvotes sparse, BN weight leans denser),
  filter passthrough, env clamping/invalid handling, kwarg-name guard
  against the real client signature (`tests/test_store.py`,
  `tests/test_api.py::test_retrieve_fusion_dispatch`).
- Golden A/B above; murder question end-to-end went from 3/8 to
  **7/8 Penal Code sections (302, 303, 300, 304, 307)**.
- Residual: some same-script neighbors remain on Bengali queries;
  a cross-encoder reranker is the natural next step, not more weighting.

## Files

`src/legalbuddy/store.py` (`weighted_search`, `dense_weight_for`,
`is_bengali_script`, `dbsf_search`), `src/legalbuddy/chat.py`
(`retrieve`), `scripts/eval_retrieval.py`, `.env.example`.
