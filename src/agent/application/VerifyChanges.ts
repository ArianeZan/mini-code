import type { CodingPlan } from '../domain/CodingPlan.js';
import {
  VerificationCorrectionSchema,
  type VerificationCorrectionRecord,
} from '../domain/VerificationCorrection.js';
import type { LanguageModel } from '../ports/LanguageModel.js';
import {
  NO_OP_EVENT_SINK,
  emitSafely,
  type EventSink,
} from '../ports/EventSink.js';
import { ReadFileOutputSchema } from '../ports/RepositoryTools.js';
import {
  VerificationResultSchema,
  type TestRunner,
  type VerificationResult,
} from '../ports/TestingTools.js';
import type { ToolRegistry } from './ToolRegistry.js';

export const MAX_VERIFICATION_ATTEMPTS = 3;
const MAX_CORRECTION_BYTES = 2_000_000;

const CORRECTION_INSTRUCTIONS = `Analyze one failed test run and propose the smallest correction.
Return complete UTF-8 content only for approved files that must change.
Every returned path must be in the approved plan. Do not create, delete, rename, or add files.
Preserve unrelated behavior and formatting. Do not return Markdown, patches, or shell commands.`;

export type VerificationLoopResult =
  | {
      readonly success: true;
      readonly attempts: number;
      readonly lastResult: VerificationResult;
      readonly corrections: VerificationCorrectionRecord[];
      readonly modifiedFiles: string[];
    }
  | {
      readonly success: false;
      readonly attempts: number;
      readonly lastResult: VerificationResult;
      readonly corrections: VerificationCorrectionRecord[];
      readonly modifiedFiles: string[];
      readonly failureReason: string;
    };

export class VerifyChanges {
  constructor(
    private readonly languageModel: LanguageModel,
    private readonly tools: ToolRegistry,
    private readonly testRunner: TestRunner,
    private readonly eventSink: EventSink = NO_OP_EVENT_SINK,
  ) {}

