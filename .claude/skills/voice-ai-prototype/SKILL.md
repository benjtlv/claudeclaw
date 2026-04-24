---
name: voice-ai-prototype
description: Build a voice AI agent end-to-end for a potential or existing client — generates the prompt file(s), creates the Retell LLM + agent + knowledge bases, and provisions a phone number. Default mode produces one receptionist prompt + one deployed Retell agent bound to a phone number. `--trojan-horse` mode additionally produces a sales-oriented Trojan variant (subtly drives callers to book a sales call with Ben); in that case two agents are deployed but the phone number is bound to the Trojan agent only. Use this skill when Ben provides a client description, call transcript, website, or any business context and says things like "build a prompt for [client]", "create an agent for [business]", "prototype for [client]", "voice agent for [company]", "build a Trojan horse demo for [client]". This skill is for first-time creation only — if the agent already exists in Retell, it refuses and routes to `voice-ai-improve-prompt`.
---

# Voice AI Prototype Prompt Skill

Builds a deployment-ready voice AI agent end-to-end: prompt generation, Retell LLM creation, knowledge base attachment, agent creation, phone number provisioning, sidecar metadata, and git commit. One skill, one pass, agent is live when done.

## The two modes

**Regular mode (default).** One receptionist prompt → one Retell agent → one phone number. The agent acts as the business's AI receptionist. Use this for existing clients, or for prospects Ben already has on a sales call where the demo just needs to sound impressive.

**Trojan horse mode (`--trojan-horse`).** For cold leads who expressed interest but didn't book a call. Produces the same receptionist prompt as regular mode **plus** a second Trojan variant that rides the receptionist persona and subtly segues into a sales pitch targeting a booked call with Ben. Two Retell agents get created. The provisioned phone number is bound to the **Trojan agent only** — the regular agent sits ready in Retell, phone-less, waiting to go live on the client's real line once Ben closes the sale.

Ben invokes the mode explicitly (flag in the request, or he says "build me a Trojan horse for X"). If unclear, default to regular and flag it.

## Resources

Shared resources live in `.claude/voice-ai-shared/` so other voice-ai-* skills can read the same files.

- **[../../voice-ai-shared/references/speech-patterns.md](../../voice-ai-shared/references/speech-patterns.md)** — Filler words, language to avoid, verbatim speech examples, response length guidelines. Read before writing any speech examples.
- **[../../voice-ai-shared/references/qualification-framework.md](../../voice-ai-shared/references/qualification-framework.md)** — IF/ONLY IF conditional patterns, transfer authorization blocks, info collection structure, variable strategy. Read when designing Steps 2-4 of the prompt.
- **[../../voice-ai-shared/references/appointment-setting.md](../../voice-ai-shared/references/appointment-setting.md)** — Complete appointment scheduling flow. Read when the use case includes booking, and always in Trojan mode (the Trojan script hands off to it).
- **[../../voice-ai-shared/references/knowledge-base-split.md](../../voice-ai-shared/references/knowledge-base-split.md)** — When (and when not) to move reference data out of the prompt into `kb-*.txt` files. Read before saving if the client provided supporting docs or if the drafted prompt is trending above ~10k tokens.
- **[../../voice-ai-shared/references/faq-format.md](../../voice-ai-shared/references/faq-format.md)** — Canonical Topic/Question/Answer format every `kb-*.txt` file must follow. Read whenever you're about to write or edit a `kb-*.txt`.
- **[../../voice-ai-shared/references/retell-conventions.md](../../voice-ai-shared/references/retell-conventions.md)** — Retell platform syntax: `--` pause marker, `NO_RESPONSE_NEEDED`, `{{variable}}` injection, `~text~` developer instructions, `~call function~` invocations. Read before writing any Steps or Objection Handling — every prompt needs the `--` guardrail in RULES TO NEVER BREAK and consistent `NO_RESPONSE_NEEDED` placement.
- **[../../voice-ai-shared/references/trojan-horse.md](../../voice-ai-shared/references/trojan-horse.md)** — Sales overlay script: segue trigger, missed-calls math (industry-adapted), frame-flip close, deploy-tonight urgency, appointment push, guardrails. Read in Trojan mode only.
- **[../../voice-ai-shared/assets/voice-agent-template.md](../../voice-ai-shared/assets/voice-agent-template.md)** — Master template for the regular receptionist prompt. Always use this as the base.
- **[../../voice-ai-shared/assets/voice-agent-template-trojan-overlay.md](../../voice-ai-shared/assets/voice-agent-template-trojan-overlay.md)** — The Trojan overlay block that layers on top of the regular template. Read in Trojan mode only.

