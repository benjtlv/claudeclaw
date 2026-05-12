---
name: voice-ai-test-cases
description: Create, update, delete, or list Retell test case definitions for a voice AI agent. **Pure executor — no conversational logic.** The brainstorm + "what behaviors do you want to test" conversation happens upstream in voice-ai-head's chat-mode loop with the user. Once the user has agreed on the test definitions, voice-ai-head invokes this skill with a structured op list (same shape pattern as `voice-ai-deploy-retell`'s inline ops) and the skill executes against the Retell API on the path-pinned account. The op grammar and the test-case writing style are canonical references in `.claude/voice-ai-shared/references/` — both must be read by the caller before drafting ops. Account pinning (same rules as `voice-ai-deploy-retell`) is enforced before any Retell call. Triggers — once voice-ai-head has the user's go: "create test cases for <agent>", "build a test for <agent>", "build simulations for <agent>", "add a Retell test for <agent>", "list test cases for <agent>", "show me the tests on <agent>", "update the test <name> on <agent>", "delete the <name> test on <agent>". Do NOT use this skill for first-time prompt drafting (`voice-ai-prototype`), prompt iteration (`voice-ai-improve-prompt`), or Retell agent/LLM/KB deploys (`voice-ai-deploy-retell`). Do NOT use it for running tests against an agent — test runs are a separate skill (not yet built).
---

# Voice AI — Test Cases (executor)

## What this skill is

A pure executor for managing Retell test case definitions on a voice
agent's LLM. Takes a structured op list (create / update / delete /
list) as input and runs the corresponding Retell API calls on the
path-pinned account.

**This skill does NOT brainstorm tests, ask the user what to test,
or have any back-and-forth.** That conversation lives in voice-ai-head's
chat-mode loop with the user, governed by the brainstorm-first rules
in `agents/voice-ai-head/CLAUDE.md`. By the time this skill runs, the
test definitions are already agreed.

## Required reading before invocation

Both files are canonical for this skill. The caller (voice-ai-head)
MUST have already read them when drafting ops; the skill itself reads
them on every run for validation:

1. [../../voice-ai-shared/references/test-case-style.md](../../voice-ai-shared/references/test-case-style.md) — writing-style rules for `user_prompt`, `metrics`, `tool_mocks`, `dynamic_variables`. The 10 strategic buckets. The `extract_dynamic_variable` judgment rule. The fuzzy/lookup consolidation pattern.
2. This file — op grammar, validation rules, execution order, account pinning, reporting.

## Account pinning (first action on every run, no exceptions)

Same mechanical rule as `voice-ai-deploy-retell`. Derive the account
slug from the prompt file's folder path under `ai_prompts/`:

| Path pattern | Account slug |
|---|---|
| `CLIENTS/GENERAL/<any>/...` | `novanest` |
| `CLIENTS/<CLIENT>/...` (not `GENERAL`) | slugify `<CLIENT>` (lowercase, spaces→hyphens, punctuation stripped) |
| `PROSPECTS/**`, `DEMOS/**`, `INTERNAL/**` | `novanest` |
| `ARCHIVE/**` | refuse — this skill does not touch archived agents |

### Pre-flight checks

1. **Retell MCP availability:** verify `mcp__<slug>-retellai-mcp-server__*` is in the available tool list. Missing → STOP, tell the user to add it to `.mcp.json`. No fallback to `novanest` or any other account.
2. **REST API key availability:** verify `RETELL_API_KEY` (slug = `novanest`) or `RETELL_API_KEY_<SLUG_UPPER>` is set. Test endpoints have full MCP coverage today (per Retell SDK), so REST is only the fallback path if an MCP tool is unexpectedly missing.
3. Every Retell call this run uses ONLY the pinned slug's prefix / env var. No cross-account calls, ever.

## Inputs the skill accepts

The invocation prompt MUST contain:

1. **A prompt file path** — relative to `ai_prompts/` root unless absolute. Used to derive the account slug AND to locate the sidecar file (which gives `llm_id`, the target for `response_engine.llm_id` in every test).
2. **A `Test case operations:` fenced YAML block** with one or more ops. Grammar below.

Optional:
- A short summary line above the YAML block describing what this batch of changes accomplishes (logged in the report, no behavioral effect).

Example invocation prompt:

````
Manage test cases for CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md.

