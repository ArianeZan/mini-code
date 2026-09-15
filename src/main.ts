#!/usr/bin/env node

import { CommanderError } from 'commander';

import { runCli } from './cli/main.js';

runCli(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected CLI error';
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