---

## Step 1: Extract client information and determine mode

### 1a. Determine the mode

Did Ben invoke with `--trojan-horse` (or say "Trojan horse demo", "sales demo", "cold lead demo", "demo that closes")? Then mode = **Trojan**. Otherwise mode = **Regular**.

If the signal is ambiguous (e.g. "build a demo for X"), default to Regular and say so in the summary at the end so Ben can flip it. Don't stop and ask — just pick and flag.

### 1b. Extract from the provided input

| What | Why |
|---|---|
| Agent name | What the AI calls itself |
| Company name | Client's business name |
| Industry / service | What they sell or do |
| Agent mode | Inbound, outbound, appointment setter, or hybrid |
| Primary objective | What a successful call looks like |
| Qualification criteria | Good lead vs. turn away |
| Info to collect | Fields to gather during the call |
| Transfer conditions | When to escalate + any restrictions |
| Appointment setting | Yes/no, which calendar functions |
| Business hours + timezone | Operating hours |
| Key objections | Common pushbacks |
| **Average customer value** (Trojan only) | Dollar figure per new customer — powers the missed-calls math |
| **Typical missed-calls count** (Trojan, optional) | If known, pre-seed the math; otherwise the agent asks live |

If a critical piece is missing, make a reasonable inference and flag it at the end. Do NOT ask Ben questions before starting — generate the prompt(s) first, flag assumptions after.

---

## Step 1.5: Classify source material — behavioral vs reference

Before drafting anything, walk through every chunk of the input the client provided (call transcript, website copy, FAQ docs, price sheets, policy text, team rosters, parking info, etc.) and label each chunk as **behavioral** or **reference**.

Read [../../voice-ai-shared/references/knowledge-base-split.md](../../voice-ai-shared/references/knowledge-base-split.md) for the full criteria. The short version:

- **Behavioral** → goes in the prompt, always, regardless of token count. Anything that tells the agent *how to act*, *what to say*, or *when to do what*: tone, conversational steps, qualification logic, transfer rules, pushy-caller handling, objection scripts, language to avoid, pronunciation rules, RULES TO NEVER BREAK.
- **Reference** → goes in a `kb-*.txt` file, always, regardless of how few tokens it would save. Pure facts the agent only *looks up* when a caller asks a specific question: full pricing tables, team/staff rosters with hours and specialties, parking lots, multi-location addresses, detailed policy text, product brand lists, long company history, FAQ lists beyond the 3-5 the agent answers instantly.

Group the reference chunks by topic — each group becomes one `kb-<topic>.txt` file. Examples: `kb-pricing.txt`, `kb-parking.txt`, `kb-team.txt`, `kb-policies.txt`. Don't make one mega-file.

**Output of this step:** a short labeled inventory you'll use to scope Steps 3, 3T, and 3.5. Example:

> Behavioral (→ prompt): tone guidance, qualification rules, transfer escalation conditions, pushy-caller block, objection notes.
> Reference (→ KBs): full price list with tiers → `kb-pricing.txt`; parking lots and validation rules → `kb-parking.txt`; stylist roster with hours and specialties → `kb-team.txt`; cancellation/deposit/payment policies → `kb-policies.txt`.

Doing this classification **before** drafting is non-negotiable. If you draft the prompt first and try to extract reference chunks afterward, you will end up with a compressed "quick reference" mirror in the prompt AND the same content in a KB — the duplication anti-pattern. Classifying upfront prevents this entirely.

