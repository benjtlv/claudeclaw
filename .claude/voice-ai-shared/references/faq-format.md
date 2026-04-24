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

## File naming

`kb-<topic>.txt`, lowercased, hyphenated. One `kb-*.txt` per logical topic cluster (returns, pricing, insurance carriers, service areas, etc.). Don't put everything in one giant `kb-faqs.txt` — Retell retrieves better when each KB file is topically tight.

## Anti-patterns

- ❌ Bulleted lists inside an Answer. Write prose.
- ❌ Headers (`## Returns`) inside the file. The format is flat — Topic does that job.
- ❌ Markdown tables. Convert each row to its own FAQ entry.
- ❌ "FAQ" or "Frequently Asked Questions" preamble at the top of the file. Start with the first entry.
- ❌ Compressing two facts into one Answer to save entries. Split them.
- ❌ Inventing a Question the source doesn't actually answer. If the source doesn't say it, the FAQ doesn't either.
