# Deploy plan format

Canonical schema for `_deploy-plan.md` — the file that persists Retell-side
deploy intent across the `--with-pr` flow gap between conversation and
post-merge CI execution.

Also defines the **inline ops** shape that callers embed in
`voice-ai-deploy-retell` invocation prompts. The plan-file YAML block and the
inline YAML block share the same op grammar — the deploy skill has one
parser and one executor for both sources.

## When this format is used

| Source | Where ops live |
|---|---|
| `voice-ai-improve-prompt --with-pr` | `_deploy-plan.md` committed alongside the prompt edit, executed by CI post-merge |
| `voice-ai-improve-prompt` direct mode → deploy chain | Inline `Retell operations:` YAML block in the deploy skill's invocation prompt |
| Standalone `voice-ai-deploy-retell` call | Inline block in invocation prompt |
| First-time prototype handoff | Inline block in invocation prompt (only if the prototype conversation produced any Retell-side asks beyond first-deploy defaults) |

If both an inline block AND a plan file exist on a single run, **inline wins
per op**. The plan file's overridden entries are noted in the report.

## File location

One plan per prompt file. Sibling to the prompt in the same client folder:

```
ai_prompts/CLIENTS/JOHN GIORDANI/
├── john-giordani-voice-agent-prompt.md
├── john-giordani-voice-agent-prompt.retell.json
├── kb-faqs.txt
└── _deploy-plan.md
```

Trojan pairs: one plan per prompt file — `_deploy-plan.md` next to the
regular prompt, `_deploy-plan-trojan.md` next to the trojan prompt. Each
plan targets exactly one agent.

## File shape

````markdown
---
prompt: john-giordani-voice-agent-prompt.md
status: pending
last_applied_sha: null
---

# Deploy plan — john-giordani-prompt (MR !47)

## Summary
Human-readable paragraph of what this MR does. Written by the agent from
the conversation. The MR description body echoes this section.

## Retell operations

```yaml
- op: set_voice
  voice_name: "Jennifer Suarez"

- op: update_custom_function
  name: book_appointment
  parameters_add:
    - { name: email, type: string, description: "caller's email" }
```

## Notes
Free-form context. Optional. Ignored by the deploy skill.

## Open questions
Items the agent flagged for human decision. Optional. Ignored.
````

### Frontmatter

| Field | Type | Required | Meaning |
|---|---|---|---|
| `prompt` | string | yes | Filename of the prompt this plan targets, relative to the same folder. The deploy skill cross-checks this against the prompt path it was invoked with. |
| `status` | enum | yes | `pending` \| `applied` \| `partial-failure`. New plans start `pending`. Deploy skill rewrites after execution. |
| `last_applied_sha` | string \| null | yes | Short SHA of the commit the plan was last successfully applied at. `null` until first apply. Used for idempotency. |

### Body sections

- `## Summary` — free-form prose. Becomes the MR description body. Required when the plan ships in an MR; can be omitted for inline-only contexts.
- `## Retell operations` — single fenced YAML block, a list of op entries. The only machine-parsed section. If the heading is present but the YAML block is absent or malformed, the deploy skill stops before any mutation.
- `## Notes`, `## Open questions`, or any other H2 — free-form, ignored by the deploy skill, useful for human reviewers.

### Op grammar

Each op is a YAML mapping with a required `op:` key. Other keys are
op-specific.

The deploy skill executes ops in **document order**, top to bottom. Each
op is atomic per its underlying API call. The plan as a whole is NOT
transactional — a later op's failure does not roll back earlier
successes; the plan is annotated `partial-failure` and a retry resumes
only the failed ops.

## Op catalog

Anything outside this catalog → deploy skill rejects the plan before any
mutation and reports `unknown op '<name>'`. New op types are added here,
not invented per-prompt.

### `set_voice`

Change the agent's TTS voice.

```yaml
- op: set_voice
  voice_name: "Jennifer Suarez"   # required — looked up via list_voices
```

Resolution: `list_voices` → match `voice_name` case-insensitively →
`update_agent.voice_id`. Voice IDs are never hardcoded in the plan.

