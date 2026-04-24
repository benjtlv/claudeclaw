---
name: voice-ai-deploy-retell
description: Syncs Retell state to match a voice AI agent's prompt files, or applies a free-form Retell-side change. The single skill for every Retell API interaction in the voice-ai stack — full first-time deploy (create LLM + KBs + agent + phone + sidecar), prompt-only redeploy, KB-only resync, agent parameter tweaks (voice, temperature, language), and sidecar recovery. Every non-create deploy publishes a new Retell agent version tagged with commit SHA + one-line description, so Retell's own version history is the audit trail — the local sidecar stays minimal. Accepts an optional post-deploy webhook (URL + JSON payload) that fires once after a successful deploy, fire-and-forget; the caller pre-fills whatever JSON the downstream automation expects (Slack, SMS, anything). Use this skill whenever Retell needs to change — as a follow-up to `voice-ai-prototype` (first deploy), after `voice-ai-improve-prompt` direct mode (post-push redeploy), on a GitLab CI-triggered mission task (post-merge deploy), or standalone ("swap John Giordani's voice to Jennifer Suarez", "re-upload the KB file for A1 Biohazard", "rebuild the sidecar for X"). Triggers: "deploy retell for <file>", "redeploy <client>'s agent", "update retell agent", "push the prompt to retell", "sync the kb", "change the voice on <agent>", "rebuild the sidecar for <client>". Do NOT use this skill to edit a prompt or KB file — that's `voice-ai-improve-prompt`. Do NOT use it for first-time prompt drafting — that's `voice-ai-prototype`. This skill only touches Retell, the sidecar file, and (optionally) one webhook.
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

- **MCP prefix:** `mcp__<slug>-retellai-mcp-server__<tool>`. Examples:
  - `novanest` → `mcp__novanest-retellai-mcp-server__update_retell_llm`
  - `voci-partners` → `mcp__voci-partners-retellai-mcp-server__update_retell_llm`
- **REST API key env var** (for KB ops that have no MCP equivalent and require multipart/form-data REST calls):
  - `novanest` → `RETELL_API_KEY` (no suffix — preserves the existing convention)
  - any other slug → `RETELL_API_KEY_<SLUG_UPPER>` where `<SLUG_UPPER>` is the slug uppercased with hyphens→underscores. `voci-partners` → `RETELL_API_KEY_VOCI_PARTNERS`.

### Pre-flight checks (do both before any Retell work)

