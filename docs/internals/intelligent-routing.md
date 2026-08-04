# Intelligent agent and model routing

Phase 6 places a deterministic routing decision in front of the existing provider-session and
mission-run pipeline. It does not create another provider execution system. Provider instances,
adapters, thread sessions, mission scheduling, worktrees, verification, GitHub synchronization, and
memory retrieval keep their existing authority boundaries.

## Identity and evidence

`ProviderInstanceId` remains the executable provider identity. A routing provider profile is the
safe, credential-free routing view of that configured instance. Models use an internal stable ID and
the unique pair `(provider profile, provider model ID)`; a model name is never globally unique.

Model facts live in immutable capability snapshots. Every snapshot identifies its source as
provider-reported, official configuration, runtime probe, manual override, inferred, or unknown.
Unknown critical capabilities do not satisfy a requirement. Harness capabilities such as repository
tools and code editing are recorded separately from model capabilities such as vision, structured
output, reasoning controls, and context capacity.

Provider health is a bounded, expiring observation. A stale record is visible as stale evidence and
is not proof that a provider is currently available. Routing records never contain provider
credentials, authorization headers, secret environment values, or unrestricted provider config.

## Assessment and policy precedence

A task assessment records role, task type, complexity, privacy classification, required and
preferred harness/model capabilities, context estimate, and whether the assessment was deterministic,
inferred, or manually corrected. Complexity does not change permissions.

Policies resolve from most specific to least specific:

1. current explicit user pin;
2. task override;
3. mission override;
4. project policy;
5. agent-role profile;
6. environment-user policy;
7. global default.

The current local product has no durable user account aggregate, so user scope means the singleton
user of this environment. Auth sessions are not treated as user identities. Irreconcilable privacy,
provider, model, reasoning, or fallback requirements fail with the conflicting policy sources rather
than silently choosing one.

Migration 041 seeds an editable `Balanced automatic routing` global policy. It selects no named
provider or model, permits remote candidates subject to stricter inherited privacy, and allows at
most the coordinator's two compatible automatic fallback attempts. More-specific policies and pins
still win.

## Deterministic selection

Candidate filtering runs before scoring. It enforces provider/model enabled state, authentication and
availability, non-expired health, privacy and remote allowlists, required harness/model capabilities,
context capacity, requested reasoning, deprecation policy, and concurrency reservations. `local_only`
is an eligibility constraint; a remote candidate cannot outscore it.

Provider occupancy is counted across active runs. A model may also carry an administrator-set
maximum session count; when present, active runs using that exact provider/model identity consume
that separate limit. Unknown limits remain unknown rather than invented.

Eligible candidates receive a policy score composed from named preference facts such as project or
role preference, context headroom, local preference, health, latency class, and configured fallback
position. The score ranks policy fit, not objective intelligence. Stable provider/model IDs are the
final tie-breaker, so identical inputs always produce the same result.

Simulation invokes the same assessment, policy resolution, filtering, scoring, reasoning, context,
and fallback code without persisting a run or contacting a model.

## Immutable decisions and run creation

Routing is complete before `mission.start` is dispatched:

```text
task selected
  -> assessment and policy snapshot
  -> registry, capability, and health snapshot
  -> bounded candidate evaluation
  -> planned routing decision persisted
  -> reference-sized routing audit event committed
  -> decision applied and capacity reserved
  -> mission.start links the decision
  -> existing thread/provider pipeline
```

The run stores the routing decision ID and the applied model/reasoning selection. Capability, policy,
constraints, candidate reasons, and fallback plan remain immutable historical evidence. Metadata
refreshes affect new decisions only. A model change creates a new decision and normally a new run;
history is never rewritten to make one run appear to have switched models.

## Context and permissions

The route estimates core instructions, current task, required evidence, predecessor handoffs,
verification diagnostics, tools, selected memory, source excerpts, and output allowance. Optional
memory/source context may be reduced to a recorded budget. The task objective, system and safety
instructions, permission boundaries, verification requirements, and explicit user constraints are
never silently truncated.

For routed mission runs, the decision reserves the model's preferred working window for required
task context first and records the remaining optional-context token budget. Phase 5 retrieval reads
that decision: it caps memory and source excerpts to the remaining budget, or skips optional
retrieval when required context consumes the window. Hard model capacity is still checked before
execution, so this budgeting never makes an incompatible model eligible.

Routing selects execution settings only. Role permissions, worktree ownership, command policy,
repository scope, verification overrides, credential access, and GitHub mutation rights remain
controlled by their existing systems.

## Fallback, cancellation, and recovery

Fallback plans are ordered and bounded. They may retry the same model, select an alternate model on
the same provider, select an approved provider, select a compatible local provider, or stop. Every
step rechecks capability, privacy, pins, cancellation, health, concurrency, and its attempt budget.

Only typed provider/model execution failures are eligible for automatic fallback. Authentication,
permissions, unsafe requests, policy conflicts, cancellation, source-code defects, and verification
failures are not provider outages. Verification failures remain in the bounded repair workflow.

Cancellation terminalizes pending decisions and reservations before replacements can start. Restart
recovery preserves decisions and candidates, cancels or fails orphaned planned work honestly,
interrupts lost active runs through the existing mission recovery path, and never repeats a completed
routing attempt. A new explicit retry re-evaluates stale health and creates new historical evidence.

Cancellation requests are observed on a dedicated routing stream so a slow fallback preparation
cannot hide them behind its own event handler. The coordinator rechecks the live guard before
planning and dispatching a replacement; a request racing the final dispatch immediately cancels the
new run and records `routing.fallback_cancelled`.

## Phase 7 boundary

Each routed run records provider/model/reasoning, assessment class, start/completion state, fallback
and retry counts, verification reference, explicit override, and existing human acceptance state.
This is outcome evidence for future analysis, not a claim that one model is universally better. Phase
6 does not include billing retrieval, a cost dashboard, learned routing, policy self-modification,
model training, deployment automation, or autonomous merging.