Test case operations:

```yaml
- op: create
  name: "Marcus Johnson - Medicare Persistence"
  bucket: hard_accept_reject_boundary
  user_prompt: |
    Identity
    Your name is Marcus Johnson.
    ...
  metrics:
    - "Agent maintains composure and doesn't transfer"
    - "Provides alternative (calling insurance number on card)"
  tool_mocks:
    - tool_name: book_appointment
      input_match_rule: { type: any }
      output: "Successfully completed the task"
  dynamic_variables: {}
```
````

## Op grammar

Each op is a YAML mapping with a required `op:` field. Other fields
are op-specific.

### `op: create`

Create a new test case definition.

```yaml
- op: create
  name: "Persona Name - Scenario Brief"          # required, must be unique on the LLM
  bucket: <one of the 10 buckets>                # required, see test-case-style.md
  user_prompt: |                                 # required, follow test-case-style.md
    Identity
    Your name is ...
    ...
  metrics:                                       # required, 1-5 items
    - "Agent does X"
    - "Agent does NOT do Y"
  tool_mocks: []                                 # required, can be empty array
  dynamic_variables: {}                          # required, can be empty object
  llm_model: gpt-4.1-mini                        # optional — defaults to LLM's current
```

Maps to `POST /create-test-case-definition` with `response_engine:
{ type: "retell-llm", llm_id: <from sidecar>, version: <current LLM version> }`.

### `op: update`

Update an existing test case by ID.

```yaml
- op: update
  test_case_definition_id: test_case_abc...      # required
  name: "..."                                    # optional — any field can be patched
  bucket: <bucket>                               # optional
  user_prompt: |                                 # optional
    ...
  metrics: [ ... ]                               # optional
  tool_mocks: [ ... ]                            # optional
  dynamic_variables: { ... }                     # optional
  llm_model: <model>                             # optional
```

Maps to `PUT /update-test-case-definition/{test_case_definition_id}`.
Only fields present in the op are patched; unset fields are left
alone on Retell's side.

### `op: delete`

Delete a test case by ID.

```yaml
- op: delete
  test_case_definition_id: test_case_abc...      # required
```

Maps to `DELETE /delete-test-case-definition/{test_case_definition_id}`.

### `op: list`

Return current test cases on the LLM. No mutation.

```yaml
- op: list
  # no fields
```

Maps to `GET /list-test-case-definitions?type=retell-llm&llm_id=<from sidecar>`.
Result formatted in the report as a table (name + bucket if derivable
from `metrics` content + last modified date + ID). When `list` is
present alongside mutation ops, run it AFTER all mutations so the
returned state reflects the changes.

## Validation (runs before any mutation)

In this order:

