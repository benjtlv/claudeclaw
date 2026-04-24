---
name: voice-ai-improve-prompt
description: Iterate on a voice AI agent prompt in the novanest-ai/ai_prompts GitLab repo. **Direct mode** (default): commit straight to main and redeploy the Retell LLM. **`--with-pr` mode**: commit to a per-prompt branch and open or extend a merge request. **Review mode**: when the user points at an open MR and asks to apply its unresolved inline comments, the skill fetches each comment, applies the edit, commits, pushes, replies "done", and resolves the discussion. Use this skill whenever the user wants to improve, iterate on, edit, or revise a voice AI prompt — phrasings like "update the prompt for <client>", "improve John Giordani's prompt", "push prompt changes", "iterate on the voice agent prompt", "apply the unresolved comments on MR !42", "pull feedback from <MR url>", "review mode on <MR>", or any request that implies editing a prompt under CLIENTS/DEMOS/PROSPECTS/INTERNAL. Only take the `--with-pr` path when the user explicitly asks for a PR, MR, or merge request; review mode triggers when the user references an MR and asks for its comments to be applied. Otherwise default to direct mode. Prefer this skill over plain git/glab commands for any voice-AI-prompt iteration.
---

# Voice AI — Improve Prompt

## What this skill does

Takes a user instruction describing how to improve a voice AI prompt, and in a single pass:

1. Resolves the target prompt file inside `C:\Users\benelk\Documents\ai_prompts`.
2. Applies the requested improvement (and, if relevant, splits knowledge-base content into sibling `kb-*.txt` files — see Step B2).
3. Ships the change via one of three modes:
   - **Default (direct mode)**: commit to `main`, push, then redeploy the Retell LLM so the live agent picks up the change immediately.
   - **`--with-pr` mode**: commit to a per-prompt branch, push, and open (or extend) a merge request against `main`. No Retell redeploy — that happens after the MR is merged, out of band.
   - **Review mode**: the instructions come from an MR's unresolved inline comments instead of from chat. The skill fetches the comments, applies them, commits + pushes to the MR branch, and replies + resolves each comment.

The design assumption for direct and `--with-pr` modes is that the user provides **everything at once** — client/category, which prompt file, and what to change. For review mode, the user just provides the MR reference and the comments carry the instructions. If anything is ambiguous, clarify before touching the repo.

## Choosing the mode

- **Default to direct mode.** If the user just says "improve the prompt for X" / "update John Giordani's prompt" / "add a rebuttal to the pricing section", ship straight to `main` and redeploy Retell.
- **Use `--with-pr` when the user explicitly asks for it** — phrases like "with a PR", "open a merge request", "don't push to main", "review first", "--with-pr". If there's any doubt, default to direct mode; the user knows to ask for a PR when they want one.
- **Use review mode when the user points at an open MR and asks to apply its comments** — phrases like "apply the unresolved comments on MR !42", "pull feedback from <MR url>", "review mode on <MR>", "apply the comments". Trigger is unambiguous — there's an MR reference and an ask to consume its comments as instructions. Skip if the user is just asking about the MR without asking to act on comments.

## Repo facts (do not re-derive)

- Local clone: `C:\Users\benelk\Documents\ai_prompts`
- Remote: `git@gitlab.com:novanest-ai/ai_prompts.git` (project path: `novanest-ai/ai_prompts`)
- Base branch: `main`
- Top-level categories (all UPPERCASE, with spaces): `CLIENTS`, `PROSPECTS`, `DEMOS`, `INTERNAL`, `ARCHIVE`
- Client subdirs are UPPERCASE with spaces (e.g., `JOHN GIORDANI`, `A1 BIOHAZARD`)
- Prompt filenames are inconsistent — a given client folder may contain `prompt.md`, `prompt improved.md`, `original_instructions.md`, `.txt` variants, etc.
- Auth: `glab` CLI is already logged in as `benjamin282`. Git uses SSH.

## Inputs you need from the user

Before doing anything, make sure you have:

1. **Category** — usually `CLIENTS` or `PROSPECTS`, occasionally `DEMOS` or `INTERNAL`. If the user didn't say, ask. Don't guess.
2. **Client/folder name** — the user will usually give it in mixed case (e.g., "John Giordani"). Match case-insensitively against the actual directory names.
3. **Prompt filename** — which file to edit inside that folder. If the folder has multiple candidates and the user didn't specify, list the files and ask which one.
4. **Improvement instruction** — what to change and why.

