import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ToolRegistry } from '../../../src/agent/application/ToolRegistry.js';
import type { Tool } from '../../../src/agent/ports/Tool.js';

const InputSchema = z.object({ value: z.string() });
const OutputSchema = z.object({ echoed: z.string() });

type EchoInput = z.infer<typeof InputSchema>;
type EchoOutput = z.infer<typeof OutputSchema>;

function createEchoTool(execute = async ({ value }: EchoInput): Promise<EchoOutput> => ({ echoed: value })):
  Tool<EchoInput, EchoOutput> {
  return {
    name: 'echo',
    description: 'Echoes a value',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    execute,
  };
}

describe('ToolRegistry', () => {
  it('executes registered tools and exposes their metadata', async () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    await expect(registry.execute('echo', { value: 'hello' })).resolves.toEqual({
      ok: true,
      value: { echoed: 'hello' },
    });
    expect(registry.list()).toEqual([{ name: 'echo', description: 'Echoes a value' }]);
  });

  it('rejects invalid input before executing the tool', async () => {
    const execute = vi.fn(createEchoTool().execute);
    const registry = new ToolRegistry();
    registry.register(createEchoTool(execute));

    const result = await registry.execute('echo', { value: 42 });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('contains exceptions thrown while validating input', async () => {
    const execute = vi.fn(createEchoTool().execute);
    const registry = new ToolRegistry();
    registry.register({
      ...createEchoTool(execute),
      inputSchema: z.unknown().transform(() => {
        throw new Error('input refinement failed');
      }) as z.ZodType<EchoInput>,
    });

    const result = await registry.execute('echo', { value: 'hello' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-input', details: 'input refinement failed' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects outputs that violate the tool contract', async () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool(async () => ({ echoed: 42 }) as unknown as EchoOutput));

    const result = await registry.execute('echo', { value: 'hello' });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-output' } });
  });

  it('converts tool exceptions into controlled failures', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createEchoTool(async () => {
        throw new Error('echo failed');
      }),
    );

    await expect(registry.execute('echo', { value: 'hello' })).resolves.toEqual({
      ok: false,
      error: { code: 'execution-failed', message: 'echo failed' },
    });
  });

  it('reports unknown tools without throwing', async () => {
    const registry = new ToolRegistry();

    await expect(registry.execute('missing', {})).resolves.toEqual({
      ok: false,
      error: { code: 'unknown-tool', message: 'Unknown tool: missing' },
    });
  });

  it('prevents duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    expect(() => registry.register(createEchoTool())).toThrow('Tool already registered: echo');
  });
});
