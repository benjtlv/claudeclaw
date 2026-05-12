---
name: voice-ai-deploy-retell
description: Syncs Retell state to match a voice AI agent's prompt files, executes a structured op list (custom function add/update, voice swap, model change, N8N workflow create, etc.), or both. The single skill for every Retell API interaction in the voice-ai stack — full first-time deploy (create LLM + KBs + agent + phone + sidecar), prompt-only redeploy, KB-only resync, agent parameter tweaks, sidecar recovery, AND post-merge execution of `_deploy-plan.md` from a merged MR. Ops can arrive two ways: (1) inline in the invocation prompt as a fenced YAML block under a `Retell operations:` heading, or (2) in a `_deploy-plan.md` sibling to the prompt file. Inline wins per op when both are present. The op grammar is canonical — defined in `.claude/voice-ai-shared/references/deploy-plan-format.md`. Every non-create deploy updates the Retell agent draft and tags it with commit SHA + one-line description, but does NOT auto-publish — Ben publishes manually from the Retell dashboard when he wants a frozen audit-trail entry. Phones follow Draft, so the deploy is live immediately regardless. Accepts an optional post-deploy webhook (URL + JSON payload) that fires once after a successful deploy, fire-and-forget. Use this skill whenever Retell needs to change — as a follow-up to `voice-ai-prototype` (first deploy), after `voice-ai-improve-prompt` direct mode (post-push redeploy with inline ops), on a GitLab CI-triggered mission task (post-merge deploy executing the plan file), or standalone ("swap John Giordani's voice to Jennifer Suarez", "re-upload the KB file for A1 Biohazard", "rebuild the sidecar for X"). Triggers: "deploy retell for <file>", "redeploy <client>'s agent", "update retell agent", "push the prompt to retell", "sync the kb", "change the voice on <agent>", "rebuild the sidecar for <client>", "execute the deploy plan for <MR>". Do NOT use this skill to edit a prompt or KB file — that's `voice-ai-improve-prompt`. Do NOT use it for first-time prompt drafting — that's `voice-ai-prototype`. This skill only touches Retell, n8n (for `*_n8n_workflow` ops), the sidecar file, the plan file's status fields, and (optionally) one webhook.
---

# Voice AI — Deploy Retell

## Account pinning (first action on every run, no exceptions)

Every Retell call in a single run goes to exactly ONE Retell account, derived from the prompt file's folder path. Do this derivation BEFORE any other work, before reading the sidecar, before any tool call.

### Path → account slug

