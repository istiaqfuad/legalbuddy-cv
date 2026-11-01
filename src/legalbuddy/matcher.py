"""Lawyer recommender: match a user's matter history to verified lawyers.

Pipeline: recent conversations -> Spark classifies practice areas and
summarizes the matter -> Voyage embeds the summary -> candidates
(verified lawyers with profiles) score on area match, embedding cosine,
and Bayesian rating -> templated explanations, never model-written
credentials.

Only verified lawyers are ever candidates. New lawyers start neutral via
the Bayesian prior instead of buried. Matching runs on explicit request.
"""

from __future__ import annotations

import json
import logging
import math
import re

from legalbuddy.memory import _conninfo

logger = logging.getLogger(__name__)

PRACTICE_AREAS = [
    "criminal",
    "family",
    "property",
    "corporate",
    "labor",
    "tax",
    "consumer",
    "immigration",
]

# Final score weights: area fit first, semantic fit second, reputation
# third. Small boosts break near-ties on locality and language.
W_AREA = 0.45
W_SIM = 0.35
W_RATING = 0.20
BOOST_BAR = 0.05
BOOST_CITY = 0.05
BOOST_BANGLA = 0.05

# Bayesian rating prior: a new lawyer reads as 3.5/5 until reviews arrive.
RATING_PRIOR_MEAN = 3.5
RATING_PRIOR_COUNT = 3

BN_PATTERN = re.compile(r"[\u0980-\u09FF]")

CLASSIFY_SYSTEM = (
    "You are a legal intake classifier. Read the user's recent questions "
    "and reply with ONLY a JSON object: {\"areas\": [...], \"dominant\": "
    "\"...\", \"summary\": \"...\", \"bangla\": true/false}. \"areas\" "
    "lists every practice area the questions touch, in order of prominence. "
    "\"dominant\" is the single best area. \"summary\" is one sentence "
    "describing the person's legal matter. \"bangla\" is true when the "
    "person mostly writes in Bangla. Use ONLY these area names: "
    + ", ".join(PRACTICE_AREAS)
    + ". Never echo the questions back."
)


def classify_matters(numbered_questions: str, client, model: str) -> dict:
    """One Spark call over the numbered recent questions. Falls back to an
    empty classification (caller treats it as directory fallback)."""
    try:
        out = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": CLASSIFY_SYSTEM},
                {"role": "user", "content": numbered_questions[:6000]},
            ],
            max_tokens=1024,
            temperature=0.0,
        )
        text = (out.choices[0].message.content or "").strip()
        start = text.find("{")
        data = json.loads(text[start:] if start >= 0 else text)
        areas = [a for a in data.get("areas", []) if a in PRACTICE_AREAS]
        dominant = data.get("dominant") if data.get("dominant") in PRACTICE_AREAS else None
        return {
            "areas": areas,
            "dominant": dominant or (areas[0] if areas else None),
            "summary": str(data.get("summary", ""))[:500],
            "bangla": bool(data.get("bangla", False)),
        }
    except Exception as exc:
        logger.warning("matter classification failed: %s", exc)
        return {"areas": [], "dominant": None, "summary": "", "bangla": False}


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity in 0..1 (Voyage vectors are non-negative-friendly;
    clip negatives since only ranking matters)."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


def bayesian_rating(total: int, count: int) -> float:
    """Bayesian average normalized to 0..1. No reviews reads as neutral."""
    avg = (RATING_PRIOR_COUNT * RATING_PRIOR_MEAN + total) / (
        RATING_PRIOR_COUNT + max(0, count)
    )
    return max(0.0, min(1.0, avg / 5.0))


