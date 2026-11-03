"""Grounded contract review for vault files (business tier).

Pipeline: clause spotting (rules) -> statute retrieval (existing hybrid
RAG) -> one constrained model call -> citation validation (rules).

The model may only cite statutes from the retrieved list, quoted
verbatim; anything else is dropped, never shown. When no retrieved
statute governs a clause, the review says so instead of guessing.
"""

from __future__ import annotations

import json
import os
import re

EXCERPT_CHARS = 6000
MAX_FLAGS = 6
REVIEW_MODEL_ENV = "CHAT_MODEL"

# Clause families worth a statute check, with the wording that spots
# them. Deliberately narrow: a missed clause is a missed flag, while a
# false family only costs retrieval, never a shown citation.
CLAUSE_GROUPS: list[tuple[str, str]] = [
    ("penalty", r"penalt|liquidated damages|compensation|forfeit|fine|deduction|charge per day|per diem"),
    ("termination", r"terminat|cancel(?:lation|led)?|rescis|expir(?:y|ation|es)|renewal|auto.?renew|notice period"),
    ("payment", r"payment|payable|consideration|advance|installment|instalment|due date|invoice"),
    ("cheque", r"cheque|check|dishono[u]?r|bounced|insufficient fund|NI Act|Negotiable Instruments"),
    ("security", r"security|earnest money|bank guarantee|collateral|lien|mortgage|pledge"),
    ("jurisdiction", r"jurisdiction|arbitration|governing law|court of|dispute resolution|mediation"),
    ("confidentiality", r"confidential|non.?disclosure|NDA|trade secret"),
]

REVIEW_QUERIES = [
    "penalty liquidated damages compensation Contract Act 1872 section 74",
    "contract termination notice period obligations",
    "cheque dishonour notice Negotiable Instruments Act section 138",
]

_SENTENCE = re.compile(r"(?<=[.!?।])\s+(?=[A-Z0-9\"“\(\u0980-\u09FF])")


def split_sentences(text: str) -> list[str]:
    parts = _SENTENCE.split(re.sub(r"\s+", " ", text or "").strip())
    return [p.strip() for p in parts if len(p.strip()) > 20]


def extract_clauses(text: str, max_chars: int = EXCERPT_CHARS) -> list[dict]:
    """Keyword sentences grouped by clause family, capped for the prompt."""
    found: list[dict] = []
    total = 0
    for sent in split_sentences(text):
        hit = next((name for name, pat in CLAUSE_GROUPS
                    if re.search(pat, sent, re.IGNORECASE)), None)
        if hit is None:
            continue
        if total + len(sent) > max_chars:
            break
        found.append({"group": hit, "text": sent[:500]})
        total += len(sent)
    return found


def build_review_prompt(clauses: list[dict], passages: list[dict]) -> str:
    """One strict prompt: flags with verbatim citations, or nothing."""
    clause_block = "\n".join(
        f"- [{c['group']}] {c['text']}" for c in clauses)
    statute_block = "\n".join(
        f"[{p['ref']}] {p['act_title']} §{p['section_label']}: {p['excerpt']}"
        for p in passages)
    return f"""You review a business contract excerpt under the laws of Bangladesh.

CONTRACT EXCERPT (family-tagged sentences):
{clause_block}

STATUTES (the ONLY citable sources):
{statute_block}

Return JSON only, exactly: {{"flags": [...]}}. Each flag:
{{"title": "<short>", "clause": "<quote ≤300 chars from the excerpt>",
"risk": "high|medium|low", "explanation": "<plain, ≤60 words>",
"citation": {{"act": "<EXACT act title from STATUTES>", "section": "<EXACT section label>"}}}}

Rules: cite ONLY act+section pairs copied exactly from STATUTES above. If no listed statute governs a clause, omit that flag — never cite from memory, never invent sections, never cite the excerpt. If nothing is flaggable, return {{"flags": []}}."""


def parse_review_flags(raw: str,
                       valid: set[tuple[str, str]]) -> list[dict]:
    """Parse the model JSON; keep only flags citing retrieved statutes."""
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return []
    flags = data.get("flags") if isinstance(data, dict) else None
    if not isinstance(flags, list):
        return []
    out: list[dict] = []
    for f in flags:
        if not isinstance(f, dict):
            continue
        cite = f.get("citation") if isinstance(f.get("citation"), dict) else {}
        key = (str(cite.get("act", "")).strip(),
               str(cite.get("section", "")).strip())
        if key not in valid:
            continue  # ungrounded citation: drop, never show
        risk = str(f.get("risk", "")).lower()
        out.append({
            "title": str(f.get("title", ""))[:120],
            "clause": str(f.get("clause", ""))[:300],
            "risk": risk if risk in ("high", "medium", "low") else "medium",
            "explanation": str(f.get("explanation", ""))[:500],
            "citation": {"act": key[0], "section": key[1]},
        })
        if len(out) >= MAX_FLAGS:
            break
    return out


def review_contract(chunk_texts: list[str], retriever=None,
                    completer=None) -> dict:
    """Full review: returns {"flags": [...], "note": str}."""
    from legalbuddy import chat as chat_mod

    text = "\n".join(t for t in chunk_texts if t)
    clauses = extract_clauses(text)
    if not clauses:
        return {"flags": [],
                "note": "No penalty, termination, payment, or standard clauses found to check."}
    retrieve = retriever or chat_mod.retrieve
    seen: dict[tuple[str, str], dict] = {}
    for q in REVIEW_QUERIES:
        try:
            hits = retrieve(q, limit=6)
        except Exception:
            continue
        for p in getattr(hits, "points", []) or []:
            pl = getattr(p, "payload", None) or {}
            if isinstance(pl, dict):
                key = (str(pl.get("act_title", "")),
                       str(pl.get("section_label", "")))
                if key[0] and key not in seen:
                    seen[key] = {
                        "ref": len(seen) + 1,
                        "act_title": key[0],
                        "section_label": key[1],
                        "excerpt": str(pl.get("text", ""))[:600],
                    }
    passages = list(seen.values())[:12]
    if not passages:
        return {"flags": [],
                "note": "No governing statutes retrieved; an advocate should review the clauses directly."}
    prompt = build_review_prompt(clauses, passages)
    if completer is None:
        from openai import OpenAI
        client = OpenAI(base_url=chat_mod.BASE_URL,
                        api_key=chat_mod._chat_key())
        model = os.environ.get(REVIEW_MODEL_ENV, "")
        def completer(prompt: str) -> str:  # noqa: E306
            resp = client.chat.completions.create(
                model=model, temperature=0,
                messages=[{"role": "user", "content": prompt}])
            return resp.choices[0].message.content or ""
    try:
        raw = completer(prompt)
    except Exception:
        return {"flags": [],
                "note": "The review could not run. Try again, or ask an advocate directly."}
    valid = {(p["act_title"], p["section_label"]) for p in passages}
    flags = parse_review_flags(raw, valid)
    if not flags:
        return {"flags": [],
                "note": "Nothing flaggable against the retrieved statutes. Ambiguous clauses still deserve an advocate's read."}
    return {"flags": flags, "note": ""}