### When to clarify vs. proceed

- If the client folder resolves unambiguously (one fuzzy match) **and** there's exactly one `.md`/`.txt` prompt file **and** the instruction is clear → proceed.
- If multiple client folders could match, or multiple prompt files exist, or the instruction is vague about which section to change → ask a single consolidated question, then proceed.

Clarifying once up-front is fine. Don't ask twice.

## Resolution: find the target file

1. `cd` into `C:\Users\benelk\Documents\ai_prompts`.
2. List the category dir (e.g., `ls CLIENTS`) and match the client name case-insensitively. If the user said "john giordani", that maps to `CLIENTS/JOHN GIORDANI/`.
3. List that subdir. If multiple prompt files exist and the user didn't pick one, ask.
4. Target path is then e.g. `CLIENTS/JOHN GIORDANI/prompt.md`. Keep the original casing and spaces — the file path goes to git as-is.

## Shared: apply the improvement

These steps run the same way in both modes.

### Step A — Sync local main

```bash
git checkout main
git pull --ff-only origin main
```

Fail fast if the local clone has uncommitted changes (`git status --porcelain` is non-empty) — abort and tell the user, because silently stashing their in-progress edits would lose work.

In `--with-pr` mode, do Step C' (branch checkout) before Step B so edits land on the feature branch, not on `main`.

### Step B0 — Consult shared references

Before editing, classify the improvement and read the matching reference(s) from `.claude/voice-ai-shared/`. These are the canonical patterns every voice agent in this repo follows — consult them so iterations stay consistent with what `voice-ai-prototype` originally produced. Skip references that don't apply.

| Improvement involves | Read first |
|---|---|
| Speech examples, filler words, tone, response length, language to avoid, AI over-reaction calibration, never-restate / never-recap rules, pronunciation rules (prices, times, emails, URLs, brand names) | [../../voice-ai-shared/references/speech-patterns.md](../../voice-ai-shared/references/speech-patterns.md) |
| Retell platform syntax — `--` pause marker, `NO_RESPONSE_NEEDED`, `{{variable}}` injection, `~text~` developer instructions, `~call function~` invocations. Also: agent verbalising "dash dash" or talking over caller after a question | [../../voice-ai-shared/references/retell-conventions.md](../../voice-ai-shared/references/retell-conventions.md) |
| Qualification gates, IF/ONLY IF logic, transfer authorization, info-collection structure, variables | [../../voice-ai-shared/references/qualification-framework.md](../../voice-ai-shared/references/qualification-framework.md) |
| Booking flow, calendar functions, AM/PM rules, no-show prevention | [../../voice-ai-shared/references/appointment-setting.md](../../voice-ai-shared/references/appointment-setting.md) |
| Editing a Trojan prompt (filename ends `-trojan.md`): segue, missed-calls math, frame-flip, deploy-tonight, sales-side objections | [../../voice-ai-shared/references/trojan-horse.md](../../voice-ai-shared/references/trojan-horse.md) and [../../voice-ai-shared/assets/voice-agent-template-trojan-overlay.md](../../voice-ai-shared/assets/voice-agent-template-trojan-overlay.md) |
| Restructuring whole sections, rebuilding from a bad prompt, re-deriving section order | [../../voice-ai-shared/assets/voice-agent-template.md](../../voice-ai-shared/assets/voice-agent-template.md) |
| Adding new content from the user (FAQs, price sheets, policies, rosters, hours, etc.), or noticing the current prompt has duplicated reference content that's also in a KB | [../../voice-ai-shared/references/knowledge-base-split.md](../../voice-ai-shared/references/knowledge-base-split.md) — classify the new or duplicated content as **behavioral** (→ prompt) or **reference** (→ KB) *before* editing. Never both. If you spot a "quick reference" mirror in the prompt of something already in a KB, delete it in this edit. |
| Writing or editing **any** `kb-*.txt` file (new or existing) | [../../voice-ai-shared/references/faq-format.md](../../voice-ai-shared/references/faq-format.md) — every KB file must be in Topic/Question/Answer FAQ format |

If the improvement is purely cosmetic (typo, formatting, single-word swap) or doesn't fall in any category above, skip Step B0 entirely and go straight to Step B.

### Step B — Apply the edit

Read the current contents of the prompt file. Apply the user's instruction as a surgical edit (prefer `Edit` over full rewrites). If the instruction genuinely requires restructuring, do a full rewrite, but keep the intent faithful. Stay aligned with whatever pattern docs you read in Step B0 — don't invent a new style if a canonical one exists.

