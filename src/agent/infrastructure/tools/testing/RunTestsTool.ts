import { spawn } from 'node:child_process';

import {
  RunTestsInputSchema,
  VerificationResultSchema,
  type RunTestsInput,
  type TestRunner,
  type VerificationResult,
} from '../../../ports/TestingTools.js';
import type { Tool } from '../../../ports/Tool.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
const TERMINATION_GRACE_MS = 1_000;

export class RunTestsTool implements Tool<RunTestsInput, VerificationResult>, TestRunner {
  readonly name = 'run_tests';
  readonly description = 'Run the repository npm test script with fixed arguments and bounded output.';
  readonly inputSchema = RunTestsInputSchema;
  readonly outputSchema = VerificationResultSchema;

  constructor(
    private readonly repositoryRoot: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('Test timeout must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new Error('Test output limit must be a positive safe integer');
    }
  }

  run(): Promise<VerificationResult> {
    return this.execute({});
  }

  execute(_input: RunTestsInput): Promise<VerificationResult> {
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let capturedBytes = 0;
      let timedOut = false;
      let outputTruncated = false;
      let settled = false;
      let terminationRequested = false;
      let terminationTimeout: NodeJS.Timeout | undefined;

      const invocation = resolveNpmInvocation();
      let child;

      try {
        child = spawn(invocation.command, invocation.arguments, {
          cwd: this.repositoryRoot,
          detached: process.platform !== 'win32',
          env: process.env,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const output = boundOutput('', errorMessage(error), this.maxOutputBytes);
        resolve({
          passed: false,
          exitCode: null,
          stdout: output.stdout,
          stderr: output.stderr,
          timedOut,
          outputTruncated: output.truncated,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      let timeout: NodeJS.Timeout;

      const finish = (exitCode: number | null, spawnError?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (terminationTimeout) {
          clearTimeout(terminationTimeout);
        }

        const rawStdout = Buffer.concat(stdoutChunks).toString('utf8');
        let rawStderr = Buffer.concat(stderrChunks).toString('utf8');
        if (spawnError) {
          rawStderr += `${rawStderr === '' ? '' : '\n'}${errorMessage(spawnError)}`;
        }
        const output = boundOutput(rawStdout, rawStderr, this.maxOutputBytes);
        outputTruncated ||= output.truncated;

        resolve({
          passed: exitCode === 0 && !timedOut && !outputTruncated && !spawnError,
          exitCode,
          stdout: output.stdout,
          stderr: output.stderr,
          timedOut,
          outputTruncated,
          durationMs: Date.now() - startedAt,
        });
      };

      const requestTermination = (): void => {
        if (terminationRequested) {
          return;
        }
        terminationRequested = true;
        terminateProcessTree(child);
        terminationTimeout = setTimeout(() => {
          forceTerminateProcessTree(child);
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null);
        }, TERMINATION_GRACE_MS);
      };

      const appendOutput = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        const remainingBytes = this.maxOutputBytes - capturedBytes;
        if (remainingBytes <= 0) {
          outputTruncated = true;
          requestTermination();
          return;
        }

        const capturedChunk = chunk.subarray(0, remainingBytes);
        capturedBytes += capturedChunk.length;
        if (target === 'stdout') {
          stdoutChunks.push(capturedChunk);
        } else {
          stderrChunks.push(capturedChunk);
        }

        if (capturedChunk.length < chunk.length) {
          outputTruncated = true;
          requestTermination();
        }
      };

      child.stdout.on('data', (chunk: Buffer) => appendOutput('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => appendOutput('stderr', chunk));

      timeout = setTimeout(() => {
        timedOut = true;
        requestTermination();
      }, this.timeoutMs);

      child.on('error', (error) => finish(null, error));
      child.on('close', (exitCode) => finish(exitCode));
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not start npm test';
}

function resolveNpmInvocation(): { command: string; arguments: string[] } {
  const npmExecPath = process.env['npm_execpath'];
  if (npmExecPath?.endsWith('.js')) {
    return { command: process.execPath, arguments: [npmExecPath, 'test'] };
  }

  if (process.platform === 'win32') {
    return {
      command: process.env['ComSpec'] ?? 'cmd.exe',
      arguments: ['/d', '/s', '/c', 'npm.cmd test'],
    };
  }

  return { command: 'npm', arguments: ['test'] };
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) {
    child.kill();
    return;
  }

  if (process.platform === 'win32') {
    child.kill();
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

function forceTerminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to direct termination.
    }
  }

  child.kill('SIGKILL');
}

function boundOutput(
  stdout: string,
  stderr: string,
  maxBytes: number,
): { stdout: string; stderr: string; truncated: boolean } {
  const boundedStdout = utf8Prefix(stdout, maxBytes);
  const remainingBytes = maxBytes - Buffer.byteLength(boundedStdout.value, 'utf8');
  const boundedStderr = utf8Prefix(stderr, remainingBytes);

  return {
    stdout: boundedStdout.value,
    stderr: boundedStderr.value,
    truncated: boundedStdout.truncated || boundedStderr.truncated,
  };
}

function utf8Prefix(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const characters: string[] = [];
  let bytes = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) {
      return { value: characters.join(''), truncated: true };
    }
    characters.push(character);
    bytes += characterBytes;
  }

  return { value, truncated: false };
}
