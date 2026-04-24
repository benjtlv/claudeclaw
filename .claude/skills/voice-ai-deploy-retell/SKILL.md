---
name: voice-ai-deploy-retell
description: Syncs Retell state to match a voice AI agent's prompt files, or applies a free-form Retell-side change. Handles every Retell API interaction for the voice-ai stack — full first-time deploy (create LLM + KBs + agent + phone + sidecar), prompt-only redeploy, KB-only resync, agent parameter tweaks (voice, temperature, language), and sidecar recovery when metadata is missing. Use this skill whenever Retell needs to change — whether as a follow-up to `voice-ai-prototype` (first deploy), `voice-ai-improve-prompt` direct mode (post-push redeploy), a GitLab CI-triggered mission task after an MR merges (deploy merged prompt), or standalone ("swap John Giordani's voice to Jennifer Suarez", "re-upload the KB file for A1 Biohazard", "the sidecar for X is missing, rebuild it"). Triggers: "deploy retell for <file>", "redeploy <client>'s agent", "update retell agent", "push the prompt to retell", "sync the kb", "change the voice on <agent>", "rebuild the sidecar for <client>". Do NOT use this skill to edit a prompt or KB file — that's `voice-ai-improve-prompt`. Do NOT use it for first-time prompt drafting — that's `voice-ai-prototype`. This skill only touches Retell and the sidecar file.
---

# Voice AI — Deploy Retell

## What this skill does

This is the single primitive for pushing change into Retell. Every path that needs the live agent to reflect a new state lands here:

- A brand-new prompt that was just produced by `voice-ai-prototype` — deploy it end-to-end (create LLM, create KBs, create agent, provision phone, write sidecar).
- A prompt file that was just edited and pushed by `voice-ai-improve-prompt` direct mode — update the existing LLM's `general_prompt` and resync any KBs.
- A prompt that just landed on `main` via merged MR — same as above, but triggered by the Claude Claw mission task that GitLab CI queued.
- A one-off Retell tweak that has nothing to do with any file change (swap voice, bump temperature, change language, re-attach a KB). No commit, no file edit.
- A sidecar file that's missing, stale, or corrupt — resolve the agent by name, rebuild the sidecar from Retell's current state.

The skill does NOT edit prompt files or KB files. If the user's ask requires a file change, they want `voice-ai-improve-prompt`, not this skill. Refuse and route.

## Choosing the intent

When invoked, inspect (in this order) the caller's handoff message, the file state, and the sidecar state. Pick exactly one intent:

