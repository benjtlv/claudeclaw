# FAQ Format for Knowledge Base Files

Every `kb-*.txt` file attached to a Retell agent must be written in **FAQ format** (Topic / Question / Answer triples). Voice agents retrieve from KBs by semantic match against the caller's spoken question — the closer the file's structure mirrors how a human would actually ask, the higher the retrieval accuracy.

This is the canonical format. Use it for every new `kb-*.txt`, and convert any legacy prose-style KB to this format the next time you touch it.

## When to apply this format

- Creating any new `kb-*.txt` file (in `voice-ai-prototype` Step 3.5, or `voice-ai-improve-prompt` Step B2).
- Editing an existing `kb-*.txt` that's still in raw prose — convert opportunistically, in the same commit as your other changes.
- Splitting prose out of a main prompt into a sibling `kb-*.txt` — the prose gets reformatted on the way out, not pasted as-is.

## The format

Each entry is exactly three lines (plus a blank line between entries):

```
**Topic:** [short category, 1-3 words]
**Question:** [the question phrased the way a caller would actually ask it, out loud]
**Answer:** [complete answer with all necessary detail — never lose meaning from the source]
```

No headers, no preamble, no closing notes. Just entries, back-to-back, separated by a blank line. The agent retrieves entry-by-entry, so each one must stand on its own.

## Rules

1. **One question per entry.** If a source paragraph covers three things (e.g., return window + condition + refund timing), produce three separate FAQ entries. Don't compress.
2. **Phrase the Question as a caller would say it.** "What's your return policy?" beats "Return policy details." If a real caller would ask multiple variants ("can I return this?" vs. "what's your refund policy?"), pick the most natural one — semantic search handles the rest.
3. **Answer fully, but tightly.** Every fact, number, hour, email, phone, and condition from the source must appear in some Answer. No summarizing away specifics. But cut filler ("we want you to be fully satisfied") — that's marketing copy, not retrievable info.
4. **Topic is for grouping, not searching.** Keep it short and reusable across entries (`Returns`, `Hours`, `Pricing`, `Insurance`, `Booking`). Don't invent a unique topic per entry.
5. **No cross-references between entries.** Don't write "see the return policy entry above" — the agent retrieves one entry at a time and won't see siblings. If two entries need the same fact, repeat it.
6. **Preserve verbatim what must stay verbatim.** Phone numbers, email addresses, prices, license numbers, hours, exact policy language — copy these exactly. Paraphrasing a price is a bug.
7. **Skip nothing from the source.** If the source has 12 distinct facts, the FAQ has at least 12 entries (often more, if a fact has multiple natural caller phrasings).

## Example

### Source (raw prose):

> At Acme Returns, we want you to be fully satisfied with your purchase. If for any reason you are not completely happy with your order, we offer a hassle-free return policy.
>
> Return Window: You may return items within 30 days of the original purchase date. After 30 days, unfortunately, we cannot offer a refund or exchange.
>
> Item Condition: To be eligible for a return, your item must be unused, in the same condition that you received it, and in its original packaging.
>
> Proof of Purchase: A receipt or proof of purchase is required for all returns. Without this, we will be unable to process your refund.
>
> Return Process: To initiate a return, please contact our customer service team at support@acme.com or call us at 1-800-555-0199.
>
> For any questions about returns, please reach out to our customer service team during our business hours, Monday to Friday, 9 AM to 5 PM EST.

### Output (`kb-returns.txt`):

```
**Topic:** Returns
**Question:** What is your return policy?
**Answer:** We accept returns within 30 days of the original purchase date. After 30 days we cannot offer a refund or exchange. Items must be unused, in the same condition you received them, and in original packaging. A receipt or proof of purchase is required.

**Topic:** Returns
**Question:** How long do I have to return something?
**Answer:** You have 30 days from the original purchase date. After 30 days, refunds and exchanges are not available.

**Topic:** Returns
**Question:** Do I need a receipt to return something?
**Answer:** Yes, a receipt or proof of purchase is required for all returns. Without it, we cannot process your refund.

**Topic:** Returns
**Question:** What condition does the item need to be in?
**Answer:** The item must be unused, in the same condition you received it, and in its original packaging. Items that have been worn, washed, or altered may not qualify.

**Topic:** Returns
**Question:** How do I start a return?
**Answer:** Contact our customer service team at support@acme.com or call 1-800-555-0199. They will provide a return authorization and instructions on how to send the item back.

**Topic:** Customer Support
**Question:** How can I contact customer support?
**Answer:** Email support@acme.com or call 1-800-555-0199. Hours are Monday through Friday, 9 AM to 5 PM Eastern.

**Topic:** Customer Support
**Question:** What are your business hours?
**Answer:** Monday through Friday, 9 AM to 5 PM Eastern.
```

Notice that the source had ~6 facts but the FAQ has 7 entries — "what are your hours?" is a natural standalone question even though hours appeared inline in the source. That's the point: optimize for how callers ask, not how the source was written.

## Handling structured / multi-dimensional data (pricing tables, catalogs, schedules)

Source docs often contain tabular data: pricing tables (service × tier), schedules (staff × day × hours), catalogs (product × variant × price), straightening pricing (treatment × hair length × retouch/virgin). The naive instinct is to either (a) explode into one entry per cell — a pricing table with 8 services × 3 tiers becomes 24 entries that all match the same caller question — or (b) dump the table as markdown into one giant Answer. Both kill retrieval.

The pattern that works:

### Rule 1: one entry per "thing the caller asks about", not per cell