  async execute(goal: string, plan: CodingPlan): Promise<VerificationLoopResult> {
    const approvedFiles = new Map<string, string>();
    for (const task of plan.tasks) {
      for (const file of task.files) {
        const pathKey = repositoryPathKey(file.path);
        const existingPath = approvedFiles.get(pathKey);
        if (existingPath && existingPath !== file.path) {
          throw new Error(
            `Approved plan contains non-portable path casing: ${existingPath}, ${file.path}`,
          );
        }
        approvedFiles.set(pathKey, file.path);
      }
    }

    const corrections: VerificationCorrectionRecord[] = [];
    const modifiedFiles = new Set<string>();

    for (let attempt = 1; attempt <= MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
      emitSafely(this.eventSink, { type: 'verification-started', attempt });
      let result: VerificationResult;
      try {
        result = VerificationResultSchema.parse(await this.testRunner.run());
      } catch (error) {
        result = failedTestResult(errorMessage(error));
        emitVerificationFailed(this.eventSink, attempt, result);
        return verificationFailure(
          attempt,
          result,
          corrections,
          modifiedFiles,
          `Could not run tests: ${errorMessage(error)}`,
        );
      }

      if (result.passed) {
        emitSafely(this.eventSink, {
          type: 'verification-passed',
          attempt,
          durationMs: result.durationMs,
        });
        return {
          success: true,
          attempts: attempt,
          lastResult: result,
          corrections,
          modifiedFiles: [...modifiedFiles],
        };
      }

      emitVerificationFailed(this.eventSink, attempt, result);

      if (attempt === MAX_VERIFICATION_ATTEMPTS) {
        return verificationFailure(
          attempt,
          result,
          corrections,
          modifiedFiles,
          `Tests still fail after ${attempt} attempts`,
        );
      }

      const currentFiles: Array<{ path: string; content: string }> = [];
      for (const approvedPath of approvedFiles.values()) {
        const readResult = await this.tools.execute('read_file', { path: approvedPath });
        if (!readResult.ok) {
          return verificationFailure(
            attempt,
            result,
            corrections,
            modifiedFiles,
            `Could not read approved file ${approvedPath}: ${readResult.error.message}`,
          );
        }

        const currentFile = ReadFileOutputSchema.parse(readResult.value);
        if (currentFile.truncated) {
          return verificationFailure(
            attempt,
            result,
            corrections,
            modifiedFiles,
            `File is too large for safe correction: ${approvedPath}`,
          );
        }
        currentFiles.push({ path: currentFile.path, content: currentFile.content });
      }

      let correction;
      try {
        correction = await this.languageModel.generate({
          schemaName: 'verification_correction',
          schema: VerificationCorrectionSchema,
          instructions: CORRECTION_INSTRUCTIONS,
          input: JSON.stringify({ goal, plan, attempt, testResult: result, currentFiles }),
        });
      } catch (error) {
        return verificationFailure(
          attempt,
          result,
          corrections,
          modifiedFiles,
          `Could not generate correction: ${errorMessage(error)}`,
        );
      }

      emitSafely(this.eventSink, {
        type: 'correction-proposed',
        attempt,
        files: correction.changes.map((change) => change.path),
      });

      const proposedPaths = new Set<string>();
      const proposedChanges: Array<{ path: string; content: string }> = [];
      const correctedFiles: string[] = [];
      let correctionBytes = 0;

      for (const change of correction.changes) {
        const pathKey = repositoryPathKey(change.path);
        const approvedPath = approvedFiles.get(pathKey);
        if (!approvedPath) {
          corrections.push(correctionRecord(attempt, correction.analysis, correctedFiles));
          rejectCorrection(this.eventSink, attempt, `Unapproved file: ${change.path}`);
          return verificationFailure(
            attempt,
            result,
            corrections,
            modifiedFiles,
            `Verification correction contains an unapproved file: ${change.path}`,
          );
        }

        if (proposedPaths.has(pathKey)) {
          corrections.push(correctionRecord(attempt, correction.analysis, correctedFiles));
          rejectCorrection(this.eventSink, attempt, `Repeated file: ${change.path}`);
          return verificationFailure(
            attempt,
            result,
            corrections,
            modifiedFiles,
            `Verification correction repeats a file: ${change.path}`,
          );
        }
        proposedPaths.add(pathKey);

        correctionBytes += Buffer.byteLength(change.content, 'utf8');
        if (correctionBytes > MAX_CORRECTION_BYTES) {
          corrections.push(correctionRecord(attempt, correction.analysis, correctedFiles));
          rejectCorrection(this.eventSink, attempt, 'Aggregate correction size exceeded');
          return verificationFailure(
            attempt,
            result,
            corrections,
            modifiedFiles,
            `Verification correction exceeds ${MAX_CORRECTION_BYTES} bytes`,
          );
        }

        proposedChanges.push({ path: approvedPath, content: change.content });
      }

      for (const change of proposedChanges) {
        const editResult = await this.tools.execute('edit_file', {
          path: change.path,
          content: change.content,
        });
        if (!editResult.ok) {
          corrections.push(correctionRecord(attempt, correction.analysis, correctedFiles));
          rejectCorrection(this.eventSink, attempt, `Write failed: ${change.path}`);
          return verificationFailure(
            attempt,
            result,
            corrections,
            modifiedFiles,
            `Could not apply correction to ${change.path}: ${editResult.error.message}`,
          );
        }

        correctedFiles.push(change.path);
        modifiedFiles.add(change.path);
        emitSafely(this.eventSink, { type: 'file-modified', path: change.path });
      }

      corrections.push(correctionRecord(attempt, correction.analysis, correctedFiles));
      emitSafely(this.eventSink, {
        type: 'correction-applied',
        attempt,
        files: correctedFiles,
      });
    }

    throw new Error('Verification loop ended unexpectedly');
  }
}

function normalizeRepositoryPath(repositoryPath: string): string {
  return repositoryPath.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}

function repositoryPathKey(repositoryPath: string): string {
  return normalizeRepositoryPath(repositoryPath).toLowerCase();
}

function failedTestResult(stderr: string): VerificationResult {
  return {
    passed: false,
    exitCode: null,
    stdout: '',
    stderr,
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
  };
}

function verificationFailure(
  attempts: number,
  lastResult: VerificationResult,
  corrections: readonly VerificationCorrectionRecord[],
  modifiedFiles: ReadonlySet<string>,
  failureReason: string,
): VerificationLoopResult {
  return {
    success: false,
    attempts,
    lastResult,
    corrections: [...corrections],
    modifiedFiles: [...modifiedFiles],
    failureReason,
  };
}

function correctionRecord(
  attempt: number,
  analysis: string,
  modifiedFiles: readonly string[],
): VerificationCorrectionRecord {
  return { attempt, analysis, modifiedFiles: [...modifiedFiles] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Verification failed';
}

function emitVerificationFailed(
  eventSink: EventSink,
  attempt: number,
  result: VerificationResult,
): void {
  emitSafely(eventSink, {
    type: 'verification-failed',
    attempt,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    outputTruncated: result.outputTruncated,
  });
}

function rejectCorrection(eventSink: EventSink, attempt: number, reason: string): void {
  emitSafely(eventSink, { type: 'correction-rejected', attempt, reason });
}
