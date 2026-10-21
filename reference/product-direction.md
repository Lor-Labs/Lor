# Product direction: From multiplayer AI workspace to self-evolving software

## MVP — Multiplayer AI workspace

Prove that humans and agents can work together inside one persistent, shared environment.

- Company memory with grounded answers
- Pi-powered codebase investigation
- Persistent artifacts and shared agent work
- Voice channels with captured conversation context and grounded memory
- Channels, threads, notifications, and mobile access
- High-value native integrations
- Approval flows for consequential agent actions

### Current feature priority — 2026-09-24

Build voice channels and conversation memory first; add live voice interaction
with Lor afterward. The guiding scope, phases, and open decisions live in
[`voice-channels.md`](./voice-channels.md).

Code sessions remain a future direction. Their product shape (a Code mode for
sessions in any channel, decided 2026-10-21) and target architecture are
recorded in [`code-channels.md`](./planned/code-channels.md).
Direct multiplayer document editing, including shared cursors and comments,
also remains part of the broader vision but is not a prerequisite for this phase.
These priorities do not set a public launch date or imply native voice is built.

## V2 — Self-evolving workspace

Allow each workspace to generate and evolve software around how its company operates.

### Multiplayer-generated apps

- Build small internal apps from conversation and company context
- Give each app durable data, a generated interface, and realtime collaboration
- Let teams modify apps conversationally as their workflows change

### Agent-built tools and integrations

- Build connectors for services Lor does not support
- Make generated tools available to agents, workflows, and apps
- Keep credentials and permissions securely governed by Lor

### Self-configuring agents

- Create workspace-specific skills, behaviors, and specialist subagents
- Let teams customize agents through conversation
- Keep changes shared, versioned, reviewable, and reversible

## Product thesis

Most company-brain products stop at retrieving information. Lor should use company memory to help teams act, collaborate, and eventually create the software they need.

**MVP:** a multiplayer workspace where humans and memory-backed agents work together.

**V2:** a multiplayer workspace that generates and evolves its own tools, agents, integrations, and applications.

The MVP should not build the full v2 platform, but its artifacts, permissions, secrets, tools, memory, and realtime systems should have clean boundaries that leave this direction open.

The post-Pi durable agent harness is built; as-built reference in [`agent-harness.md`](./agent-harness.md).