### `set_voice_model`

```yaml
- op: set_voice_model
  voice_model: "eleven_turbo_v2_5"   # required
```

→ `update_agent.voice_model`.

### `set_language`

```yaml
- op: set_language
  language: "es-ES"   # required — ISO locale
```

→ `update_agent.language`.

### `set_model` (heavy — recreates LLM)

```yaml
- op: set_model
  model: "claude-4.6-sonnet"   # required, must be in the Retell-supported enum
```

Retell's `update-retell-llm` endpoint does NOT accept `model`. This op
triggers an LLM-recreation flow:

1. `get_retell_llm(current_llm_id)` — capture `begin_message`, `general_prompt`, `knowledge_base_ids`, `general_tools`, `model_temperature`.
2. `create_retell_llm` with `model: <new>` + all copied fields → `new_llm_id`.
3. `update_agent(response_engine={type: "retell-llm", llm_id: new_llm_id, version: 0}, version_description: "<sha> set_model <new>")`.
4. Sidecar `llm_id` updated. Committed outside CI; reported inside CI.
5. Old LLM is orphaned — logged for manual cleanup.

If a plan contains both `set_model` and one or more
`create_custom_function` / `update_custom_function` / `delete_custom_function`
ops, the LLM-recreation merges them: the new LLM is created with the
already-mutated tools list baked in, NOT as two separate updates.

### `set_model_temperature` (heavy — recreates LLM)

Same flow as `set_model` — listed separately so plans are explicit.

```yaml
- op: set_model_temperature
  model_temperature: 0.2   # required, 0.0–2.0
```

### `create_custom_function`

Add a custom function to the LLM's `general_tools`.

```yaml
- op: create_custom_function
  name: send_callback_sms                                      # required, must be unique on this LLM
  url: "https://hooks.n8n.example.com/callback"                # required
  method: POST                                                 # optional, default POST
  description: "Sends an SMS callback when caller requests one"  # required
  speak_during_execution: "Got it, I'll text you those details"  # optional
  parameters:                                                  # required (can be [])
    - { name: phone,   type: string, description: "E.164 phone" }
    - { name: message, type: string, description: "SMS body" }
  headers:                                                     # optional
    Authorization: "Bearer ${RETELL_FUNCTION_TOKEN}"
  response_variables:                                          # optional — values to extract from the function response into call state
    - { name: sms_status, path: "$.status" }
  timeout_ms: 10000                                            # optional
```

The exact field-name mapping to Retell's `general_tools` schema is
re-confirmed via Context7 at call time (the surface evolves). Required
fields above are validated locally before any API call.

Conflict: if a function with the same `name` already exists on the LLM,
this op fails with a clear error. Use `update_custom_function` instead.

### `update_custom_function`

Mutate an existing custom function. Targeted edits, not full replacement.

```yaml
- op: update_custom_function
  name: book_appointment                # required — must exist on the LLM
  url: "https://hooks.example.com/v2"   # optional — replaces if given
  method: POST                          # optional — replaces if given
  description: "..."                    # optional
  speak_during_execution: "..."         # optional
  parameters_add:                       # optional — append-only
    - { name: email, type: string, description: "caller's email" }
  parameters_remove:                    # optional — names only
    - old_field
  parameters_replace:                   # optional — full replacement; if set, _add / _remove are ignored
    - { name: date,      type: string }
    - { name: time_slot, type: string }
  headers_set:                          # optional — key/value pairs to set
    Authorization: "Bearer ..."
  headers_unset:                        # optional — keys to delete
    - X-Old-Token
```

The deploy skill fetches the current function definition, applies the
patch fields, then writes the full updated tools array via
`update_retell_llm.general_tools` (Retell has no per-tool PATCH endpoint).

If `parameters_replace` is set, `parameters_add` and `parameters_remove`
are ignored for that op.

### `delete_custom_function`

```yaml
- op: delete_custom_function
  name: deprecated_function   # required — must exist on the LLM
```

Removes the entry from `general_tools`. If the prompt grammar still
calls the function, the grammar-parse safety check surfaces the
orphaned reference in the post-deploy report.

