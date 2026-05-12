# Retell test case writing style

Canonical style guide for writing Retell test case definitions
(`user_prompt`, `metrics`, `tool_mocks`, `dynamic_variables`). Read this
BEFORE drafting any test case proposal in chat, and BEFORE invoking
the `voice-ai-test-cases` skill. Faithfully mimic the patterns shown
in the existing florida-oasis and a1-biohazard test suites — those
are the source of truth this guide distils.

## Core rules

1. **Tests verify the most critical behaviors, not coverage.** A bad
   test is one that, if it failed, wouldn't make Ben change anything.
   If a test doesn't map to one of the 10 strategic buckets below,
   don't propose it.
2. **Be conservative.** 5-12 tests for a typical agent. 20+ only when
   the agent has genuinely many distinct critical-path behaviors. Do
   not propose tone, length, friendliness, or voice-quality tests at
   this stage.
3. **Mimic the existing style closely.** Name format, prompt structure,
   metric phrasing — match what's already in florida-oasis and
   a1-biohazard. Consistency makes tests scannable later.

## The 10 strategic buckets

Every proposed test fits exactly one bucket. If it doesn't, it's
probably not worth a test case.

| # | Bucket | When to propose | Existing example |
|---|---|---|---|
| 1 | Hard accept/reject boundary | Agent has a yes/no gate (insurance, age, geography, budget). Propose ONE accepted + ONE rejected, not all variations. | "Sylvia Gomez - Humana" (reject), "Jennifer Walsh - Cigna HMO" (accept) |
| 2 | Irreversible safety behavior | Crisis routing, 911 referral, NEVER-collect-PII-during-emergency, end_call right after referral. | "Paige Harisson - Active Physical Danger", "Michael Harrison - Active Medical Emergency" |
| 3 | Negative transfer authorization | When NOT to transfer. Pressure / urgency / anger don't unlock the transfer. | "Robert Williams - Unknown Therapist Transfer", "Amanda Chen - After Hours Emergency" |
| 4 | Vendor / spam filter | Categorical "don't engage" patterns (vendor sales call, OMG National prefix, "calling from Google Ads"). | "Digital Marketing Solutions - Vendor Cal", "Call from Google Ad" |
| 5 | Tool-call correctness | Agent calls the right function with the right args in the right order. Always paired with tool_mocks. | "Medical Waste Pickup - New Client", "Police Department - Existing Client" |
| 6 | Fuzzy / lookup resolution | Sound-alike facility/insurance/name resolution. **Always consolidate into ONE test** with multiple sub-rounds — see the consolidation pattern below. | "Fuzzy Lookup - 5 Facility Sound-Alikes" (consolidated) |
| 7 | Proxy / family caller | Caller is acting on behalf of another person. Agent must not conflate identities. | "David Thompson - Admit wife", "Maria Rodriguez - Needs help with numbers", "Caller vs On-Site Contact Confusion" |
| 8 | Adversarial caller | Angry-at-AI, conversation loops, hyper-rushed details. Propose ONLY the highest-stakes ones for this agent, not exhaustive. | "Angry to speak to AI Agent", "Nancy Peterson - Conversation Loop", "Jessica Torres - Verification Rush" |
| 9 | Grammar contract | A special function (`end_call`, `SetupCallback`, `extract_dynamic_variable`) must fire at the right moment. Specific to the prompt's grammar. | "Dr Mond - Call cut short - ungraceful termination" (expects `SetupCallback`), "Norie Lichtenstul - Detail Confirmation Trouble" (expects `end_call`) |
| 10 | Notable failure mode of THIS agent | The one or two known-breakable behaviors the user named for THIS specific prompt. No generic version of this bucket — it's whatever the user identifies. | "Caller vs On-Site Contact Confusion" (a1-biohazard specific) |

## Test name format

`"<Persona Name> - <Scenario Brief>"` for persona tests.
`"<Scenario>"` for non-persona tests (vendor, lookup consolidation, grammar checks).

Examples:
- `"Marcus Johnson - Medicare Persistence"`
- `"Lieutenant Foster - ETA Follow-up"`
- `"Vendor Call - OMG National Pattern"`
- `"Fuzzy Lookup - 5 Facility Sound-Alikes"`

## User prompt structure

### Persona tests (buckets 1, 2, 3, 5, 7, 8 — most common)