1. **Prompt path resolves.** File exists at the given path; otherwise STOP.
2. **Sidecar exists** at `<prompt-basename>.retell.json`. Parse `agent_id`, `llm_id`. If sidecar is missing or malformed, STOP — refuse to run. The caller can rebuild the sidecar via `voice-ai-deploy-retell` sidecar recovery before retrying.
3. **Account pinning checks** (above) pass.
4. **YAML parses cleanly.** Every op has a known `op:` value.
5. **Per-op required fields populated.** See grammar above.
6. **`create` ops have unique names within this batch.** If two `create` ops share a name, STOP.
7. **`create` ops don't collide with existing names on Retell.** Pre-fetch `list-test-case-definitions` once at the start of the run; compare each `create.name` against existing test names. Collision → STOP, surface the existing test's ID so the caller can decide between an update or a renamed create.
8. **`update` and `delete` target IDs exist.** Same pre-fetched list. Missing ID → STOP for that op (don't continue blind).
9. **`bucket` value is one of the 10 from test-case-style.md.** Unknown bucket → STOP.
10. **`extract_dynamic_variable` mock judgment.** For each `create` / `update` op that includes a tool_mock entry with `tool_name: extract_dynamic_variable`:
    - Read the op's metrics. If ANY metric mentions extraction-related behavior (`"extract"`, `"capture"`, `"is extracted"`, `"is captured"`), STOP — refuse to mock a function whose extraction the test purports to verify. Surface the contradiction.
    - If metrics are clearly downstream-of-extraction (e.g. `"agent honors <var>=X"`, `"agent uses qualification path for X"`), allow the mock. Pass.
    - Ambiguous case → STOP, ask the caller to clarify intent. This is the rule from test-case-style.md's `extract_dynamic_variable` judgment section.

If any check fails, the skill stops before any Retell call and
reports the offending op + line. No partial state ever.

## Execution

After validation passes:

1. **Pre-fetch existing tests once** via `list-test-case-definitions` (already done in validation step 7-8 — cache the result).
2. **Execute ops in document order.** Each op is a single Retell API call:
   - `create` → `create_test_case_definition` MCP tool, or REST fallback. Capture the returned `test_case_definition_id`.
   - `update` → `update_test_case_definition` MCP tool. Capture the updated record.
   - `delete` → `delete_test_case_definition` MCP tool. Confirm 2xx.
   - `list` → already cached; just format and include in the report.
3. **Atomicity is per-op, not per-batch.** If op #3 fails, ops #1 and #2 are already persisted. Mark each op's outcome (`applied: true` / `applied: false, error: "..."`) and continue to subsequent ops — they're independent (different test cases). The exception: if a `create` op fails because of a transient API issue, surface loudly and keep going.

## Reporting

Single summary at the end of the run. Format:

```
voice-ai-test-cases — JOHN GIORDANI VOICE AGENT (slug: voci-partners)
LLM:  llm_xyz... (version 14)

Ops processed: 5
  ✓ create  "Marcus Johnson - Medicare Persistence"          → test_case_29b58ee9...  (bucket: hard_accept_reject_boundary)
  ✓ create  "Vendor Call - OMG National Pattern"             → test_case_81e0ea4f...  (bucket: vendor_spam_filter)
  ✗ create  "Fuzzy Lookup - 5 Facility Sound-Alikes"         → FAILED: 400 Bad Request (input_match_rule arg 'query' on facility 3 is invalid)
  ✓ update  test_case_4422f1b001fa (renamed + tightened metrics)
  ✓ delete  test_case_abc123ef4567

State after run:
  12 test cases total on the LLM (was 10; 2 created, 1 update, 1 delete, 1 failed create)

(if list op was present)
Current test cases:
  | Name                                            | Bucket                          | Last Modified         | ID                      |
  | ---                                             | ---                             | ---                   | ---                     |
  | Marcus Johnson - Medicare Persistence           | hard_accept_reject_boundary     | 2026-05-12 18:23 UTC  | test_case_29b58ee9...   |
  | ...
```

## What this skill is NOT for

- **Brainstorming what tests to write.** That's voice-ai-head's job in chat with Ben (Path 3 in `agents/voice-ai-head/CLAUDE.md`). By the time this skill runs, ops are already agreed.
- **Running tests against an agent** (executing simulations, collecting results). Out of scope for v1 — that's a separate future skill.
- **Editing prompt `.md` files or `kb-*.txt` files** — that's `voice-ai-improve-prompt`.
- **Drafting a new prompt from scratch** — that's `voice-ai-prototype`.
- **Retell LLM / agent / KB / phone changes** — that's `voice-ai-deploy-retell`.
- **Manually publishing test results, alerts, dashboards** — out of scope.

## Edge cases and failure handling

- **Sidecar missing or corrupt** → STOP. Caller can rebuild via `voice-ai-deploy-retell` sidecar recovery then retry.
- **Retell test case API returns 4xx on `create`** → mark op failed with the error message, continue to next op (other tests still ship).
- **Retell test case API returns 5xx** → retry once with exponential backoff (1s, 2s); if still failing, mark op failed and continue.
- **Caller passes a `create` op whose name already exists** → STOP that op pre-flight; suggest the caller use `update` with the existing ID instead.
- **Caller passes `delete` with no matching ID** → STOP that op pre-flight; suggest `list` to find the right ID.
- **Bucket is missing or unknown** → STOP that op pre-flight. Buckets are required for proposal hygiene — every test has to map to one.
- **`extract_dynamic_variable` mock conflicts with metrics** → STOP that op pre-flight per the judgment rule. Caller fixes the contradiction.
- **The LLM has been deleted in Retell since the sidecar was written** → catch the 404 from the first `list` call, surface as "LLM `<id>` not found on account `<slug>` — run sidecar recovery first".
- **CI context** (env `GITLAB_CI=true` or caller hint) — irrelevant here; this skill doesn't write to git. It runs the same in CI as in chat.