1. **MCP availability:** Verify `mcp__<slug>-retellai-mcp-server__*` is in your available tool list. If missing, STOP — tell Ben to add the MCP to his `.mcp.json`. Do NOT fall back to `novanest` or any other account, even if another MCP happens to have an agent with the same derived name.
2. **REST key availability** (only if you'll hit a REST-only endpoint this run — KB ops): verify the matching env var is set. If missing, STOP and tell Ben to add it to his `.env`.
3. For the rest of the run, every Retell call — MCP tool invocation OR REST `curl` — uses ONLY the pinned slug's prefix / env var. No cross-account calls, ever.

When Ben onboards a new client, he does two things manually and in parallel: adds the MCP under `<slug>-retellai-mcp-server` and sets `RETELL_API_KEY_<SLUG_UPPER>` in `.env`. Both naming rules are mechanical, so "which MCP do I use here?" never has a judgment call in it.

---

## What this skill does

This is the single primitive for pushing change into Retell. Every path that needs the live agent to reflect a new state lands here:

- A brand-new prompt that was just produced by `voice-ai-prototype` — deploy end-to-end (create LLM, create KBs, create agent, provision phone, write sidecar).
- A prompt file that was just edited and pushed by `voice-ai-improve-prompt` direct mode — update the existing LLM's `general_prompt`, resync any changed KBs, publish a new Retell agent version.
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

Never combine a file-driven intent with a param tweak in one run. Finish the file sync, then ask if a param tweak is also wanted.

## Inputs the skill accepts

- A prompt file path (most common). Example: `CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md`. Path is relative to `ai_prompts/` root unless absolute.
- A KB file path. Example: `CLIENTS/JOHN GIORDANI/kb-faqs.txt`. Skill resolves the sibling prompt for KB-only sync.
- A client name plus a free-form Retell-side instruction. Example: "swap John Giordani's voice to Jennifer Suarez". Skill resolves the agent via the sidecar or `list_agents`.
- A client name alone plus "rebuild sidecar".

Optional additional inputs the caller may include in the invocation prompt:
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
| **Publish agent** | `agent.publish` (SDK) | `POST /publish-agent/{agent_id}` (no body) |
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

Retell maintains native version history per agent. Each `update_*` call mutates a mutable **draft**; calling `POST /publish-agent/{agent_id}` freezes that draft as an immutable published version N and spawns a fresh draft N+1. Phone numbers assigned to "Draft" always follow the latest — which is what we want for auto-deploy.

**Version metadata is tagged on `update_agent`, NOT on the publish call.** The publish endpoint takes no body. `update_retell_llm` doesn't accept `version_description` either. The only place description + SHA survive into version history is `update_agent.version_description`. So the flow is: update LLM → update agent (with description) → publish.

**What tags a version:**

- **Commit SHA (short, 7 chars):** from the caller's invocation prompt if provided (CI passes `$CI_COMMIT_SHA`), otherwise `git -C <ai_prompts> rev-parse --short HEAD`.
- **Description (one line):** MR title on the CI path, commit subject on the direct-mode path, or the caller's instruction text (truncated to ~100 chars) for a standalone invocation. Combined as `"<sha> <description>"`.

### The 5-step publish sequence (used by every non-create intent)

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
   # the draft agent description

5. POST /publish-agent/{agent_id}
   # freezes draft as published version N, creates new draft N+1
```

Subsequent `get_agent_versions(agent_id)` then shows `version_description` on each published entry — that's our audit trail.

**On create deploys (first-time):**
- `create_retell_llm` with `begin_message`, `general_prompt`, `knowledge_base_ids`, model, `model_temperature`.
- `create_agent` with `response_engine`, `voice_id`, and `version_description: "<sha> initial deploy"`.
- Skip the explicit publish — the initial create IS version 0/1.

**Failure handling:**
- If `update_retell_llm` or `update_agent` fails, the Retell state is unchanged (atomic per call). Stop, surface the error.
- If they succeed but `publish-agent` fails, the live agent IS updated (the draft is what Draft-pinned phones serve), but no immutable version entry exists for rollback. Surface loudly in the report — don't fail the whole deploy.

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

### 3. Create LLM(s)

Regular: `create_retell_llm` with `model: "gpt-4.1"`, `general_prompt: <regular prompt file contents>`, `model_temperature: 0`. Capture `llm_id_regular`.

Trojan (when a sibling `-trojan.md` exists): create a second LLM with the Trojan prompt's contents. Consider bumping `model_temperature` by 0.1 on the Trojan LLM only (makes the sales segue feel less scripted). Flag the choice in the final report. Capture `llm_id_trojan`.

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

Trojan mode: create a second agent with `agent_name` = derived Trojan name, `llm_id: llm_id_trojan`, same voice, same `version_description` format.

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

Caller is typically `voice-ai-improve-prompt` direct mode, or a GitLab CI-triggered mission task.

1. Read the sidecar → `agent_id`, `llm_id`. If missing, run **Sidecar recovery** first, then retry.
2. Read the current prompt file contents.
3. Run the **5-step publish sequence** from the Retell agent versioning section above:
   - `get_retell_llm(llm_id)` — capture `begin_message` (required on the next call).
   - `update_retell_llm(llm_id, begin_message=<existing>, general_prompt=<new>)` — KBs unchanged, so do NOT pass `knowledge_base_ids`.
   - `get_retell_llm(llm_id)` — capture the new draft LLM version number.
   - `update_agent(agent_id, response_engine={type: "retell-llm", llm_id, version: <new llm version>}, version_description: "<sha> <title>")`.
   - `POST /publish-agent/{agent_id}`.
4. Sidecar does NOT need rewriting — `agent_id` and `llm_id` are unchanged, and no KBs changed. Skip the commit.
5. Fire the webhook (if configured).
6. Report:
   ```
   LLM <llm_id> redeployed.
   Agent <agent_id> published as v<N> "<sha> <title>"
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
4. Run the **5-step publish sequence** to redeploy:
   - `get_retell_llm(llm_id)` — capture `begin_message`.
   - `update_retell_llm(llm_id, begin_message=<existing>, general_prompt=<current prompt file contents>, knowledge_base_ids=<updated list>)`.
   - `get_retell_llm(llm_id)` — capture new LLM version.
   - `update_agent(agent_id, response_engine={type: "retell-llm", llm_id, version: <new>}, version_description: "<sha> <title>")`.
   - `POST /publish-agent/{agent_id}`.
   - In Trojan mode, run the LLM update + agent update + publish for BOTH agents (they share KBs, so the new `knowledge_base_ids` list applies to both LLMs).
5. Write the updated sidecar (`knowledge_bases[]` changed). Commit:
   ```bash
   git add "<sidecar path>"
   git commit -m "deploy(<prompt-slug>): resync KBs"
   git push origin main
   ```
   In CI context (`$GITLAB_CI=true` or caller hint), skip the commit — surface the updated sidecar contents in the report instead.
6. Fire the webhook.
7. Report what was added / updated / detached, plus the new published version number.

---

## Intent: Full file sync

Prompt AND KB files both changed. Do NOT run prompt update and KB sync as two separate publishes — batch them into a single 5-step sequence:

1. KB diff + mutations first (create/add-source/delete-source as needed), accumulating the final `knowledge_base_ids` list.
2. `get_retell_llm(llm_id)` — capture `begin_message`.
3. `update_retell_llm(llm_id, begin_message=<existing>, general_prompt=<new prompt>, knowledge_base_ids=<final list>)` — one LLM update carrying both the new prompt AND the updated KB attachments.
4. `get_retell_llm(llm_id)` — capture new LLM version.
5. `update_agent(agent_id, response_engine={type: "retell-llm", llm_id, version: <new>}, version_description: "<sha> <title>")`.
6. `POST /publish-agent/{agent_id}`.
7. Write the updated sidecar (only `knowledge_bases[]` changed). Single commit: `deploy(<prompt-slug>): resync prompt + KBs`.
8. Single webhook fire.

Trojan mode: steps 2–6 run for both LLMs + both agents (they share KBs). One publish per agent, not per step.

---

## Intent: Agent param tweak

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

If the caller asks for a `model` or `model_temperature` change, the flow is heavier: `create_retell_llm` with the new settings (copy `begin_message`, `general_prompt`, `knowledge_base_ids` from the old LLM) → `update_agent` to re-point `response_engine.llm_id` at the new LLM → publish → swap `llm_id` in the sidecar → commit. Then the old LLM is orphaned (manual cleanup). Worth explicitly confirming with the caller before taking this path.

### Standard in-place tweak

1. Resolve target: caller names a client → find sidecar → `agent_id`.
2. Clarify ambiguities once, then act. Examples:
   - "change voice to Jennifer Suarez" → `list_voices` → `update_agent(agent_id, voice_id: <voice_id>, version_description: "<sha> change voice to Jennifer Suarez")`.
   - "set fallback voices for John Giordani" → `update_agent(agent_id, fallback_voice_ids: [...], version_description: "...")`.
   - "set language to Spanish" → `update_agent(agent_id, language: "es-ES", version_description: "...")`.
3. `POST /publish-agent/{agent_id}` to freeze the change as a new immutable version.
4. **Do NOT update the sidecar.** It holds only the binding (agent_id, llm_id, KBs) — none of those change here.
5. **Do NOT commit anything to git.** No file changed, no sidecar changed.
6. Fire the webhook (if configured).
7. Report exactly what changed in Retell + the new published version number.

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
- **Retell version publish fails but the LLM/KB update succeeded** → log the missing version entry prominently, continue. The agent is live; the audit trail is the only thing missing.

---

## What this skill is NOT for

- Editing prompt `.md` files or `kb-*.txt` files — that's `voice-ai-improve-prompt`.
- Drafting a new prompt from scratch — that's `voice-ai-prototype`.
- Testing the agent, making test calls, reviewing transcripts.
- Deleting any Retell resources.
- Managing GitLab MRs, running `glab`, opening pull requests.
- Writing `.gitlab-ci.yml` or any CI config.
- Sending SMS, Slack messages, or any specific notification directly — fire a webhook, let downstream automation do the notification.
