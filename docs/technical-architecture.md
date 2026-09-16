# Technical Architecture

Mini Coding Agent uses a small Ports and Adapters structure to keep the agent workflow explicit, provider-independent, and testable. The current implementation delivers read-only repository exploration and structured planning; state transitions, approval, writes, verification, and events will extend the same boundaries in later milestones.

## Architecture at a Glance

```mermaid
flowchart LR
    User --> CLI
    CLI --> ExploreRepository
    CLI --> CreateCodingPlan
    ExploreRepository --> ExplorationResult[RepositoryExploration]
    ExplorationResult --> CreateCodingPlan
    ExploreRepository --> LanguageModel
    CreateCodingPlan --> LanguageModel
    CreateCodingPlan --> PathInspector[RepositoryPathInspector port]
    ExploreRepository --> ToolRegistry
    LanguageModel --> OpenAIAdapter
    ToolRegistry --> ListFiles
    ToolRegistry --> ReadFile
    ToolRegistry --> SearchCode
    ListFiles --> Sandbox
    ReadFile --> Sandbox
    SearchCode --> Sandbox
    Sandbox --> Repository[(Local repository)]
    Sandbox -. implements .-> PathInspector
```

The dependency direction is inward:

```text
CLI and infrastructure adapters
              |
              v
application workflows and ports
              |
              v
domain schemas and results
```

Application code does not import the OpenAI SDK or Node filesystem adapters. Repository tool schemas are ports because they define the capability contract shared by the workflow and its adapters.

## Current Source Structure

```text
src/
  agent/
    application/
      CreateCodingPlan.ts
      ExploreRepository.ts
      ToolRegistry.ts
    domain/
      CodingPlan.ts
      ExplorationDecision.ts
      RepositoryPathPolicy.ts
      RepositoryExploration.ts
    ports/
      LanguageModel.ts
      RepositoryPathInspector.ts
      RepositoryTools.ts
      Tool.ts
    infrastructure/
      llm/
        OpenAILanguageModel.ts
      tools/
        code/
          SearchCodeTool.ts
        filesystem/
          ListFilesTool.ts
          ReadFileTool.ts
          RepositorySandbox.ts
          walkRepository.ts
  cli/
    main.ts
  main.ts
```

Tests mirror these boundaries under `tests/` and provide `tests/helpers/FakeLanguageModel.ts` for deterministic model behavior.

## Runtime Flow

### 1. CLI Composition

`src/cli/main.ts` is the composition root.

It:

1. Parses the goal and optional `--repo` path.
2. Confirms the repository exists and is a directory.
3. Resolves the repository's real path.
4. Creates one `RepositorySandbox`.
5. Registers the three read-only tools.
6. Creates `OpenAILanguageModel`, unless a model was injected by a test.
7. Runs `ExploreRepository`.
8. Renders the summary and relevant files.
9. Runs `CreateCodingPlan` with the same model and sandbox-backed path inspector.
10. Renders ordered tasks, file operations, expected outcomes, and verification strategy.

No dependency injection container or factory layer is used. Wiring remains visible because there are only a few dependencies.

### 2. Observe, Decide, Act

`ExploreRepository` runs a bounded loop:

```text
goal + previous observations
             |
             v
LanguageModel.generate(ExplorationDecisionSchema)
             |
             v
list_files | read_file | search_code | complete
             |
             v
ToolRegistry validates input and output
             |
             v
structured observation is appended
```

Only one action is allowed per model response. The loop stops when:

- the model returns a valid `complete` decision; or
- 12 decisions have been attempted, producing a controlled error.

### 3. Completion Validation

The workflow records every file returned by listing, reading, or searching. A `complete` decision is accepted only if each relevant path maps to a previously observed file.

This prevents a plausible but invented model path from becoming a trusted exploration result.

Windows comparisons are case-insensitive. Returned paths use the canonical casing observed from the filesystem tools.

### 4. Structured Planning

`CreateCodingPlan` sends the original goal and validated exploration result through `CodingPlanSchema`. The returned plan is normalized and checked before the CLI displays it.

Planning invariants are:

- task IDs are unique;
- each task references at least one file;
- one task cannot reference the same file twice;
- separate tasks cannot create the same path twice;
- plan path identity is case-insensitive on every platform to prevent non-portable collisions;
- `modify` targets must be relevant exploration results and still exist;
- `create` targets must not already exist;
- every path must be relative, portable, and outside restricted locations;
- the original user goal remains authoritative even if the model rewrites it.

The planner does not write files. These constraints define the candidate change set that human approval will consume in Milestone 4.

## Core Contracts

### Language Model

