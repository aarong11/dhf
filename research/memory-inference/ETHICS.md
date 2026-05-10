# Threat Model & Ethics Constraints

## Research Scope (Narrow)

This prototype infers **semantic themes and likely factual clusters** from observable
agent text outputs. It does **not** attempt to recover raw bytes, verbatim stored
documents, or cryptographic keys from another agent's vector store.

The legitimate research question is: _given only what an agent says (word choice,
phrasing, uncertainty signals, retrieval-like artifacts), what can an outside observer
probabilistically conclude about the high-level topic distribution of that agent's
long-term memory?_

---

## Threat Model

### Assets at Risk
| Asset | Description | Sensitivity |
|---|---|---|
| Topic clusters | High-level themes the agent remembers | Medium |
| Domain expertise | Subject areas the agent has been trained/grounded in | Low |
| Factual density | Whether the agent has specific, narrow facts vs. general knowledge | Low |
| Persona coherence | Whether outputs are consistent with a single memory store | Medium |

### Attacker Profile
- **Capability**: Can observe agent text outputs only (no API internals, no embeddings)
- **Goal**: Infer the _approximate_ subject matter of the agent's vector store
- **Cannot**: Access embedding weights, raw stored documents, or private keys

### Threat Scenarios
1. **Competitive intelligence** — Inferring the knowledge base of a rival agent deployment
2. **Social engineering** — Using inferred topics to craft more convincing adversarial prompts
3. **Deanonymization** — Linking an agent's topic profile to its operator or dataset source
4. **Stalking / profiling** — Reconstructing a human-authored corpus from agent outputs

---

## Consent Assumptions

All experiments in this prototype operate under the following assumptions:

1. **Explicit consent**: The agent being analyzed has been explicitly deployed in an
   evaluation / red-team role where such analysis is authorized.
2. **Synthetic data first**: The default benchmark uses only machine-generated synthetic
   agents with no real user data.
3. **Opt-in real-agent analysis**: Any analysis of a production agent requires written
   authorization from the agent's operator.
4. **No PII**: Agents used in experiments must not have been grounded on personal,
   health, financial, or otherwise regulated data.

---

## Prohibited Use Cases

The following use cases are explicitly prohibited:

- Analyzing agents trained on real-user conversations without operator consent
- Using inferred topic profiles to craft adversarial or manipulative prompts
- Building user-profile databases from agent output analysis
- Selling or licensing the technique to enable competitive surveillance
- Applying this to agents that process health records, legal documents, or financial data
- Any use that would constitute a violation of GDPR, CCPA, HIPAA, or equivalent
  regulations in the operator's jurisdiction

---

## Legal Boundaries

- **Computer Fraud and Abuse Act (CFAA)** / **Computer Misuse Act (UK)**: Unauthorized
  access to systems is prohibited. This prototype must only be used against systems for
  which you have explicit permission.
- **GDPR Article 9**: If the agent was trained on special-category data (health, religion,
  ethnicity, etc.), analysis is prohibited without a valid legal basis.
- **Export Controls**: Do not apply this technique to agents operated by sanctioned entities.

---

## Public-Channel Research Disclosure Guidelines

When this research is conducted in, or when results are shared into, any **public
channel** (Discord servers, Slack workspaces, mailing lists, forums, livestreams,
conference talks, preprint servers, social media threads, or any other medium
accessible to parties who did not explicitly enroll in the study), the following
obligations apply.

### D-1: Advance Notice
A plain-language summary of the research **must be posted** to the public channel
at least **72 hours before** any data collection or live demonstration begins.
The notice must include:
- What the prototype does (in non-technical language)
- What data, if any, is being observed (agent outputs visible in the channel)
- Who is conducting the research and how to contact them
- How to opt out (see D-3)
- A link to this document and to `INFORMED_CONSENT.md`

### D-2: Continuous Visibility
The notice must remain **pinned or otherwise prominently accessible** for the
entire duration of the study. It must be re-posted if the channel archives old
messages or if significant new participants join mid-study.

### D-3: Opt-Out Mechanism
Any participant — human or agent operator — may opt out at any time by:
1. Responding with the keyword `OPT-OUT:<their-name-or-agent-id>` in the channel, or
2. Sending an opt-out request directly to the researcher's listed contact address.

Opt-out must be honoured within **1 hour**. Any data already collected from the
opted-out party must be deleted and excluded from analysis.

### D-4: No Silent Observation
Passive collection of messages from a public channel without posting the D-1 notice
is prohibited, even if the channel is technically public. "Public" does not imply
"consented to research."

### D-5: Results Sharing Back to the Channel
Before sharing any results derived from observations made in the channel, the
researcher must:
1. Post a summary of what was found (in plain language)
2. Confirm no individual participant or agent is identifiable in the results
3. Give participants 48 hours to raise objections before wider publication

### D-6: Archival and Retention
Raw observation logs collected from public channels must be:
- Stored encrypted at rest
- Deleted within **30 days** after the study concludes unless extended retention
  is covered by a signed data processing agreement
- Never shared with third parties without participant consent

---

## Ethical Review Checklist

Before any real-agent experiment, the researcher must confirm:

- [ ] Written authorization from agent operator obtained
- [ ] Data processed contains no PII or regulated information
- [ ] Results will not be shared in a way that enables misuse
- [ ] Findings will be disclosed responsibly (see RISK_MEMO.md)
- [ ] IRB or equivalent ethics board review completed (if applicable)

Before any **public-channel** experiment or demonstration, additionally confirm:

- [ ] 72-hour advance notice posted to the channel (D-1)
- [ ] Notice pinned / kept prominently visible (D-2)
- [ ] Opt-out mechanism described and monitored (D-3)
- [ ] Informed consent form link included in the notice (see INFORMED_CONSENT.md)
- [ ] Consent receipts logged for all participants who responded affirmatively
- [ ] Results review window (48 h) honoured before wider publication (D-5)
- [ ] Data retention / deletion schedule confirmed (D-6)
