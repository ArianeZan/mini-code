import { describe, expect, it } from 'vitest';

import {
  createInitialAgentState,
  transitionAgentState,
} from '../../../src/agent/domain/AgentState.js';

describe('AgentState', () => {
  it('supports the approved execution workflow', () => {
    let state = createInitialAgentState('Change registration', '/repository');

    state = transitionAgentState(state, 'planning');
    state = transitionAgentState(state, 'awaiting-approval');
    state = transitionAgentState(state, 'executing');
    state = transitionAgentState(state, 'completed');

    expect(state.status).toBe('completed');
  });

  it('supports cancellation before execution', () => {
    let state = createInitialAgentState('Change registration', '/repository');
    state = transitionAgentState(state, 'planning');
    state = transitionAgentState(state, 'awaiting-approval');

    expect(transitionAgentState(state, 'cancelled').status).toBe('cancelled');
  });

  it('rejects invalid transitions', () => {
    const state = createInitialAgentState('Change registration', '/repository');

    expect(() => transitionAgentState(state, 'executing')).toThrow(
      'Invalid agent transition: exploring -> executing',
    );
  });
});
