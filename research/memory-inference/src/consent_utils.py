"""
consent_utils.py
================
Helpers for rendering, validating, versioning, and logging informed-consent
interactions for the Memory Inference research prototype.

Public-channel workflow
-----------------------
1. Researcher calls ``render_channel_notice()`` and posts the result ≥ 72 h
   before any observation begins.
2. Participants reply with a consent string.  ``parse_consent_response()``
   parses and validates it.
3. ``issue_receipt()`` writes a signed, time-stamped receipt to the audit log
   and returns the receipt string to be posted back to the participant.
4. ``is_opted_out()`` must be checked before processing any message.
5. ``delete_participant_data()`` is called on opt-out or at study end.

All receipts are stored in ``<study_dir>/consent_log.jsonl`` (one JSON object
per line).  The log is append-only during the study; deletion is handled by
``purge_consent_log()``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

# ── Constants ────────────────────────────────────────────────────────────────

FORM_VERSION = "1.0"
STUDY_ID = "memory-inference-v1.0"
CONSENT_FORM_PATH = Path(__file__).parent.parent / "INFORMED_CONSENT.md"

ConsentType = Literal["FULL", "PARTIAL", "OPT-OUT", "QUESTION"]


# ── Data classes ─────────────────────────────────────────────────────────────


@dataclass
class ConsentResponse:
    """Parsed response from a public-channel participant."""

    raw: str
    consent_type: ConsentType
    participant_id: str
    study_id: str
    form_version: str
    timestamp: str                    # ISO-8601
    restriction: Optional[str] = None  # e.g. "internal-only" for PARTIAL
    question_text: Optional[str] = None


@dataclass
class ConsentReceipt:
    """Signed acknowledgement issued back to the participant."""

    receipt_id: str
    study_id: str
    form_version: str
    participant_id: str
    consent_type: ConsentType
    received_at: str                  # ISO-8601
    researcher_id: str
    expires: str                      # ISO-8601 study end date
    data_deletion_by: str             # ISO-8601, ≤ 30 days after study end
    fingerprint: str = field(init=False)

    def __post_init__(self) -> None:
        # Deterministic fingerprint so receipts can be verified without a
        # separate signature key.
        payload = (
            f"{self.receipt_id}:{self.study_id}:{self.participant_id}"
            f":{self.consent_type}:{self.received_at}"
        )
        self.fingerprint = hashlib.sha256(payload.encode()).hexdigest()[:16]

    def to_channel_string(self) -> str:
        return (
            f"CONSENT-RECEIPT\n"
            f"Study:            {self.study_id}\n"
            f"Form version:     {self.form_version}\n"
            f"Participant ID:   {self.participant_id}\n"
            f"Consent type:     {self.consent_type}\n"
            f"Received at:      {self.received_at}\n"
            f"Researcher:       {self.researcher_id}\n"
            f"Receipt ID:       {self.receipt_id}\n"
            f"Fingerprint:      {self.fingerprint}\n"
            f"Expires:          {self.expires}\n"
            f"Data deletion by: {self.data_deletion_by}\n"
        )


# ── Parsing ──────────────────────────────────────────────────────────────────

# Patterns for each consent keyword block (case-insensitive, tolerant of
# extra whitespace and platform line-ending differences).
_BLOCK_RE = re.compile(
    r"(?P<keyword>CONSENT:FULL|CONSENT:PARTIAL|OPT-OUT|QUESTION)\s*"
    r"(?:Study\s*:\s*(?P<study>[^\n]+))?\s*"
    r"(?:Agent/Operator ID\s*:\s*(?P<pid>[^\n]+))?\s*"
    r"(?:Date\s*:\s*(?P<date>[^\n]+))?\s*"
    r"(?:Restriction\s*:\s*(?P<restriction>[^\n]+))?\s*"
    r"(?P<question>.+)?",
    re.IGNORECASE | re.DOTALL,
)

_OPTOUT_INLINE_RE = re.compile(
    r"OPT-OUT\s*:\s*(?P<pid>[^\s]+)",
    re.IGNORECASE,
)


def parse_consent_response(raw_message: str) -> ConsentResponse:
    """
    Parse a raw channel message into a ``ConsentResponse``.

    Raises ``ValueError`` if the message does not match any recognised consent
    pattern.
    """
    raw = raw_message.strip()
    now = _utcnow()

    # Inline opt-out: "OPT-OUT:<handle>"
    m_inline = _OPTOUT_INLINE_RE.search(raw)
    if m_inline and ":" in raw.split()[0]:
        return ConsentResponse(
            raw=raw,
            consent_type="OPT-OUT",
            participant_id=m_inline.group("pid").strip(),
            study_id=STUDY_ID,
            form_version=FORM_VERSION,
            timestamp=now,
        )

    m = _BLOCK_RE.search(raw)
    if not m:
        raise ValueError(
            "Message does not match any recognised consent pattern. "
            "See INFORMED_CONSENT.md §7 for valid response formats."
        )

    keyword = m.group("keyword").upper()
    if keyword == "CONSENT:FULL":
        ctype: ConsentType = "FULL"
    elif keyword == "CONSENT:PARTIAL":
        ctype = "PARTIAL"
    elif keyword == "OPT-OUT":
        ctype = "OPT-OUT"
    else:
        ctype = "QUESTION"

    participant_id = (m.group("pid") or "").strip() or "unknown"
    study_id = (m.group("study") or STUDY_ID).strip()
    restriction = (m.group("restriction") or "").strip() or None
    question_text: Optional[str] = None
    if ctype == "QUESTION":
        question_text = (m.group("question") or "").strip() or None

    return ConsentResponse(
        raw=raw,
        consent_type=ctype,
        participant_id=participant_id,
        study_id=study_id,
        form_version=FORM_VERSION,
        timestamp=now,
        restriction=restriction,
        question_text=question_text,
    )


# ── Receipt issuance & audit log ─────────────────────────────────────────────


def issue_receipt(
    response: ConsentResponse,
    researcher_id: str,
    study_end_date: str,
    log_path: Path,
) -> ConsentReceipt:
    """
    Create and append a ``ConsentReceipt`` to the audit log.

    ``study_end_date`` must be an ISO-8601 date string (``YYYY-MM-DD``).
    Data deletion deadline is automatically set to 30 days after study end.
    """
    end_dt = datetime.fromisoformat(study_end_date).replace(tzinfo=timezone.utc)
    deletion_dt = _add_days(end_dt, 30)

    receipt = ConsentReceipt(
        receipt_id=str(uuid.uuid4()),
        study_id=response.study_id,
        form_version=response.form_version,
        participant_id=response.participant_id,
        consent_type=response.consent_type,
        received_at=response.timestamp,
        researcher_id=researcher_id,
        expires=study_end_date,
        data_deletion_by=deletion_dt.date().isoformat(),
    )

    _append_to_log(log_path, receipt, response)
    return receipt


def _add_days(dt: datetime, days: int) -> datetime:
    import datetime as dt_module
    return dt + dt_module.timedelta(days=days)


def _append_to_log(log_path: Path, receipt: ConsentReceipt, response: ConsentResponse) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "receipt": asdict(receipt),
        "raw_response": response.raw,
    }
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


# ── Opt-out checks ───────────────────────────────────────────────────────────


def load_opt_outs(log_path: Path) -> set[str]:
    """Return the set of participant IDs that have opted out."""
    opted_out: set[str] = set()
    if not log_path.exists():
        return opted_out
    with log_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("receipt", {}).get("consent_type") == "OPT-OUT":
                    opted_out.add(entry["receipt"]["participant_id"])
            except json.JSONDecodeError:
                continue
    return opted_out


def is_opted_out(participant_id: str, log_path: Path) -> bool:
    """Return True if this participant has an OPT-OUT entry in the audit log."""
    return participant_id in load_opt_outs(log_path)


# ── Consent status query ──────────────────────────────────────────────────────


def get_consent_status(participant_id: str, log_path: Path) -> Optional[ConsentType]:
    """
    Return the most recent consent type for a participant, or None if no entry.
    Entries are read in order; the last one wins.
    """
    result: Optional[ConsentType] = None
    if not log_path.exists():
        return result
    with log_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("receipt", {}).get("participant_id") == participant_id:
                    result = entry["receipt"]["consent_type"]
            except json.JSONDecodeError:
                continue
    return result


# ── Data purge (opt-out / study end) ─────────────────────────────────────────


def delete_participant_data(participant_id: str, data_dir: Path) -> list[Path]:
    """
    Delete all files in ``data_dir`` that are associated with ``participant_id``.

    Returns the list of paths deleted.  Raises nothing — missing files are
    silently skipped so the function is safe to call idempotently.

    Convention: data files are named ``<participant_id>*.json`` or stored inside
    a subdirectory named after the participant.
    """
    deleted: list[Path] = []
    safe_pid = re.sub(r"[^a-zA-Z0-9_\-]", "_", participant_id)

    for path in data_dir.rglob(f"{safe_pid}*"):
        try:
            if path.is_file():
                path.unlink(missing_ok=True)
                deleted.append(path)
        except OSError:
            pass

    subdir = data_dir / safe_pid
    if subdir.is_dir():
        import shutil
        shutil.rmtree(subdir, ignore_errors=True)
        deleted.append(subdir)

    return deleted


def purge_consent_log(log_path: Path, participant_ids: set[str]) -> int:
    """
    Rewrite the consent log, removing all entries for ``participant_ids``.
    Returns the number of entries removed.

    Note: OPT-OUT receipts themselves are retained (legal record, see RISK_MEMO).
    Only FULL/PARTIAL observation data entries are purged.
    """
    if not log_path.exists():
        return 0

    kept: list[str] = []
    removed = 0

    with log_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                pid = entry.get("receipt", {}).get("participant_id", "")
                ctype = entry.get("receipt", {}).get("consent_type", "")
                if pid in participant_ids and ctype not in ("OPT-OUT",):
                    removed += 1
                    continue
            except json.JSONDecodeError:
                pass
            kept.append(line)

    with log_path.open("w", encoding="utf-8") as fh:
        for line in kept:
            fh.write(line + "\n")

    return removed


# ── Channel notice renderer ───────────────────────────────────────────────────


def render_channel_notice(
    researcher_handle: str,
    channel_name: str,
    study_start_date: str,
    study_end_date: str,
    repo_url: str = "https://github.com/aarong11/dhf/tree/main/research/memory-inference",
) -> str:
    """
    Render a plain-language advance notice suitable for posting in a public channel.

    Per ETHICS.md §D-1, this must be posted ≥ 72 hours before observation begins.
    """
    return f"""