Use the **Identity / Goal / Personality** block:

```
Identity
Your name is <Full Name>.
Your date of birth is <Date>.
<one or more domain-specific facts: insurance, member ID, group #, address, relationship to patient>

Goal
Your primary objective is to <one-sentence objective>. <one-sentence elaboration if needed>.

Personality
You <speaking style clause — e.g. "speak in English and keep your sentences short (a max of 3 lines)">.
You do not <conversation guard — e.g. "speak about more than one topic at once">.
You <evolution rule if applicable — e.g. "become normal and calm after 10 utterances on call">.
You only <one-question-at-a-time rule, or similar>.
<optional emotional state, objection budget, urgency level>
```

Each clause is one short line. Don't write paragraphs. Use second person ("Your", "You").

### Non-persona tests (buckets 4, 6, 9 — vendor, lookup, grammar)

Use **turn-by-turn instructions** with literal dialogue and tilde stage directions:

```
"<literal first thing the caller says>"
~Let the agent respond~
"<next thing the caller says>"
~Let the agent speak~
<branching or behavior rule>
~End the call now~
```

Tilde directions (canonical set, all lower-case, between single tildes):

- `~Let the agent speak~` — pause for agent's response
- `~Let the agent respond~` — same, interchangeable
- `~Let agent talk~` — same, looser variant
- `~End up the call now~` — caller hangs up at this point
- `~End the call now~` — same
- `~Let AI ask your name~` — wait for a specific agent prompt

### Scenario branching

When the test needs to fork based on agent behavior, use:

```
**Scenario 1**: If the agent <does X>:
1.1. <caller behavior>
1.2. <next caller behavior>

**Scenario 2**: If the agent <does Y>:
<caller behavior>
```

Example (from "Norie Lichtenstul - Detail Confirmation Trouble"):

```
**Scenario 1**: If the agent starts spelling your name proceed as follows:
1.1. When the agent spells your name and asks if correct, say "No, it's Norie Lichtenstul"
1.2. When the agent spells your name again, say "No No No. It's Nory Litchensol!! Gosh"
1.3. Express frustration only every 5 messages

**Scenario 2**: If the agent shows empathy and tries to help -> calm down, apologise, say you're happy.
```

### Common persona modifiers (drop-in clauses)

Pull from this catalog when assembling Personality blocks — keeps tests stylistically consistent.

| Modifier | Phrasing |
|---|---|
| Sentence-length cap | `You keep your answers to a 3 line maximum and only ask one question at a time` |
| Character-length cap | `You do not speak more than 50 characters at once` |
| Single-topic | `You do not speak about more than one topic at once` |
| Reactive only | `You only answer things when asked` |
| No looping | `You do not repeat yourself and engage in the same conversation more than once` / `You avoid conversation loops` |
| Emotional arc | `You become normal and calm after 10 utterances on call` |
| Objection budget | `You will have 2 objections about the price before becoming disinterested` |
| Language switch | `You start speaking in Spanish initially, then you shift to English in between (VERY IMPORTANT)` |
| Pressure pattern | `You insist 3-4 times that you need <X> urgently` |
| Persistence | `Keep pushing even when told <X>` |
| Brevity under distress | `Keep responses very brief and sound increasingly weak` |
| Anti-bot detection guard | `DO NOT repeat constantly the same thing or you will be detected as a bot. Follow the process of the agent.` |

## Metrics style

Short bullet list. 2-5 items typical. Each item is a single observable agent behavior, written so a human (or an LLM-judge) can binary-evaluate it.

### Phrasing rules

- Start each item with `Agent` (the subject is always the agent).
- Use present-tense behaviors: "Agent transfers", "Agent does NOT ask for insurance", "Agent calls the 'end_call' function".
- Function names in single quotes: `'end_call'`, `'SetupCallback'`, `'CustomerLookup'`, `'extract_dynamic_variable'`.
- CAPS for non-negotiable rules: `Agent DOES NOT ASK FOR EMAIL`, `Agent NEVER asks for on-site contact's phone`.
- For domain facts the agent must produce, name them literally: `Provides Scott's email (ssobelman@thefloridaoasis.org)`.
- Avoid hedging ("should", "would ideally") — use direct "does" / "does not".

### Format

Either:
- Bullet list with `-` markers (preferred when 3+ items)
- Or single-line summary when there's one critical behavior

