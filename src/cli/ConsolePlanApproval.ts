import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import type { PlanApproval, PlanApprovalContext } from '../agent/ports/PlanApproval.js';

export class ConsolePlanApproval implements PlanApproval {
  constructor(
    private readonly output: (message: string) => void = console.log,
    private readonly ask: () => Promise<string> = askForApproval,
  ) {}

  async requestApproval(context: PlanApprovalContext): Promise<boolean> {
    this.output(context.exploration.summary);
    this.output('Relevant files:');

    if (context.exploration.relevantFiles.length === 0) {
      this.output('- None identified');
    } else {
      context.exploration.relevantFiles.forEach((file) => {
        this.output(`- ${file.path}: ${file.reason}`);
      });
    }

    context.plan.tasks.forEach((task, index) => {
      this.output(`${index + 1}. ${task.description} [${task.id}]`);
      task.files.forEach((file) => {
        this.output(`   - ${file.operation} ${file.path}: ${file.reason}`);
      });
      this.output(`   Expected outcome: ${task.verification.expectedOutcome}`);
    });
    this.output(`Verification strategy: ${context.plan.verificationStrategy}`);

    const answer = await this.ask();
    const approved = /^(y|yes)$/i.test(answer.trim());
    return approved;
  }
}

async function askForApproval(): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question('Proceed? [y/N] ');
  } finally {
    prompt.close();
  }
}
