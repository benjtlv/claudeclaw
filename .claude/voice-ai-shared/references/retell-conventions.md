# Retell Prompt Conventions

Retell parses certain markers in the prompt as platform directives — they don't get spoken, they control behavior. Use these consistently in every prompt. Misusing them either breaks behavior silently or causes the agent to read directives aloud.

This is the reference for platform syntax. For *how the agent should speak* (tone, pacing, fillers, pronunciation), see [speech-patterns.md](speech-patterns.md).

---

## `--` (double hyphen) — pause marker

**What it does:** Inserts a natural mid-sentence pause when the agent speaks the line. Roughly 200-400ms, depending on voice provider.

**Use when** you want the agent to slow down at a specific point: between two clauses, before delivering a number, after a soft acknowledgement, before asking a question.

```
Yeah we have a few options -- want me to walk you through them?

Alright, you're all set. -- We'll see you then!

Saks parking is two hours free if you validate. -- Or there's street parking on Wilshire too.
```

**Hard rule:** Add an explicit guardrail in every prompt's `RULES TO NEVER BREAK` section:

> The `--` symbol represents a pause in speech. NEVER read it aloud as "dash dash" or any other punctuation. Just pause naturally.

Without this, the agent will sometimes verbalise the marker, which is jarring and instantly breaks immersion.

**Don't overdo it.** One or two `--` per agent utterance is plenty. Stacking `--` everywhere makes the agent sound halting. Use commas for short natural pauses, `--` for genuine beats.

**Note on the existing template's "no hyphens" rule:** The current `voice-agent-template.md` Speech Rules block says "No hyphens. Use commas to mimic speech pauses." That rule predates the `--` convention and is in conflict with the gold-standard agents now deployed. Treat `--` as the default pause marker for any new prompt; if the template gets updated, this section is the source of truth.

---

## `NO_RESPONSE_NEEDED` — wait for caller without speaking

**What it does:** Tells the agent that after delivering the previous line, it should wait silently for the caller to speak, rather than continuing to talk or generating filler.

**Syntax:** Append `Reply with "NO_RESPONSE_NEEDED"` (or wrap as `~Reply with "NO_RESPONSE_NEEDED"~` to keep the directive out of spoken output) at the end of the agent's line in Steps and Objection Handling sections.

```
Step 1.1. Greet warmly:
- "Hi, thanks for calling [COMPANY]. This is [AGENT_NAME]. -- How can I help you?" Reply with "NO_RESPONSE_NEEDED"

Step 4.2. Get phone number:
- "And what's the best number to reach you at?" Reply with "NO_RESPONSE_NEEDED"

"Not interested"
- "Gotcha, no worries. ..." ~Reply with "NO_RESPONSE_NEEDED"~
```

**Use after:** any line that ends with a question, an explicit invitation for the caller to speak, or a transition where the next move is clearly the caller's.

**Don't use after:** lines where the agent is mid-sequence and should continue (e.g. multiple agent lines in a row before the caller is expected to respond).

**Why this matters:** Without `NO_RESPONSE_NEEDED`, the agent often keeps talking — restating the question, offering options, filling silence. That destroys the natural turn-taking rhythm that makes the agent feel human.

---

## `{{variable_name}}` — runtime variable injection

**What it does:** At call time, Retell substitutes the variable's current value into the prompt before sending to the LLM.

**Common variables:**

| Variable | What it injects |
|---|---|
| `{{current_time_[TIMEZONE]}}` | Current datetime in the named timezone (e.g. `{{current_time_America/Los_Angeles}}`, `{{current_time_America/New_York}}`) |
| `{{caller_phone_number}}` | The caller's number on inbound calls |
| Custom variables you define | Whatever you stored via `~store 'x' in 'var_name'~` earlier in the call |

**Use the IANA timezone name**, not abbreviations: `America/Los_Angeles` not `PST`, `America/Chicago` not `CST`. Daylight savings is handled correctly only with IANA names.

**Custom variable example:**

```
Step 2.1. Collect first name:
- "Can I grab your first name?" ~store the first name in 'customer_name'~

Later in the prompt:
- "Alright {{customer_name}}, you're all set."
```

**Don't reference a variable before it's been set.** Retell will inject an empty string and the agent will say "Alright , you're all set." which sounds broken.

---

## `~text~` (tildes) — non-spoken developer instructions

**What it does:** Marks text inside the prompt that the LLM should treat as instruction/guidance to itself, **not** as words to speak. Common uses: side-notes within Steps, anti-pattern reminders, internal state directives.

```
Step 3.3. IF new client:
- ~MATCH THEIR ENERGY. Do NOT launch into a sales pitch unless the caller's tone invites it.~
- If they're direct/low-energy: "Alright, no worries." then keep moving.
- If they're chatty: "Oh nice! Yeah you're gonna like it here." one line max.
- ~NEVER give an unsolicited pitch about the vibe or experience.~
```

The agent reads the `~...~` blocks as guidance shaping its next utterance, but doesn't speak them.

**Use sparingly.** If a rule applies broadly, put it in `RULES TO NEVER BREAK` instead of repeating `~...~` directives in every Step. Reserve `~...~` for context-specific reminders that only apply at one point in the flow.

---

## `~call the function 'FUNCTION_NAME'~` — tool/function invocation

**What it does:** Triggers a Retell-side function call. Tilde-wrapped (non-spoken developer directive) with one canonical literal-string form. The form matters: `voice-ai-deploy-retell` parses this exact grammar to auto-wire the Retell LLM's built-in function config. Freestyle phrasings like `~end the call~`, `~call end_call~`, or `~hang up~` are NOT recognized and will not auto-enable the function.

