# Prompt vs. Knowledge Base: the split decision

Every chunk of content destined for a voice agent goes in exactly one of two places: **the prompt** or **a knowledge base (`kb-*.txt`) file**. This doc tells you which goes where, and when to make the call.

**Make the split decision BEFORE you draft the prompt, not after.** Classify the source material first, then write the prompt already knowing which chunks won't be in it. Writing the whole prompt first and splitting later is the mistake that produces duplicated content — a compressed "quick reference" in the prompt AND the full version in a KB. That's the worst of both worlds: extra tokens *and* a second copy that silently drifts out of sync.

## The one rule

**Behavioral content → prompt. Reference content → KB. No exceptions. No duplication.**

| Behavioral (goes in prompt, always) | Reference (goes in KB, always) |
|---|---|
| Instructs the agent *how to act*, *what to say*, *when to do what* | Pure facts the agent *looks up* to answer a caller's specific question |
| Removing it changes the agent's behavior | Removing it only changes what the agent *knows* when asked |
| The agent needs it on *every* turn | The agent needs it only when a specific topic comes up |
| Steering at generation time | Lookup at retrieval time |

If a chunk is behavioral, it stays in the prompt **no matter how many tokens it adds**. If it's reference, it goes to a KB **no matter how few tokens it would save**. Token count is not the deciding factor — the nature of the content is.

## Behavioral content (prompt — always)

- Role, identity, company, agent name
- Personality, tone calibration, speech rules, filler-word guidance
- Objective, task, success criteria
- Steps — the full conversational flow (greeting, qualification, info collection, booking, close)
- Qualification IF/ONLY IF logic, transfer authorization, transfer rules
- Appointment-setting logic (calendar calls, timezone handling, AM/PM rules, error recovery)
- Objection handling scripts
- Handle-pushy-callers / difficult-caller rescue blocks
- Silence / hold / interruption handling
- Language to avoid, acknowledgment phrases, "never say X" lists
- Pronunciation rules (how to read prices, times, emails, website URLs)
- RULES TO NEVER BREAK
- Response length guidelines
- Special-response conventions (e.g. NO_RESPONSE_NEEDED, `--` pause marker)
- Any IF/THEN that governs what the agent *does*

If cutting it would make the agent *behave differently* on any call — even one the caller never asks a specific question on — it's behavioral. Keep it in.

**Size doesn't exempt it.** A 15k-token prompt full of behavioral content is correct. A 4k-token prompt missing the pushy-caller block because "we can put that in a KB" is broken.

## Reference content (KB — always)

Pure lookups. The agent only reads them when the caller asks a specific question that maps to them:

- Full pricing tables (all tiers, all line items)
- Service catalogs with many SKUs/options/descriptions
- Multi-location hours, addresses, contact rosters
- Team/stylist/staff rosters with specialties and schedules
- Parking structures, transit options, nearby landmarks
- Detailed policy text (refund, warranty, terms, cancellation fine print)
- Long company background, history, founder bios, press mentions
- Insurance carrier lists, coverage matrices
- Product/brand lists
- Service-specific deep-dives (e.g. "what does the premium package include, step by step")
- FAQ lists beyond the 3–5 the agent needs to answer instantly
- Compliance disclaimers for narrow cases

None of this changes how the agent conducts a call. All of it is retrievable on demand when a caller asks.

## The no-duplication rule

**Once content lives in a KB, it is gone from the prompt.** Not compressed. Not summarised. Not "quick-referenced." Gone.

The only thing the prompt keeps about split content is a single-line pointer in the `## Knowledge Base` section (see below) saying *which* KB to consult for *which* topic. That's navigation, not content.

Why this is non-negotiable:

- **Token waste.** The agent pays for every token in the prompt on every turn, whether it's the full version or a "compressed" version.
- **Drift risk.** Two copies of the same fact will silently diverge the next time someone updates one and forgets the other. The agent then confidently states contradictory things.
- **Single-source discipline.** When a fact changes, there's exactly one place to edit.

If you find yourself writing "Quick Reference:" or "Summary of [topic]:" in the prompt for content that's also in a KB — stop. Delete it. Add a `## Knowledge Base` pointer and trust the retrieval.

## The upfront classification pass

Before writing any prompt, walk through every chunk of the source material the client provided and label each one:

1. **Read the whole source first.** Don't start drafting while still discovering what's in it.
2. **For each section, ask:** "Does this tell the agent *how to act*, or *what the answer is*?"
   - *How to act* → behavioral → prompt.
   - *What the answer is* → reference → KB.
   - If both (e.g. "what should the agent say when asked X" — which embeds both a behavioral instruction *and* the answer content) → split it. Keep the instruction in the prompt, put the answer body in a KB if it's long, or inline it if it's short.
3. **Group reference chunks by topic.** Similar topics → one `kb-<topic>.txt` file. Don't make one giant `kb-everything.txt`.
4. **Sanity-check token count on the prompt side.** If the prompt is tracking toward >15k tokens and it's *still* all behavioral, fine — ship it. If it's tracking big and you spot any reference material that slipped through, that's your signal to re-classify, not to compress.

## Ambiguous cases

**"Common questions the caller might ask" lists** — if the list is just topics ("price ranges", "parking", "cancellation policies") with no answers attached, it's useless filler. Delete it. The agent already knows which KBs exist from the `## Knowledge Base` pointer, and the caller's actual question is what drives retrieval. Listing the topics inside the prompt adds tokens without adding capability.

**Short policy summaries inline with behavioral steps** — e.g. "If caller asks about cancellation, say: 'We ask for 24 hours notice...'". This is *behavioral* (it scripts the agent's response) even though the content is policy. Keep it in the prompt. Only push to KB when the full policy is long enough that the inline version would be a lossy compression.

**Small catalogs (3–5 items)** — e.g. a salon with only 3 services. Inline it in the prompt. Splitting a tiny list into a KB adds retrieval overhead without saving meaningful tokens.

**Long "about the company" paragraph** — reference. Split it. The agent doesn't need the founder's bio on every turn; it needs it if a caller asks.

**Pronunciation / speech rules for specific terms** — behavioral. Even though it's "reference-looking" (a list of words and how to say them), it steers every utterance. Keep in prompt.

## How to split (mechanics)

Once classification is done and you're writing the KBs:

- **One KB file per logical topic.** `kb-pricing.txt`, `kb-parking.txt`, `kb-policies.txt`, `kb-team.txt`. Not one mega-file.
- **Plain `.txt`** (not `.md`) — matches the Retell convention and avoids confusing the platform about prompt-vs-data.
- **Co-located with the prompt**, same client folder. E.g. `CLIENTS/JOHN GIORDANI/kb-faqs.txt`.
- **Format inside the file:** FAQ-style Topic/Question/Answer triples. See [faq-format.md](faq-format.md) for the canonical spec. This applies to *every* `kb-*.txt` regardless of source content shape — convert prose, tables, and catalogs into Topic/Question/Answer before saving.
- **Strip the split content from the prompt completely.** Not summarised. Not mirrored. Gone.

## The `## Knowledge Base` pointer section

Add a short section near the bottom of the prompt (above `Notes`) listing each KB file and *when* to consult it. This is the only thing the prompt retains about split content.

```
## Knowledge Base

You have access to the following reference files. Consult them only when the caller asks a specific question covered by that file. Do not read them proactively.

- **kb-pricing.txt** — Full pricing tables with all tiers and line items. Consult when the caller asks about a specific service price or tier.
- **kb-parking.txt** — Parking structures, addresses, validation rules. Consult when the caller asks about parking.
- **kb-team.txt** — Stylist roster with specialties, working days, and hours. Consult when the caller asks about a specific stylist or stylist availability.
- **kb-policies.txt** — Detailed salon policies (cancellation fine print, deposit rules, payment methods, membership terms). Consult when the caller asks a specific policy question.
```

Keep each line tight: *what's in it*, *when to consult*. This is navigation, not content.

## Reporting to the user

After you're done, tell the user clearly what went where and why.

Good:

> Classified the source doc: pricing tiers, parking lots, full stylist roster, and detailed policies were reference → split into `kb-pricing.txt`, `kb-parking.txt`, `kb-team.txt`, `kb-policies.txt`. Everything else (tone, steps, pushy-caller block, objection handling, rules, pronunciation) was behavioral → kept in the prompt. Prompt is ~8k tokens, all behavioral.

> Left all content in the prompt (~6k tokens). Client only provided behavioral guidance — nothing was pure reference. No KB files needed.

Bad:

> Prompt was big so I split out some stuff into KBs and left a quick-reference version in the prompt too just in case. *(This is the anti-pattern. Never do this.)*