```ts
interface StructuredGenerationRequest<T> {
  schemaName: string
  schema: z.ZodType<T>
  instructions: string
  input: string
}

interface LanguageModel {
  generate<T>(request: StructuredGenerationRequest<T>): Promise<T>
}
```

The application supplies a Zod schema with every request. `OpenAILanguageModel` translates it to the Responses API through `zodTextFormat`, then validates the parsed response again before returning it.

The default model is `gpt-5.6`. `OPENAI_MODEL` can override it without changing application code.

### Structured Exploration Decision

OpenAI strict structured outputs require an object at the root. The decision is therefore wrapped:

```ts
{
  decision:
    | { action: 'list_files'; path: string }
    | { action: 'read_file'; path: string }
    | { action: 'search_code'; path: string; query: string }
    | {
        action: 'complete'
        relevantFiles: Array<{ path: string; reason: string }>
        summary: string
      }
}
```

The LLM does not return Markdown that must be manually parsed.

### Coding Plan

```ts
interface CodingPlan {
  goal: string
  tasks: Array<{
    id: string
    description: string
    files: Array<{
      path: string
      operation: 'create' | 'modify'
      reason: string
    }>
    verification: {
      expectedOutcome: string
    }
  }>
  verificationStrategy: string
}
```

The plan is a strict Zod object compatible with OpenAI structured outputs. File-level reasons make the future approval boundary reviewable without parsing free-form prose.

### Repository Path Inspector

`RepositoryPathInspector` exposes only `exists(relativePath)`. `RepositorySandbox` implements the port, allowing the planner to prevent `create` from overwriting an existing file without depending on filesystem infrastructure. For missing targets, the sandbox resolves the nearest existing ancestor so a new path cannot hide beneath an external or dangling symlink.

### Tool

```ts
interface Tool<TInput, TOutput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  execute(input: TInput): Promise<TOutput>
}
```

`ToolRegistry` owns the dynamic boundary where input is still `unknown`. It validates input, executes the selected tool, validates output, and returns a discriminated result.

```ts
type ToolResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: {
        code: 'unknown-tool' | 'invalid-input' | 'invalid-output' | 'execution-failed'
        message: string
        details?: unknown
      }
    }
```

Application workflows can observe expected tool failures without using exceptions as control flow.

## Read-Only Tools

| Tool | Input | Output | Default bounds |
| --- | --- | --- | --- |
| `list_files` | Relative directory path | Files, directories, truncation flag | 200 returned entries, depth 5, 800 inspected entries |
| `read_file` | Relative file path | Decoded text prefix and truncation flag | First 20,000 bytes |
| `search_code` | Relative directory and literal query | Path, line, text, truncation flag | 50 matches, 300 returned entries, up to 1,200 inspected entries, depth 8, first 64,000 bytes per file |

Search is a case-insensitive literal match, not a regular expression. A file is treated as binary only when its inspected prefix contains a NUL byte. Other byte sequences are decoded as UTF-8 and may contain replacement characters.

## Repository Sandbox

Every read-only tool shares one `RepositorySandbox` created from the selected root.

### Path Validation

The sandbox rejects:

- empty paths;
- POSIX and Windows absolute paths;
- any `..` segment;
- `:` segments, including Windows alternate data streams;
- paths whose real target is outside the repository;
- restricted names before and after `realpath` resolution.

Directory walking does not follow symbolic links. A direct read through a symlink is allowed only when its real target remains inside the root and is not restricted.

### Restricted Content

The explorer skips common sources of secrets, dependencies, generated output, and VCS metadata:

```text
.aws
.git
.git-credentials
.netrc
.npmrc
.pypirc
.ssh
.venv
coverage
dist
node_modules
vendor
venv
```

It also excludes:

- `.env` and `.env.*`, except `.env.example`;
- `id_rsa` and `id_ed25519`;
- files ending in `.key` or `.pem`.

Checks are case-insensitive so the policy also holds on Windows filesystems.

### Trust Boundary

The CLI is designed for repositories the user trusts and is authorized to send to the configured model provider.

The sandbox protects against deterministic traversal and symlink escapes. Node.js does not expose a portable descriptor-relative `openat` workflow, so it cannot fully prevent a malicious local process from replacing a validated path between validation and access. Concurrent adversarial filesystem mutation is outside the MVP threat model.

## Resource Bounds

Resource limits protect cost, latency, and context size:

| Resource | Limit |
| --- | --- |
| Model decisions per exploration | 12 |
| Listed entries | 200 |
| Listing depth | 5 |
| Inspected directory entries | 4 times the configured return limit |
| Direct file read | 20,000 bytes |
| Search matches | 50 |
| Search traversal | 300 returned entries, up to 1,200 inspected entries, depth 8 |
| Search content per file | 64,000 bytes |