### `create_n8n_workflow`

Create a workflow on a configured n8n instance to back a custom
function (or any agent-triggered automation).

The n8n MCP is **derived from the same account slug as Retell** — the
same path-pinning rule that picks the Retell MCP also picks the n8n
MCP. Convention: `<slug>-n8n-mcp-server` (parallels
`<slug>-retellai-mcp-server`). Examples:

- Path `CLIENTS/VOCI PARTNERS/...` → slug `voci-partners` → n8n MCP `mcp__voci-partners-n8n-mcp-server__*`
- Path `DEMOS/...` or `PROSPECTS/...` → slug `novanest` → n8n MCP `mcp__novanest-n8n-mcp-server__*`

```yaml
- op: create_n8n_workflow
  name: send_callback_sms                                # required — should match the function name when backing one
  description: "Posts to Twilio when send_callback_sms is invoked"  # required
  webhook_path: /callback                                # required — appended to the n8n base URL
  mcp_target: voci-partners-n8n-mcp-server               # OPTIONAL — paranoia check, see below
  template_id: null                                      # optional — n8n template to clone from
  nodes_outline: |                                       # optional — free-form description for the agent to translate into nodes
    Webhook (POST /callback)
      → HTTP Request to Twilio /Messages
      → Respond to Webhook with {status: "sent"}
```

**`mcp_target` is a paranoia check, not a selector.** The deploy
skill ALWAYS uses the path-derived n8n MCP. If `mcp_target` is set:

- Matches `<slug>-n8n-mcp-server` → fine, redundant but harmless.
- Does NOT match → the deploy skill refuses the op and stops the
  whole run before any Retell mutation. This catches plans that
  were copy-pasted from another client.

Omit `mcp_target` in normal plans. Set it only when you want the
extra safety net (e.g. a high-stakes client where mistakes are
expensive — the explicit assertion makes a stale plan fail loudly).

The agent translates `nodes_outline` into a concrete workflow via the
n8n MCP's `n8n_generate_workflow` + `n8n_create_workflow` calls. When
`template_id` is set, `n8n_deploy_template` is used instead.

The op succeeds when the workflow is created AND active. Failure here
does NOT undo Retell-side changes earlier in the plan — the plan is
annotated `applied: false` for this op and a retry can target only the
failed entries.

### `update_n8n_workflow`

Same MCP-derivation rule as `create_n8n_workflow` — the n8n MCP is
derived from the prompt path slug, `mcp_target` is a paranoia check
only.

```yaml
- op: update_n8n_workflow
  name: send_callback_sms                  # required — looked up by name on the derived MCP
  description: "..."                       # optional
  nodes_outline: |                         # optional
    ...
  mcp_target: voci-partners-n8n-mcp-server # OPTIONAL — paranoia check, see create_n8n_workflow
```

Uses `n8n_update_partial_workflow` when only metadata changes,
`n8n_update_full_workflow` when nodes change.

### `note`

```yaml
- op: note
  text: "Voice swap requested informally in chat 2026-05-12; no formal sign-off needed."
```

Logged in the deploy report. No mutation. Useful for capturing context
that matters for review but doesn't drive a Retell change.

## Validation (runs before any mutation)