| Path pattern (under `ai_prompts/` root) | Account slug |
|---|---|
| `CLIENTS/GENERAL/<any>/...` | `novanest` (these agents live in Ben's internal Retell account) |
| `CLIENTS/<CLIENT>/...` (not `GENERAL`) | slugify `<CLIENT>` — lowercase, spaces→hyphens, punctuation stripped. `VOCI PARTNERS` → `voci-partners`. |
| `PROSPECTS/**`, `DEMOS/**`, `INTERNAL/**` | `novanest` |
| `ARCHIVE/**` | refuse — the skill does not touch archived agents |

### Slug → tools

- **Retell MCP prefix:** `mcp__<slug>-retellai-mcp-server__<tool>`. Examples:
  - `novanest` → `mcp__novanest-retellai-mcp-server__update_retell_llm`
  - `voci-partners` → `mcp__voci-partners-retellai-mcp-server__update_retell_llm`
- **n8n MCP prefix** (used by `create_n8n_workflow` / `update_n8n_workflow` ops): `mcp__<slug>-n8n-mcp-server__<tool>`. Same shape as the Retell prefix — one slug, two MCPs. Examples:
  - `novanest` → `mcp__novanest-n8n-mcp-server__n8n_create_workflow`
  - `voci-partners` → `mcp__voci-partners-n8n-mcp-server__n8n_create_workflow`
- **REST API key env var** (for KB ops that have no MCP equivalent and require multipart/form-data REST calls):
  - `novanest` → `RETELL_API_KEY` (no suffix — preserves the existing convention)
  - any other slug → `RETELL_API_KEY_<SLUG_UPPER>` where `<SLUG_UPPER>` is the slug uppercased with hyphens→underscores. `voci-partners` → `RETELL_API_KEY_VOCI_PARTNERS`.

### Pre-flight checks (run before any Retell or n8n work)

1. **Retell MCP availability:** Verify `mcp__<slug>-retellai-mcp-server__*` is in your available tool list. If missing, STOP — tell Ben to add the MCP to his `.mcp.json`. Do NOT fall back to `novanest` or any other account, even if another MCP happens to have an agent with the same derived name.
2. **n8n MCP availability** (only if this run has any `create_n8n_workflow` / `update_n8n_workflow` op, inline or in the plan): Verify `mcp__<slug>-n8n-mcp-server__*` is in your available tool list. If missing, STOP — tell Ben to add the MCP. Do NOT fall back to another client's n8n MCP, ever. If the plan/inline ops set an explicit `mcp_target` field that doesn't match `<slug>-n8n-mcp-server`, STOP — surface "n8n MCP mismatch: op targets `<value>` but the prompt path derives `<slug>-n8n-mcp-server`. Refusing to cross-account."
3. **REST key availability** (only if you'll hit a REST-only endpoint this run — KB ops): verify the matching env var is set. If missing, STOP and tell Ben to add it to his `.env`.
4. For the rest of the run, every Retell call AND every n8n call uses ONLY the pinned slug's prefix / env var. No cross-account calls, ever.

When Ben onboards a new client, he does three things manually and in parallel: adds the Retell MCP under `<slug>-retellai-mcp-server`, adds the n8n MCP under `<slug>-n8n-mcp-server`, and sets `RETELL_API_KEY_<SLUG_UPPER>` in `.env`. All three naming rules are mechanical, so "which MCP do I use here?" never has a judgment call in it.

---

## What this skill does

This is the single primitive for pushing change into Retell. Every path that needs the live agent to reflect a new state lands here:

- A brand-new prompt that was just produced by `voice-ai-prototype` — deploy end-to-end (create LLM, create KBs, create agent, provision phone, write sidecar).
- A prompt file that was just edited and pushed by `voice-ai-improve-prompt` direct mode — update the existing LLM's `general_prompt`, resync any changed KBs, tag the agent draft with the SHA + commit subject. Draft goes live immediately; manual publish from the dashboard is Ben's call.
- A prompt that just landed on `main` via merged MR — same as above, but triggered by the Claude Claw mission task that GitLab CI queued. Commit SHA and MR title ride in on the task body and become the Retell version metadata.
- A one-off Retell tweak that has nothing to do with any file change (swap voice, bump temperature, change language, re-attach a KB). No commit, no file edit, no sidecar change — just the Retell call.
- A sidecar file that's missing, stale, or corrupt — resolve the agent by name, rebuild the 3-field sidecar from Retell's current state.

The skill does NOT edit prompt files or KB files. If the user's ask requires a file change, they want `voice-ai-improve-prompt`, not this skill. Refuse and route.

## Sidecar schema (canonical, minimal)

The sidecar lives next to the prompt file at `<prompt-basename>.retell.json`. Three fields, nothing more:

```json
{
  "agent_id": "agent_abc...",
  "llm_id": "llm_xyz...",
  "knowledge_bases": [
    { "source_file": "kb-faqs.txt", "id": "kb_..." }
  ]
}
```

Omit `knowledge_bases` entirely (not an empty array) when there are none.

Every other attribute — voice, model, temperature, phone number, area code, language, timestamps, mode, Trojan sibling cross-links — is either derivable from the filename or authoritatively owned by Retell and queryable on demand. The sidecar is purely the *binding* from "this prompt file" to "these Retell resources". Nothing more.

`llm_id` is strictly derivable via `get_agent(agent_id).response_engine.llm_id` but kept as a cache because it's the primary handle for prompt updates — saves one round-trip per deploy.

`knowledge_bases[*].id` is kept because mapping a local `kb-*.txt` file to its Retell KB by name convention alone is brittle (Retell names can drift). Storing the ID keeps the mapping robust. `source_id` (the inner-source ID inside each KB) is NOT stored — the skill fetches it on demand during KB resync via `get-knowledge-base/{id}` when it actually needs to mutate a source.

Trojan pairs get two separate sidecars (one per prompt file). No cross-linking needed — the sibling file is in the same folder; read its sidecar when you need its `agent_id`.

## Choosing the intent

When invoked, inspect (in this order) the caller's handoff message, the file state, and the sidecar state. Pick exactly one intent:

| Intent | When to pick it |
|---|---|
| **Full deploy** (create) | Caller named a prompt file with no sidecar AND no agent in Retell under the derived name. Typical caller: `voice-ai-prototype` just finished. |
| **Prompt-only update** | Caller named a prompt file, sidecar exists with `llm_id`, no local `kb-*.txt` file has been touched since the last deploy. Typical caller: `voice-ai-improve-prompt` direct mode, or CI-triggered mission task. |
| **KB-only sync** | Caller named a KB file (or said "resync KBs for X"), or the prompt itself is unchanged but `kb-*.txt` files differ from the sidecar's `knowledge_bases[]`. |
| **Full file sync** | Both prompt and at least one KB changed. Update prompt + resync all KBs in one pass, single Retell version. |
| **Agent param tweak** | Caller's instruction names an agent attribute (voice, temperature, language, etc.) with no file context. No file is read, no sidecar is written, no commit is made. |
| **Sidecar recovery** | Caller says "rebuild sidecar" or any other intent failed because the sidecar is missing/corrupt but the agent exists in Retell. |

If two intents fit (e.g., a merged MR that touched both prompt and KBs), pick **Full file sync**. If zero intents fit, stop and ask the caller what they want.

**Ops are orthogonal to intent.** Any intent that reads/updates an LLM or agent (Full deploy, Prompt-only update, KB-only sync, Full file sync, Agent param tweak) can also carry an ops list — inline or from a plan file. Ops execute BEFORE the intent's regular work (Op-list ingest, Step OP5), and the intent's prompt/KB update then runs against the post-op LLM state in one final draft update. Sidecar recovery is the one exception — it never executes ops because the agent's binding may itself be broken.

Param tweak intent is now mostly subsumed by inline ops — a caller asking "swap John's voice to Jennifer" should pass `op: set_voice` inline rather than parse a free-form sentence. The legacy free-form path still works for backwards compatibility but the structured form is the recommended way.

## Inputs the skill accepts

- A prompt file path (most common). Example: `CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md`. Path is relative to `ai_prompts/` root unless absolute. If a `_deploy-plan.md` (or `_deploy-plan-trojan.md`) sibling exists, it's picked up automatically — no need to pass it separately.
- A KB file path. Example: `CLIENTS/JOHN GIORDANI/kb-faqs.txt`. Skill resolves the sibling prompt for KB-only sync.
- A client name plus a free-form Retell-side instruction. Example: "swap John Giordani's voice to Jennifer Suarez". Skill resolves the agent via the sidecar or `list_agents`. Free-form instructions like this should ideally be passed as inline ops (see below) — the legacy free-form path still works but the structured form is preferred for auditability.
- A client name alone plus "rebuild sidecar".

Optional additional inputs the caller may include in the invocation prompt:
- A **`Retell operations:` fenced YAML block** with one or more ops (see Op-list ingest section and [../../voice-ai-shared/references/deploy-plan-format.md](../../voice-ai-shared/references/deploy-plan-format.md)). This is the structured form of free-form Retell-side instructions. Used by direct-mode improve-prompt handoffs, standalone tweaks, and prototype handoffs.
- A commit SHA + short description for Retell version tagging (the CI pipeline always includes these; callers can too).
- A webhook URL + JSON payload to fire after a successful deploy (see **Post-deploy webhook** below).

## Repo and environment facts

- Prompts repo local path (Mac): `/Users/benjaminelkrieff/Documents/Claude Code Master Folder/ai_prompts`.
- Retell API keys: see **Account pinning** above for the per-account env var convention. `RETELL_API_KEY` is novanest; clients use `RETELL_API_KEY_<SLUG_UPPER>`.
- The pinned-account's RetellAI MCP (derived per Account pinning) is preferred for every operation that has a tool. If an operation isn't exposed by the MCP (mainly KB ops), fall back to REST via `curl` using the pinned account's API key. Query Context7 first for any endpoint you haven't used recently — the API shape evolves.

## RetellAI MCP tool map

| Operation | MCP tool | REST fallback |
|---|---|---|
| Create LLM | `create_retell_llm` | `POST /create-retell-llm` |
| Get LLM | `get_retell_llm` | `GET /get-retell-llm/{llm_id}` |
| Update LLM | `update_retell_llm` | `PATCH /update-retell-llm/{llm_id}` |
| Create agent | `create_agent` | `POST /create-agent` |
| Get agent | `get_agent` | `GET /get-agent/{agent_id}` |
| Update agent | `update_agent` | `PATCH /update-agent/{agent_id}` |
| List agents | `list_agents` | `GET /list-agents` |
| List agent versions | `get_agent_versions` | `GET /get-agent-versions/{agent_id}` |
| **Publish agent** | `agent.publish` (SDK) | `POST /publish-agent/{agent_id}` (no body) — **not called by this skill anymore**; listed for completeness. Ben publishes manually from the Retell dashboard when he wants a frozen audit-trail entry. |
| Create phone number | `create_phone_number` | `POST /create-phone-number` |
| List phone numbers | `list_phone_numbers` | `GET /list-phone-numbers` |
| Update phone number | `update_phone_number` | `PATCH /update-phone-number/{phone_number}` |
| List voices | `list_voices` | `GET /list-voices` |
| **Create knowledge base** | no MCP — REST only | `POST /create-knowledge-base` (multipart/form-data) |
| **Add source to KB** | no MCP — REST only | `POST /add-knowledge-base-sources/{kb_id}` (multipart/form-data) |
| **Delete source from KB** | no MCP — REST only | `DELETE /delete-knowledge-base-source/{kb_id}/source/{source_id}` |
| **Attach KB to LLM** | via `update_retell_llm` `knowledge_base_ids` field | same |

Both `create-knowledge-base` and `add-knowledge-base-sources` require **multipart/form-data** (files are uploaded as form fields like `knowledge_base_files=@./kb-faqs.txt`, NOT as JSON). Use `curl --form` or equivalent — sending JSON will fail.

For every KB operation, confirm current payload shape with Context7 before the call — the REST surface evolves.

## Op-list ingest

Before the grammar parse and before any Retell mutation, ingest any structured ops from the invocation. Ops are the canonical way to express Retell-side changes that aren't derivable from the prompt grammar — custom function configs, voice/model swaps, N8N workflows. The full op catalog, schema, and validation rules live in [../../voice-ai-shared/references/deploy-plan-format.md](../../voice-ai-shared/references/deploy-plan-format.md). Read it before writing any handler logic; this section describes the ingest + execution flow, not the catalog itself.

### Sources (priority order)

Ops can arrive from two places on a single run:

1. **Inline** — a fenced YAML block in the deploy skill's invocation prompt, under a `Retell operations:` heading. This is how direct mode of `voice-ai-improve-prompt`, standalone tweaks, and prototype handoffs pass ops.
2. **Plan file** — `_deploy-plan.md` (or `_deploy-plan-trojan.md`) sibling to the prompt file. This is how `--with-pr` mode persists ops across the merge gap; CI hands the deploy skill both the prompt path AND the plan path.

**Inline wins per op.** If the same op-type targets the same thing in both inline and plan (e.g. both have `set_voice`), execute the inline version and log the plan version as overridden. The plan file's `status` and `last_applied_sha` are still updated as if the override executed (the user got what they asked for; the plan's audit trail just records that an override happened).

### Step OP1 — Discover ops

1. Scan the invocation prompt for a fenced YAML block under `Retell operations:`. If found, parse it. If parse fails, STOP — surface the error before any Retell call.
2. Look for `_deploy-plan.md` (or `_deploy-plan-trojan.md` if the prompt filename ends `-trojan.md`) in the prompt's folder. If found, parse frontmatter + the `## Retell operations` fenced YAML block.
3. If neither exists, there are no ops — skip to the grammar parse. The deploy still runs (prompt may have changed).

### Step OP2 — Validate

Run every check from `deploy-plan-format.md` § Validation:

- Frontmatter fields present and valid (plan file only).
- `prompt` field matches the prompt file being deployed (plan file only).
- Every op has a known `op:` value in the catalog.
- Every op has its required fields populated.
- For `update_custom_function` and `delete_custom_function`: fetch the current LLM (`get_retell_llm`) and confirm the named function exists in `general_tools`. If not, STOP and surface — almost always a stale plan or typo.

Validation runs BEFORE any mutation. If any check fails, the skill stops with the offending op + line number; no Retell calls, no partial state.

### Step OP3 — Idempotency check (plan file only)

If a plan file exists with `status: applied` and `last_applied_sha == HEAD` of the prompts repo → the ops were already executed against this exact commit. Skip op execution entirely. Still run the grammar parse and the prompt 4-step draft-update sequence (the file content may have been touched in a way that doesn't change ops but does change the prompt). Note "Plan ops skipped — already applied at <sha>" in the report.

If `status: partial-failure`, retry only the ops marked `applied: false` or unmarked. Skip those marked `applied: true` from the previous run unless the plan was edited since (the commit SHA at which the plan changed is checked against `last_applied_sha`).

If `status: pending`, execute all ops in document order.

Inline ops always execute — there's no persisted state for them, so idempotency is the caller's responsibility.

### Step OP4 — Merge inline + plan into a single execution list

For each op, the priority rule:

- Op present inline only → execute, mark "source: inline".
- Op present in plan only → execute, mark "source: plan".
- Same op-type + same target in both → execute the inline one, log the plan one as `overridden: true` for the post-run report.

The execution list preserves document order: inline ops first (in inline order), then plan ops not overridden (in plan order). This means inline ops can override plan ops AND set context for later plan ops (e.g. inline `set_model` recreates the LLM, then plan ops execute against the new LLM).

### Step OP5 — Execute ops in order

Each op type maps to a handler. Handlers are detailed below. Each op is atomic per its underlying API call; the plan as a whole is NOT transactional — a later failure does not undo earlier successes.

For each op:

1. Re-confirm payload shape via Context7 if it's an op that hits a non-MCP-wrapped endpoint (custom function tools schema, post-call analysis schema) — these surfaces evolve.
2. Execute the underlying API call(s).
3. Mark the op `applied: true` on success, `applied: false, error: "..."` on failure.
4. **If `set_model` or `set_model_temperature`** — the LLM was recreated. Update `current_llm_id` for any subsequent ops in this run, AND update the in-memory sidecar so the post-run write captures the new `llm_id`.
5. On failure: continue to the next op (so other independent changes still ship), unless the failure left Retell in a state where subsequent ops can't run (e.g. `set_model` failed mid-recreation). If subsequent ops depend on the failed one, mark them `applied: false, error: "skipped due to upstream op failure"` and continue without executing them.

### Step OP6 — After ops, run the prompt update

Once all ops are processed:

1. Run the **Pre-deploy grammar parse** (section below) on the current prompt file contents.
2. Diff parsed built-ins / mid-call / post-call configs against current Retell state (post-op). Custom-function adds/updates/deletes from the ops have already happened, so the grammar parse will see them as already-present — that's fine, the parse only configures built-ins anyway. Custom functions detected in the grammar that DON'T match anything in `general_tools` after ops are flagged as orphaned (grammar references a function nothing wired).
3. Run the **4-step draft-update sequence** with the new prompt + any grammar-driven config changes. This single update carries both the ops-driven changes (custom functions, voice, language, etc.) AND the prompt content. One draft update per deploy, not one per op. No publish call.

### Step OP7 — Rewrite plan status (plan file only)

After everything completes:

- All ops succeeded + grammar parse + draft update succeeded → rewrite the plan: `status: applied`, `last_applied_sha: <new HEAD short-sha>`, all ops annotated `applied: true`.
- One or more ops failed → `status: partial-failure`, `last_applied_sha` unchanged (or stays `null` if first apply never completed), failed ops annotated with `applied: false, error: "..."`, successful ops `applied: true`.
- Plan was empty (no ops block) → `status: applied`, `last_applied_sha: <sha>`.

Commit the rewritten plan to `main`:

```bash
git add "<plan path>"
git commit -m "deploy(<prompt-slug>): mark plan applied at <sha>"
git push origin main
```

In CI context (`$GITLAB_CI=true` or caller hint), skip the commit — print the updated plan contents in the report and let the dashboard infrastructure decide whether to write back. The plan file MAY become stale in `main` until a follow-up direct push corrects it, but the Retell state is correct, which is what matters.

Inline-only runs: nothing to rewrite, no commit. Skip this step entirely.

### Op handlers

Each handler below references the canonical schema in `deploy-plan-format.md` and adds the concrete Retell calls.

#### `set_voice` / `set_voice_model` / `set_language`

In-place on the agent. Per `deploy-plan-format.md` § set_voice: look up `voice_name` via `list_voices`, match case-insensitively, capture `voice_id`. Then add the field to a single `update_agent` call (batched with any other agent-level fields from sibling ops).

#### `set_model` / `set_model_temperature` (heavy — recreates LLM)

Per `deploy-plan-format.md` § set_model. Five sub-steps:

1. `get_retell_llm(current_llm_id)` — capture `begin_message`, `general_prompt`, `knowledge_base_ids`, `general_tools`, `model_temperature`, any other fields needed for full recreate.
2. `create_retell_llm` with `model: <new>` + copied fields → `new_llm_id`. If `set_model_temperature` is also present in the ops list, fold it into this single create so the new LLM ships with both changes at once.
3. `update_agent(response_engine={type: "retell-llm", llm_id: new_llm_id, version: 0}, version_description: "<sha> set_model <new>")`.
4. Update sidecar's `llm_id` in-memory; the post-run write picks it up.
5. Log the old LLM ID for manual cleanup.

If subsequent ops in this run target the LLM (custom function changes, KB attaches), they execute against `new_llm_id` — that's the "update `current_llm_id` for subsequent ops" rule.

#### `create_custom_function` / `update_custom_function` / `delete_custom_function`

All three modify the LLM's `general_tools` array. Strategy: batch them.

1. `get_retell_llm(current_llm_id)` once at the start of the custom-function block (the first such op in this run) — capture the current tools array.
2. For each `create_*`: validate name unique, append a new tool entry built from the op fields (URL, method, parameters, headers, etc.). Confirm exact field-name mapping for tool entries via Context7 — the schema evolves.
3. For each `update_*`: find entry by `name`, apply patch fields (`url`, `description`, `speak_during_execution`, `parameters_add` / `parameters_remove` / `parameters_replace`, `headers_set` / `headers_unset`) per `deploy-plan-format.md` § update_custom_function.
4. For each `delete_*`: remove entry by `name`.
5. Write the full new tools array back via `update_retell_llm(llm_id, general_tools=<new array>)`. One write per LLM per run, not one write per op.

This batching means custom-function ops are effectively transactional within a run — they all succeed together (one `update_retell_llm` call) or all fail together.

If a `set_model` op also ran earlier this run, the tools array recreation already includes the new tools (because step 1 of `set_model` copied the current tools, and the in-memory state after subsequent custom-function ops reflects the additions/updates/deletes). In that case, the `create_retell_llm` in `set_model`'s step 2 ships with the final tools array baked in, and the separate `update_retell_llm(general_tools=...)` call from this handler is skipped.

#### `create_n8n_workflow` / `update_n8n_workflow`

Use the n8n MCP **derived from the pinned account slug**, NOT a free-form `mcp_target` value:

- The MCP name is always `<slug>-n8n-mcp-server` where `<slug>` is the same account slug derived from the prompt's folder path in the Account pinning section at the top of this skill.
- The MCP prefix is `mcp__<slug>-n8n-mcp-server__*`. Examples: `mcp__novanest-n8n-mcp-server__n8n_create_workflow`, `mcp__voci-partners-n8n-mcp-server__n8n_create_workflow`.

The `mcp_target` field in the op is OPTIONAL and serves as a **paranoia check**, not a selector:

- If `mcp_target` is omitted → use the derived MCP. This is the normal case.
- If `mcp_target` is set AND equals `<slug>-n8n-mcp-server` → use the derived MCP. The field was redundant but harmless.
- If `mcp_target` is set AND does NOT equal `<slug>-n8n-mcp-server` → STOP the op (and the whole run, before any Retell mutation if this is caught in pre-flight; otherwise fail just the op). Surface: "n8n MCP mismatch: op targets `<value>` but the prompt path derives `<slug>-n8n-mcp-server`. Refusing to cross-account."

This makes n8n cross-account contamination structurally impossible — even if a plan author hand-writes the wrong `mcp_target`, the deploy skill refuses to honour it.

Verify `mcp__<slug>-n8n-mcp-server__*` is in your available tool list before calling — if missing, fail the op with a clear error pointing Ben to add the MCP to `.mcp.json`. Do NOT fall back to another account's n8n MCP.

In the steps below, `<n8n>` is shorthand for `mcp__<slug>-n8n-mcp-server` — the derived MCP prefix.

For `create_n8n_workflow`:

1. If `template_id` is set: `<n8n>__n8n_deploy_template` with the template ID and any caller-supplied overrides.
2. Else: `<n8n>__n8n_generate_workflow` with the `description` + `nodes_outline` to draft the workflow, then `<n8n>__n8n_validate_workflow` to confirm it parses, then `<n8n>__n8n_create_workflow` to save it.
3. Confirm the workflow is active (`<n8n>__n8n_get_workflow` and check `active: true`). If not, `<n8n>__n8n_update_partial_workflow` to set `active: true`.

For `update_n8n_workflow`: find by name (`<n8n>__n8n_list_workflows` → filter), then `n8n_update_partial_workflow` (metadata only) or `n8n_update_full_workflow` (nodes changed).

N8N failures do NOT roll back prior Retell-side changes. Mark the op `applied: false` with the error message and continue.

#### `note`

Log the text in the deploy report. No mutation. Use to capture context (informal sign-off, related ticket, why a change is being made) without driving an API call.

### Reporting (extended)

The deploy report after a run with ops now includes:

```
Ops executed:
  set_voice                          Jennifer Suarez                       (source: plan)        applied
  update_custom_function             book_appointment +email param         (source: plan)        applied
  create_custom_function             send_callback_sms                     (source: plan)        applied
  create_n8n_workflow                send_callback_sms on n8n-novanest     (source: plan)        applied
  note                               (logged)                              (source: plan)        n/a

Plan status:  applied at a1b2c3d (was: pending)
              — overrides: (none) / 1 plan op overridden by inline
```

If a plan op was overridden, list which one and which inline op took its place.

If `status: partial-failure`, surface the failed ops loudly above the regular deploy summary.

---



Every intent that reads a prompt file (Full deploy, Prompt-only update, KB-only sync, Full file sync) must run a pre-deploy parse pass BEFORE any Retell create/update call. The parse reads the prompt's literal grammar and produces the Retell-side config: which built-in functions to enable on the LLM, which variables go into mid-call extraction, and which go into post-call analysis. The grammar source of truth is [../../voice-ai-shared/references/retell-conventions.md](../../voice-ai-shared/references/retell-conventions.md).

### The three patterns

Scan the entire prompt file (and, in Trojan mode, scan both regular and Trojan prompt files — each has its own LLM and agent, so each gets its own parse). Match:

1. **Function invocations** — regex equivalent of `~call the function '<NAME>'(?:\s+[^~]*)?~`
   - Capture `<NAME>`. Ignore any trailing `with key=value, ...` arguments (not relevant to auto-wiring).
   - Partition into built-ins (`end_call`, `transfer_call`, `agent_transfer`, `press_digit`, `extract_dynamic_variable`) and custom (anything else).

2. **Store statements** — regex equivalent of `~store '(.+?)' in '(.+?)'~`
   - Capture the description (`'x'`) and the variable name (`'var'`).
   - Classify each match by position: is it **inside** the tilde-block of an `~call the function 'extract_dynamic_variable'~` invocation, or **outside**?
     - Inside → mid-call extraction variable for that `extract_dynamic_variable` call.
     - Outside → post-call extraction field for the agent's post-call analysis config.
   - "Inside" means the store statement appears within the same bullet group / nested list under the `extract_dynamic_variable` call. The template convention is to indent the `store` lines directly under the function call as a sub-list. If ambiguous, treat as post-call (the safer default — a post-call field costs nothing at runtime, a missing mid-call extraction breaks downstream `IF` logic).

3. **Variable references** — regex equivalent of `{{(\w+)}}`
   - Capture the variable name. Use this to cross-check: every `{{var}}` reference should have a prior `store` statement targeting `var`. If a `{{var}}` has no matching store, flag it in the pre-deploy report (the agent will inject empty string at runtime). Don't auto-fail the deploy — Ben may have a valid reason (e.g. system-provided variable like `{{caller_phone_number}}`, `{{current_time_America/Los_Angeles}}`).

### Produced artifacts

After the parse, you have:

| Artifact | Used in |
|---|---|
| `builtin_functions: [end_call, transfer_call, ...]` (deduped) | Enabled on the Retell LLM via the `general_tools` field (or equivalent — confirm exact field via Context7 before the call) |
| `custom_functions: [book_appointment, check_availability, ...]` (deduped, with any `with key=value` args captured for reference) | **Cross-checked against `general_tools` after ops execute.** If a custom function name appears in the prompt grammar AND a matching tool entry was created/exists on the LLM (via ops, or from a prior run), no flag. If a name appears in the grammar but NO tool entry matches → flag as "orphaned function reference" in the report (the agent will read the line as instruction text at runtime, not as a function call). Conversely, if a tool entry exists but no grammar reference calls it, flag as "unused custom function" — informational, not a failure. The mechanism that wires custom functions is `create_custom_function` / `update_custom_function` ops, executed from the plan or inline. |
| `mid_call_extractions: [{function_call_index, variables: [{name, description}]}]` | Wired into each `extract_dynamic_variable` function-call config on the LLM |
| `post_call_extractions: [{name, description}]` | Wired into the Retell agent's post-call analysis data config |
| `variable_references: [var_name, ...]` (with unresolved flag) | Report-only — flagged if any reference has no backing store or isn't a known system variable |

For `mid_call_extractions` and `post_call_extractions`, infer `type` from the description and surrounding prompt text. Common inferences:

- Description mentions "yes or no", "true or false", "agreed / declined" → boolean
- Description mentions "phone number", "email", "address", "name", "summary", "reason" → string
- Description mentions "count", "number of", "how many", "age", "year" → integer
- Description mentions "dollar amount", "price", "percentage", "rating" → number
- Description mentions "date", "time", "timezone" → string (ISO format preferred; surface in the description itself)
- When in doubt → string

If Retell's post-call analysis schema requires a human-readable description per field, generate it from the prompt context (a 1-2 sentence summary of what to extract and when). Don't default to the variable name — the description guides Retell's extraction.

### Where the parse runs in each intent

- **Full deploy**: parse BEFORE `create_retell_llm`. Pass `builtin_functions` and mid-call extraction configs as part of the LLM creation. Pass post-call extraction config on `create_agent`.
- **Prompt-only update**: parse BEFORE step 2 of the 4-step draft-update sequence. Compare against the current LLM's enabled functions and current agent's post-call config — if either set changed, include the new values on `update_retell_llm` (functions / mid-call extractions) and `update_agent` (post-call extractions). If nothing grammar-related changed, skip those fields.
- **KB-only sync**: parse is still required because the prompt text is being sent on `update_retell_llm` anyway (per the 5-step sequence), and a KB-only trigger doesn't guarantee the grammar didn't also drift. Same diff-against-current logic.
- **Full file sync**: same as prompt-only — parse, diff, include in the single `update_retell_llm` + `update_agent` calls.

### Reporting

Every run's summary (per intent) must list:

```
Retell config from grammar:
  Built-in functions enabled:   [end_call, transfer_call, extract_dynamic_variable]
  Custom functions (manual):    [book_appointment, check_availability]
  Mid-call extractions:         3 variables across 1 extract_dynamic_variable call
  Post-call extractions:        6 fields
  Unresolved {{variable}} refs: none   (or: [foo, bar] — see flags below)
```

If grammar references custom functions that have NO matching tool entry on the LLM after ops execute, add a block: `Orphaned function references in prompt: <list>. These names appear in '~call the function ...~' lines but have no matching general_tools entry. Add a 'create_custom_function' op to the deploy plan (or inline) to wire them, or remove the references from the prompt.`

### Failure modes

- **Grammar regex matches zero function-call or store patterns in a well-structured prompt** → almost certainly means the prompt uses the old grammar (`~call end_call~`, `~Store in 'X' variable~`). Stop before any Retell call, show Ben the first few old-pattern lines you found (run a second scan for the old patterns), and ask whether to: (a) rewrite the prompt to new grammar first via `voice-ai-improve-prompt`, then re-deploy; or (b) proceed with deploy anyway (no built-ins / extractions will be configured). Default is (a).
- **Same variable name used in both a mid-call and a post-call store** (unusual but possible) → mid-call wins; log the conflict.
- **Custom function appears in a `call the function 'NAME'` block but isn't registered on the Retell agent** → the agent will silently read the line as instruction text at runtime. Flag in the report; do NOT auto-register (custom function config is out of scope until N8N phase).

---

## Model enum (current, as of this writing)

Retell's supported LLM model enum is much broader than `gpt-4.1`: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5.1`, `gpt-5.2`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `claude-4.5-sonnet`, `claude-4.6-sonnet`, `claude-4.5-haiku`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.0-flash`. Default for new deploys is `gpt-4.1` (anchored in this skill), but the caller can override.

Note: `model` and `model_temperature` are settable at `create_retell_llm` time and via `RetellLlmOverride`, but the `update-retell-llm` endpoint does NOT accept them in its request body (only `begin_message`, `general_prompt`, `general_tools`, `states`). Changing model or temperature on a live LLM therefore requires recreating the LLM and re-pointing the agent's `response_engine.llm_id` — see **Agent param tweak** intent.

## Derived agent name

Rules (shared with `voice-ai-prototype` so collision checks and lookups agree):

1. Take the prompt filename, strip `.md` or `.txt`.
2. Strip trailing `-prompt` or `-voice-agent-prompt` if present. Keep a trailing `-trojan` marker.
3. Replace `-` and `_` with spaces, uppercase, collapse whitespace.
4. If the result does NOT end in ` TROJAN`, append ` VOICE AGENT`.

Examples:
- `john-giordani-voice-agent-prompt.md` → `JOHN GIORDANI VOICE AGENT`
- `john-giordani-prompt-trojan.md` → `JOHN GIORDANI TROJAN`

If the derived name would be just `VOICE AGENT` or `PROMPT VOICE AGENT` (filename too generic), stop and ask the caller for an explicit agent name.

---

## Retell agent versioning (applies to every non-create deploy)

Retell maintains native version history per agent. Each `update_*` call mutates a mutable **draft**; calling `POST /publish-agent/{agent_id}` freezes that draft as an immutable published version N and spawns a fresh draft N+1. Phone numbers assigned to "Draft" always follow the latest, so the draft IS what live callers reach.

**This skill no longer auto-publishes.** Every non-create deploy updates the draft and tags it with `version_description` ready for publish, but does NOT call `POST /publish-agent`. Live calls hit the new state immediately (because phones follow Draft); Ben decides when to freeze it as an immutable version by publishing manually from the Retell dashboard. The `version_description` field is set on the draft so when he does publish, the version entry already carries the SHA + description without him typing anything.

Rationale: auto-publish was creating immutable history entries on every typo fix. The audit trail of Retell versions was getting noisy, and rollbacks weren't actually using it (git history of `ai_prompts` is the real audit trail). Decoupling deploy (frequent, live) from publish (deliberate, audited) gives Ben control over when version entries are created.

**What still gets tagged on every deploy (just on the draft, not as a published version):**

- **Commit SHA (short, 7 chars):** from the caller's invocation prompt if provided (CI passes `$CI_COMMIT_SHA`), otherwise `git -C <ai_prompts> rev-parse --short HEAD`.
- **Description (one line):** MR title on the CI path, commit subject on the direct-mode path, or the caller's instruction text (truncated to ~100 chars) for a standalone invocation. Combined as `"<sha> <description>"`.

### The 4-step draft-update sequence (used by every non-create intent)

```
1. current_llm = get_retell_llm(llm_id)
   # capture current begin_message — REQUIRED on update_retell_llm, would
   # otherwise fail if we only sent general_prompt

2. update_retell_llm(llm_id,
                     begin_message = current_llm.begin_message,
                     general_prompt = <new prompt contents>,
                     knowledge_base_ids = <updated list if KBs changed>)
   # bumps the draft LLM's version counter

3. updated_llm = get_retell_llm(llm_id)
   # capture the new draft version number

4. update_agent(agent_id,
                response_engine = { type: "retell-llm",
                                    llm_id: llm_id,
                                    version: updated_llm.version },
                version_description = "<sha> <title>")
   # pins the draft agent to the new LLM draft version AND tags
   # the draft agent description, ready for Ben to publish manually
```

After step 4, the live agent state IS updated — phones pinned to Draft serve the new prompt + LLM. `get_agent_versions(agent_id)` shows the publish history Ben has explicitly created via the dashboard; the most recent unpublished draft is visible in the dashboard as "Draft (unsaved changes)" with the SHA + description preview.

**On create deploys (first-time):**
- `create_retell_llm` with `begin_message`, `general_prompt`, `knowledge_base_ids`, model, `model_temperature`.
- `create_agent` with `response_engine`, `voice_id`, and `version_description: "<sha> initial deploy"`.
- The initial create IS the live version 0 by default — no publish call needed (and none was made before either).

**Failure handling:**
- If `update_retell_llm` or `update_agent` fails, the Retell state is unchanged (atomic per call). Stop, surface the error.
- No publish step means there's no "draft updated but publish failed" failure mode to handle anymore. Simpler.

**Manually publishing later** (out of scope for this skill, documented here for reference): Ben opens the agent in the Retell dashboard, sees the draft with the description "(sha) (title)" already populated, clicks Publish. That freezes the version with the existing description, no additional typing required. If he wants a different description for the published version, he edits it there before clicking publish.

---

## Post-deploy webhook (optional)

If the invocation prompt includes a webhook URL + JSON payload, fire it **once**, after the Retell work succeeds:

1. POST the caller-supplied JSON payload to the caller-supplied URL, `Content-Type: application/json`, 15-second timeout.
2. Fire-and-forget: a connection failure or non-2xx response is logged in the final report but does NOT mark the deploy as failed. The agent is already live.
3. No templating inside this skill. No variable substitution. The caller — `voice-ai-head` orchestrating a prospect build, or CI passing through an env-var-defined URL — has already filled the payload with whatever literal values the downstream automation expects.

**Parsing the webhook from the invocation prompt:** look for a clear signal like "POST to <url> with this payload: { ... }" or "after deploy, webhook to <url> with { ... }". If the URL is there but the payload is absent, POST an empty `{}` body. If the payload is there but the URL is absent, ignore — don't guess URLs.

**Reporting:** every run's report ends with a webhook status line: `Webhook: fired (HTTP 200)`, `Webhook: failed (connection refused)`, or `Webhook: none configured`.

---

## Intent: Full deploy (create)

Used for first-time deploys. Caller is typically `voice-ai-prototype` handing off a freshly committed prompt file.

### 1. Validate inputs

- Confirm the prompt file exists.
- Confirm no sidecar exists yet. If one does, switch to the matching update intent.
- Confirm no agent exists in Retell under the derived name (`list_agents`, case-insensitive compare). If one does, refuse with the existing `agent_id`.
- For Trojan mode: both the regular and Trojan prompts must exist as siblings in the same folder before deploying either.

### 2. Fixed deploy settings

- Model: `gpt-4.1`
- Voice: Jennifer Suarez. Look up `voice_id` at runtime via `list_voices` — name is the anchor, never a hardcoded ID.
- Default area code: `954`. Use caller's value if they specified one.

### 3. Parse grammar + create LLM(s)

Run the **Pre-deploy grammar parse** on the regular prompt file first (and on the Trojan prompt file separately in Trojan mode — each LLM gets its own parse). This produces the built-in-functions list, the mid-call extraction configs, the post-call extraction fields, and the list of custom functions needing manual wiring.

Regular: `create_retell_llm` with `model: "gpt-4.1"`, `general_prompt: <regular prompt file contents>`, `model_temperature: 0`, plus the parsed built-in functions and mid-call extraction configs (confirm exact field names for the `general_tools` / extraction schema via Context7 before the call — the Retell API shape evolves). Capture `llm_id_regular`.

Trojan (when a sibling `-trojan.md` exists): create a second LLM with the Trojan prompt's contents AND its own parse result (the Trojan file may reference a different set of functions / variables than the regular prompt, e.g. additional sales-funnel captures). Consider bumping `model_temperature` by 0.1 on the Trojan LLM only (makes the sales segue feel less scripted). Flag the choice in the final report. Capture `llm_id_trojan`.

### 4. Create knowledge bases and attach

For each `kb-*.txt` in the prompt's folder:

1. KB name: `<REGULAR AGENT NAME> — <topic>`, where `<topic>` is the filename segment between `kb-` and `.txt`, title-cased. Example: `kb-faqs.txt` → `JOHN GIORDANI VOICE AGENT — Faqs`. Trojan pairs share KBs anchored to the regular name.
2. REST: `POST /create-knowledge-base` to create the KB container.
3. REST: `POST /add-knowledge-base-sources` to upload the `.txt` as a source.
4. Capture `knowledge_base_id`.

After all KBs exist, attach them to both LLMs (Trojan mode) or just the one LLM (regular mode) via `update_retell_llm` with `knowledge_base_ids: [...]`.

If any KB step fails, report what was created and what failed, then stop. Don't leave half-wired agents.

### 5. Create agent(s)

Regular agent: `create_agent` with:
- `agent_name`: derived regular name
- `response_engine`: `{ type: "retell-llm", llm_id: llm_id_regular, version: 0 }` (version 0 = latest draft of the LLM we just created)
- `voice_id`: Jennifer Suarez
- `version_description`: `"<short-sha> initial deploy"` where `<short-sha>` is `git -C <ai_prompts> rev-parse --short HEAD` or the SHA the caller passed in
- Post-call analysis data config: the `post_call_extractions` list from the grammar parse, converted to Retell's post-call-analysis schema (field name, type, description per entry). Confirm the exact field name on `create_agent` via Context7 — Retell's post-call-analysis schema evolves.

Trojan mode: create a second agent with `agent_name` = derived Trojan name, `llm_id: llm_id_trojan`, same voice, same `version_description` format, and its OWN post-call extraction list (parsed from the Trojan file — Trojan prompts often extract sales-funnel fields the regular prompt doesn't, e.g. `missed_calls_per_day`, `lost_revenue_acknowledged`, `agreed_to_book`).

### 6. Provision phone number

Regular mode: `create_phone_number` with `area_code` (caller's or `954`), `inbound_agent_id: agent_id_regular`. Capture `phone_number`.

Trojan mode: `create_phone_number` with `inbound_agent_id: agent_id_trojan`. The phone routes to the Trojan agent only. The regular agent stays phone-less.

If no number is available in the requested area code, surface Retell's error verbatim and ask for a fallback. Don't silently pick a different one.

### 7. Write sidecar(s)

Three fields only, per the schema above. Regular mode → one sidecar next to the prompt. Trojan mode → two sidecars (one next to each prompt), each with its own `agent_id` / `llm_id`. Both sidecars reference the same `knowledge_bases[]` entries (same IDs, same source files).

### 8. Git commit the sidecar(s)

```bash
cd "<ai_prompts root>"
git add "<sidecar path>" ["<trojan sidecar path>"]
git commit -m "deploy(<prompt-slug>): record Retell agent metadata"
git push origin main
```

If push rejects non-fast-forward, `git pull --rebase origin main` and retry once. If rebase conflicts, stop.

### 9. Fire the webhook (if configured)

Per **Post-deploy webhook** above.

### 10. Report back

```
Created in Retell:
  Agent:      JOHN GIORDANI VOICE AGENT
  agent_id:   agent_abc...
  llm_id:     llm_xyz...
  Voice:      Jennifer Suarez
  Phone:      +1 (954) 555-0123  (area: 954 default)
  KBs:
    - kb-faqs.txt -> kb_abc...

Sidecar:  committed <short-sha>
Webhook:  fired (HTTP 200)   | or: none configured | or: failed (...)
```

Trojan mode: include both agents, note the phone is bound to Trojan only, include "Demo number to send the lead: <phone>".

---

## Intent: Prompt-only update

Caller is typically `voice-ai-improve-prompt` direct mode (inline ops in invocation), or a GitLab CI-triggered mission task (plan file alongside the prompt).

1. Read the sidecar → `agent_id`, `llm_id`. If missing, run **Sidecar recovery** first, then retry.
2. Read the current prompt file contents.
2.0. **Run Op-list ingest** (Steps OP1 through OP5 above). Inline ops + plan file ops are discovered, validated, and executed against the LLM/agent before the grammar parse runs. `current_llm_id` may change here if a `set_model` op ran.
2.5. Run the **Pre-deploy grammar parse** on the new prompt contents. Fetch the current LLM's enabled functions (`get_retell_llm`) and the current agent's post-call analysis config (`get_agent`). Diff:
    - If `builtin_functions` or mid-call extraction configs changed → include the new values on the `update_retell_llm` call in step 3.
    - If `post_call_extractions` changed → include the new list on the `update_agent` call in step 3.
    - If custom functions were added → log in the report; no auto-config.
    - If nothing grammar-related changed → pass nothing extra, just the prompt.
3. Run the **4-step draft-update sequence** from the Retell agent versioning section above:
   - `get_retell_llm(llm_id)` — capture `begin_message` (required on the next call). This call may already be done by step 2.5's diff — reuse the result.
   - `update_retell_llm(llm_id, begin_message=<existing>, general_prompt=<new>, <built-in functions + mid-call extractions if changed>)` — KBs unchanged, so do NOT pass `knowledge_base_ids`.
   - `get_retell_llm(llm_id)` — capture the new draft LLM version number.
   - `update_agent(agent_id, response_engine={type: "retell-llm", llm_id, version: <new llm version>}, version_description: "<sha> <title>", <post-call extractions if changed>)`.

   The draft is now live (phones follow Draft). No publish call. Ben publishes manually from the dashboard when he wants a frozen audit entry.
4. Sidecar update: usually no change. Exception: if a `set_model` op ran, `llm_id` was rewritten in-memory in Step OP5; persist the new `llm_id` to the sidecar file now and commit (skip commit in CI per the standard rule).
5. **Run Op-list status rewrite** (Step OP7 above) if a plan file was consumed.
6. Fire the webhook (if configured).
7. Report:
   ```
   LLM <llm_id> draft updated.
   Agent <agent_id> draft tagged "<sha> <title>" — live (phones follow Draft).
   Publish manually from the Retell dashboard if you want an audit-trail entry.
   Ops: <count> applied / <count> failed   (or: "no ops")
   Plan: <status> at <sha>                  (or: "no plan file")
   Webhook: fired (HTTP 200)   | or: none configured | or: failed (...)
   ```

---

## Intent: KB-only sync

Caller said "resync KBs for X" or pointed at a `kb-*.txt` file directly.

1. Resolve the sibling prompt file (same folder, matching `*-prompt.md` or `*-voice-agent-prompt.md`).
2. Read the sidecar. If missing, run **Sidecar recovery** first.
3. Build a diff of local `kb-*.txt` files vs sidecar's `knowledge_bases[]`:
   - **New local file, no sidecar entry** → `POST /create-knowledge-base` (multipart/form-data, file in `knowledge_base_files`) → append to sidecar.
   - **Existing match (local file content changed)** → `GET /get-knowledge-base/{kb_id}` to read current sources → `POST /add-knowledge-base-sources/{kb_id}` (multipart) with the new file → `DELETE /delete-knowledge-base-source/{kb_id}/source/{old_source_id}`. Sidecar entry stays the same (we store KB ID, not source ID).
   - **Sidecar entry with no local file** → detach the KB from the LLM via `update_retell_llm`, remove the entry from sidecar. Don't delete the KB entity in Retell automatically — log it as manual cleanup.
4. Run the **Pre-deploy grammar parse** on the current prompt contents (the prompt wasn't edited here, but grammar parse is cheap and guards against drift between prompt and Retell config). Diff against current LLM + agent config as in the Prompt-only intent; include any changes in the update calls below.
5. Run the **4-step draft-update sequence** to redeploy:
   - `get_retell_llm(llm_id)` — capture `begin_message`.
   - `update_retell_llm(llm_id, begin_message=<existing>, general_prompt=<current prompt file contents>, knowledge_base_ids=<updated list>, <built-in functions + mid-call extractions if changed per step 4>)`.
   - `get_retell_llm(llm_id)` — capture new LLM version.
   - `update_agent(agent_id, response_engine={type: "retell-llm", llm_id, version: <new>}, version_description: "<sha> <title>", <post-call extractions if changed per step 4>)`.
   - In Trojan mode, run the LLM update + agent update for BOTH agents (they share KBs, so the new `knowledge_base_ids` list applies to both LLMs; but each LLM/agent gets its OWN parse-derived config — Trojan file may declare different functions/extractions than the regular file).
5. Write the updated sidecar (`knowledge_bases[]` changed). Commit:
   ```bash
   git add "<sidecar path>"
   git commit -m "deploy(<prompt-slug>): resync KBs"
   git push origin main
   ```
   In CI context (`$GITLAB_CI=true` or caller hint), skip the commit — surface the updated sidecar contents in the report instead.
6. Fire the webhook.
7. Report what was added / updated / detached, plus the current draft tag ("<sha> <title>"). No published version is created here — Ben publishes manually from the dashboard if he wants a frozen entry.

---

## Intent: Full file sync

Prompt AND KB files both changed. Do NOT run prompt update and KB sync as two separate draft updates — batch them into a single 4-step sequence:

0. **Run Op-list ingest** (Steps OP1 through OP5). Plan file or inline ops execute first; `current_llm_id` may change if a `set_model` op ran.
1. KB diff + mutations first (create/add-source/delete-source as needed), accumulating the final `knowledge_base_ids` list.
1.5. Run the **Pre-deploy grammar parse** on the new prompt contents (and on the Trojan file separately, in Trojan mode). Diff the parsed built-ins / mid-call / post-call configs against the current LLM + agent state. Include any changes in the update calls below.
2. `get_retell_llm(llm_id)` — capture `begin_message`.
3. `update_retell_llm(llm_id, begin_message=<existing>, general_prompt=<new prompt>, knowledge_base_ids=<final list>, <built-in functions + mid-call extractions if changed>)` — one LLM update carrying the new prompt, the updated KB attachments, AND any grammar-driven config changes.
4. `get_retell_llm(llm_id)` — capture new LLM version.
5. `update_agent(agent_id, response_engine={type: "retell-llm", llm_id, version: <new>}, version_description: "<sha> <title>", <post-call extractions if changed>)`.
6. Write the updated sidecar (`knowledge_bases[]` changed; `llm_id` also changes if a `set_model` op ran in Step 0). Single commit: `deploy(<prompt-slug>): resync prompt + KBs`.
7. Run Op-list status rewrite (Step OP7) if a plan file was consumed.
8. Single webhook fire.

Trojan mode: steps 2–5 run for both LLMs + both agents (they share KBs). Each LLM/agent uses its OWN parse-derived config. No publish call — drafts go live, Ben publishes manually when he wants the audit entry.

---

## Intent: Agent param tweak

> **Prefer inline ops over this intent.** Modern callers should pass `op: set_voice`, `op: set_model`, etc. inline rather than parse a free-form sentence. This intent stays documented for backwards compatibility — when the caller passes a free-form instruction with no inline ops block, this is the fallback. If both are passed, ops win and this intent's free-form parsing is skipped.

Caller's instruction changes something on the agent that ISN'T the prompt or KBs. The Retell API splits tweakable fields in two groups — know which mutation path applies:

**Mutable in-place on `update_agent`** (confirmed via docs):
- `voice_id` — "change voice to Jennifer Suarez"
- `voice_model` — e.g. `eleven_turbo_v2_5`, `sonic-3`
- `fallback_voice_ids` — provider-outage fallback list
- `agent_name` — rename the agent
- `language` — e.g. `en-US`, `es-ES`
- `version_description` — the description slot (always set on every update)

**NOT mutable on `update-retell-llm`** (requires LLM recreation):
- `model` — to change from `gpt-4.1` to `gpt-5`, `claude-4.6-sonnet`, etc.
- `model_temperature` — can only be set at LLM creation time

If the caller asks for a `model` or `model_temperature` change, the flow is heavier: `create_retell_llm` with the new settings (copy `begin_message`, `general_prompt`, `knowledge_base_ids` from the old LLM) → `update_agent` to re-point `response_engine.llm_id` at the new LLM with a tagged `version_description` → swap `llm_id` in the sidecar → commit. No publish call — draft goes live, Ben publishes manually. Then the old LLM is orphaned (manual cleanup). Worth explicitly confirming with the caller before taking this path.

### Standard in-place tweak

1. Resolve target: caller names a client → find sidecar → `agent_id`.
2. Clarify ambiguities once, then act. Examples:
   - "change voice to Jennifer Suarez" → `list_voices` → `update_agent(agent_id, voice_id: <voice_id>, version_description: "<sha> change voice to Jennifer Suarez")`.
   - "set fallback voices for John Giordani" → `update_agent(agent_id, fallback_voice_ids: [...], version_description: "...")`.
   - "set language to Spanish" → `update_agent(agent_id, language: "es-ES", version_description: "...")`.
3. The change is live immediately (phones follow Draft). No publish call. Ben publishes manually from the dashboard when he wants the audit entry — `version_description` is already set, so the published entry inherits it.
4. **Do NOT update the sidecar.** It holds only the binding (agent_id, llm_id, KBs) — none of those change here.
5. **Do NOT commit anything to git.** No file changed, no sidecar changed.
6. Fire the webhook (if configured).
7. Report exactly what changed in Retell + the current draft description.

Never write this change to the prompt file. The prompt file is for prompt content; agent settings live only in Retell.

---

## Intent: Sidecar recovery

Caller says "rebuild sidecar for X" or any other intent tripped because the sidecar is missing/corrupt.

1. Derive the agent name from the prompt filename.
2. `list_agents` and match by name (case-insensitive). Zero matches → stop, nothing to recover. Multiple matches → stop and show candidates.
3. `get_agent` → capture `agent_id`, `response_engine.llm_id`.
4. `get_retell_llm(llm_id)` → capture `knowledge_base_ids`.
5. For each `knowledge_base_id`, fetch the KB via REST (`GET /get-knowledge-base/{id}`) to read its name. Match back to local `kb-*.txt` files by the name convention (`<AGENT NAME> — <Topic>` ↔ `kb-<topic>.txt`, topic lowercased). If a KB has no local counterpart, record it with `source_file: null` and flag in the report.
6. Write the 3-field sidecar:
   ```json
   {
     "agent_id": "...",
     "llm_id": "...",
     "knowledge_bases": [ { "source_file": "kb-faqs.txt", "id": "kb_..." } ]
   }
   ```
7. Commit (outside CI). Report what was recovered and flag anything ambiguous.

No phone number lookup, no voice capture, no timestamp guessing. Those don't belong in the sidecar.

---

## Edge cases and failure handling

- **Plan file present but YAML block malformed** → stop before any mutation, surface the parse error with line numbers. Do NOT fall through to grammar-only deploy silently. Explicit failure beats silent partial deploy.
- **Plan file's `prompt` frontmatter field doesn't match the prompt being deployed** → stop and ask. Almost certainly the plan was committed in the wrong folder.
- **Inline ops + plan ops both target same op-type + same target** → inline wins, plan op logged as `overridden: true` in report. Both run through the same status-rewrite logic (plan still marked applied because the user got the override).
- **Plan op references custom function the prompt grammar never calls** → execute the op anyway (the function will exist on the LLM, just unused at runtime). Flag in the report as "unused custom function". Don't auto-delete.
- **Grammar references custom function with no matching tool entry after ops run** → flag as "orphaned function reference" in the report. The agent will read the line as instruction text at runtime, not as a function call. Don't auto-create — the user should add a `create_custom_function` op in a follow-up.
- **`set_model` op runs, then a later op fails** → the new LLM is live but the plan's status is `partial-failure`. Sidecar `llm_id` is updated regardless (the new LLM IS the current one). On retry, skip `set_model` (already applied) and resume from the failed op against `new_llm_id`.
- **n8n MCP for an `*_n8n_workflow` op is not in available tools** → fail just that op with a clear error ("MCP `n8n-novanest` not available; add it to .mcp.json"); other ops continue.
- **Sidecar's `agent_id` no longer exists in Retell** → surface the broken link, ask caller whether to rebuild sidecar (→ recovery intent) or recreate the agent (→ full deploy). Never silently recreate.
- **Prompt file path doesn't exist** → stop. Don't run any Retell calls blind.
- **Derived name collides with an unrelated live agent** on first-time deploy → refuse with the conflicting `agent_id`.
- **KB REST endpoint shape changed** → re-query Context7 before retrying. Don't hammer the API with guessed payloads.
- **No phone number available in requested area code** → surface Retell's error, ask for alternate area code.
- **Caller mixes a file sync and a param tweak in one ask** → do the file sync, report it, then ask explicitly whether to also apply the param tweak.
- **Running in CI context** (env var `GITLAB_CI=true`, or caller hint in the handoff message) → do every Retell operation, but **skip the sidecar git commit**. Print the updated sidecar contents at the end of the report instead. Whether CI writes back to the repo is decided upstream.
- **File says prompt is for a Trojan pair but only one sidecar exists** → deploy or update only the one that matches the caller's intent. Don't improvise the other.
- **User asks to delete an agent/LLM/KB/number** → refuse. This skill is for create + update only. Deletion is manual.
- **Webhook fails** → log the HTTP status (or connection error), continue. Never retry. Never fail the deploy.
- **Manual publish workflow note** → the audit-trail entry only exists when Ben publishes from the dashboard. If a deploy succeeded but no published version exists, that's expected — the draft IS live. Only flag if `version_description` on the draft is empty or stale (means a prior deploy didn't tag properly).

---

## What this skill is NOT for

- Editing prompt `.md` files or `kb-*.txt` files — that's `voice-ai-improve-prompt`.
- Drafting a new prompt from scratch — that's `voice-ai-prototype`.
- **Drafting `_deploy-plan.md`** — that's `voice-ai-improve-prompt`'s Step B3. This skill EXECUTES the plan but doesn't write it. The only mutation it makes to the plan file is updating `status` and `last_applied_sha` (and per-op `applied:` flags) after execution.
- Testing the agent, making test calls, reviewing transcripts.
- Deleting any Retell resources (except via `delete_custom_function` op).
- Managing GitLab MRs, running `glab`, opening pull requests.
- Writing `.gitlab-ci.yml` or any CI config.
- Sending SMS, Slack messages, or any specific notification directly — fire a webhook, let downstream automation do the notification.
