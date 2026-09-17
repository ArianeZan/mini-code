import type { AgentEvent } from '../domain/AgentEvent.js';

export interface EventSink {
  emit(event: AgentEvent): void | Promise<void>;
}

export const NO_OP_EVENT_SINK: EventSink = {
  emit: () => undefined,
};

export function emitSafely(eventSink: EventSink, event: AgentEvent): void {
  try {
    const emission = eventSink.emit(deepFreeze(structuredClone(event)));
    if (emission && typeof emission.then === 'function') {
      void Promise.resolve(emission).catch(() => undefined);
    }
  } catch {
    // Observability must not change agent behavior.
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((nestedValue) => deepFreeze(nestedValue));
  }
  return value;
}
