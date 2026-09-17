import type { Tool, ToolResult } from '../ports/Tool.js';
import {
  NO_OP_EVENT_SINK,
  emitSafely,
  type EventSink,
} from '../ports/EventSink.js';

type RegisteredTool = {
  readonly description: string;
  execute(input: unknown): Promise<ToolResult<unknown>>;
};

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

  constructor(private readonly eventSink: EventSink = NO_OP_EVENT_SINK) {}

  register<TInput, TOutput>(tool: Tool<TInput, TOutput>): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.#tools.set(tool.name, {
      description: tool.description,
      execute: async (input) => {
        let parsedInput;

        try {
          parsedInput = tool.inputSchema.safeParse(input);
        } catch (error) {
          return {
            ok: false,
            error: {
              code: 'invalid-input',
              message: `Invalid input for tool: ${tool.name}`,
              details: error instanceof Error ? error.message : String(error),
            },
          };
        }

        if (!parsedInput.success) {
          return {
            ok: false,
            error: {
              code: 'invalid-input',
              message: `Invalid input for tool: ${tool.name}`,
              details: parsedInput.error.issues,
            },
          };
        }

        try {
          const value = await tool.execute(parsedInput.data);
          let parsedOutput;

          try {
            parsedOutput = tool.outputSchema.safeParse(value);
          } catch (error) {
            return {
              ok: false,
              error: {
                code: 'invalid-output',
                message: `Invalid output from tool: ${tool.name}`,
                details: error instanceof Error ? error.message : String(error),
              },
            };
          }

          if (!parsedOutput.success) {
            return {
              ok: false,
              error: {
                code: 'invalid-output',
                message: `Invalid output from tool: ${tool.name}`,
                details: parsedOutput.error.issues,
              },
            };
          }

          return { ok: true, value: parsedOutput.data };
        } catch (error) {
          return {
            ok: false,
            error: {
              code: 'execution-failed',
              message:
                error instanceof Error
                  ? error.message
                  : `Tool execution failed: ${tool.name}`,
            },
          };
        }
      },
    });
  }

  list(): ReadonlyArray<{ name: string; description: string }> {
    return [...this.#tools.entries()].map(([name, tool]) => ({
      name,
      description: tool.description,
    }));
  }

  async execute(name: string, input: unknown): Promise<ToolResult<unknown>> {
    emitSafely(this.eventSink, { type: 'tool-started', toolName: name });
    const tool = this.#tools.get(name);

    if (!tool) {
      const result: ToolResult<unknown> = {
        ok: false,
        error: {
          code: 'unknown-tool',
          message: `Unknown tool: ${name}`,
        },
      };
      emitSafely(this.eventSink, {
        type: 'tool-completed',
        toolName: name,
        success: false,
        errorCode: result.error.code,
      });
      return result;
    }

    const result = await tool.execute(input);
    emitSafely(this.eventSink, {
      type: 'tool-completed',
      toolName: name,
      success: result.ok,
      ...(result.ok ? {} : { errorCode: result.error.code }),
    });
    return result;
  }
}
