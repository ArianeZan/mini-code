import type { Tool, ToolResult } from '../ports/Tool.js';

type RegisteredTool = {
  readonly description: string;
  execute(input: unknown): Promise<ToolResult<unknown>>;
};

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

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
    const tool = this.#tools.get(name);

    if (!tool) {
      return {
        ok: false,
        error: {
          code: 'unknown-tool',
          message: `Unknown tool: ${name}`,
        },
      };
    }

    return tool.execute(input);
  }
}
