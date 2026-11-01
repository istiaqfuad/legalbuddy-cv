"""Recommender scoring: area gate, cosine, Bayesian rating weight."""

import pytest

from legalbuddy import matcher as m


def cand(name, areas, **kw):
    base = {
        "user_id": name,
        "display_name": name.title(),
        "practice_areas": areas,
        "languages": ["english"],
        "city": None,
        "bar_association": "Dhaka Bar Association",
        "profile_embedding": [1.0, 0.0],
        "rating_total": 0,
        "rating_count": 0,
        "rating_avg": 0.0,
    }
    base.update(kw)
    return base


def need(dominant="property", emb=None, **kw):
    base = {
        "areas": [dominant, "family"],
        "dominant": dominant,
        "summary": "land dispute",
        "bangla": False,
        "matter_embedding": emb or [1.0, 0.0],
    }
    base.update(kw)
    return base


class TestCosine:
    def test_identical_is_one(self):
        assert m.cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)

    def test_orthogonal_is_zero(self):
        assert m.cosine([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_mismatched_lengths_zero(self):
        assert m.cosine([1.0], [1.0, 2.0]) == 0.0


class TestBayesianRating:
    def test_no_reviews_is_neutral(self):
        assert m.bayesian_rating(0, 0) == pytest.approx(3.5 / 5.0)

    def test_perfect_record_approaches_one(self):
        assert m.bayesian_rating(25, 5) == pytest.approx((10.5 + 25) / 8 / 5)

    def test_single_bad_review_does_not_crater(self):
        # (10.5 + 1) / 4 / 5 = 0.575: punished, still rankable.
        assert m.bayesian_rating(1, 1) == pytest.approx(0.575)


class TestScoreLawyers:
    def test_dominant_area_gates(self):
        lawyers = [cand("prop", ["property"]), cand("crim", ["criminal"])]
        ranked = m.score_lawyers(need(), lawyers)
        assert [r["user_id"] for r in ranked] == ["prop"]

    def test_relaxes_to_secondary_areas(self):
        lawyers = [cand("fam", ["family"])]
        ranked = m.score_lawyers(need(), lawyers)
        assert [r["user_id"] for r in ranked] == ["fam"]
        assert ranked[0]["area_score"] == 0.5

    def test_empty_pool_returns_empty(self):
        assert m.score_lawyers(need(), [cand("crim", ["criminal"])]) == []
        assert m.score_lawyers({**need(), "dominant": None}, [cand("p", ["property"])]) == []

    def test_rating_breaks_similarity_ties(self):
        # Same area, same embedding: the better-rated lawyer must win.
        mid = cand("mid", ["property"], rating_total=12, rating_count=3,
                   rating_avg=4.0)
        top = cand("top", ["property"], rating_total=25, rating_count=5,
                   rating_avg=5.0)
        ranked = m.score_lawyers(need(), [mid, top])
        assert ranked[0]["user_id"] == "top"

    def test_new_lawyer_stays_rankable(self):
        # No reviews reads neutral (0.7), not zero: a new lawyer with a
        # perfect semantic fit is not buried by rated peers.
        new = cand("new", ["property"], profile_embedding=[1.0, 0.0])
        rated = cand("rated", ["property"], profile_embedding=[0.7, 0.7],
                     rating_total=20, rating_count=5, rating_avg=4.0)
        ranked = m.score_lawyers(need(), [rated, new])
        assert ranked[0]["user_id"] == "new"

    def test_bangla_boost(self):
        bn = cand("bn", ["property"], languages=["english", "bangla"])
        en = cand("en", ["property"], languages=["english"])
        ranked = m.score_lawyers(need(bangla=True), [en, bn])
        assert ranked[0]["user_id"] == "bn"

    def test_explanation_names_inputs(self):
        lawyer = cand("nasrin", ["property"], display_name="Nasrin",
                      rating_total=9, rating_count=2, rating_avg=4.5)
        text = m.explain(need(), lawyer, 3)
        assert "3 of your recent chats" in text
        assert "property" in text
        assert "Nasrin" in text
        assert "4.5/5" in text


class TestClassifyFallback:
    def test_client_error_yields_empty(self):
        class Boom:
            @property
            def chat(self):
                raise AssertionError("unreachable")

        out = m.classify_matters("1. hello", Boom(), "model")
        assert out == {"areas": [], "dominant": None, "summary": "", "bangla": False}
