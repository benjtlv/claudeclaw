---
name: voice-ai-improve-prompt
description: Iterate on a voice AI agent prompt in the novanest-ai/ai_prompts GitLab repo. Default mode pushes the improvement straight to main and redeploys the Retell LLM. `--with-pr` mode pushes to a per-prompt branch and opens a merge request instead. Use this skill whenever the user wants to improve, iterate on, edit, or revise a voice AI prompt — phrasings like "update the prompt for <client>", "improve John Giordani's prompt", "push prompt changes", "iterate on the voice agent prompt", or any request that implies editing a prompt under CLIENTS/DEMOS/PROSPECTS/INTERNAL. Only take the `--with-pr` path when the user explicitly asks for a PR, MR, or merge request; otherwise default to the direct-to-main + redeploy path. Prefer this skill over plain git/glab commands for any voice-AI-prompt iteration.
---

# Voice AI — Improve Prompt

## What this skill does

Takes a user instruction describing how to improve a voice AI prompt, and in a single pass:

1. Resolves the target prompt file inside `C:\Users\benelk\Documents\ai_prompts`.
2. Applies the requested improvement (and, if relevant, splits knowledge-base content into sibling `kb-*.txt` files — see Step B2).
3. Ships the change via one of two modes:
   - **Default (direct mode)**: commit to `main`, push, then redeploy the Retell LLM so the live agent picks up the change immediately.
   - **`--with-pr` mode**: commit to a per-prompt branch, push, and open a merge request against `main`. No Retell redeploy — that happens after the MR is merged, out of band.

The design assumption is that the user provides **everything at once** — client/category, which prompt file, and what to change. If anything is ambiguous, clarify before touching the repo.

## Choosing the mode

- **Default to direct mode.** If the user just says "improve the prompt for X" / "update John Giordani's prompt" / "add a rebuttal to the pricing section", ship straight to `main` and redeploy Retell.
- **Only use `--with-pr` when the user explicitly asks for it** — phrases like "with a PR", "open a merge request", "don't push to main", "review first", "--with-pr". If there's any doubt, default to direct mode; the user knows to ask for a PR when they want one.

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
- Reviewing or merging MRs.
