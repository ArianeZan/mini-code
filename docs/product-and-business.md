# Product and Business Context

Mini Coding Agent is an educational coding agent that demonstrates how autonomous software workflows can be designed safely, tested deterministically, and explained clearly.

It is a portfolio product rather than a commercial replacement for established coding agents. Its value comes from making the internal engineering visible.

## Product Summary

| Topic | Definition |
| --- | --- |
| Target product | A CLI agent that progressively explores, plans, modifies, and verifies changes in a local repository |
| Primary user | Software engineers learning or evaluating agentic system design |
| Primary value | A compact, inspectable reference implementation of a coding-agent workflow |
| Current release | Package version `0.1.0`: complete V0.4 workflow with typed console observability |
| Interface | Local command-line application |
| Model provider | OpenAI through a provider-independent port |
| Business model | Open-source portfolio and learning project; no monetization is assumed |

## The Problem

Coding-agent demos often have one of two limitations:

- They are too small: one prompt produces code, but there is no agent loop, state, tool boundary, or verification.
- They are too large: a framework or production platform hides the decisions that a learner or reviewer wants to understand.

This makes it difficult to evaluate whether an engineer understands the underlying concerns:

- capability boundaries;
- structured model decisions;
- explicit workflow state;
- human approval;
- safe filesystem access;
- deterministic tests;
- bounded retries;
- operational visibility.

Mini Coding Agent fills the space between a toy completion and a production platform.

## Target Audiences

### Learners

Developers who want to study a complete agent loop without first learning an agent framework.

Their desired outcome is to follow the code from user goal to model decision, tool execution, observation, and final result.

### Engineering Reviewers

Hiring managers, technical interviewers, and senior engineers evaluating practical knowledge of AI application engineering.

Their desired outcome is to verify architecture, tradeoffs, security thinking, and testing quality from a repository that remains small enough to review.

### Experimenters

Engineers who need a controlled baseline for trying alternative models, editing strategies, context policies, or evaluation approaches.

Their desired outcome is to replace one adapter or workflow phase without adopting a large platform.

## Value Proposition

Mini Coding Agent demonstrates that an agent is a software system, not only a prompt.

The project provides:

- explicit control flow that can be read in one application service;
- Zod-validated decisions at every machine-consumed LLM boundary;
- tools with narrow capabilities instead of arbitrary shell access;
- repository sandboxing and bounded reads;
- fake model responses for fast, offline tests;
- incremental milestones where each release remains understandable;
- documentation that distinguishes current capabilities from planned ones.

## Product Principles

| Principle | Product consequence |
| --- | --- |
| Explicit over magical | The agent loop and transitions remain visible in application code |
| Least capability | Each tool exposes one narrow operation |
| Human authority | Write operations require an approved plan before execution |
| Machine-readable decisions | LLM outputs consumed by code use strict schemas |
| Bounded autonomy | Every loop has a fixed limit and controlled failure |
| Provider independence | Core workflow code depends on `LanguageModel`, not the OpenAI SDK |
| Testability | Normal tests never require a network or paid API |
| Honest documentation | Roadmap items are never presented as shipped features |

## Current User Journey

The current release supports this journey:

```text
Describe a coding goal
        |
        v
Select a trusted local repository
        |
        v
Agent lists, searches, and reads bounded content
        |
        v
Agent returns relevant files and reasons
        |
        v
Agent returns ordered tasks and verification strategy
        |
        v
User approves or cancels
        |
        +---- cancel ----> Agent exits without writes
        |
        +---- approve ---> Agent applies approved file operations
                                  |
                                  v
                           Tests run up to three times
                                  |
                         pass ----+---- fail with attempts left
                           |                 |
                           v                 v
                     Final diff       Approved-file correction
```

This is the completed V0.4 functional journey:

```text
Explore -> Plan -> Approve -> Execute -> Verify -> Correct or Finish
```

## Scope

### MVP Outcomes

