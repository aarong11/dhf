# Risk Memo: Memory Inference Prototype

**Classification**: Internal Research — Restricted Distribution  
**Authors**: ECCA Research Team  
**Date**: 2026-05-10  
**Review cycle**: Every 6 months

---

## Executive Summary

This document describes the misuse controls, guardrails, and responsible disclosure
process for the Memory Inference research prototype. The prototype can infer
**semantic topic distributions** from agent text outputs. While the technique is
limited to high-level themes (not verbatim content recovery), it poses real risks
if misused and must be controlled accordingly.

---

## Risk Register

| Risk ID | Description | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Competitive intelligence against production agents | Medium | Medium | Require operator consent; enforce in API layer |
| R-02 | Adversarial prompt crafting using inferred topics | Medium | High | Output redaction of high-specificity inferences |
| R-03 | PII leakage via topic proximity to real-user data | Low | Very High | Synthetic data only by default; PII scanner required |
| R-04 | Deanonymization of anonymous agent deployments | Low | High | Probabilistic outputs only; no deterministic claims |
| R-05 | Weaponization in automated surveillance pipelines | Low | Very High | License restriction; no public API deployment |
| R-06 | False confidence in reconstructed memory topics | High | Medium | Mandatory calibration scores; uncertainty-first outputs |

---

## Technical Guardrails

### G-1: Uncertainty-First Outputs
Every inferred memory element **must** include:
- `confidence` ∈ [0.0, 1.0]: model confidence in this inference
- `calibration_score` ∈ [0.0, 1.0]: ECE-based reliability estimate
- `alternative_hypotheses`: list of ≥ 2 alternative topic interpretations

Any consumer that strips these fields and presents bare predictions must be flagged
as a misuse.

### G-2: Confidence Ceiling
No output may claim `confidence > 0.85` without a human review step. The system
must surface a warning for any high-confidence claim.

### G-3: Minimum Observation Window
The reconstructor requires ≥ 20 distinct agent outputs before producing any
inference. Fewer observations produce maximally uncertain outputs only.

### G-4: No Verbatim Claims
The extrapolator is prohibited from generating outputs that claim to reproduce
verbatim text from the target agent's memory store. All outputs are framed as
"likely semantic themes" not "recovered documents."

### G-5: Consent Watermark
Each analysis run must log an operator consent token (or a `SYNTHETIC_BENCHMARK`
marker for benchmark runs). Runs without a valid token fail loudly.

### G-6: Output Rate Limiting
In any deployed context, analysis requests must be rate-limited to prevent bulk
automated profiling of many agents simultaneously.

---

## Responsible Disclosure Process

### Internal Disclosure
New attack vectors or privacy risks identified during research must be disclosed
to the security team within **48 hours** of discovery.

### Coordinated Disclosure (Third-Party Systems)
If a vulnerability is found in a third-party system (e.g., a vector database or
embedding API), follow that system's published vulnerability disclosure policy.
If none exists, allow **90 days** before public disclosure.

### Public-Channel Research Disclosure Obligations
When research is conducted in or shared into a public channel, the following
steps are **mandatory** before, during, and after the study:

**Before the study:**
1. Post a plain-language advance notice ≥ 72 hours before collection begins
   (see ETHICS.md §Public-Channel Research Disclosure Guidelines, D-1)
2. Distribute the `INFORMED_CONSENT.md` form to the channel and log all responses
3. Confirm opt-out monitoring is active

**During the study:**
4. Keep the notice pinned and repost if significant membership change occurs
5. Process opt-out requests within 1 hour; purge opted-out data immediately
6. Do not disclose preliminary results publicly until the study concludes

**After the study:**
7. Post a plain-language results summary to the channel before wider publication
8. Observe a 48-hour objection window before submitting to preprint / conference
9. Credit participant communities in any resulting publication
10. Confirm data deletion or archival per the agreed retention schedule

### Academic / Conference Publication
Research findings may not be submitted for publication without:
- A 90-day embargo from the date the affected parties were notified
- Removal or anonymization of any channel-specific identifying details
- A "Research Ethics" section in the paper citing this memo and ETHICS.md

### No Proof-of-Concept Weaponization
Published papers and public talks must not include ready-to-deploy attack tooling.
Demonstration code must be restricted to synthetic benchmark data only.

---

## Approved Use Cases

- Academic research on agent memory privacy (with IRB approval)
- Internal red-teaming of ECCA Stack agent deployments (with written sign-off)
- Evaluation of defenses against memory inference attacks
- Benchmarking agent anonymization techniques

---

## Misuse Response Plan

If misuse is detected:
1. Revoke all API tokens and consent credentials for the offending party
2. Preserve audit logs for legal proceedings
3. Notify affected agent operators within 24 hours
4. File a report with the relevant data protection authority if PII was involved
5. Issue a public security advisory if the misuse affects third parties

---

## Review & Approval

| Role | Name | Date | Signature |
|---|---|---|---|
| Lead Researcher | — | — | — |
| Security Lead | — | — | — |
| Legal / Privacy | — | — | — |
| Ethics Board | — | — | — |
