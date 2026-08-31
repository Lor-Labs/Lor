# Playbooks — exploratory product and architecture note

> Status: working idea, not a locked implementation spec. This document is
> intended to preserve the current product model so it can be challenged and
> refined when implementation begins.

## Thesis

A Playbook is Lor's versioned definition of an outcome Merlin knows how to own
for the team.

It should be a thin orchestration layer over Lor's existing primitives, not a
new execution engine or a rigid workflow builder. Its job is to organize
triggers, tools, permissions, context and execution primitives into one reusable
capability that Merlin can propose, execute and improve.

The desired product feeling is not "the user built a workflow." It is:

> Merlin noticed how our team works, proposed a way to take some of that work
> over, safely configured itself after we approved it, and got better when we
> corrected it.

## How it maps onto the existing product

| Primitive | Responsibility |
|---|---|
| Trigger or Loop | When should something begin? |
| Playbook | What outcome should Merlin own, and under what constraints? |
| Task | One instance of that outcome being pursued |
| Agent Run | One execution attempt within the Task |
| Tools | What can Merlin do? |
| Approval policies | What authority does Merlin have? |
| Channel | Where does the team observe and participate? |
| Artifacts | What did the work produce? |
| Change proposal | How can Merlin safely update the configuration? |

Example:

> A Sentry webhook invokes the Incident Response Playbook. Lor creates an
> investigation Task in `#health`. Merlin performs Runs using Sentry and GitHub
> tools, stops at configured engineering approval gates, and produces an
> investigation artifact and possibly a draft pull request.

The Playbook does not execute the work. It tells Lor how to assemble and
configure the primitives that already do.

## Why this is still a data model

Most of the product experience can be created by cleverly organizing what Lor
already has. A small durable model is still required so Lor can:

- refer to a learned capability as one thing;
- activate, pause or retire it as one thing;
- show what it can access and who must approve its actions;
- attach manual, scheduled and event-driven triggers to the same behavior;
- propose a new version and explain why;
- approve or reject an exact version without races;
- roll back a bad change; and
- record which version produced a Task, Run and artifact.

Without that identity, the same behavior remains duplicated across Loop
instructions, webhook instructions, Task goals and tool settings. Merlin could
suggest edits to those pieces, but it could not coherently say "I can learn,
run and improve this process."

## The model should be thin

Conceptually:

```text
Playbook
- identity
- workspace
- name
- lifecycle status
- current active version

Playbook Version
- outcome
- flexible agent instructions
- completion and escalation conditions
- trigger bindings
- tool/capability references
- approval policy references
- destination/visibility configuration
- source Tasks and Runs
- rationale for this version
```

Tasks and Runs should record the exact Playbook version that caused them. The
implementation may normalize some of the references into separate tables; the
important product boundary is the versioned aggregate, not this tentative
storage shape.

### Structured shell, flexible core

The structured fields should describe intent and boundaries:

- desired outcome;
- activation conditions;
- available tools and context;
- authority and approval requirements;
- expected outputs;
- completion, failure and escalation conditions; and
- where the work should be visible.

The execution instructions can remain flexible and goal-oriented. Do not begin
with a BPMN/Zapier-style graph of mandatory steps. Merlin should be free to
determine the appropriate steps for a particular execution while staying
inside the Playbook's contract.

## Relationship to Loops and event triggers

Today a Loop or event trigger can own both **when** Merlin runs and **what** it
should do. A Playbook creates a useful separation:

- the trigger owns **when**;
- the Playbook owns **what outcome and constraints**; and
- the Task and Runs own **this particular execution**.

The same Playbook could therefore be invoked manually, by a schedule, by a
webhook or by another Playbook without duplicating its instructions and
authority configuration across every activation source.

This does not require immediately rewriting Loops and triggers. The first
implementation can compose them, then converge their standing instructions
behind Playbook references when the model has proven useful.

## The self-evolving loop

1. Lor observes several similar completed Tasks and Runs.
2. Merlin identifies the common outcome, tools, corrections, decisions and
   human handoffs.
3. Merlin proposes taking the work over and cites the prior examples as
   evidence.
4. The proposal shows the Playbook and any workspace changes required to make
   it possible: tool grants, approval rules, triggers, channels, webhooks or
   instructions.