```
- ~call the function 'end_call'~
- ~call the function 'transfer_call'~
- ~call the function 'agent_transfer'~
- ~call the function 'press_digit'~
- ~call the function 'extract_dynamic_variable'~
- ~call the function 'book_appointment'~           <- custom, not auto-wired (yet)
```

**In-scope built-ins** (auto-wired by the deploy skill — no manual Retell config needed):

| Function | What it does |
|---|---|
| `end_call` | Hang up the call |
| `transfer_call` | Warm-transfer the call to a human number |
| `agent_transfer` | Hand off to another Retell agent |
| `press_digit` | Send a DTMF digit (IVR navigation) |
| `extract_dynamic_variable` | Capture one or more variables mid-call so they're available for conditional logic later in the prompt (see variable extraction section below) |

**Custom / external functions** (e.g. `book_appointment`, `check_availability`, `SetupCallback`): use the same grammar in the prompt. The deploy skill will detect them but NOT auto-configure them — custom functions are manually wired until the N8N agent-level webhook router ships (single webhook, splits function calls from post-call events). For now, anything outside the 5 built-ins is logged as "custom, skipping auto-config".

**Function name must match exactly** what's registered on the Retell agent. Typos = silent failures (the line gets read aloud as instruction text instead of executing).

**Always pair `end_call` with a goodbye line first**, never as the first thing in a Step:

```
- "Alright, thanks for calling. Have a good one!"
- ~call the function 'end_call'~
```

Calling `end_call` mid-utterance cuts the agent off and sounds abrupt.

---

## Variable extraction — two modes

There are two places in a voice AI prompt where variables get captured. The literal pattern is the same — `~store 'x' in 'variable_name'~` — but where it appears determines which Retell config it drives.

### Mode 1: Post-call extraction (default)

A bare `~store 'x' in 'variable_name'~` line — i.e. NOT nested inside a `~call the function 'extract_dynamic_variable'~` block — is interpreted as a **post-call** data-extraction field. After the call hangs up, Retell's post-call analysis runs and populates `variable_name` from the full transcript.

```
Step 2.1: Collect Full Name. ~store the caller's full name in 'full_name'~
Step 2.3: Ask about the issue. ~store a 1-2 sentence summary of the caller's issue in 'issue_summary'~
```

The deploy skill auto-populates the agent's post-call analysis config with these fields. Type and description are inferred from context (the `'x'` description and surrounding prompt text), not defaulted to string.

Use post-call extraction for any variable you only need *after* the call — summaries, qualification outcomes, final contact details, outcome codes.

### Mode 2: Mid-call extraction (explicit)

If a variable needs to be available **during** the call — for conditional branching, for use in a later `{{variable}}` injection, for passing to another function — wrap the `store` lines inside an `extract_dynamic_variable` function call:

```
Step 3.2: Determine the caller's eligibility.
  ~call the function 'extract_dynamic_variable'~
    ~store 'yes' or 'no' for whether the caller is a new customer in 'is_new_customer'~
    ~store the zip code they mentioned in 'zip_code'~
```

The deploy skill detects the nested `store` statements and wires them into the `extract_dynamic_variable` function's variable list so they're available mid-conversation. The same variables can then drive `IF` logic downstream, or be injected with `{{is_new_customer}}` / `{{zip_code}}`.

Batch multiple related captures into one `extract_dynamic_variable` call whenever you can — Retell runs the extraction tightly when the relevant context is still fresh in the LLM's turn, and one call is cheaper than several.

### Don't

- Don't use `~store 'x' in 'var'~` for a constant you just want to hardcode — it's still a capture statement (Retell will try to extract `x` from the transcript). For control-flow state (e.g. "mark rescue mode on"), use a descriptive line of plain instruction inside `~...~`, or structure the flow without relying on flags.
- Don't reference a variable via `{{var}}` before the `store` that sets it has executed. Retell injects empty string.

---

## Quick reference

| Marker | Purpose | Spoken? |
|---|---|---|
| `--` | Pause mid-line | No (must be guarded by RULES TO NEVER BREAK) |
| `Reply with "NO_RESPONSE_NEEDED"` | Wait silently for caller after this line | No |
| `{{variable}}` | Inject runtime value | Value is spoken |
| `~text~` | Developer instruction to LLM | No |
| `~call the function 'NAME'~` | Trigger Retell function (5 built-ins auto-wired; custom = manual) | No |
| `~store 'x' in 'var'~` bare | Post-call data extraction field | No |
| `~store 'x' in 'var'~` inside `extract_dynamic_variable` | Mid-call extraction variable | No |

---

## When to consult this doc

- **First-time prompt creation** (`voice-ai-prototype` Step 3) — every Step that ends with a question or transition needs `NO_RESPONSE_NEEDED`. Every prompt needs the `--` guardrail in RULES TO NEVER BREAK.
- **Iterating on a prompt** (`voice-ai-improve-prompt` Step B) — if you're adding a new Step or Objection, apply the conventions; if you find a prompt missing the `--` guardrail or using `NO_RESPONSE_NEEDED` inconsistently, fix it in the same edit.
- **When the agent is misbehaving** — verbalising "dash dash", talking over the caller after a question, saying "Alright , you're all set" with a missing name, or reading `~call end_call~` aloud are all symptoms of broken or missing convention usage.