When a traversal or content limit is reached, tools set `truncated: true`. Exploration can continue, but the model must reason from incomplete evidence.

The directory walker uses `opendir` streaming instead of loading an entire directory into memory. When an extreme directory exceeds the inspection limit, which entries appear before truncation can depend on filesystem iteration order.

## Error Handling

Errors are handled at two levels:

| Boundary | Behavior |
| --- | --- |
| CLI configuration | Throws a concise user-facing error and exits non-zero |
| Tool invocation | Returns a controlled `ToolResult` failure |
| Invalid LLM structure | Zod/OpenAI parse rejects the generation |
| Invented completion path | Adds `completion_rejected` observation and continues |
| Exploration limit | Throws a controlled limit error |
| Invalid plan structure | Zod/OpenAI parse rejects the generation |
| Unsafe or inconsistent plan path | Planning fails before approval or execution |

Later milestones will add an explicit `AgentState` with `failed` and `completed` states. The current read-only exploration and planning workflow has no full state machine yet.

## Testing Strategy

The test suite uses Vitest and does not make network calls.

### Model Boundary

`FakeLanguageModel` consumes a queue of predefined responses. It validates each response with the schema supplied by the application and records requests for assertions.

Covered behavior includes:

- queued response order;
- schema rejection;
- missing fake responses;
- OpenAI request mapping;
- missing structured output;
- OpenAI-compatible object-root decision schema.

### Tool Boundary

Tool tests use real temporary directories and files.

Covered behavior includes:

- listing and exclusions;
- bounded reads and the NUL-byte binary heuristic;
- path traversal rejection;
- case-insensitive secret restrictions;
- NTFS alternate data stream rejection;
- external symlink rejection;
- literal search and line numbers;
- registry input/output validation;
- controlled execution failures.

### Application Boundary

Application tests combine real or focused repository boundaries with `FakeLanguageModel`.

Covered behavior includes:

- sequential decisions;
- observations passed to the next decision;
- relevant-file collection;
- invented-path rejection;
- Windows path casing;
- finite positive step limits;
- termination at the configured maximum.

Planning coverage includes:

- OpenAI-compatible structured plan schema;
- canonical user goals and paths;
- unique task IDs and task-local file references;
- explored-file requirements for modifications;
- existence checks for modifications and creations;
- restricted, traversal, and non-portable path rejection;
- CLI rendering of ordered tasks and verification strategy.

### Verification Commands

```bash
npm test
npm run typecheck
npm run build
npm audit
```

## Design Decisions and Tradeoffs

### Explicit Loop Instead of Framework Orchestration

The loop is ordinary TypeScript so reviewers can see iteration, limits, observations, and tool selection directly. This costs some framework convenience but serves the educational goal.

### Full Observations Instead of Context Management

The current loop sends accumulated bounded observations back to the model. Context selection and summarization are intentionally deferred until there is evidence they are needed.

### Literal Search Instead of Regex or Ripgrep

Literal search avoids regex injection and external binary dependencies. It is less powerful and less scalable than ripgrep, which is acceptable for the initial language-neutral explorer.

### Full-Content Editing Later

The planned execution milestone will initially read current content, request complete updated content, generate a diff, and write within the sandbox. Patch-based editing remains a future experiment.

### No Full Agent State Yet

The current features have a bounded exploration workflow followed by one planning operation. Introducing every future state now would create unused abstractions. `AgentState`, transitions, approval, execution, and verification state belong to the milestones that exercise them.

## Planned Evolution

```mermaid
flowchart LR
    Explore --> Plan
    Plan --> Approval
    Approval --> Execute
    Execute --> Verify
    Verify -->|pass| Complete
    Verify -->|fail, attempts remain| Correct
    Correct --> Verify
    Verify -->|fail, limit reached| Failed
```

The remaining planned additions are:

1. Explicit agent state and valid transitions.
2. Human approval port and CLI adapter.
3. Sandboxed create and edit tools.
4. Diff generation and modified-file tracking.
5. Fixed `npm test` capability with three verification attempts.
6. Typed `AgentEvent` output through an `EventSink` port.

## Review Checklist

When the architecture changes, verify:

- Does application code still avoid provider and filesystem SDK details?
- Is every machine-consumed model response schema-validated?
- Is each new capability narrower than a generic command tool?
- Are path, byte, result, step, and retry limits explicit?
- Can the workflow be tested with `FakeLanguageModel`?
- Does the user guide match the real CLI?
- Are planned capabilities still labeled as planned?
