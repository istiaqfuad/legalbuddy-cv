# LegalBuddy engineering notes

How the hard, non-obvious problems in this repo were diagnosed and fixed.
UI work (theme, copy, layout, logo) is deliberately excluded.

- [Retrieval fusion](retrieval-fusion.md) — why dense-heavy weighted
  fusion beat RRF/DBSF on the golden set, and the Bengali-script rule.
- [Streaming reliability](streaming-reliability.md) — keepalive crash,
  silent-stall watchdog, and the no-leak error contract.
- [Ingestion pipeline](ingestion-pipeline.md) — chunking normalizer,
  resumable deterministic ingestion, Voyage pacing, Qdrant client fix.