If the input has no clean reference material (everything is behavioral guidance from a call transcript or sales brief), this step produces an empty reference inventory — and Step 3.5 will be skipped. That's fine.

---

## Step 2: Determine agent mode (prompt flavor)

**Inbound Receptionist** (Florida Oasis pattern) — caller reaches out; emphasize qualification gate, info collection, warm handoff or callback. Heavy use of qualification-framework.md.

**Outbound Cold Caller** (Cold Caller AI Receptionist pattern) — agent initiates; may need two personas. Emphasize natural speech, referral hook, pain creation, booking. Heavy use of speech-patterns.md.

**Appointment Setter / Speed-to-Lead** — following up on expressed interest. Emphasize objection handling, confirming interest, full booking flow. Heavy use of appointment-setting.md.

**Hybrid** — combine as needed.

In Trojan mode, the underlying prompt flavor is almost always **Inbound Receptionist** — the caller is dialing the Trojan demo number thinking they're trying out "their" agent. The Trojan overlay sits on top of that base.

---

## Step 3: Build the regular prompt

Use only the **behavioral chunks** from Step 1.5. Reference chunks are excluded from the prompt entirely — they go to KB files in Step 3.5. The prompt you write here must not contain compressed or summarised mirrors of any reference content (no "Quick Reference" sections, no inline pricing/hours/roster tables that also live in a KB).

Read [../../voice-ai-shared/assets/voice-agent-template.md](../../voice-ai-shared/assets/voice-agent-template.md) fully. Then build the prompt section by section:

1. **Global header rules** — copy verbatim (FIXED)
2. **Role** — agent name, role description, company
3. **Skills** — 3-5 relevant to this specific business
4. **Personality** — warm/empathetic (inbound), casual/genuine (outbound), direct/confident (setter)
5. **Speech Rules** — copy verbatim (FIXED), **with one explicit override**: the template's line *"No hyphens. Use commas to mimic speech pauses."* is outdated. Replace it with: *"Use `--` as the pause marker for genuine mid-sentence beats. Use commas for short natural pauses."* The `--` convention is the source of truth — see [../../voice-ai-shared/references/retell-conventions.md](../../voice-ai-shared/references/retell-conventions.md). Also add the *"NEVER read `--` aloud as 'dash dash'"* guardrail to RULES TO NEVER BREAK.
6. **Speech Examples** — read speech-patterns.md, pull 3-5 examples adapted to this industry. Use real terms (e.g., "roofing estimate" not "service")
7. **Info Collection Guidelines** — copy verbatim + any business-specific verification
8. **Context** — company background, service, key pain point, key contacts
9. **Task + Success Criteria**
10. **Steps** — Greeting → Info collection (one field at a time) → Qualification (IF/ONLY IF) → Core value delivery → Appointment setting (if applicable) → Closing
11. **Objection Handling** — 5-10 objections specific to this business
12. **Notes** — copy RULES TO NEVER BREAK verbatim + business-specific rules. **Then add these mandatory rules** (template doesn't include them yet, but every prompt must have them — see [../../voice-ai-shared/references/speech-patterns.md](../../voice-ai-shared/references/speech-patterns.md)):
    - **NEVER read `--` aloud as "dash dash" or any punctuation. Just pause naturally.** (per [retell-conventions.md](../../voice-ai-shared/references/retell-conventions.md))
    - **NEVER answer more than the specific question asked.** Yes/no questions get yes/no answers. "How much" gets the price, not every tier and option. Let the caller drive what comes next. Volunteering related info without being asked is the most common AI tell.
    - **NEVER restate what the caller just told you.** No parroting names, phone numbers, dates, or times back. Only spell back emails. Don't recap booking details at the end of the call — they know what they booked.
    - **MIRROR the caller's energy, never inject enthusiasm they didn't bring.** Direct caller → direct agent. Chatty caller → chatty agent. Match, never exceed.

### Quality checklist (applies to both prompts)

- [ ] All decision trees max 4 levels deep
- [ ] Qualification conditions use IF/ONLY IF pattern
- [ ] Transfer block has explicit conditions + business hours gate
- [ ] At least 3 speech examples with filler words
- [ ] "Language to NEVER USE" list is in Notes
- [ ] All RULES TO NEVER BREAK are present in Notes
- [ ] One-question-at-a-time rule is in Notes
- [ ] "NEVER read `--` aloud as 'dash dash'" guardrail is in Notes
- [ ] "NEVER answer more than the specific question asked" rule is in Notes
- [ ] "NEVER restate what the caller just told you" rule is in Notes
- [ ] "MIRROR caller energy, never inject enthusiasm they didn't bring" rule is in Notes
- [ ] Variable names defined for all collected fields
- [ ] Pushy caller rescue block is present
- [ ] Appointment setting has timezone + AM/PM rules (if applicable)

---

## Step 3T: Build the Trojan variant (Trojan mode only)

Skip this step entirely in Regular mode.

Read [../../voice-ai-shared/references/trojan-horse.md](../../voice-ai-shared/references/trojan-horse.md) and [../../voice-ai-shared/assets/voice-agent-template-trojan-overlay.md](../../voice-ai-shared/assets/voice-agent-template-trojan-overlay.md).

The Trojan prompt is a **superset** of the regular prompt: all the same Role / Skills / Personality / Speech Rules / Context / Objection Handling / Notes sections carry over unchanged. The receptionist persona must stay intact throughout the call — the Trojan layer rides on top of it, never replaces it.

Additions/changes versus the regular prompt:

1. **Role** — still the business's receptionist. Add a short invisible directive (inside Notes, not Role) that the agent is also authorized to speak on behalf of the business owner about the agent product itself when the conversation drifts there.
2. **New Step in the Steps section** — inserted after the caller has asked 1-2 business questions or after ~60-90 seconds of rapport. This is the **Trojan segue**. Full script lives in ../../voice-ai-shared/references/trojan-horse.md. Keep the segue natural ("quick question while I have you") — never a hard break.
3. **Missed-calls math sub-step** — asks missed calls/day → monthlyizes → asks conversion % → multiplies by average ticket → surfaces the monthly lost-revenue figure. The agent waits for the caller to acknowledge the number out loud.
4. **Frame-flip close** — "one [industry] per area" scarcity line that positions Ben as the scarce resource.
5. **Deploy-tonight urgency** — "this agent is already built for your business; all we need is a quick call to tweak details and set up forwarding; it can start saving you missed calls tonight."
6. **Appointment push** — soft first ask, single loss-framed nudge if they hesitate, then hand off to appointment-setting.md flow to book the call with Ben.
7. **Objection Handling** — add Trojan-specific objections: "how much does it cost", "I need to think about it", "send me something in writing", "we already have a receptionist". Scripts in ../../voice-ai-shared/references/trojan-horse.md.
8. **Guardrails in Notes** — from ../../voice-ai-shared/references/trojan-horse.md: never say "I'm a demo" unless directly asked; compress the math to one line if the caller is rushed; never break frame.

### Trojan quality checklist (additional)

- [ ] Trojan segue fires after 1-2 business questions OR 60-90s, not in the opening
- [ ] Missed-calls math steps adapted to the actual industry (dentist, HVAC, plumber, electrician, med spa, etc.)
- [ ] Industry-specific "least a new customer spends" figure is prompted for, not hardcoded (unless Ben provided it)
- [ ] Frame-flip line names the specific industry ("I only work with one [INDUSTRY] per area")
- [ ] Deploy-tonight line is present and verbatim
- [ ] Appointment push with soft ask → loss-framed nudge is present
- [ ] All guardrails from ../../voice-ai-shared/references/trojan-horse.md are in Notes

---

## Step 3.5: Write the knowledge base files

The split decision was already made in Step 1.5 — here you just produce the files.

If Step 1.5 produced no reference groups, **skip this step entirely**. Don't invent KB files.

Otherwise, for each reference group identified in Step 1.5:

1. Read [../../voice-ai-shared/references/faq-format.md](../../voice-ai-shared/references/faq-format.md) and convert the source content to the canonical Topic/Question/Answer FAQ format. Never paste raw prose into a `kb-*.txt`.
2. Save as plain `.txt` (not `.md`) alongside the prompt file, named `kb-<topic>.txt`.

**Verify no duplication.** Before moving on, re-scan the prompt you built in Step 3 (and 3T if applicable). If you find any section that mirrors content now in a KB — a "Quick Reference" pricing list, a compressed hours/location/team block, a summarised policy paragraph — delete it from the prompt. The prompt must contain zero copies of anything that lives in a KB.

**Add the `## Knowledge Base` pointer section** near the bottom of the prompt (above "Notes"), listing each KB file with what's in it and when to consult it. Format per [knowledge-base-split.md](../../voice-ai-shared/references/knowledge-base-split.md). One line per KB — this is navigation only, not content.

In Trojan mode, both prompts share the same `kb-*.txt` files. Both Retell agents will get the same KBs attached. Do not duplicate the files.

---

## Step 4: Save the prompt file(s)

**Prompts root:** `C:\Users\benelk\Documents\ai_prompts`

### 4.1 Destination folder

Ask Ben: **"Is [ClientName] an existing client or a prospect?"**
- Existing client → `ai_prompts/CLIENTS/`
- Prospect → `ai_prompts/PROSPECTS/`
- Cold lead / Trojan demo target → `ai_prompts/PROSPECTS/` (still lives under PROSPECTS — they haven't bought yet)

### 4.2 Fuzzy-match or create subfolder

List the subfolders in the chosen directory and fuzzy-match against existing folder names (case-insensitive, ignore punctuation). Subfolder names use UPPERCASE, human-readable names (e.g., `CLAIM WARRIORS`, `HONEST AUTOMOTIVE`).

- **Match found:** confirm "Found existing folder [FOLDER NAME] — save there?" Only proceed on confirmation.
- **No match:** propose a folder name and confirm "No existing folder found. I'll create [PROPOSED NAME] — good?"

### 4.3 Save filenames

- **Regular prompt (always):** `[client-name]-voice-agent-prompt.md` (lowercased, hyphenated).
- **Trojan prompt (Trojan mode only):** `[client-name]-prompt-trojan.md` (lowercased, hyphenated, sibling to the regular prompt in the same folder).

The filename asymmetry is intentional — the shorter `-prompt-trojan.md` is Ben's chosen convention and keeps the Trojan variant visually distinct when listing the folder.

Always confirm before writing. Never save without Ben's explicit go-ahead on folder + filenames.

Do NOT push to git yet — the sidecar metadata from the Retell creation step needs to go in the same commit. Commit-and-push happens in Step 12.

---

## Step 5: Derive Retell agent name(s) and check for collisions

The `ai_prompts` repo is local at `C:\Users\benelk\Documents\ai_prompts` and pushes to `git@gitlab.com:novanest-ai/ai_prompts.git` on `main`.

### 5.1 Derive agent names from the filenames

Rules:
1. Strip extension (`.md` or `.txt`).
2. If the base ends with `-prompt`, strip that suffix.
3. If the base ends with `-voice-agent-prompt`, strip that suffix.
4. If the base ends with `-trojan` (after the above stripping), keep it — it's the Trojan marker.
5. Replace every `-` and `_` with a space.
6. Uppercase the whole string.
7. Collapse any runs of whitespace to a single space; trim.

Examples:
- `john-giordani-voice-agent-prompt.md` → `JOHN GIORDANI`
- `john-giordani-prompt-trojan.md` → `JOHN GIORDANI TROJAN`
- `claim-warriors-inbound-prompt.md` → `CLAIM WARRIORS INBOUND`

For a cleaner deployed look, append ` VOICE AGENT` to the regular-mode name only — the Trojan name already has `TROJAN` suffix which signals the variant. So the final derivation is:
- Regular: `JOHN GIORDANI VOICE AGENT`
- Trojan: `JOHN GIORDANI TROJAN`

If the derived regular name would be just `PROMPT` or `PROMPT IMPROVED` (i.e. filename was too generic), stop and ask Ben for an explicit name.

### 5.2 Collision check

Call `list_agents` via the NovaNest RetellAI MCP. Case-insensitive compare against `agent_name`.

Also check whether a sidecar file already exists in the target folder (see Step 11 for sidecar filenames). If the sidecar exists AND the agent is live in Retell → refuse: "An agent named `<AGENT NAME>` already exists in Retell (agent_id `<id>`). This skill only handles first-time creation — use `voice-ai-improve-prompt` to modify."

In Trojan mode, check both derived names. If either collides, refuse with specifics.

---

## Step 6: Fixed Retell settings

- **Model:** `gpt-4.1`
- **Voice:** Jennifer Suarez — look up `voice_id` at runtime via `list_voices` (name is the anchor, not a hardcoded ID)
- **Default area code:** `954` (South Florida). If Ben gave one, use his.
- **Env:** `RETELL_API_KEY` in `C:\Users\benelk\Documents\claudeclaw\.env`

## Tooling: MCP first, REST fallback via context7

Prefer the NovaNest RetellAI MCP tools for every call where an equivalent exists: `list_agents`, `create_retell_llm`, `create_agent`, `create_phone_number`, `list_voices`, `update_retell_llm`.

If an operation isn't exposed by the MCP (knowledge-base creation, attaching KBs to LLMs, uploading KB source files are the usual gaps), fall back to the Retell REST API:

1. Use `context7` MCP to fetch current docs. `resolve-library-id` with query `retell ai`, then `query-docs` with your specific question. Don't trust cached knowledge — the API shape evolves.
2. Load `RETELL_API_KEY` from `.env`.
3. Call via `curl` or an inline Python script.
4. Never hardcode the API key.

---

## Step 7: Create Retell LLM(s)

**Regular mode — one LLM:**

Call `create_retell_llm` via MCP with:
- `model`: `gpt-4.1`
- `general_prompt`: full contents of the regular prompt file
- `model_temperature`: Retell default unless Ben specified

Capture `llm_id_regular`.

**Trojan mode — two LLMs:**

Create both — regular first, then Trojan. Same payload shape, `general_prompt` differs:
- `llm_id_regular` ← regular prompt file contents
- `llm_id_trojan` ← Trojan prompt file contents

Consider bumping `model_temperature` slightly for the Trojan LLM to make the sales segue feel less scripted (e.g., default + 0.1). Flag the choice in the final summary.

---

## Step 8: Create knowledge bases and attach

If `kb-*.txt` files exist in the folder, for each file:

1. Derive KB name: `<REGULAR AGENT NAME> — <topic>` where `<topic>` is the filename segment between `kb-` and `.txt`, title-cased. Example: `kb-faqs.txt` → `JOHN GIORDANI VOICE AGENT — Faqs`.
2. Create the knowledge base and upload the `.txt` as source. If the MCP exposes `create_knowledge_base`, use it; otherwise context7 + REST.
3. Capture `knowledge_base_id`.

After all KBs exist, attach them to **both** LLMs in Trojan mode, or just the one LLM in Regular mode. KB naming stays anchored to the regular agent name — the Trojan agent shares the same KBs, no duplication.

If KB creation fails mid-way, report what was created and what failed, then stop. Don't leave partially-wired agents.

---

## Step 9: Create Retell agent(s)

### 9.1 Get Jennifer Suarez voice_id

Call `list_voices`, match "Jennifer Suarez" case-insensitively. If missing, stop and ask Ben which voice.

### 9.2 Create agents

**Regular mode — one agent:**

`create_agent` with:
- `agent_name`: regular derived name (e.g., `JOHN GIORDANI VOICE AGENT`)
- `response_engine`: `{ type: "retell-llm", llm_id: <llm_id_regular> }`
- `voice_id`: Jennifer Suarez
- Other fields: Retell defaults unless the prompt file has a Voice Settings section

Capture `agent_id_regular`.

**Trojan mode — two agents:**

Create regular agent (same payload as above) → capture `agent_id_regular`.
Create Trojan agent with `agent_name` = Trojan derived name, `llm_id` = `llm_id_trojan`, same voice → capture `agent_id_trojan`.

---

## Step 10: Provision phone number

**Regular mode:**
`create_phone_number` via MCP with `area_code` (Ben's or `954` default), `inbound_agent_id: <agent_id_regular>`. Capture `phone_number`.

**Trojan mode:**
`create_phone_number` with `inbound_agent_id: <agent_id_trojan>` — the phone routes to the **Trojan** agent only. The regular agent sits phone-less in Retell, ready for post-sale phone assignment. Capture `phone_number`.

If no number is available in the requested area code, surface Retell's error verbatim and ask Ben for a fallback area code. Don't silently pick a different one.

---

## Step 11: Write sidecar(s)

Sidecar filename = prompt basename (minus extension) + `.retell.json`, same directory as the prompt file.

**Regular mode — one sidecar** next to the regular prompt:

```json
{
  "agent_name": "JOHN GIORDANI VOICE AGENT",
  "agent_id": "agent_abc...",
  "llm_id": "llm_xyz...",
  "model": "gpt-4.1",
  "voice": { "name": "Jennifer Suarez", "voice_id": "..." },
  "phone_number": "+19545550123",
  "area_code": "954",
  "knowledge_bases": [
    {"name": "JOHN GIORDANI VOICE AGENT — Faqs", "id": "kb_...", "source_file": "kb-faqs.txt"}
  ],
  "prompt_file": "CLIENTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md",
  "mode": "regular",
  "created_at": "<ISO-8601 UTC>",
  "last_synced_at": "<same on first run>"
}
```

**Trojan mode — two sidecars.**

Regular sidecar (`[client]-voice-agent-prompt.retell.json`):
```json
{
  "agent_name": "JOHN GIORDANI VOICE AGENT",
  "agent_id": "agent_reg...",
  "llm_id": "llm_reg...",
  "model": "gpt-4.1",
  "voice": { "name": "Jennifer Suarez", "voice_id": "..." },
  "phone_number": null,
  "phone_status": "awaiting post-sale assignment",
  "area_code": null,
  "knowledge_bases": [ ... same IDs as Trojan sidecar ... ],
  "prompt_file": "PROSPECTS/JOHN GIORDANI/john-giordani-voice-agent-prompt.md",
  "mode": "regular",
  "sibling_trojan_agent_id": "agent_troj...",
  "created_at": "...",
  "last_synced_at": "..."
}
```

Trojan sidecar (`[client]-prompt-trojan.retell.json`):
```json
{
  "agent_name": "JOHN GIORDANI TROJAN",
  "agent_id": "agent_troj...",
  "llm_id": "llm_troj...",
  "model": "gpt-4.1",
  "voice": { "name": "Jennifer Suarez", "voice_id": "..." },
  "phone_number": "+19545550123",
  "area_code": "954",
  "knowledge_bases": [ ... same IDs ... ],
  "prompt_file": "PROSPECTS/JOHN GIORDANI/john-giordani-prompt-trojan.md",
  "mode": "trojan",
  "sibling_regular_agent_id": "agent_reg...",
  "created_at": "...",
  "last_synced_at": "..."
}
```

Omit `knowledge_bases` entirely if there are none (don't emit an empty array).

---

## Step 12: Git commit and push

One commit bundles prompts + sidecars + any `kb-*.txt` files. This is the only push in the whole flow.

```bash
cd /c/Users/benelk/Documents/ai_prompts
git checkout main
git pull --ff-only origin main
```

If local has uncommitted unrelated changes, flag them and stop before committing — don't bundle them in.

Stage the specific files only:

```bash
git add "<regular prompt path>" "<regular sidecar path>" \
  [ "<trojan prompt path>" "<trojan sidecar path>" ] \
  [ "<each kb-*.txt path>" ]
git commit -m "Add voice agent for <AGENT NAME>[ + Trojan]"
git push origin main
```

If push is rejected non-fast-forward, `git pull --rebase origin main` and retry. If rebase conflicts, stop and show Ben.

On success, confirm `Pushed to main: <short SHA>`.

---

## Step 13: Report back

Clean summary. Always lead with what was deployed.

**Regular mode:**
```
Created in Retell:
  Agent:          JOHN GIORDANI VOICE AGENT
  agent_id:       agent_abc123...
  llm_id:         llm_xyz789...
  Voice:          Jennifer Suarez
  Phone:          +1 (954) 555-0123   (area code: 954 — default)
  Knowledge bases:
    - JOHN GIORDANI VOICE AGENT — Faqs   (kb_...)

Saved to: PROSPECTS/JOHN GIORDANI/ (pushed to main, <short SHA>)
```

**Trojan mode:**
```
Created in Retell (Trojan horse demo):
  Regular agent:  JOHN GIORDANI VOICE AGENT
    agent_id:     agent_reg...
    llm_id:       llm_reg...
    phone:        (none — awaiting post-sale assignment)

  Trojan agent:   JOHN GIORDANI TROJAN
    agent_id:     agent_troj...
    llm_id:       llm_troj...
    phone:        +1 (954) 555-0123   (bound to Trojan) (area: 954 — default)

  Voice:          Jennifer Suarez (both agents)
  Knowledge bases (shared):
    - JOHN GIORDANI VOICE AGENT — Faqs   (kb_...)

Saved to: PROSPECTS/JOHN GIORDANI/ (pushed to main, <short SHA>)

Demo number to send the lead: +1 (954) 555-0123
```

If the area code was defaulted, note it so Ben can override. If any assumptions were made during prompt generation, flag them after the summary: "Assumed X because Y — confirm and I'll update."

---

## Edge cases and failure handling

- **Prompt file would overwrite something** → confirm with Ben before overwriting; never silently clobber.
- **Agent name collision in Retell** → refuse with the name and `agent_id` of the existing agent. Don't append `(2)`.
- **Derived name too generic** (`PROMPT`, `PROMPT IMPROVED`) → stop and ask for an explicit agent name.
- **`.env` missing or `RETELL_API_KEY` not set** → stop before any Retell call.
- **KB creation partial failure** → report what succeeded, what failed, surface Retell's error body, stop.
- **No phone number available in area code** → surface the error, ask for alternate area code. Don't silently fall back.
- **Jennifer Suarez not in `list_voices`** → ask Ben which voice.
- **Push rejected non-fast-forward** → `git pull --rebase`, retry once. If conflicts, stop.
- **Working tree dirty with unrelated changes** → flag them, do not bundle. Ben should clean up first, then re-run.
- **Ambiguous mode signal** ("build a demo for X") → default to Regular, flag in summary.
- **Trojan mode on a business where the math framework doesn't fit** (e.g. a SaaS with zero phone calls) → still try; Trojan ../../voice-ai-shared/references/trojan-horse.md has adapted variants, and for truly unfit cases the frame-flip + deploy-tonight urgency still lands even without the missed-calls math.

---

## What this skill is NOT for

- Updating an existing Retell agent's prompt, KBs, or voice — that's `voice-ai-improve-prompt`.
- Iterating on an existing prompt file — `voice-ai-improve-prompt`.
- Deleting agents, LLMs, KBs, or phone numbers.
- Testing or making calls.
- Managing GitLab MRs — `voice-ai-improve-prompt --with-pr`.

---

## Key notes

- The appointment-setting.md block is nearly complete — preserve the calendar error handling and AM/PM rules intact; they prevent real no-shows.
- Qualification IF/ONLY IF conditions must be strict and unambiguous — vague conditions cause expensive mistakes.
- Always include the pushy caller rescue block from qualification-framework.md in every prompt.
- Trojan mode prompts must keep the receptionist persona intact throughout; the Trojan overlay rides on top, never replaces it.
- If the input is a call transcript, focus on what the caller/prospect needed — that's the agent you're building.