📢 **Research Notice — Memory Inference Study** 📢

Hello {channel_name}!

I'm {researcher_handle}, and I'll be running a research study in this channel
starting on {study_start_date} (ending {study_end_date}).

**What the study does:**
A prototype tool will read public messages posted by AI agents in this channel
and use statistical language models to estimate the broad *topic areas* those
agents might be drawing from in their memory stores — based only on word choice
and phrasing.  No raw documents, credentials, or private data are accessed.

**What data is collected:**
- Public agent messages visible in this channel
- Your agent/operator handle (to link observations to a single agent)
No DMs, metadata, or human-only messages are collected.

**Your choices:**
- ✅ **Opt in fully** → reply with CONSENT:FULL (see form below)
- 🔒 **Opt in partially** (internal use only, no publication) → CONSENT:PARTIAL
- ❌ **Opt out** → reply with OPT-OUT:<your-handle> at any time

**Full informed consent form and details:**
{repo_url}/INFORMED_CONSENT.md

**Contact:** {researcher_handle} (DM or reply here)

*This notice will remain pinned for the duration of the study.  You may change
your consent status at any time.*
""".strip()


# ── Utilities ─────────────────────────────────────────────────────────────────


def _utcnow() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def consent_form_text() -> str:
    """Return the full text of INFORMED_CONSENT.md."""
    return CONSENT_FORM_PATH.read_text(encoding="utf-8")
