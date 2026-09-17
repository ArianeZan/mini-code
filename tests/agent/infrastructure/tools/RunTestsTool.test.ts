import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ToolRegistry } from '../../../../src/agent/application/ToolRegistry.js';
import { RunTestsTool } from '../../../../src/agent/infrastructure/tools/testing/RunTestsTool.js';

describe('RunTestsTool', () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((temporaryPath) =>
        rm(temporaryPath, { recursive: true, force: true }),
      ),
    );
  });

  it('runs only the repository npm test script and captures success', async () => {
    const repositoryRoot = await createRepository(
      `node -e "console.log('tests passed')"`,
    );

    const result = await new RunTestsTool(repositoryRoot).run();

    expect(result).toMatchObject({
      passed: true,
      exitCode: 0,
      timedOut: false,
      outputTruncated: false,
    });
    expect(result.stdout).toContain('tests passed');
  });

  it('captures a failing test exit and stderr', async () => {
    const repositoryRoot = await createRepository(
      `node -e "console.error('tests failed'); process.exit(2)"`,
    );

    const result = await new RunTestsTool(repositoryRoot).run();

    expect(result).toMatchObject({
      passed: false,
      exitCode: 2,
      timedOut: false,
      outputTruncated: false,
    });
    expect(result.stderr).toContain('tests failed');
  });

  it('stops waiting after the configured timeout', async () => {
    const testScript =
      process.platform === 'win32'
        ? `node -e "setTimeout(() => process.exit(0), 1500)"`
        : `node -e "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 3000)"`;
    const repositoryRoot = await createRepository(testScript);
    const startedAt = Date.now();

    const result = await new RunTestsTool(repositoryRoot, 50).run();

    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_500);
  });

  it('bounds captured output', async () => {
    const repositoryRoot = await createRepository(
      `node -e "console.log('x'.repeat(10000))"`,
    );

    const result = await new RunTestsTool(repositoryRoot, 5_000, 100).run();

    expect(result.passed).toBe(false);
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      100,
    );
  });

  it('keeps decoded multibyte output within the byte limit', async () => {
    const repositoryRoot = await createRepository(
      `node -e "console.log('😀'.repeat(1000))"`,
    );

    const result = await new RunTestsTool(repositoryRoot, 5_000, 101).run();

    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      101,
    );
  });

  it('does not accept command input through the tool registry', async () => {
    const repositoryRoot = await createRepository(`node -e "process.exit(0)"`);
    const registry = new ToolRegistry();
    registry.register(new RunTestsTool(repositoryRoot));

    const result = await registry.execute('run_tests', { command: 'git push' });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  });

  async function createRepository(testScript: string): Promise<string> {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-tests-tool-'));
    temporaryPaths.push(repositoryRoot);
    await writeFile(
      path.join(repositoryRoot, 'package.json'),
      JSON.stringify({ name: 'test-fixture', private: true, scripts: { test: testScript } }),
    );
    return repositoryRoot;
  }
});