V0.4 is the completed functional milestone; the npm package remains versioned `0.1.0`. The MVP can:

1. Understand a repository-level coding goal.
2. Identify relevant files through tools.
3. Produce an ordered, structured plan.
4. Obtain explicit human approval.
5. Apply only approved file changes.
6. Run a fixed test capability.
7. Analyze failures across at most three total test attempts and two corrections.
8. Finish with a diff and a controlled success or failure summary.

### Intentionally Out of Scope

- arbitrary command execution;
- multi-agent orchestration;
- IDE and GitHub integrations;
- persistent memory or vector search;
- automatic pushes or pull requests;
- broad language-specific intelligence;
- production tenancy, billing, or access control;
- a web frontend.

## Differentiation

This project does not compete on the number of integrations or model benchmarks. It differentiates on reviewability.

| Alternative | Typical strength | Mini Coding Agent focus |
| --- | --- | --- |
| One-shot coding demo | Very small implementation | Real loop, tools, and validation |
| Agent framework tutorial | Fast orchestration | Framework-free mechanics |
| Production coding agent | Broad capability | Small, inspectable architecture |
| Generic automation bot | Flexible commands | Restricted coding-specific tools |

## Success Measures

The project uses engineering and portfolio measures rather than revenue metrics.

| Measure | Target |
| --- | --- |
| Reviewability | A reviewer can locate the loop, ports, tools, and safety policy quickly |
| Determinism | Standard tests make zero external API calls |
| Safety | No generic shell or destructive Git capability exists in the MVP |
| Workflow correctness | State transitions, approval, sequential execution, and retry limits are tested |
| Reproducibility | A sample repository demonstrates the end-to-end goal |
| Documentation | Product, technical, and user documentation match every milestone |
| Build health | `npm test`, `npm run typecheck`, and `npm run build` pass |

## Risks and Responses

| Risk | Response |
| --- | --- |
| LLM returns invented paths | Accept relevant files only after a tool has observed them |
| Repository content contains secrets | Exclude common secret locations and document the trusted-repository boundary |
| Agent loops indefinitely | Enforce explicit step and retry limits |
| Provider API changes | Isolate the SDK in `OpenAILanguageModel` |
| Tests become slow or costly | Use `FakeLanguageModel` and temporary local repositories |
| Scope expands into a platform | Keep exclusions and milestone acceptance criteria explicit |
| Documentation overpromises | Label every capability as available, next, or planned |

## Delivery Roadmap

| Milestone | User-visible outcome | Status |
| --- | --- | --- |
| 1. Bootstrap | The CLI and core contracts run and can be tested | Complete |
| 2. Repository exploration | The agent identifies likely relevant files without writing | Complete |
| 3. Planning | The user sees an ordered plan and verification strategy | Complete |
| 4. Approval and execution | The user approves before bounded file changes | Complete |
| 5. Verification | The agent tests and performs limited self-correction | Complete |
| 6. Observability | Typed events expose workflow progress | Complete |
| 7. Portfolio polish | A reproducible demo and finished narrative are available | Next |

## Product Decisions

### Why a CLI?

A CLI keeps the interaction close to the repository and avoids spending the first version on UI concerns. It also makes the behavior easy to script and demonstrate.

### Why no agent framework?

The portfolio objective is to demonstrate understanding of loops, state, tools, and transitions. A framework would reduce implementation time but hide the most relevant learning.

### Why one agent?

The workflow does not yet justify coordination overhead. Planner and builder agents may become an experiment after the single-agent behavior is measurable and stable.

### Why OpenAI behind a port?

The current product needs one working provider, but the application should not encode provider-specific requests. This keeps future adapters and deterministic tests feasible.

## Documentation Ownership

Documentation is part of each work unit, not a final cleanup task.

For every milestone:

1. Update the capability and roadmap tables.
2. Update technical contracts and limits that changed.
3. Update user commands and output examples.
4. Record new safety assumptions or accepted risks.
5. Verify all documented commands before committing.
