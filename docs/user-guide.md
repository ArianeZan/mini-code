# User Guide

Mini Coding Agent explores a trusted Git repository, generates a structured plan, requests human approval, applies approved changes, runs bounded tests, corrects failures when possible, and displays the final diff. It does not delete files, create commits, or accept arbitrary commands.

## Quick Path

1. Install dependencies with `npm install`.
2. Export `OPENAI_API_KEY` in your shell.
3. Run `npm run dev -- "your goal" --repo path/to/repository`.
4. Review the exploration summary, affected files, ordered tasks, and verification strategy.
5. Enter `y` or `yes` to execute; any other response cancels without writes.
6. If approved, review verification attempts, corrections, final status, modified files, and Git diff. Cancellation prints a confirmation and exits without a diff.

## Requirements

| Requirement | Minimum or expectation |
| --- | --- |
| Node.js | 20.19.0 |
| npm | Included with a supported Node.js installation |
| Git | A working tree containing the selected repository path |
| OpenAI API key | Required for model-driven exploration, planning, execution, and correction |
| Repository | Local, readable, executable, and trusted |
| Internet | Required only for OpenAI API calls |

The standard test suite does not require an API key or internet connection.

## Install from Source

Clone the repository and install locked dependencies:

```bash
git clone https://github.com/ArianeZan/mini-code.git
cd mini-code
npm install
```

Verify the installation:

```bash
npm test
npm run typecheck
npm run build
```

## Configure OpenAI

The CLI reads environment variables from the process. It does not automatically load a `.env` file.

### PowerShell

```powershell
$env:OPENAI_API_KEY="your-api-key"
$env:OPENAI_MODEL="gpt-5.6"
```

### Bash or Zsh

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_MODEL="gpt-5.6"
```

`OPENAI_MODEL` is optional. When absent, the adapter uses `gpt-5.6`.

Do not commit API keys. `.env` is ignored by Git, but this project intentionally does not load it automatically.

## Run from Source

Use the current directory as the repository:

```bash
npm run dev -- "Prevent users from registering with invalid email addresses"
```

Select another repository:

```bash
npm run dev -- "Add expiration handling to password reset tokens" --repo ../another-project
```

Use an absolute path when needed:

```powershell
npm run dev -- "Prevent registration with invalid email addresses" --repo "C:\Users\you\Projects\sample-app"
```

The `--` after `npm run dev` separates npm arguments from Mini Coding Agent arguments.

## Run the Built CLI

Build and execute the generated entry point:

```bash
npm run build
node dist/main.js "Add expiration handling to password reset tokens" --repo .
```

For local development, npm can expose the `mini-code` binary globally:

```bash
npm run build
npm link
mini-code "Add expiration handling to password reset tokens" --repo .
```

Rebuild after changing source files when using the linked binary.

## Command Reference

```text
mini-code [options] <goal>
```

| Argument or option | Required | Meaning |
| --- | --- | --- |
| `<goal>` | Yes | Natural-language description of the coding change to explore and plan |
| `--repo <path>` | No | Repository root; defaults to the current working directory |
| `-h, --help` | No | Display CLI help |

Examples:

```bash
mini-code "Reject invalid email addresses during registration"
mini-code "Add expiration handling to password reset tokens" --repo ../api
mini-code "Reject invoices with negative totals" --repo ../billing-service
```

## Writing a Useful Goal

Good goals describe a concrete behavior change and its domain context:

```text
Prevent users from registering with invalid email addresses
```

```text
Add expiration handling to password reset tokens
```

```text
Reject invoices whose line items produce a negative total
```

Avoid goals that assume a path the agent has not discovered:

```text
Read src/foo/bar.ts
```

The current release can plan implementation-oriented goals:

```text
Add email validation and update the tests
```

Treat the proposed plan as untrusted model output. Entering `y` or `yes` authorizes every listed `create` and `modify` operation. Any other response cancels cleanly before execution.

## Understanding the Output

A typical session looks like:

```text
Mini Coding Agent
[14:32:01] Goal received: Prevent users from registering with invalid email addresses (C:\Projects\sample-app)
[14:32:01] Exploring repository
[14:32:02] Tool started: list_files
[14:32:02] Tool completed: list_files
[14:32:03] Exploration completed: 2 relevant file(s)
[14:32:03] Creating coding plan
[14:32:05] Plan created: 2 task(s)
[14:32:05] Approval requested
Registration is handled by the users application module and covered by its tests.
Relevant files:
- src/users/RegisterUser.ts: Contains the registration workflow.
- src/users/RegisterUser.test.ts: Verifies registration behavior.
1. Introduce validated email values [task-1]
   - create src/users/Email.ts: Represent a validated email address.
   - modify src/users/RegisterUser.ts: Validate input before registration.
   Expected outcome: Invalid email addresses are rejected.
