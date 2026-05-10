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

1. **Internal disclosure**: New attack vectors identified during research must be
   disclosed to the security team within 48 hours.
2. **Coordinated disclosure**: If a vulnerability is found in a third-party system
   (e.g., a vector database), follow their vulnerability disclosure policy.
3. **Publication**: Research findings may not be published without a 90-day embargo
   to allow mitigation by affected parties.
4. **No proof-of-concept weaponization**: Published papers must not include
   ready-to-deploy attack tooling.

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