1. Frontmatter parses as YAML and has all required fields with valid types.
2. `prompt` field matches the prompt filename the deploy skill was invoked with. If it doesn't, stop and surface — the plan is for a different file.
3. The `## Retell operations` fenced YAML block parses cleanly. (If the heading is absent entirely, that's allowed — the plan is summary-only and the deploy skill falls through to the grammar parse without executing any ops.)
4. Every op has a known `op:` value (in this catalog).
5. Every op has its required fields populated.
6. Duplicate-target ops (e.g. two `set_voice`) — later wins, but the conflict is logged.
7. `update_custom_function` and `delete_custom_function` targets exist on the live LLM. If they don't, stop and ask the caller — this almost always indicates a stale plan or a typo.

If any check fails, the deploy skill stops before any Retell call and
reports the offending op + line number.

## Status lifecycle

`status` and `last_applied_sha` in frontmatter are rewritten by the
deploy skill after execution:

| Outcome | `status` | `last_applied_sha` |
|---|---|---|
| All ops succeeded + prompt update succeeded | `applied` | new short SHA |
| Some ops failed | `partial-failure` | unchanged (or `null` if never applied) |
| Plan was empty (no `Retell operations` block, summary only) | `applied` | new short SHA |

On `partial-failure`, the YAML block is annotated per op:

```yaml
- op: create_custom_function
  name: send_callback_sms
  ...
  applied: false                                       # injected by deploy skill
  error: "n8n MCP n8n-novanest unreachable"            # injected
```

Successful ops are annotated `applied: true`. A retry run skips ops
marked `applied: true` UNLESS the plan was edited (commit SHA changed)
since the last apply.

## Idempotency

A plan with `status: applied` and `last_applied_sha == HEAD` is a
no-op for ops — the deploy skill skips the op list, but still runs
the prompt-grammar parse and the 5-step publish for the prompt file
itself (the file may have been touched in a way that didn't change
the plan but did change the prompt).

A plan with `status: applied` and `last_applied_sha != HEAD` means
the plan was edited after the last apply — treat as `pending` and
execute.

## Inline op block (no file, same shape)

For direct-mode deploys and standalone tweaks, the caller embeds
the same YAML grammar inline in the invocation prompt to
`voice-ai-deploy-retell`:

````
Deploy CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md.

Retell operations:

```yaml
- op: set_voice
  voice_name: "Jennifer Suarez"
```
````

The deploy skill scans its invocation prompt for a fenced YAML block
under a `Retell operations:` heading. Same validation, same execution,
no plan file written.

If both inline ops AND a plan file exist on the same run, inline takes
priority per op. The plan's overridden ops are not executed but ARE
logged in the report.

## Examples

### Minimal — voice swap only

````markdown
---
prompt: john-giordani-voice-agent-prompt.md
status: pending
last_applied_sha: null
---

# Deploy plan

## Summary
Voice swap to Jennifer Suarez per Ben's request.

## Retell operations

```yaml
- op: set_voice
  voice_name: "Jennifer Suarez"
```
````

### Full — multi-op MR

````markdown
---
prompt: john-giordani-voice-agent-prompt.md
status: pending
last_applied_sha: null
---

# Deploy plan — john-giordani-prompt (MR !47)

## Summary
Tightened the FAQ pricing section. Added an `email` parameter to
`book_appointment` (now required for confirmation). Added a new
`send_callback_sms` custom function backed by a new N8N workflow.
Voice swapped to Jennifer Suarez.

## Retell operations

```yaml
- op: set_voice
  voice_name: "Jennifer Suarez"

- op: update_custom_function
  name: book_appointment
  parameters_add:
    - { name: email, type: string, description: "caller's email for confirmation" }

- op: create_custom_function
  name: send_callback_sms
  url: "https://hooks.n8n.example.com/callback"
  method: POST
  description: "Sends an SMS callback when caller requests follow-up"
  speak_during_execution: "Got it, I'll text you those details"
  parameters:
    - { name: phone,   type: string, description: "E.164 phone" }
    - { name: message, type: string, description: "SMS body" }

- op: create_n8n_workflow
  name: send_callback_sms
  description: "Posts to Twilio when send_callback_sms is invoked"
  webhook_path: /callback
  nodes_outline: |
    Webhook (POST /callback)
      → HTTP Request to Twilio /Messages
      → Respond to Webhook with {status: "sent"}
```

## Notes
- KB files unchanged. Grammar parse still runs as a safety check.
- N8N workflow must be active before the Retell function is callable;
  op order above guarantees this.
- n8n MCP is auto-derived from the prompt path (`CLIENTS/JOHN GIORDANI/`
  → no, this is a `novanest`-account prospect; the workflow lands on
  novanest's n8n). To deploy to a client's own n8n, the prompt would
  need to live under `CLIENTS/<CLIENT>/`.

## Open questions
- (none)
````
