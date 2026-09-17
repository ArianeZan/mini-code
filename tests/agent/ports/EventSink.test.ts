import { describe, expect, it } from 'vitest';

import { emitSafely, type EventSink } from '../../../src/agent/ports/EventSink.js';

describe('EventSink', () => {
  it('emits a frozen snapshot instead of live workflow state', () => {
    const exploration = { relevantFiles: [], summary: 'No files.' };
    const sink: EventSink = {
      emit: (event) => {
        if (event.type === 'exploration-completed') {
          const files = event.exploration.relevantFiles as Array<{
            path: string;
            reason: string;
          }>;
          files.push({ path: 'injected.ts', reason: 'Mutation.' });
        }
      },
    };

    emitSafely(sink, { type: 'exploration-completed', exploration });

    expect(exploration.relevantFiles).toEqual([]);
  });

  it('contains asynchronous sink rejections', async () => {
    const sink: EventSink = {
      emit: async () => {
        throw new Error('async observability failure');
      },
    };

    expect(() => emitSafely(sink, { type: 'exploration-started' })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
