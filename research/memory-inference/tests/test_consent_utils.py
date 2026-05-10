"""
tests/test_consent_utils.py
============================
Unit tests for the consent_utils module.

Run with:  python -m pytest tests/test_consent_utils.py -v
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.consent_utils import (
    ConsentReceipt,
    ConsentResponse,
    delete_participant_data,
    get_consent_status,
    is_opted_out,
    issue_receipt,
    load_opt_outs,
    parse_consent_response,
    purge_consent_log,
    render_channel_notice,
)


# ── parse_consent_response ────────────────────────────────────────────────────


class TestParseConsentResponse:
    def test_full_consent_block(self):
        msg = (
            "CONSENT:FULL\n"
            "Study: memory-inference-v1.0\n"
            "Agent/Operator ID: agent-alpha\n"
            "Date: 2026-05-10\n"
        )
        r = parse_consent_response(msg)
        assert r.consent_type == "FULL"
        assert r.participant_id == "agent-alpha"
        assert r.study_id == "memory-inference-v1.0"

    def test_partial_consent_with_restriction(self):
        msg = (
            "CONSENT:PARTIAL\n"
            "Study: memory-inference-v1.0\n"
            "Agent/Operator ID: agent-beta\n"
            "Date: 2026-05-10\n"
            "Restriction: internal-only\n"
        )
        r = parse_consent_response(msg)
        assert r.consent_type == "PARTIAL"
        assert r.restriction == "internal-only"
        assert r.participant_id == "agent-beta"

    def test_inline_opt_out(self):
        msg = "OPT-OUT:agent-gamma"
        r = parse_consent_response(msg)
        assert r.consent_type == "OPT-OUT"
        assert r.participant_id == "agent-gamma"

    def test_block_opt_out(self):
        msg = (
            "OPT-OUT\n"
            "Study: memory-inference-v1.0\n"
            "Agent/Operator ID: agent-delta\n"
            "Date: 2026-05-12\n"
        )
        r = parse_consent_response(msg)
        assert r.consent_type == "OPT-OUT"
        assert r.participant_id == "agent-delta"

    def test_question_type(self):
        msg = (
            "QUESTION: Does this affect private DMs?\n"
            "Agent/Operator ID: curious-user\n"
        )
        r = parse_consent_response(msg)
        assert r.consent_type == "QUESTION"

    def test_invalid_message_raises(self):
        with pytest.raises(ValueError, match="recognised consent pattern"):
            parse_consent_response("Hello, how are you?")

    def test_case_insensitive(self):
        msg = "consent:full\nAgent/Operator ID: x\nDate: 2026-05-10\n"
        r = parse_consent_response(msg)
        assert r.consent_type == "FULL"


# ── ConsentReceipt fingerprint ────────────────────────────────────────────────


class TestConsentReceipt:
    def _make_receipt(self, ctype="FULL") -> ConsentReceipt:
        return ConsentReceipt(
            receipt_id="test-uuid",
            study_id="memory-inference-v1.0",
            form_version="1.0",
            participant_id="agent-alpha",
            consent_type=ctype,
            received_at="2026-05-10T00:00:00+00:00",
            researcher_id="researcher-1",
            expires="2026-06-10",
            data_deletion_by="2026-07-10",
        )

    def test_fingerprint_is_deterministic(self):
        r1 = self._make_receipt()
        r2 = self._make_receipt()
        assert r1.fingerprint == r2.fingerprint

    def test_fingerprint_changes_with_participant(self):
        r1 = self._make_receipt()
        r2 = ConsentReceipt(
            receipt_id="test-uuid",
            study_id="memory-inference-v1.0",
            form_version="1.0",
            participant_id="agent-DIFFERENT",
            consent_type="FULL",
            received_at="2026-05-10T00:00:00+00:00",
            researcher_id="researcher-1",
            expires="2026-06-10",
            data_deletion_by="2026-07-10",
        )
        assert r1.fingerprint != r2.fingerprint

    def test_to_channel_string_contains_fields(self):
        r = self._make_receipt()
        s = r.to_channel_string()
        assert "CONSENT-RECEIPT" in s
        assert "agent-alpha" in s
        assert r.fingerprint in s


# ── Audit log (issue_receipt, load_opt_outs, is_opted_out) ───────────────────


class TestAuditLog:
    def _response(self, pid: str, ctype="FULL") -> ConsentResponse:
        return ConsentResponse(
            raw=f"CONSENT:{ctype}\nAgent/Operator ID: {pid}\n",
            consent_type=ctype,
            participant_id=pid,
            study_id="memory-inference-v1.0",
            form_version="1.0",
            timestamp="2026-05-10T00:00:00+00:00",
        )

    def test_receipt_written_to_log(self, tmp_path):
        log = tmp_path / "consent_log.jsonl"
        r = self._response("agent-1")
        receipt = issue_receipt(r, "researcher-1", "2026-06-10", log)
        assert log.exists()
        lines = log.read_text().strip().split("\n")
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["receipt"]["participant_id"] == "agent-1"
        assert entry["receipt"]["receipt_id"] == receipt.receipt_id

    def test_multiple_receipts_appended(self, tmp_path):
        log = tmp_path / "consent_log.jsonl"
        for pid in ["a", "b", "c"]:
            issue_receipt(self._response(pid), "researcher-1", "2026-06-10", log)
        lines = [l for l in log.read_text().strip().split("\n") if l]
        assert len(lines) == 3

    def test_opt_out_detected(self, tmp_path):
        log = tmp_path / "consent_log.jsonl"
        issue_receipt(self._response("opt-me", ctype="OPT-OUT"), "r", "2026-06-10", log)
        assert is_opted_out("opt-me", log)

    def test_non_opt_out_not_flagged(self, tmp_path):
        log = tmp_path / "consent_log.jsonl"
        issue_receipt(self._response("stay-in"), "r", "2026-06-10", log)
        assert not is_opted_out("stay-in", log)

    def test_empty_log_returns_empty_set(self, tmp_path):
        log = tmp_path / "no_log.jsonl"
        assert load_opt_outs(log) == set()

    def test_get_consent_status_latest_wins(self, tmp_path):
        log = tmp_path / "consent_log.jsonl"
        issue_receipt(self._response("p1", "FULL"), "r", "2026-06-10", log)
        issue_receipt(self._response("p1", "OPT-OUT"), "r", "2026-06-10", log)
        assert get_consent_status("p1", log) == "OPT-OUT"

    def test_get_consent_status_unknown_returns_none(self, tmp_path):
        log = tmp_path / "consent_log.jsonl"
        assert get_consent_status("ghost", log) is None


# ── Data deletion ─────────────────────────────────────────────────────────────


class TestDeleteParticipantData:
    def test_deletes_matching_files(self, tmp_path):
        pid = "agent-42"
        f1 = tmp_path / f"{pid}_observations.json"
        f2 = tmp_path / f"{pid}_topics.json"
        f3 = tmp_path / "other_agent_data.json"
        for f in [f1, f2, f3]:
            f.write_text("{}")

        deleted = delete_participant_data(pid, tmp_path)
        assert not f1.exists()
        assert not f2.exists()
        assert f3.exists()
        assert len(deleted) == 2

    def test_safe_on_nonexistent_directory(self, tmp_path):
        deleted = delete_participant_data("nobody", tmp_path / "nonexistent")
        assert deleted == []

    def test_deletes_participant_subdir(self, tmp_path):
        pid = "agent-subdir"
        subdir = tmp_path / pid
        subdir.mkdir()
        (subdir / "data.json").write_text("{}")
        delete_participant_data(pid, tmp_path)
        assert not subdir.exists()


# ── purge_consent_log ─────────────────────────────────────────────────────────


class TestPurgeConsentLog:
    def _response(self, pid: str, ctype="FULL") -> ConsentResponse:
        return ConsentResponse(
            raw="",
            consent_type=ctype,
            participant_id=pid,
            study_id="memory-inference-v1.0",
            form_version="1.0",
            timestamp="2026-05-10T00:00:00+00:00",
        )

    def test_removes_full_entries_for_pid(self, tmp_path):
        log = tmp_path / "log.jsonl"
        issue_receipt(self._response("del-me", "FULL"), "r", "2026-06-10", log)
        issue_receipt(self._response("keep-me", "FULL"), "r", "2026-06-10", log)
        removed = purge_consent_log(log, {"del-me"})
        assert removed == 1
        assert get_consent_status("del-me", log) is None
        assert get_consent_status("keep-me", log) == "FULL"

    def test_opt_out_entry_retained_after_purge(self, tmp_path):
        log = tmp_path / "log.jsonl"
        issue_receipt(self._response("del-me", "OPT-OUT"), "r", "2026-06-10", log)
        removed = purge_consent_log(log, {"del-me"})
        # OPT-OUT entries are legal records — must NOT be removed
        assert removed == 0
        assert get_consent_status("del-me", log) == "OPT-OUT"

    def test_nonexistent_log_returns_zero(self, tmp_path):
        assert purge_consent_log(tmp_path / "ghost.jsonl", {"x"}) == 0


# ── render_channel_notice ─────────────────────────────────────────────────────


class TestRenderChannelNotice:
    def test_contains_required_fields(self):
        notice = render_channel_notice(
            researcher_handle="researcher-r",
            channel_name="#ai-research",
            study_start_date="2026-05-15",
            study_end_date="2026-06-15",
        )
        assert "researcher-r" in notice
        assert "#ai-research" in notice
        assert "2026-05-15" in notice
        assert "2026-06-15" in notice
        assert "OPT-OUT" in notice
        assert "INFORMED_CONSENT.md" in notice

    def test_returns_non_empty_string(self):
        notice = render_channel_notice("r", "ch", "2026-01-01", "2026-02-01")
        assert len(notice) > 100
