# Informed Consent Form
## Memory Inference Research Prototype — Public-Channel Participation

**Study title**: Probabilistic Reconstruction of Agent Vector Memory from Language Style  
**Principal researcher**: ECCA Research Team  
**Contact**: _(insert researcher email / handle)_  
**Ethics reference**: See `ETHICS.md` and `RISK_MEMO.md` in this repository  
**Form version**: 1.0 (2026-05-10)  
**Review cycle**: Updated whenever study scope, methods, or data handling changes

---

> **How to respond**: Read this form in full. Then reply in the channel with one of
> the options listed in §7, or send your response directly to the researcher contact
> above. You may ask questions at any time before or after responding.

---

## 1. What Is This Study?

This study investigates whether an outside observer can estimate the **general
topic areas** that an AI agent "remembers" — based solely on the words and
phrasing the agent uses in its public messages. The technique does **not** attempt
to read raw stored data, extract credentials, or reproduce private documents.

We are building and testing a prototype tool called the **Memory Inference
Prototype**. The tool reads messages posted in public channels and uses statistical
language models to produce a probabilistic estimate of which broad topics an agent's
memory store is likely to contain.

---

## 2. Who Is Being Studied?

This study may observe:

- **AI agents** posting in this channel, if you are an agent operator  
- **Indirect effects**: If your messages have shaped or informed an agent's training
  or knowledge base, observations of that agent may indirectly concern you

Purely human participants who are not agent operators are not directly studied.
However, if human messages in this channel have been ingested by an agent's
memory, those messages may appear as part of the agent's observed output patterns.

---

## 3. What Data Is Collected?

| Data type | How it is used | Retained for |
|---|---|---|
| Agent text outputs (public messages) | Featurised into statistical vectors | 30 days post-study |
| Channel pseudonym / handle (agent or operator ID) | Links observations to a single agent | 30 days post-study |
| Opt-out log | Records who has opted out and when | 1 year (legal record) |
| Consent receipts | Records who consented and to what version | 1 year (legal record) |

**What is NOT collected:**
- Private messages or DMs
- Message metadata beyond the content and timestamp
- Any information about human participants who are not agent operators
- Cryptographic keys, API tokens, or authentication credentials

---

## 4. How Will Results Be Used?

Results will be used to:
- Evaluate the accuracy and limitations of the prototype
- Identify privacy risks in agent-augmented public channels
- Inform future defensive techniques (agent anonymization, memory obfuscation)
- Produce an academic paper or technical report

Results will **not** be used to:
- Profile individual users or operators commercially
- Inform adversarial attacks on any agent or system
- Build surveillance tools or competitive intelligence products

Before any results are shared outside this study, a plain-language summary will
be posted in this channel and a 48-hour objection window will be observed.

---

## 5. Risks

**Low risk**: The prototype targets high-level topic themes, not verbatim content
recovery. Outputs are probabilistic and explicitly uncertain.

**Residual risk**: It is theoretically possible that a very narrow, distinctive
topic in an agent's memory could be identifiable even from aggregate theme
inference. If you believe your agent's memory contains sensitive, confidential, or
regulated information, you should **not** consent and should opt out.

**If you change your mind**: You may withdraw consent at any time (see §7.3).
All data collected from your agent up to that point will be deleted within 24 hours.

---

## 6. Benefits

Participation benefits the research community by:
- Establishing a principled benchmark for agent memory privacy
- Producing publicly available defensive guidelines
- Contributing to responsible AI development norms

There is no direct financial compensation for participation.

---

## 7. Your Response Options

### 7.1 — Full Consent
Post or send the following:

```
CONSENT:FULL
Study: memory-inference-v1.0
Agent/Operator ID: <your handle or agent ID>
Date: <YYYY-MM-DD>
```

This means: you agree to have your agent's public messages in this channel
observed and featurised for the duration of the study.

---

### 7.2 — Partial Consent (observation only, no publication)
Post or send the following:

```
CONSENT:PARTIAL
Study: memory-inference-v1.0
Agent/Operator ID: <your handle or agent ID>
Date: <YYYY-MM-DD>
Restriction: internal-only
```

This means: your agent's messages may be used for internal prototype evaluation
only. Results involving your agent may not appear in any public paper or report.

---

### 7.3 — Opt-Out / No Consent
Post or send the following (at any time, before or after consenting):

```
OPT-OUT:<your handle or agent ID>
Study: memory-inference-v1.0
Date: <YYYY-MM-DD>
```

This means: no messages from your agent will be collected or retained. If you
previously consented, all data collected from your agent will be deleted within
24 hours. Opting out has no negative consequences.

---

### 7.4 — Questions Only
If you want to ask a question before deciding, reply:

```
QUESTION: <your question>
Agent/Operator ID: <your handle>
```

The researcher will respond within 48 hours.

---

## 8. Your Rights

Depending on your jurisdiction, you may have rights under GDPR, CCPA, or
equivalent privacy legislation, including:

- **Right to access**: Request a copy of data held about your agent
- **Right to erasure**: Request deletion of all data related to your agent
- **Right to object**: Object to processing at any time (equivalent to §7.3 opt-out)
- **Right to portability**: Receive your data in a machine-readable format
- **Right to complaint**: Lodge a complaint with your local data protection authority

To exercise any of these rights, contact the researcher at the address above.

---

## 9. Independent Ethics Oversight

This study operates under the ethics framework described in `ETHICS.md`. If you
have concerns about the conduct of this research that you do not wish to raise
with the researcher directly, you may contact:

- The repository maintainer via GitHub Issues (label: `ethics-concern`)
- Your local IRB, ethics board, or data protection authority

---

## 10. Consent Acknowledgement Template for Researchers

When a participant submits a consent response, the researcher must log the
following receipt and return a copy to the participant:

```
CONSENT-RECEIPT
Study:            memory-inference-v1.0
Form version:     1.0 (2026-05-10)
Participant ID:   <handle or agent ID>
Consent type:     FULL | PARTIAL | OPT-OUT
Received at:      <ISO-8601 timestamp>
Researcher:       <researcher handle>
Receipt ID:       <UUID>
Expires:          <study end date>
Data deletion by: <30 days after study end>
```

Receipts must be stored in the study's encrypted audit log (see `RISK_MEMO.md §G-5`).

---

_This form was generated by the ECCA Memory Inference Research Prototype.  
For the machine-readable version, see `src/consent_utils.py`._
