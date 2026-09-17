import { describe, expect, it } from 'vitest';

import { ConsoleEventSink } from '../../src/cli/ConsoleEventSink.js';

describe('ConsoleEventSink', () => {
  it('renders timestamped lifecycle and verification events', () => {
    const output: string[] = [];
    const sink = new ConsoleEventSink(
      (message) => output.push(message),
      () => new Date('2026-09-16T14:32:01'),
    );

    sink.emit({
      type: 'goal-received',
      goal: 'Fix registration',
      repositoryRoot: '/repo',
    });
    sink.emit({ type: 'verification-started', attempt: 2 });
    sink.emit({
      type: 'verification-failed',
      attempt: 2,
      exitCode: 1,
      timedOut: false,
      outputTruncated: false,
    });
    sink.emit({ type: 'agent-failed', reason: 'Tests still fail' });

    expect(output).toEqual([
      '[14:32:01] Goal received: Fix registration (/repo)',
      '[14:32:01] Running tests: attempt 2',
      '[14:32:01] Tests failed: attempt 2',
      '[14:32:01] Agent failed: Tests still fail',
    ]);
  });
});
