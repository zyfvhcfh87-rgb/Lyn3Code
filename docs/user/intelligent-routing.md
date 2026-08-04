# Intelligent agent and model routing

Lyn Code can select a provider, model, and reasoning level for a mission task from the task's actual
requirements. The selection is explainable and can be simulated before an agent starts.

Open **Settings → Routing** to inspect configured provider and model identities, capability sources,
health, defaults, policies, fallback chains, and temporary overrides. Credentials stay in provider
settings and are never shown in routing records.

New installations begin with an editable **Balanced automatic routing** policy. It does not choose
a vendor for you; it ranks compatible configured models and allows a short, compatible fallback
only when no stricter policy or pin disables it.

## Automatic routing

Automatic routing evaluates required tools and modalities, context size, privacy, provider health,
availability, reasoning support, role defaults, and current concurrency. It filters incompatible
models before ranking eligible alternatives. `Unknown` means Lyn Code does not have trusted evidence
for that capability; it is not treated as supported.

Provider session limits and optional per-model session limits stop new tasks from selecting capacity
that is already full. You can edit a model's session limit in **Settings â†’ Routing â†’ Models and
capabilities**.

The routing explanation shows:

- the selected provider, model, reasoning level, and decision type;
- required and preferred capabilities;
- policies and privacy constraints that applied;
- alternatives considered and concise rejection reasons;
- the allowed fallback chain;
- reroutes or model changes as separate historical decisions.

## Pins and privacy

A provider, model, reasoning level, privacy policy, or fallback chain that you explicitly pin wins
over automatic preferences. If a pin is unavailable or lacks a required capability, the task stops
with an actionable conflict. Lyn Code does not silently replace or downgrade a pin.

`local_only` excludes every remote provider, including during fallback. If no compatible local model
exists, routing stops and explains what capability or context requirement could not be met.

Selecting a stronger model never grants broader file, command, worktree, repository, credential,
verification, or GitHub permissions. Those permissions continue to come from the mission role and
project policy.

## Simulation and fallback

The simulator uses the real routing engine with a proposed role, task, complexity, privacy class,
capabilities, context estimate, and optional pins. Simulation does not contact a model or start an
agent.

When a selected model has limited working context, Lyn Code reserves room for the required task
first. Optional project memory and source excerpts are capped to the remaining recorded budget—or
omitted when there is no safe room. The task itself is never silently shortened to make a model fit.

Automatic fallback is conservative and bounded. It is available only for recognized temporary
provider or model execution failures and only when the active policy allows it. A failing test or a
source-code bug stays in the verification/repair workflow; it does not automatically switch models.

Routing history survives restart. An interrupted run stays interrupted, its original decision remains
visible, and an explicit retry or reroute creates a new decision.

Cancelling a task also stops automatic fallback preparation. If cancellation races the final start,
the replacement run is cancelled immediately and the cancelled attempt remains in routing history.
