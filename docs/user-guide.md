# User Guide

Mini Coding Agent currently explores a trusted local repository and generates a structured implementation plan for a coding goal. It does not create, edit, delete, test, or commit files in the current release.

## Quick Path

1. Install dependencies with `npm install`.
2. Export `OPENAI_API_KEY` in your shell.
3. Run `npm run dev -- "your goal" --repo path/to/repository`.
4. Review the exploration summary, affected files, ordered tasks, and verification strategy.

## Requirements

| Requirement | Minimum or expectation |
| --- | --- |
| Node.js | 20.19.0 |
| npm | Included with a supported Node.js installation |
| OpenAI API key | Required for normal CLI exploration and planning |
| Repository | Local, readable, and trusted |
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

The result is a proposed plan only. Review it as untrusted model output before relying on it; approval and execution are not available yet.

## Understanding the Output

A typical session looks like:

```text
Mini Coding Agent
Goal: Prevent users from registering with invalid email addresses
Repository: C:\Projects\sample-app
Exploring repository...
Exploration complete
Registration is handled by the users application module and covered by its tests.
Relevant files:
- src/users/RegisterUser.ts: Contains the registration workflow.
- src/users/RegisterUser.test.ts: Verifies registration behavior.
Creating coding plan...
Plan generated
1. Introduce validated email values [task-1]
   - create src/users/Email.ts: Represent a validated email address.
   - modify src/users/RegisterUser.ts: Validate input before registration.
   Expected outcome: Invalid email addresses are rejected.
2. Cover invalid registration [task-2]
   - modify src/users/RegisterUser.test.ts: Document invalid-email behavior.
   Expected outcome: Registration tests cover valid and invalid addresses.
Verification strategy: Run the registration unit tests.
No files were changed.
```

The output contains:

| Section | Meaning |
| --- | --- |
| Goal | The exact goal passed to the CLI |
| Repository | The resolved real path being explored |
| Summary | The model's concise interpretation of the discovered evidence |
| Relevant files | Only files observed through a registered tool |
| Reason | Why each file appears related to the goal |
| Plan tasks | Ordered implementation steps with nonempty, plan-local unique IDs |
| File operation | Whether a task expects to create or modify a path |
| Expected outcome | The behavior that should hold after each task |
| Verification strategy | How the completed change should be checked |

The model can complete with no relevant files when the available evidence does not identify a match.

The planner may propose new files, but it cannot classify an existing path as new. Modifications are limited to files identified by exploration. Paths outside the repository, restricted locations, and non-portable Windows names are rejected before display.

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

The restricted-path policy is defense in depth, not a data-loss-prevention product.

The current agent cannot:

- write or delete files;
- execute shell commands;
- run tests;
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

No standard verification command calls OpenAI.

## Current Limitations

- Exploration context is accumulated without summarization.
- Search is literal and does not support regular expressions.
- Only a fixed set of read-only tools exists.
- There is no persistent session or memory.
- There is no approval or execution workflow yet.
- There is no event log beyond current CLI output.

Follow the [Roadmap](../README.md#roadmap) for planned capabilities.