Callers ask "how much is a women's haircut?" — they don't ask "how much is a women's haircut with a senior stylist?" until they've heard the tier prices first. So make **one entry per service** with the tier breakdown inside the Answer:

```
**Topic:** Haircut
**Question:** How much is a women's haircut?
**Answer:** Women's haircuts are one hour. Pricing depends on the stylist: Signature Stylist is $145, Senior Stylist is $195, Salon Owner is $300.
```

Not 3 entries (one per tier). One entry per service.

### Rule 2: write the multi-dim breakdown as natural speech, never as a table

The Answer field must be readable as spoken English without the agent having to mentally parse a table. Use sentence structure to convey dimensions:

```
**Topic:** Straightening
**Question:** How much is Japanese hair straightening?
**Answer:** Japanese Hair Straightening is a three-hour permanent treatment. Pricing depends on hair length. Short hair, chin length or above, is $350 for a retouch or $450 for virgin hair. Medium hair, shoulder length or above, is $500 retouch or $600 virgin. Long hair, past shoulder, is $600 retouch or $700 virgin.
```

Two dimensions (length × retouch/virgin) collapsed into a paragraph the agent can read straight through.

### Rule 3: split per variant when callers probe by variant

When the source has multiple methods/types within a service, and callers naturally ask about *a specific one* once they know the options exist, give each variant its own entry. Extensions are the canonical example — there are four methods (V-Light, K-Tips, Tape-In, Sew-In) and once a caller hears "we have four methods" they ask about a specific one:

```
**Topic:** Extensions
**Question:** How much are V-Light hair extensions?
**Answer:** V-Light extensions are $20 per application. A mini-fill is around $200 for about ten applications. A full length is around $2,000 for one hundred applications. Appointments take three hours and require a $50 deposit.

**Topic:** Extensions
**Question:** How much are K-Tip hair extensions?
**Answer:** K-Tip extensions are $10 per application. A mini-fill is around $120 for ten pieces, a volume fill is around $360 for thirty pieces, and a full length is around $960 for eighty pieces. Appointments take three hours and require a $50 deposit.
```

Plus one umbrella entry for the "what methods do you offer?" first-touch question:

```
**Topic:** Extensions
**Question:** What hair extension methods do you offer?
**Answer:** We offer four extension methods: V-Light, K-Tips, Tape-In, and Sew-In. Each has different pricing and is suited to different hair types and goals. All extension appointments require a $50 deposit. I'd recommend starting with a consultation so we can figure out which method is right for you.
```

The umbrella entry tees up the variant question, the per-variant entries answer it.

### Rule 4: explain the dimension system once, in a separate entry

When a dimension applies to many services (the Signature/Senior/Owner tier system applies to every service), don't re-explain what the tiers mean inside every pricing answer. State the *prices* in each pricing entry, but put the *system explanation* in its own dedicated entry — typically in the team or staff KB rather than the pricing one:

```
**Topic:** Stylist tiers
**Question:** What's the difference between Signature, Senior, and Salon Owner stylists?
**Answer:** The tiers reflect experience and pricing. Signature Stylists are fully trained and handle every service we offer. Senior Stylists have additional experience and specialize in more complex work. Salon Owner is the founder, an internationally recognized master colorist. All services are available at every tier — the choice comes down to budget and preference.
```

When the caller asks "what's the difference between the tiers?" this entry retrieves. When they ask "how much is a haircut?" the haircut entry retrieves with the tier prices inline. Two clean retrievals, no duplication.

### Rule 5: never store tabular data as markdown tables or CSV inside the file

Markdown tables, CSV rows, and pipe-separated lists fragment poorly under semantic retrieval. A row like `Haircut | Women | $145 | $195 | $300` returned alone — without the header — is meaningless to the LLM. Always convert table rows into the natural-speech Answer format above.

If the client maintains pricing in a spreadsheet, that's fine as their *source of truth* — but the `kb-*.txt` Retell sees must be Q&A prose, regenerated from the spreadsheet when prices change.

### Rule 6: don't explode into per-price entries

If a service has 3 tiers and a single price each, that's *one entry* with all three tiers in the Answer. Not three entries. Three entries with only the tier varying produces near-identical embeddings — they all match the same caller question, and Retell may return any of them or all three (which then sound like duplicate hits to the agent). One entry per service is the right grain.

The exception is variants the caller probes by name (extension methods, hair length × treatment combos like Rule 2/3) — those are different *things*, not different *prices for the same thing*.

---

## File naming

`kb-<topic>.txt`, lowercased, hyphenated. One `kb-*.txt` per logical topic cluster (returns, pricing, insurance carriers, service areas, etc.). Don't put everything in one giant `kb-faqs.txt` — Retell retrieves better when each KB file is topically tight.

For service-heavy businesses (salons, clinics, multi-service shops), prefer **per-service-category** KBs that bundle service info AND pricing AND duration together (`kb-haircut.txt`, `kb-color.txt`, `kb-extensions.txt`) over a single `kb-pricing.txt` separated from `kb-services.txt`. A caller asking "do you do balayage?" naturally expects pricing in the answer — both should retrieve in one shot, which only happens if they live in the same file.

## Anti-patterns

- ❌ Bulleted lists inside an Answer. Write prose.
- ❌ Headers (`## Returns`) inside the file. The format is flat — Topic does that job.
- ❌ Markdown tables. Convert each row to its own FAQ entry.
- ❌ "FAQ" or "Frequently Asked Questions" preamble at the top of the file. Start with the first entry.
- ❌ Compressing two facts into one Answer to save entries. Split them.
- ❌ Inventing a Question the source doesn't actually answer. If the source doesn't say it, the FAQ doesn't either.
