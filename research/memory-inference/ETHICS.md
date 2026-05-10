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

## Ethical Review Checklist

Before any real-agent experiment, the researcher must confirm:

- [ ] Written authorization from agent operator obtained
- [ ] Data processed contains no PII or regulated information
- [ ] Results will not be shared in a way that enables misuse
- [ ] Findings will be disclosed responsibly (see RISK_MEMO.md)
- [ ] IRB or equivalent ethics board review completed (if applicable)