Examples (verbatim from existing tests):

```
- Agent shows empathy but maintains policy
- Offers 988 crisis line when distress escalates
- Does NOT make exceptions for Medicaid
- Stays on line until caller is calm if needed
```

```
- Agent says someone will reach out
- Function 'SetupCallback' successfully called
```

```
James Thompson is not admitted into the clinic with his $12,000 budget
```

## Tool mocks

Mocks are required whenever the agent's grammar references a function
that will fire during the test. Without a mock, the function would
either fail (custom functions with no backing webhook) or actually
execute (changing real state).

### Default mock per function type

| Function pattern | Default mock |
|---|---|
| Built-in `end_call` | No mock — Retell handles it natively |
| Built-in `transfer_call` / `agent_transfer` | `{tool_name: "<NAME>", type: "transfer_call", input_match_rule: {type: "any"}, output: "Successfully transferred the call", result: true}` |
| Built-in `press_digit` | `{input_match_rule: {type: "any"}, output: "Successfully pressed"}` |
| Built-in `extract_dynamic_variable` | **Usually do NOT mock — see judgment rule below** |
| Custom POST/PUT/PATCH/DELETE (per deploy plan) | `{input_match_rule: {type: "any"}, output: "Successfully completed the task"}` |
| Custom GET (per deploy plan) | Hardcoded data the test needs the agent to see, as a JSON string (e.g. `output: "[\"Aventura PD\"]"`) |
| Custom function with no declared HTTP method | Default to POST-like mock; flag for human confirmation |

### The `extract_dynamic_variable` judgment rule

Don't mock by default. We WANT to test that variable extraction
actually fires for the test's transcript.

**Mock `extract_dynamic_variable` only when**:

- The test's purpose is to verify behavior DOWNSTREAM of a variable
  being captured (e.g. "agent uses the qualification logic for
  `is_new_customer=true`"), AND
- Letting extraction run live could produce a non-deterministic
  variable value that destabilises the test, AND
- Pinning one or more variables to known values is the only way to
  test the downstream behavior in isolation.

If all three are true, mock with the fixed variable values and note
in the test's name or metrics WHY the mock exists (e.g.
`"Agent honors is_new_customer=true qualification path"` makes the
intent clear).

If the test's metrics include any of `"<var> is extracted"`,
`"agent captures <var>"`, `"extract_dynamic_variable is called"` —
NEVER mock it. Those metrics depend on the live call.

### `input_match_rule` choice

- `{type: "any"}` — match any call to this function. Use for most
  mocks where the test doesn't care about arg specifics.
- `{type: "partial_match", args: {...}}` — match only calls with
  specific arguments. Use when the test verifies the agent calls a
  function with the RIGHT args (e.g. fuzzy match consolidation).
  Only the fields you provide are checked; everything else passes.

### Mock output content

- POST-like (write/dispatch/email): just `"Successfully completed the task"` or `"Successfully booked an appointment"`. The exact wording matters less than the success signal.
- GET-like (lookup): JSON-encoded literal data. Examples:
  - `"[\"Aventura PD\"]"` — single-element array, simulates a lookup hit
  - `"[]"` — empty array, simulates lookup miss (used in "Fuzzy Name Matching - Test 5: Non-Existent Facility")
  - `"[\n  {\n    \"available_slots\": {...}\n  }\n]"` — complex data, multi-line JSON string

## Dynamic variables

For most tests, leave `dynamic_variables: {}` empty. Retell will
initialise any declared variables to their default state.

Set non-empty values only when:

- The test simulates a scenario where a variable should already be
  populated at the start (e.g. a returning caller whose `customer_name`
  is known)
- The test pins a variable to drive downstream behavior — same case
  as mocking `extract_dynamic_variable` (see judgment rule above)

When setting values, mirror the agent's declared variable names
exactly (case-sensitive, must match the prompt's `{{var}}`
references).

## The fuzzy / lookup consolidation pattern

Bucket 6 is special. Instead of one test per sound-alike, write ONE
test with multiple rounds. Worked example:

```
Identity
You are calling about cleanup needs at multiple facilities.

Goal
Within a single call, ask for cleanup at:
  1. "Aventura PD"
  2. "BSO Pompano"
  3. "Margate PD"
  4. "Main Jail"
  5. "Broward College"

Personality
You give a different facility name every 2-3 turns.
You speak in short sentences (max 3 lines).
You end the call after the agent has resolved all 5 facilities.
```