def score_lawyers(need: dict, candidates: list[dict]) -> list[dict]:
    """Rank verified candidates. Area match is a hard gate on the dominant
    area (relaxed to secondary areas only when nothing matches); similarity
    and rating order the rest. Returns best-first with score parts kept for
    explanations."""
    dominant = need.get("dominant")
    if not dominant:
        return []
    pool = [c for c in candidates if dominant in (c.get("practice_areas") or [])]
    if not pool:
        secondary = [a for a in (need.get("areas") or []) if a != dominant]
        pool = [c for c in candidates if any(a in (c.get("practice_areas") or []) for a in secondary)]
    if not pool:
        return []
    ranked = []
    for c in pool:
        areas = c.get("practice_areas") or []
        area = 1.0 if dominant in areas else 0.5
        sim = cosine(need.get("matter_embedding") or [], c.get("profile_embedding") or [])
        rating = bayesian_rating(c.get("rating_total", 0), c.get("rating_count", 0))
        score = W_AREA * area + W_SIM * sim + W_RATING * rating
        if need.get("user_bar") and c.get("bar_association") == need["user_bar"]:
            score += BOOST_BAR
        if need.get("user_city") and c.get("city") and c["city"].lower() == need["user_city"].lower():
            score += BOOST_CITY
        if need.get("bangla") and "bangla" in (c.get("languages") or []):
            score += BOOST_BANGLA
        ranked.append({**c, "score": min(1.0, score), "area_score": area,
                       "sim": sim, "rating_norm": rating})
    ranked.sort(key=lambda r: r["score"], reverse=True)
    return ranked


def explain(need: dict, lawyer: dict, recent_count: int) -> str:
    """Templated reason string from matched inputs only."""
    bits = []
    dominant = need.get("dominant") or ""
    if recent_count > 1:
        bits.append(f"{recent_count} of your recent chats were about {dominant} matters")
    else:
        bits.append(f"your recent chats were about {dominant} matters")
    areas = ", ".join((lawyer.get("practice_areas") or [])[:3])
    bits.append(f"{lawyer.get('display_name', 'This lawyer')} practices {areas}")
    if lawyer.get("bar_association"):
        bits.append(f"enrolled with {lawyer['bar_association']}")
    if lawyer.get("rating_count"):
        bits.append(f"rated {lawyer['rating_avg']:.1f}/5 by {lawyer['rating_count']} clients")
    else:
        bits.append("newly listed, no client ratings yet")
    return "; ".join(bits) + "."


def fetch_history(user_id: str, limit: int = 20) -> list[dict]:
    """Recent user questions across conversations, newest last."""
    import psycopg

    conn = psycopg.connect(_conninfo(pooled=True))
    try:
        rows = conn.execute(
            """SELECT m.content FROM messages m
               JOIN conversations c ON c.id = m.conversation_id
               WHERE c.user_id = %s AND m.role = 'user'
               ORDER BY m.created_at DESC LIMIT %s""",
            (user_id, limit),
        ).fetchall()
    finally:
        conn.close()
    return [{"content": r[0]} for r in reversed(rows)]


def fetch_candidates() -> list[dict]:
    """Verified lawyers with profiles, review aggregates, and bars."""
    import psycopg

    conn = psycopg.connect(_conninfo(pooled=True))
    try:
        rows = conn.execute(
            """SELECT u.id, u.name, p.practice_areas, p.languages, p.city,
                      p.bio, p.profile_embedding, v.bar_association,
                      COALESCE(SUM(r.rating), 0)::int AS rating_total,
                      COUNT(r.id)::int AS rating_count,
                      COALESCE(AVG(r.rating), 0)::float AS rating_avg
               FROM users u
               JOIN lawyer_profiles p ON p.user_id = u.id
               LEFT JOIN lawyer_verifications v ON v.user_id = u.id
               LEFT JOIN lawyer_reviews r ON r.lawyer_id = u.id
               WHERE u.role = 'lawyer' AND u.lawyer_status = 'verified'
               GROUP BY u.id, u.name, p.practice_areas, p.languages, p.city,
                        p.bio, p.profile_embedding, v.bar_association"""
        ).fetchall()
    finally:
        conn.close()
    cols = ["user_id", "display_name", "practice_areas", "languages", "city",
            "bio", "profile_embedding", "bar_association",
            "rating_total", "rating_count", "rating_avg"]
    return [dict(zip(cols, r)) for r in rows]
