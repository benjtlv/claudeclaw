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
| Custom variables you define | Whatever you stored via `~Store in 'var_name' variable~` earlier in the call |

**Use the IANA timezone name**, not abbreviations: `America/Los_Angeles` not `PST`, `America/Chicago` not `CST`. Daylight savings is handled correctly only with IANA names.

**Custom variable example:**

```
Step 2.1. Collect first name:
- "Can I grab your first name?" ~Store in 'customer_name' variable~

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

## `~call function_name~` — tool/function invocation

**What it does:** Triggers a Retell-side function call (transfer, end_call, calendar booking, etc.). Same tilde syntax as developer instructions, but the contents name a registered function.

```
- ~call end_call~
- ~call SetupCallback~
- ~call book_appointment with date={{current_time_{{timezone}}}}, name={{customer_name}}~
- ~call transfer_to_front_desk~
```

**Function names must match exactly** what's registered in the Retell agent config. Typos = silent failures (the line gets read aloud as instruction text instead of executing).

**Always pair `end_call` with a goodbye line first**, never as the first thing in a Step:

```
- "Alright, thanks for calling. Have a good one!"
- ~call end_call~
```

Calling `end_call` mid-utterance cuts the agent off and sounds abrupt.

---

## Quick reference

| Marker | Purpose | Spoken? |
|---|---|---|
| `--` | Pause mid-line | No (must be guarded by RULES TO NEVER BREAK) |
| `Reply with "NO_RESPONSE_NEEDED"` | Wait silently for caller after this line | No |
| `{{variable}}` | Inject runtime value | Value is spoken |
| `~text~` | Developer instruction to LLM | No |
| `~call func~` | Trigger Retell function | No |

---

## When to consult this doc

- **First-time prompt creation** (`voice-ai-prototype` Step 3) — every Step that ends with a question or transition needs `NO_RESPONSE_NEEDED`. Every prompt needs the `--` guardrail in RULES TO NEVER BREAK.
- **Iterating on a prompt** (`voice-ai-improve-prompt` Step B) — if you're adding a new Step or Objection, apply the conventions; if you find a prompt missing the `--` guardrail or using `NO_RESPONSE_NEEDED` inconsistently, fix it in the same edit.
- **When the agent is misbehaving** — verbalising "dash dash", talking over the caller after a question, saying "Alright , you're all set" with a missing name, or reading `~call end_call~` aloud are all symptoms of broken or missing convention usage.
