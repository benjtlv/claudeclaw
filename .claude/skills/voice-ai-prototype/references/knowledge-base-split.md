# When to split content into a knowledge base file

Voice AI agents pay token costs on every turn. A bloated system prompt is expensive *and* slower. But aggressively cutting the prompt can hurt accuracy — if the agent needs something mid-conversation and has to tool-call for it, latency and error rates both rise.

The goal is balance: keep what the agent needs immediately in the prompt, push pure reference data into separate files the agent can retrieve when a specific question comes up.

## The rule of thumb

- **Target:** keep the main prompt under ~10,000 tokens.
- **Ceiling:** there is no hard ceiling. If the prompt *must* exceed 10k to stay accurate, let it. Never sacrifice correctness for token savings.
- **Estimation:** `tokens ≈ characters / 4`. Good enough — don't pull in a real tokenizer.

Only consider splitting when the prompt is above ~10k tokens *and* there's a clear chunk of pure reference data that can live outside without degrading behavior.

## What ALWAYS stays in the main prompt

These are non-negotiable. The agent reasons from them on every turn:

- Role, identity, company, what the agent calls itself
- Personality, tone, speech rules, filler-word guidance
- Objective, task description, success criteria
- Skills list
- **Steps** — the conversational flow (greeting, info collection, qualification, value delivery, booking, close)
- **Rules** — qualification IF/ONLY IF logic, transfer authorization, RULES TO NEVER BREAK
- Appointment-setting logic (calendar functions, timezone, AM/PM rules, error handling)
- Objection handling
- One-question-at-a-time rule and other conversational discipline
- Short speech examples (3–5 inline)
- Short FAQ-style content when the agent is expected to answer instantly without lookup (e.g., 3–5 core pricing Q&As)

If cutting it would make the agent *behave differently*, it stays.

## What is a CANDIDATE for a knowledge base file

Pure reference material the agent only consults to answer a specific caller question. Moving it out doesn't change how the agent acts — only what it knows when asked:

- Large FAQ lists (say, 15+ Q&As or >1,500 tokens of FAQ content)
- Product or service catalogs with many SKUs/options
- Pricing tables with many tiers or line items
- Multi-location hours / addresses / contact rosters
- Policy documents (refund policy, terms, warranty)
- Long company background, history, founder bios
- Insurance carrier lists, coverage matrices
- Long lists of "things we do / don't do"
- Compliance disclaimers that only fire in narrow cases

## Split decision checklist

For each candidate chunk, ask:

1. **Is this reference data, or behavior?** If removing it would change *how* the agent conducts the call, it's behavior — keep it in.
2. **Does the agent need it every call, or only when the caller asks?** Every call → keep in. Only on specific questions → candidate.
3. **Is it big enough to matter?** Splitting 300 tokens of FAQ isn't worth the indirection overhead. ~1,000+ tokens is the floor where splitting pays off.
4. **Would reading it as a file hurt accuracy?** If the agent needs to *cross-reference* this data against the current conversation state in real time, keep it in. If it's a straight lookup ("what are your hours in Tampa?"), splitting is safe.

If you answered "reference data, only on specific questions, large enough, straight lookup" → split.

## How to split

- **One KB file per logical topic.** Not one mega-KB. Good: `kb-faqs.txt`, `kb-pricing.txt`, `kb-locations.txt`, `kb-policies.txt`. Bad: `knowledge-base.txt` with everything crammed in.
- **Plain `.txt`** (not `.md`) — matches the existing convention in the repo and avoids confusing the voice platform about what's a prompt vs. what's data.
- **Co-located with the prompt**, in the same client folder. E.g., `CLIENTS/JOHN GIORDANI/kb-faqs.txt`.
- **Format inside the KB file**: whatever is clearest for that content. FAQs: `Q: ...` / `A: ...` blocks. Catalogs: a table or labeled list. Don't over-engineer.
- **Strip the split content from the main prompt completely** — don't leave a summary copy. Duplication is worse than either extreme.

## What to add to the main prompt after splitting

Add a short `## Knowledge Base` section near the bottom of the prompt (before "Notes"), listing each KB file and *when* to consult it. This is the bridge — without it the agent won't know the files exist.

Example:

```
## Knowledge Base

You have access to the following reference files. Consult them only when the caller asks a specific question covered by that file. Do not read them proactively.

- **kb-faqs.txt** — Detailed FAQs about pricing, scheduling, cancellation policy, and service areas. Consult when the caller asks a specific question about any of these topics that isn't covered above.
- **kb-locations.txt** — Full list of office locations with hours and addresses. Consult when the caller asks about a specific city, neighborhood, or location.
- **kb-insurance.txt** — Accepted insurance carriers and coverage notes. Consult when the caller mentions a specific insurance provider.
```

Keep this section short — it's navigation, not content.

## Reporting to the user

After deciding on a split (or deciding not to), tell the user clearly what you did and why. Example:

> Prompt was ~14k tokens — split out the FAQ block (~3k) into `kb-faqs.txt` and the carrier list (~1.5k) into `kb-insurance.txt`. Main prompt is now ~9.5k tokens. Kept all appointment-setting logic, objection handling, and rules inline since those affect behavior.

Or:

> Prompt is ~11k tokens but every section is behavioral (rules, steps, objections, appointment logic). Left it intact — splitting would hurt accuracy.

The user should always know whether a split happened, what moved, and why.