2. Cover invalid registration [task-2]
   - modify src/users/RegisterUser.test.ts: Document invalid-email behavior.
   Expected outcome: Registration tests cover valid and invalid addresses.
Verification strategy: Run the registration unit tests.
Proceed? [y/N] y
[14:32:12] Plan approved
[14:32:12] Executing approved plan
[14:32:12] Task started: task-1 - Introduce validated email values
... tool events omitted ...
[14:32:15] File created: src/users/Email.ts
[14:32:15] File modified: src/users/RegisterUser.ts
[14:32:15] Task completed: task-1
[14:32:15] Task started: task-2 - Cover invalid registration
... tool events omitted ...
[14:32:18] File modified: src/users/RegisterUser.test.ts
[14:32:18] Task completed: task-2
[14:32:19] Running tests: attempt 1
[14:32:24] Tests failed: attempt 1
... tool events omitted ...
[14:32:28] Correction proposed after attempt 1: 1 file(s)
... tool events omitted ...
[14:32:28] File modified: src/users/RegisterUser.ts
[14:32:28] Correction applied after attempt 1: 1 file(s)
[14:32:28] Running tests: attempt 2
[14:32:33] Tests passed: attempt 2 (5000 ms)
[14:32:34] Final diff generated: 1842 bytes
[14:32:34] Agent completed
Agent status: completed
Completed tasks: task-1, task-2
Modified files: src/users/Email.ts, src/users/RegisterUser.ts, src/users/RegisterUser.test.ts
Verification: passed after 2 attempt(s)
Correction analysis after attempt 1: The invalid-email branch returned instead of throwing.
Final diff:
diff --git a/src/users/RegisterUser.ts b/src/users/RegisterUser.ts
...
```

The output contains:

| Section | Meaning |
| --- | --- |
| Goal | The exact goal passed to the CLI |
| Repository | The resolved real path being explored |
| Timestamped events | Live phase, tool, task, file, verification, correction, diff, and terminal progress |
| Summary | The model's concise interpretation of the discovered evidence |
| Relevant files | Only files observed through a registered tool |
| Reason | Why each file appears related to the goal |
| Plan tasks | Ordered implementation steps with nonempty, plan-local unique IDs |
| File operation | Whether a task expects to create or modify a path |
| Expected outcome | The behavior that should hold after each task |
| Verification strategy | How the completed change should be checked |
| Agent status | Whether approved execution completed or failed; cancellation prints a separate confirmation |
| Modified files | Files successfully written before completion or failure |
| Verification | Whether tests passed and how many attempts ran |
| Correction analysis | Model analysis after a failed attempt; rejected proposals may modify no files |
| Final diff | Bounded Git diff against `HEAD`, scoped to the selected path, including staged, unstaged, and non-ignored untracked content |

The model can complete with no relevant files when the available evidence does not identify a match.

The planner may propose new files, but it cannot classify an existing path as new. Modifications are limited to files identified by exploration. Paths outside the repository, restricted locations, and non-portable Windows names are rejected before display.

New files can only be created when their immediate parent directory already exists. The agent has no directory-creation capability.

During execution, the model must return complete content for exactly the approved files and operations. Extra files, missing files, repeated files, and operation changes are rejected before that task writes.

After execution, the agent runs `npm test`. If it fails, the model may edit a subset of approved files and tests run again. The third failed test run ends the workflow without another correction.

## What the Agent Reads

The model chooses among three capabilities:

| Capability | Behavior |
| --- | --- |
| `list_files` | Lists a bounded repository subtree |
| `read_file` | Decodes a bounded file prefix as UTF-8 |
| `search_code` | Finds a case-insensitive literal string in bounded decoded file prefixes |

The agent can make at most 12 model decisions during one exploration.

The tools apply a fixed, filename-based denylist for common credential locations, dependencies, generated output, and VCS metadata. This does not detect arbitrary secrets in source files or unknown filenames. Files whose inspected prefix contains a NUL byte are treated as binary; other byte sequences are decoded as UTF-8. See [Technical Architecture](technical-architecture.md#repository-sandbox) for the exact policy.

## Privacy and Safety

Repository content returned by `read_file` or `search_code` can be sent to OpenAI as part of the next decision context.

Before running the CLI:

- confirm you are authorized to inspect the repository;
- understand your organization's model-provider policy;
- remove sensitive material that is not covered by the built-in exclusions;
- avoid repositories controlled by an untrusted local process;
- review OpenAI data-handling settings applicable to your account.
- use a clean branch or otherwise preserve work you cannot afford to lose;
- read every task and file operation before approving.

The restricted-path policy is defense in depth, not a data-loss-prevention product.

Event payloads do not include file contents or raw test output. Console events are best-effort process output, not a durable audit log.

Approved tasks execute sequentially. A task with multiple files is not transactional: if a later write fails, earlier writes remain and are reported. The agent does not automatically roll back changes. Atomic edits preserve basic mode bits, but replacement may not preserve ownership, ACLs, or extended attributes on every filesystem.

Running `npm test` executes repository-controlled code. Only run the agent against repositories you trust to execute locally. Each attempt has a 120-second timeout and a 200 KB combined output limit. Resistant descendant processes may survive termination on Windows, so the timeout is a workflow bound rather than a hostile-code sandbox.

The current agent cannot:

- accept or execute an arbitrary shell command;
- run any test command other than the repository's fixed `npm test` script;
- delete files;
- mutate Git state;
- push code;
- create pull requests.

## Troubleshooting

### `OPENAI_API_KEY is required`

The key is not available in the process running the CLI.

Set it in the same shell before running the command:

```powershell
$env:OPENAI_API_KEY="your-api-key"
npm run dev -- "Find authentication" --repo .
```

### `Repository path does not exist`

Check the value passed to `--repo`. Relative paths are resolved from the current working directory.

```bash
npm run dev -- "Find authentication" --repo ../correct-path
```

### `Repository path is not a directory`

`--repo` points to a file. Pass the directory containing the repository instead.

### Git validation fails

The selected path must be inside a Git working tree. Git is validated before any model call or file write.

```bash
git -C path/to/repository status
```

Initialize or select the correct repository before retrying.

### `Repository exploration exceeded 12 steps`

The model did not complete within the safety limit.

Try a narrower goal with recognizable domain terms:

```text
Find the RegisterUser use case and its tests
```

Do not increase the limit as a first response. A repeated failure may indicate that tool results are truncated or the repository is too broad for the current exploration strategy.

### Relevant files are incomplete

The current tools intentionally limit traversal, read size, and search results. Narrow the goal or run the agent against a smaller repository subtree if it is a separate repository root.

### A file is not visible

The file may be:

- outside the repository root;
- inside an excluded dependency, VCS, build, virtual-environment, or credential path;
- a symbolic link;
- detected as binary because the inspected prefix contains a NUL byte;
- beyond a traversal limit.

These exclusions cannot currently be overridden from the CLI.

### Model or API errors

Confirm:

- the API key is valid;
- the selected model is available to the account;
- the machine has internet access;
- the provider accepts the structured-output schema.

Try removing `OPENAI_MODEL` to return to the documented default.

### Execution fails after modifying files

Review `Modified files`, `Failure`, and `Final diff`. Multi-file tasks do not roll back earlier successful writes. Resolve or revert changes manually before running the agent again.

### Tests still fail after three attempts

The agent applies at most two corrections. Review `Failure`, `Last test output`, correction analyses, modified files, and the final diff. Fix or revert the remaining issue manually before another run.

### Test execution times out or truncates output

The attempt fails when `npm test` exceeds 120 seconds or 200 KB of combined output. Reduce hanging or noisy tests before retrying. These bounds cannot currently be changed through the CLI.

## Development and Offline Tests

Normal tests use `FakeLanguageModel`, so they are fast and deterministic:

```bash
npm test
```

Additional checks:

```bash
npm run typecheck
npm run build
npm audit
```

The project's own standard verification commands do not call OpenAI. The running agent may call OpenAI to analyze a failed target-repository test run.

## Current Limitations

- Exploration context is accumulated without summarization.
- Search is literal and does not support regular expressions.
- Exploration uses a fixed set of read-only tools.
- Write capability is limited to approved create and full-content edit operations in existing directories.
- There is no persistent session or memory.
- Test execution is fixed to `npm test`; other package managers and commands are unsupported.
- Corrections use complete file content rather than patches and remain non-transactional.
- Events are not persisted and currently have no run ID, replay, or external telemetry backend.

Follow the [Roadmap](../README.md#roadmap) for planned capabilities.
