import type { AgentEvent } from '../agent/domain/AgentEvent.js';
import type { EventSink } from '../agent/ports/EventSink.js';

export class ConsoleEventSink implements EventSink {
  constructor(
    private readonly output: (message: string) => void = console.log,
    private readonly now: () => Date = () => new Date(),
  ) {}

  emit(event: AgentEvent): void {
    this.output(`[${formatTime(this.now())}] ${eventMessage(event)}`);
  }
}

function eventMessage(event: AgentEvent): string {
  switch (event.type) {
    case 'goal-received':
      return `Goal received: ${event.goal} (${event.repositoryRoot})`;
    case 'exploration-started':
      return 'Exploring repository';
    case 'exploration-completed':
      return `Exploration completed: ${event.exploration.relevantFiles.length} relevant file(s)`;
    case 'planning-started':
      return 'Creating coding plan';
    case 'plan-created':
      return `Plan created: ${event.plan.tasks.length} task(s)`;
    case 'approval-requested':
      return 'Approval requested';
    case 'approval-granted':
      return 'Plan approved';
    case 'approval-rejected':
      return 'Plan rejected';
    case 'execution-started':
      return 'Executing approved plan';
    case 'task-started':
      return `Task started: ${event.taskId} - ${event.description}`;
    case 'task-completed':
      return `Task completed: ${event.taskId}`;
    case 'task-failed':
      return `Task failed: ${event.taskId} - ${event.reason}`;
    case 'file-created':
      return `File created: ${event.path}`;
    case 'file-modified':
      return `File modified: ${event.path}`;
    case 'tool-started':
      return `Tool started: ${event.toolName}`;
    case 'tool-completed':
      return event.success
        ? `Tool completed: ${event.toolName}`
        : `Tool failed: ${event.toolName}${event.errorCode ? ` (${event.errorCode})` : ''}`;
    case 'verification-started':
      return `Running tests: attempt ${event.attempt}`;
    case 'verification-passed':
      return `Tests passed: attempt ${event.attempt} (${event.durationMs} ms)`;
    case 'verification-failed':
      return `Tests failed: attempt ${event.attempt}`;
    case 'correction-proposed':
      return `Correction proposed after attempt ${event.attempt}: ${event.files.length} file(s)`;
    case 'correction-applied':
      return `Correction applied after attempt ${event.attempt}: ${event.files.length} file(s)`;
    case 'correction-rejected':
      return `Correction rejected after attempt ${event.attempt}: ${event.reason}`;
    case 'diff-generated':
      return `Final diff generated: ${event.bytes} bytes`;
    case 'agent-completed':
      return 'Agent completed';
    case 'agent-cancelled':
      return 'Agent cancelled';
    case 'agent-failed':
      return `Agent failed: ${event.reason}`;
  }
}

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}