A minimal, focused diff is much easier to scan after the fact (direct mode) or review in GitLab (PR mode), so default to the smallest change that satisfies the instruction.

### Step B2 — Write or update knowledge base files

The split decision was already made in Step B0 — here you just produce or update the files.

If Step B0 flagged no reference content (the improvement was purely behavioral), **skip this step**.

Otherwise, for each reference chunk identified in Step B0:

1. Read [../../voice-ai-shared/references/faq-format.md](../../voice-ai-shared/references/faq-format.md) and convert the source content to the canonical Topic/Question/Answer FAQ format. Never paste raw prose into a `kb-*.txt`.
2. Save each KB file as plain `.txt` alongside the prompt (same client folder), named `kb-<topic>.txt` (e.g., `kb-faqs.txt`, `kb-pricing.txt`).
3. If a `kb-*.txt` already exists for this topic, edit it in place rather than creating a parallel file. If the existing file is still in raw prose, convert it to FAQ format in the same edit.

**Verify no duplication.** Re-scan the prompt after your edit. If you spot any section that mirrors content now in a KB — a "Quick Reference" block, a compressed pricing/hours/roster summary, an inline policy paragraph — delete it from the prompt in this same commit. The prompt must contain zero copies of anything that lives in a KB.

**Add or update the `## Knowledge Base` pointer section** near the bottom of the prompt (above Notes) so each KB file is listed with what's in it and when to consult it. Format per [../../voice-ai-shared/references/knowledge-base-split.md](../../voice-ai-shared/references/knowledge-base-split.md). One line per KB — navigation only.

## Direct mode (default): push to main + redeploy Retell

Order of operations: Step A → Step B0 → Step B → Step B2 → Step C → Step D → Step E.

### Step C — Commit and push to main

Stage the prompt file plus any `kb-*.txt` files you touched in Step B2:

```bash
git add "<prompt-file-path>" "<any kb-*.txt paths you touched>"
git commit -m "improve(<prompt-slug>): <one-line summary of the change>"
git push origin main
```

If the push is rejected non-fast-forward, `git pull --rebase origin main` and try again. If rebase conflicts, stop and show the user.

Commit message style: imperative, ≤72 char subject.

### Step D — Redeploy the Retell LLM

The live agent pulls its system prompt from the Retell LLM object. Without this step, the main branch is updated but the agent still speaks the old prompt.

1. Identify the Retell LLM for this client. The normal source of truth is the client's folder in `C:\Users\benelk\Documents\AI-OS\AI-Agency\Clients\[ClientName]\` — look for a recorded `llm_id` / `agent_id` (commonly in a `retell.json`, `deployment.md`, or similar file). If nothing is recorded, fall back to `list_retell_llms` / `list_agents` via the RetellAI MCP and match by name.
2. Read the updated prompt file (and any `kb-*.txt` files that feed into the LLM, if the deployment uses them).
3. Call `update_retell_llm` with the new `general_prompt`. If knowledge bases are attached, update those as well per the RetellAI docs (use Context7 `resolve-library-id` / `query-docs` for "retell ai update knowledge base" if unsure of current API shape).
4. Do NOT create a new LLM or a new agent. This is an in-place update only.

If the Retell update fails, surface the error clearly. The git push already landed on main, so the prompt file is updated regardless — the user needs to know the agent didn't redeploy.

### Step E — Report back (direct mode)

```
Edited:   CLIENTS/JOHN GIORDANI/prompt.md
Pushed:   main (commit <short-sha>)
Retell:   LLM <llm_id> redeployed
```

If the Retell redeploy failed, say so explicitly and include the error.

## `--with-pr` mode: branch + merge request

Order of operations: Step A → Step C' → Step B0 → Step B → Step B2 → Step D' → Step E'.

### Step C' — Ensure the branch exists and is checked out

Normalize client + prompt into a slug: lowercase, replace whitespace and underscores with `-`, strip punctuation, collapse repeats.

Pattern: `{client-slug}-{prompt-slug}`

Example: `CLIENTS/JOHN GIORDANI/prompt.md` → branch `john-giordani-prompt`.

Keep the slug stable across invocations so re-runs land on the same branch. This is load-bearing — the "is there already an open MR" check depends on the branch name being deterministic.

Check whether the branch exists on the remote:

```bash
git ls-remote --exit-code --heads origin <branch-name>
```