| Intent | When to pick it |
|---|---|
| **Full deploy** (create) | Caller named a prompt file with no sidecar AND no agent in Retell with that derived name. Typical caller: `voice-ai-prototype` just finished. |
| **Prompt-only update** | Caller named a prompt file, sidecar exists with `llm_id`, agent exists in Retell. No KB files changed since last sync (check sidecar's `last_synced_at` vs `kb-*.txt` mtime). Typical caller: `voice-ai-improve-prompt` direct mode, or CI-triggered mission task. |
| **KB-only sync** | Caller named a KB file (or said "resync KBs for X"), or the prompt file is unchanged but `kb-*.txt` files are newer than `last_synced_at`. |
| **Full file sync** | Both prompt and at least one KB file changed since `last_synced_at`. Update prompt + resync all KBs in one pass. |
| **Agent param tweak** | Caller's instruction names an agent attribute with no file context (voice, temperature, language, webhook URL, end-call phrases, interruption sensitivity). No file is read, no commit is made. |
| **Sidecar recovery** | Caller says "rebuild sidecar" or named a prompt file whose sidecar is missing/corrupt but the Retell agent exists under the derived name. |

If two intents fit (e.g., a merged MR that touched both prompt and KBs), pick **Full file sync**. If zero intents fit, stop and ask the caller what they want.

Never combine a file-driven intent with a param tweak in one run. Finish the file sync, then ask if a param tweak is also wanted.

## Inputs the skill accepts

- A prompt file path (most common). Example: `CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md`. Path is relative to `ai_prompts/` root unless absolute.
- A KB file path. Example: `CLIENTS/JOHN GIORDANI/kb-faqs.txt`. Skill resolves sibling prompt for KB-only sync.
- A client name plus a free-form Retell-side instruction. Example: "swap John Giordani's voice to Jennifer Suarez". Skill resolves agent via sidecar or `list_agents`.
- A client name alone plus "rebuild sidecar". Skill queries Retell by derived name and writes sidecar.

## Repo and environment facts

- Prompts repo local path: `/Users/benjaminelkrieff/Documents/Claude Code Master Folder/ai_prompts` (on Ben's Mac). Historical references in older skills point at `C:\Users\benelk\Documents\ai_prompts` — that was the Windows path. Always resolve dynamically: `cd "$(git -C "$HOME/Documents/Claude Code Master Folder/ai_prompts" rev-parse --show-toplevel)"` or use the absolute Mac path above.
- `RETELL_API_KEY`: read from `.claude/.mcp.json` env (already loaded when MCP is active) or from `RETELL_API_KEY` env var in a CI context.
- NovaNest RetellAI MCP is preferred for every operation that has a tool. If MCP isn't available (running inside GitLab CI that called the Claude Claw agent by HTTP — the agent itself has MCP, so this case is only for edge environments), fall back to REST via `curl` with `Authorization: Bearer $RETELL_API_KEY`. For unfamiliar endpoints, query Context7 first (`resolve-library-id` "retell ai" → `query-docs`).

## RetellAI MCP tool map

| Operation | MCP tool | REST fallback |
|---|---|---|
| Create LLM | `create_retell_llm` | `POST /create-retell-llm` |
| Get LLM | `get_retell_llm` | `GET /get-retell-llm/{llm_id}` |
| Update LLM | `update_retell_llm` | `PATCH /update-retell-llm/{llm_id}` |
| List LLMs | `list_retell_llms` | `GET /list-retell-llms` |
| Create agent | `create_agent` | `POST /create-agent` |
| Get agent | `get_agent` | `GET /get-agent/{agent_id}` |
| Update agent | `update_agent` | `PATCH /update-agent/{agent_id}` |
| List agents | `list_agents` | `GET /list-agents` |
| Create phone number | `create_phone_number` | `POST /create-phone-number` |
| List phone numbers | `list_phone_numbers` | `GET /list-phone-numbers` |
| Update phone number | `update_phone_number` | `PATCH /update-phone-number/{phone_number}` |
| List voices | `list_voices` | `GET /list-voices` |
| **Create knowledge base** | no MCP — REST only | `POST /create-knowledge-base` |
| **Add source to KB** | no MCP — REST only | `POST /add-knowledge-base-sources` |
| **Delete source from KB** | no MCP — REST only | `DELETE /delete-knowledge-base-source` |
| **Delete KB** | no MCP — REST only | `DELETE /delete-knowledge-base/{kb_id}` |
| **Attach KB to LLM** | no MCP — via `update_retell_llm` `knowledge_base_ids` field | same |

For every KB operation, confirm current payload shape with Context7 before the call — the REST surface evolves.

## Derived agent name (how to map a prompt file to an agent name)

Rules (same rules `voice-ai-prototype` uses, so collision checks and lookups agree):

1. Take the prompt filename, strip `.md` or `.txt`.
2. Strip trailing `-prompt` or `-voice-agent-prompt` if present. Keep a trailing `-trojan` marker.
3. Replace `-` and `_` with spaces, uppercase, collapse whitespace.
4. If the result does NOT end in ` TROJAN`, append ` VOICE AGENT`.

Examples:
- `john-giordani-voice-agent-prompt.md` → `JOHN GIORDANI VOICE AGENT`
- `john-giordani-prompt-trojan.md` → `JOHN GIORDANI TROJAN`
- `claim-warriors-inbound-prompt.md` → `CLAIM WARRIORS INBOUND VOICE AGENT`

If the derived name would be just `VOICE AGENT` or `PROMPT VOICE AGENT` (filename too generic), stop and ask the caller for an explicit agent name.

## Sidecar schema (canonical)

The sidecar lives next to the prompt file at `<prompt-basename>.retell.json`. Omit `knowledge_bases` entirely if there are none (don't emit an empty array). Omit `phone_number`, `phone_status`, `area_code`, and `sibling_*` fields when they don't apply.

```json
{
  "agent_name": "JOHN GIORDANI VOICE AGENT",
  "agent_id": "agent_abc...",
  "llm_id": "llm_xyz...",
  "model": "gpt-4.1",
  "model_temperature": 0.0,
  "voice": { "name": "Jennifer Suarez", "voice_id": "..." },
  "phone_number": "+19545550123",
  "phone_status": "active",
  "area_code": "954",
  "knowledge_bases": [
    {
      "name": "JOHN GIORDANI VOICE AGENT — Faqs",
      "id": "kb_...",
      "source_file": "kb-faqs.txt",
      "source_id": "source_..."
    }
  ],
  "prompt_file": "CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md",
  "mode": "regular",
  "sibling_regular_agent_id": null,
  "sibling_trojan_agent_id": null,
  "created_at": "2026-04-24T18:00:00Z",
  "last_synced_at": "2026-04-24T18:00:00Z"
}
```

`mode` is `"regular"` or `"trojan"`. In Trojan pairs, both sidecars carry `sibling_regular_agent_id` / `sibling_trojan_agent_id` pointing at the other. The Trojan sidecar holds the phone number; the regular sidecar has `phone_number: null, phone_status: "awaiting post-sale assignment"`.

`last_synced_at` gets rewritten on every successful run of this skill. `created_at` is immutable after the first deploy.

---

## Intent: Full deploy (create)

Used for first-time deploys. Caller is typically `voice-ai-prototype` handing off a freshly committed prompt file.

### 1. Validate inputs

- Confirm the prompt file exists.
- Confirm no sidecar exists yet. If one does, this is not a first-time deploy — switch to the matching update intent.
- Confirm no agent exists in Retell under the derived name (`list_agents`, case-insensitive compare). If one does, refuse with the existing `agent_id`.
- For Trojan mode: both the regular and Trojan prompts must exist as siblings in the same folder before deploying either.

### 2. Fixed deploy settings

- Model: `gpt-4.1`
- Voice: Jennifer Suarez. Look up `voice_id` at runtime via `list_voices` — name is the anchor, never a hardcoded ID.
- Default area code: `954` (South Florida). If the caller specified a different one, use theirs.

### 3. Create LLM(s)

Regular: `create_retell_llm` with `model: "gpt-4.1"`, `general_prompt: <regular prompt file contents>`, `model_temperature: 0` (Retell default unless caller specified otherwise). Capture `llm_id_regular`.

Trojan (when a sibling `-trojan.md` exists): create a second LLM with the Trojan prompt's contents. Consider bumping `model_temperature` by 0.1 for the Trojan LLM only (makes the sales segue feel less scripted). Flag the choice in the final report. Capture `llm_id_trojan`.

### 4. Create knowledge bases and attach

For each `kb-*.txt` in the prompt's folder:

1. KB name: `<REGULAR AGENT NAME> — <topic>`, where `<topic>` is the filename segment between `kb-` and `.txt`, title-cased. Example: `kb-faqs.txt` → `JOHN GIORDANI VOICE AGENT — Faqs`. In Trojan mode the KB name still anchors to the regular name — both agents share KBs, no duplication.
2. REST: `POST /create-knowledge-base` to create the KB container.
3. REST: `POST /add-knowledge-base-sources` to upload the `.txt` as a source. Capture `source_id`.
4. Capture `knowledge_base_id`.

After all KBs exist, attach them to both LLMs (Trojan mode) or just the one LLM (regular mode) by calling `update_retell_llm` with `knowledge_base_ids: [...]`.

If any KB step fails, report what was created and what failed, then stop. Don't leave half-wired agents.

### 5. Create agent(s)

Regular agent: `create_agent` with:
- `agent_name`: derived regular name
- `response_engine`: `{ type: "retell-llm", llm_id: llm_id_regular }`
- `voice_id`: Jennifer Suarez
- Other fields default unless the prompt file has a `Voice Settings` section to override

Capture `agent_id_regular`.

Trojan mode: create a second agent with `agent_name` = derived Trojan name, `llm_id: llm_id_trojan`, same voice. Capture `agent_id_trojan`.

### 6. Provision phone number

Regular mode: `create_phone_number` with `area_code` (caller's or `954`), `inbound_agent_id: agent_id_regular`. Capture `phone_number`.

Trojan mode: `create_phone_number` with `inbound_agent_id: agent_id_trojan` — the phone routes to the **Trojan** agent only. The regular agent stays phone-less, `phone_status: "awaiting post-sale assignment"`.

If no number is available in the requested area code, surface Retell's error verbatim and ask for a fallback area code. Don't silently pick a different one.

### 7. Write sidecar(s)

Write per the schema above. Regular mode → one sidecar next to the prompt. Trojan mode → two sidecars (one next to each prompt), with `sibling_*` fields cross-linking them.

### 8. Git commit the sidecar(s)

The prompt and KB files were already committed by `voice-ai-prototype`. Only the sidecar is new here.

```bash
cd "<ai_prompts root>"
git add "<sidecar path>" ["<trojan sidecar path>"]
git commit -m "deploy(<prompt-slug>): record Retell agent metadata"
git push origin main
```

If push rejects non-fast-forward, `git pull --rebase origin main` and retry once. If rebase conflicts, stop.

### 9. Report back

```
Created in Retell:
  Agent:      JOHN GIORDANI VOICE AGENT
  agent_id:   agent_abc...
  llm_id:     llm_xyz...
  Voice:      Jennifer Suarez
  Phone:      +1 (954) 555-0123  (area: 954 default)
  KBs:
    - JOHN GIORDANI VOICE AGENT — Faqs  (kb_...)

Sidecar written + committed: <short-sha>
```

Trojan mode: include both agents, note the phone is bound to Trojan only, include "Demo number to send the lead: <phone>".

---

## Intent: Prompt-only update

Caller is typically `voice-ai-improve-prompt` direct mode, or a GitLab CI-triggered mission task.

1. Read the sidecar. Capture `llm_id`, `agent_id`, and the KB list. If the sidecar is missing, switch to **Sidecar recovery** intent first, then retry.
2. Read the current prompt file contents.
3. `update_retell_llm` with `llm_id` + new `general_prompt`. Do not recreate the LLM. Do not touch the agent. Do not touch phone numbers.
4. Update sidecar's `last_synced_at`. Commit the sidecar change:
   ```bash
   git add "<sidecar path>"
   git commit -m "deploy(<prompt-slug>): resync prompt to Retell"
   git push origin main
   ```
   If running in a CI-triggered context (detect via `$GITLAB_CI` env var or caller hint), skip the commit — CI will have its own opinion about whether to write back to the repo. Just surface the updated sidecar contents in the report.
5. Report: `LLM <llm_id> redeployed. Sidecar last_synced_at: <iso>.`

---

## Intent: KB-only sync

Caller said "resync KBs for X" or pointed at a `kb-*.txt` file directly.

1. Resolve the sibling prompt file (same folder, matching `*-prompt.md` or `*-voice-agent-prompt.md`).
2. Read the sidecar. If missing, switch to **Sidecar recovery** first.
3. Build a diff:
   - Local KB files in the folder vs sidecar's `knowledge_bases` list.
   - New local file (no matching sidecar entry) → create KB, upload source, attach to LLM(s), add to sidecar.
   - Existing match → upload new source via `add-knowledge-base-sources`, delete old source via `delete-knowledge-base-source`. Update `source_id` in sidecar.
   - Sidecar entry with no local file → detach from LLM(s), delete source, delete KB, remove from sidecar.
4. For each affected LLM (in Trojan mode, both), `update_retell_llm` with the current `knowledge_base_ids`.
5. Update sidecar `last_synced_at`, commit (outside CI) as above.
6. Report what was added/updated/removed.

---

## Intent: Full file sync

Prompt AND KB files changed. Run the prompt-only update first, then the KB-only sync, in that order. Single commit at the end with both sidecar updates and a message like `deploy(<prompt-slug>): resync prompt + KBs`.

---

## Intent: Agent param tweak

Caller's instruction changes something on the agent (or LLM config), not the prompt or KBs.

1. Resolve target: caller names a client → find sidecar → `agent_id` (or `llm_id` if the setting lives on the LLM).
2. Clarify ambiguities once, then act. Examples:
   - "change voice to Jennifer Suarez" → `list_voices` → `update_agent` with new `voice_id`.
   - "make the agent slightly warmer" → `update_retell_llm` with `model_temperature: 0.3` (ask if caller didn't specify a number; don't guess).
   - "set language to Spanish" → `update_agent` with `language: "es-ES"`.
3. Update the sidecar field that mirrors the changed attribute (e.g., sidecar's `voice.name` + `voice.voice_id`). If the attribute isn't in the sidecar schema, skip the sidecar write — schema is not a catch-all.
4. Do NOT commit anything unless a sidecar field changed. No file edit happened.
5. Report exactly what changed.

Never write this change to the prompt file. The prompt file is for prompt content; agent settings live only in Retell and (partially) the sidecar.

---

## Intent: Sidecar recovery

Caller says "rebuild sidecar for X" or any other intent failed because the sidecar is missing/corrupt.

1. Derive the agent name from the prompt filename (rules above).
2. `list_agents` and match by name. If zero matches, stop — there's nothing to recover. If multiple, stop and show the caller the candidates.
3. `get_agent` → capture `agent_id`, `response_engine.llm_id`, `voice_id`, `language`, etc.
4. `get_retell_llm` → capture `model`, `model_temperature`, `knowledge_base_ids`.
5. For each `knowledge_base_id`, query Retell (REST: `GET /get-knowledge-base/{id}`) → capture name and sources. Match sources back to local `kb-*.txt` files by basename where possible. If a source has no local counterpart, record it in the sidecar with `source_file: null` and flag it in the report.
6. `list_phone_numbers` → find the one whose `inbound_agent_id` is this agent. Capture phone and area code. If none, sidecar's `phone_number` is null.
7. Write sidecar per schema. `created_at` = best-effort (Retell `get_agent` may return `last_modification_timestamp` — use that). `last_synced_at` = now.
8. Commit the new sidecar. Report what was recovered and flag anything ambiguous.

---

## Edge cases and failure handling

- **Sidecar lookup returns an `agent_id` that no longer exists in Retell** → surface the broken link, ask caller whether to rebuild sidecar or recreate the agent. Never silently recreate.
- **Prompt file path doesn't exist** → stop. Don't run any Retell calls blind.
- **Derived name collides with an unrelated live agent** → refuse with the conflicting `agent_id`.
- **KB REST endpoint shape changed** → re-query Context7 before retrying. Don't hammer the API with guessed payloads.
- **No phone number available in requested area code** → surface Retell's error, ask for alternate area code.
- **Caller mixes a file sync and a param tweak in one ask** → do the file sync, report it, then ask explicitly whether to also apply the param tweak.
- **Running in CI context** (env var `GITLAB_CI=true`, or caller hint in the handoff message) → do every Retell operation, update the sidecar in memory, but **skip the sidecar git commit**. Instead, print the updated sidecar contents at the end of the report. Whether to write back to the repo from CI is decided upstream of this skill.
- **Running in CI and the sidecar is stale** → do sidecar recovery in-memory, perform the Retell update against recovered state, report the recovered + updated sidecar. Don't commit it from CI.
- **File says prompt is for a Trojan pair but only one sidecar exists** → deploy or update only the one that matches the caller's intent. Don't improvise the other.
- **User asks to delete an agent/LLM/KB/number** → refuse. This skill is for create + update only. Deletion is manual.

---

## What this skill is NOT for

- Editing prompt `.md` files or `kb-*.txt` files — that's `voice-ai-improve-prompt`.
- Drafting a new prompt from scratch — that's `voice-ai-prototype`.
- Testing the agent, making test calls, reviewing transcripts.
- Deleting any Retell resources.
- Managing GitLab MRs, running `glab`, opening pull requests.
- Writing `.gitlab-ci.yml` or any CI config.