5. The team edits, tests and approves the proposal.
6. Future activations execute publicly through the normal Task and Run system.
7. Merlin compares actual executions with the active version and proposes an
   update when the team corrects it or a better configuration becomes clear.

Merlin must never silently widen its authority or change active behavior.
Learning produces a versioned proposal, not an immediate mutation.

## Intended UX

The primary entry point should be a recommendation, not an empty workflow
builder:

> **I can take this over**
>
> Your team has investigated this type of production error four times. I can
> handle the initial investigation, reproduce the issue, propose a fix and ask
> the engineering owner to review it.

The proposal should answer:

- Why is Merlin suggesting this? Link to the prior work.
- What outcome will Merlin own?
- What will happen when it activates?
- What workspace configuration will be added or changed?
- What new access is required?
- Who will approve consequential actions?
- Where will the team watch and participate?
- How can the team test it before activation?

An explicit "learn this process" action can make the first version easier to
develop and test. High-confidence proactive suggestions create the launch
moment. Both should produce the same proposal object.

"Playbook" can remain the internal name even if the active user-facing object
is eventually called an Automation, Routine or Capability. Avoid "learned
skill" if it would conflict with Lor's uploaded Skill files.

## Safe self-configuration

Self-configuration should be split into two levels.

### Early: configure existing primitives

Merlin can propose a versioned change set that creates or updates supported
resources:

- a Playbook;
- a Loop or event trigger;
- a channel or webhook;
- tool grants;
- approval policies; or
- workspace instructions.

The team reviews an understandable diff, approves all or part of it, and can
roll it back. This generalizes the proposal/approval model already used for
workspace instructions.

### Later: create new primitives

When the existing workspace cannot accomplish the outcome, Merlin can propose
new custom tools, MCP integrations, generated connectors, specialist agents or
other software. These additions still enter the workspace through the same
versioned proposal, permission and approval system.

## Recommended implementation order

1. Enforce permission and approval policies at the tool/action layer. Approval
   must be execution physics, not something Merlin remembers to request.
2. Generalize versioned workspace change proposals enough to safely create or
   update existing configuration primitives.
3. Define the thin Playbook identity/version contract and link executions to an
   exact version.
4. Ship one narrow end-to-end "I can take this over" vertical slice: evidence
   from prior Tasks, proposal, test execution, approval and activation.
5. Bind accepted Playbooks to existing manual, Loop and event-trigger paths.
6. Use completed executions and team corrections to propose new versions.
7. Add high-confidence repeated-work detection and proactive proposals.
8. Expand self-configuration into generated tools and other new capabilities.

A viewable persistent browser/computer is an additional execution capability,
not a prerequisite for proving this model. Add it when an important Playbook
cannot be completed through Lor's existing tools, connectors and sandboxes.

## First vertical slice candidate

Incident response is a strong test because it exercises the multiplayer and
authority model rather than merely replaying a personal task:

1. Similar production errors have been investigated several times.
2. Merlin proposes an Incident Response Playbook and cites those investigations.
3. The proposal configures the existing error trigger, `#health`, Sentry and
   GitHub access, the investigation outcome, and the engineering approval rule.
4. The team runs a test event and watches the resulting Task.
5. After activation, an error starts the Playbook automatically.
6. Merlin investigates, creates artifacts or a draft PR, and asks the correct
   person before any approval-gated action.
7. Corrections made during the Task become evidence for a proposed new version.

## Open questions for implementation time

- What is the user-facing name: Playbook, Automation, Routine or Capability?
- Is the version manifest relational, JSON, or a hybrid?
- Do triggers bind to a Playbook identity and always use its current version,
  or are some triggers pinned to an exact version?
- Which existing configuration changes can be applied atomically in the first
  version?
- How should partial approval work when a proposal contains several related
  changes?
- Does activation require a successful test Run?
- How are tool permissions snapshotted so an in-flight execution cannot gain
  authority from a later configuration edit?
- What evidence threshold is required before Merlin proactively suggests a
  Playbook?
- How should the team distinguish a correction for one execution from a
  durable correction to the Playbook?
- Should a Playbook always create a Task, or can small executions remain
  headless while still retaining equivalent provenance and visibility?