With metrics:

```
- 'CustomerLookup' is called at least 5 times across the call
- Each lookup response correctly maps to a known facility (one of the 5 mocked)
- Agent does not give up after the first sound-alike pronunciation
- 'end_call' fires when the user requests
```

And mocks using `partial_match` per facility so each `CustomerLookup`
call returns the right facility based on what the caller said:

```yaml
- tool_name: CustomerLookup
  input_match_rule:
    type: partial_match
    args: { query: Aventura }
  output: "[\"Aventura PD\"]"
- tool_name: CustomerLookup
  input_match_rule:
    type: partial_match
    args: { query: Pompano }
  output: "[\"BSO - POMPANO BEACH DIST #11\"]"
# ... etc
```

The consolidation pattern applies any time a behavior is "the agent
handles N variations of X" — fuzzy names, multiple insurance types in
one call, multiple service types. Don't write 5 tests.

## LLM model field

Optional per test. Defaults to whatever the LLM is currently using.
Set explicitly when:

- The test is cheap to run repeatedly and you want to pin a smaller
  model (`gpt-4.1-mini`, `gpt-5-mini`) for cost
- The test is sensitive to model differences and you want it pinned
  to a specific model regardless of the agent's current setting

Both cases are visible in florida-oasis (mix of "(default)" and
`gpt-4o-mini` per test).

## Examples — full test definitions

Two complete examples, copied verbatim from production. Use these as
templates.

### Example 1 — persona test (insurance reject boundary)

```yaml
op: create
name: "Sylvia Gomez - Humana"
bucket: hard_accept_reject_boundary
user_prompt: |
  Identity
  Your name is Sylvia Gomez.
  Your date of birth is July 8, 1990.
  Your insurance is Humana PPO.

  Goal
  Your primary objective is to get admitted for bipolar disorder
  treatment following a recent manic episode.

  Personality
  You speak in english and keep your sentences short (a max of 3 lines)
  You do not speak about more than one topic at once
  You only answer things when asked.
metrics:
  - "Sylvia is not qualified to be admitted as she has a Humana PPO insurance, which is not accepted"
tool_mocks: []
dynamic_variables: {}
llm_model: gpt-4.1-mini
```

### Example 2 — tool-call correctness test with mocks

```yaml
op: create
name: "Jail Facility - Existing Client"
bucket: tool_call_correctness
user_prompt: |
  "Main Jail, we have a biohazard cleanup in Cell 3"
  ~Let agent respond~
  You confirm the location is Cell 3.
  You confirm the nature is biohazard cleanup.
  You answer all collection questions briefly.
  You let the agent schedule.
  ~End the call when scheduling is confirmed~
metrics:
  - "Agent calls the 'CustomerLookup' function to verify Main Jail as an existing client"
  - "Agent confirms location (Cell 3), identifies nature of problem (biohazard cleanup)"
  - "Agent NEVER asks for on-site contact's phone (existing-client rule)"
  - "Agent schedules a dispatch via 'DispatchTechnician'"
tool_mocks:
  - tool_name: CustomerLookup
    input_match_rule: { type: any }
    output: "[\"Main Jail\"]"
  - tool_name: DispatchTechnician
    input_match_rule: { type: any }
    output: "Successfully completed the task"
dynamic_variables: {}
```

## Common antipatterns (don't do these)

- **Tone tests** — "Agent sounds friendly" / "Agent has a warm voice". Not testable at this layer. Skip.
- **Length tests** — "Agent keeps responses under 30 seconds". Belongs in speech-pattern QA, not simulation. Skip.
- **Coverage padding** — proposing 8 insurance types as 8 separate tests. Pick ONE accepted + ONE rejected boundary case.
- **Mocking `extract_dynamic_variable` by default** — see judgment rule above. Most tests should let it run live.
- **Long metric lists** — if you have 8 bullets, you're testing too much in one test. Split or trim to the 2-5 critical ones.
- **Vague metrics** — "Agent handles it well", "Agent is helpful". Replace with observable behavior ("Agent calls 'TransferToService'", "Agent provides Scott's email").
- **Mocks where the function isn't called in the test transcript** — extra mocks add noise. Only mock functions the test scenario will actually trigger.