- **Exists on remote** → `git fetch origin <branch>` then `git checkout <branch>` then `git pull --ff-only origin <branch>`. This is the "second run" case: MR is already open, we're just adding a new commit.
- **Does not exist** → `git checkout -b <branch>` from `main`.

Do not delete or force-recreate branches. The user manages branch/MR lifecycle manually in GitLab after merge.

### Step D' — Commit and push to the feature branch

```bash
git add "<prompt-file-path>" "<any kb-*.txt paths you touched>"
git commit -m "improve(<prompt-slug>): <one-line summary of the change>"
git push -u origin <branch-name>
```

### Step E' — Open an MR if none is open

```bash
glab mr list --source-branch <branch-name> --state opened --output json
```

- **Non-empty result** → an MR is already open. Print its URL and stop. Do not open a second MR.
- **Empty result** → open one:

```bash
glab mr create \
  --source-branch <branch-name> \
  --target-branch main \
  --title "improve(<prompt-slug>): <one-line summary>" \
  --description "<user's improvement instruction, verbatim>" \
  --remove-source-branch \
  --yes
```

### Step F' — Report back (`--with-pr` mode)

```
Edited: CLIENTS/JOHN GIORDANI/prompt.md
Branch: john-giordani-prompt (pushed)
MR:     https://gitlab.com/novanest-ai/ai_prompts/-/merge_requests/123
```

If the MR already existed, say "MR already open" instead of creating a new one.

Do **not** update the Retell LLM in this mode. The redeploy happens after the MR is merged, out of band.

## Review mode: apply unresolved MR comments

Use this mode when the user references an open MR and asks for its unresolved inline comments to be applied as edits. The comments carry the instructions — you don't need separate free-text guidance from the user.

Order of operations: Step A → Step C'' → Step R1 → Step R2 → [per comment: Step B0 → Step B → Step B2] → Step D' → Step R3 → Step F''.

### Step C'' — Resolve MR and check out its source branch

1. Parse the MR reference from the user's input. Accept any of:
   - A full URL: `https://gitlab.com/novanest-ai/ai_prompts/-/merge_requests/42`
   - Bang-prefixed number: `!42`
   - Plain number: `42`
2. Fetch MR metadata to find the source branch:
   ```bash
   glab mr view <iid> --output json | jq -r '.source_branch'
   ```
3. Sync local main first (Step A rules still apply — no uncommitted changes), then:
   ```bash
   git fetch origin <source_branch>
   git checkout <source_branch>
   git pull --ff-only origin <source_branch>
   ```

If the MR is closed or merged, stop and tell the user — you can't add commits.

### Step R1 — Fetch unresolved inline comments

```bash
glab api "projects/novanest-ai%2Fai_prompts/merge_requests/<iid>/discussions" \
  | jq '[.[] | select(
      .notes[0].resolvable == true
      and .notes[0].resolved == false
      and .notes[0].position != null
    )]'
```

Capture for each discussion:
- `id` — discussion ID (used to resolve later)
- `notes[0].id` — note ID (used for replies)
- `notes[0].body` — the instruction text
- `notes[0].position.new_path` — file the comment anchors to
- `notes[0].position.new_line` — line number in the new version

**Only inline comments (`position != null`) are auto-applicable.** General MR-level comments don't have line anchors — surface them to the user at the end as "heads up, there are N general comments that need your attention", don't try to guess what they mean.

If there are no unresolved inline comments, say so and stop.

### Step R2 — Plan pass

Group comments by file. Surface the plan tersely (2-6 lines total) before applying anything so the user can catch a misread:

> Found 4 unresolved inline comments on MR !42:
>
>   CLIENTS/JOHN GIORDANI/prompt.md
>     L38:  "make this tighter — one sentence not three"
>     L112: "replace with 'warmth not buddy energy'"
>     L145: "delete this sentence, it contradicts the rule above"
>     L203: "typo — 'balayge' should be 'balayage'"
>
> Apply all four in one commit?

Wait for go/no-go. If the user wants to skip any, respect that list. If they want you to handle some and defer others, apply the ones they pick and leave the rest unresolved.

### Per-comment edit loop

For each comment you're applying:

1. **Classify** via Step B0 lookup — if the comment is about speech/tone, consult `speech-patterns.md`; if about qualification, `qualification-framework.md`; about a KB file, `faq-format.md` and `knowledge-base-split.md`; etc. Same rules as a normal `--with-pr` run.
2. **Apply the edit** per Step B — use the comment's line number to locate the anchor; prefer surgical `Edit` over rewrites. If the line has shifted due to prior commits on the branch, search for the surrounding context in the current file.
3. **If the comment touches KB content**, apply Step B2 mechanics (FAQ format, no duplication, update `## Knowledge Base` pointer).
4. **If you can't apply a comment cleanly** (truly ambiguous, conflicts with another comment, asks for something that requires your judgment), skip it and note why — you'll leave that discussion unresolved and reply with what you saw.

### Step D' — Commit and push (same as `--with-pr` mode)

One commit for all applied comments. Stage the prompt file plus any `kb-*.txt` files you touched:

```bash
git add "<prompt-file-path>" "<any kb-*.txt paths you touched>"
git commit -m "improve(<prompt-slug>): apply MR !<iid> review comments"
git push origin <source_branch>
```

The commit appears in the MR thread automatically — no second MR, no second branch.

### Step R3 — Reply and resolve each handled comment

For each discussion you applied:

```bash
# Reply confirming the change
glab api "projects/novanest-ai%2Fai_prompts/merge_requests/<iid>/discussions/<discussion_id>/notes" \
  -X POST -f body="Done in <short-sha>."

# Resolve the discussion
glab api "projects/novanest-ai%2Fai_prompts/merge_requests/<iid>/discussions/<discussion_id>" \
  -X PUT -f resolved=true
```

For comments you **couldn't** apply: reply with what you interpreted and why you skipped it, **do not resolve**. Example reply: `"Skipped — line 145 could mean delete either the full sentence or just the clause after the comma. Clarify and I'll apply."`

### Step F'' — Report back (review mode)

```
MR !42 — CLIENTS/JOHN GIORDANI/prompt.md
Applied:   3 of 4 comments
Skipped:   1 (L145, ambiguous — replied asking for clarification, left unresolved)
General:   0 non-inline comments
Commit:    <short-sha> pushed to <source-branch>
MR URL:    https://gitlab.com/novanest-ai/ai_prompts/-/merge_requests/42
```

If there were general (non-inline) MR comments, list them here so the user can address them manually.

### Review mode edge cases

- **MR is closed or merged** → stop, tell the user, don't try to add commits.
- **Source branch has diverged from what your local knows about** — the fetch + pull in Step C'' handles it; if the pull isn't fast-forward, stop and surface the conflict rather than force-overwriting.
- **Comment line has moved because of prior commits** — use the comment body to find the anchor text in the current file; apply if found, reply with "couldn't locate the original line, my best guess is X, please confirm" if not.
- **Two comments conflict** (one says delete X, another says edit X) — apply the later-dated comment, reply to both explaining which won.
- **A comment asks for something outside the prompt file** (e.g. "also update the kb-faqs.txt") — `position.new_path` tells you which file; follow the same loop for that file.
- **A comment is vague** ("this doesn't feel right", "tighten") — apply your best interpretation, note it in the reply so the user can push back if you got it wrong.
- **All comments are general (no inline)** → report them, apply nothing automatically.

---

## Edge cases and failure handling

- **Uncommitted changes on main** → abort with a clear message. Don't stash.
- **`git pull` is not fast-forward** → abort and surface the conflict. Don't force.
- **Direct-mode push rejected** → `git pull --rebase origin main`, then push again. If rebase conflicts, stop and show the user.
- **`--with-pr` push rejected (non-fast-forward on the feature branch)** → someone else pushed to the same branch. `git pull --rebase origin <branch>`, then push again. If rebase conflicts, stop.
- **`glab mr create` fails because one already exists** → treat as success, fetch and print the existing MR URL.
- **Client folder not found** → list the closest matches from the category dir and ask.
- **Prompt file not found** → list what's in the client folder and ask which to edit.
- **Retell LLM not found in client folder's deployment metadata** → fall back to `list_retell_llms` / `list_agents` and match by name. If still ambiguous, ask the user which LLM ID to update rather than guessing.
- **User asks for changes across multiple prompts at once** → handle one at a time. Do the first, report, then ask before continuing.

## What this skill is *not* for

- Creating new clients or new prompt files from scratch — use `voice-ai-prototype` for that.
- First-time creation of an agent (prompt + Retell deploy) — use `voice-ai-prototype` for that.
- Managing branch/MR lifecycle post-merge — the user handles that in the GitLab UI.
- Human-side MR review (judging whether to approve/merge). Review mode *applies* the user's already-written review comments as edits; it doesn't decide whether the prompt is good.
- Merging MRs — the user clicks merge in GitLab when satisfied.
