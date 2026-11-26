import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AgentResponse {
  text: string;
}

export interface AgentBridge {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  sendPrompt(prompt: string, options?: { systemPrompt?: string }): Promise<AgentResponse>;
}

export class VsCodeLmBridge implements AgentBridge {
  readonly id = 'vscode-lm';
  readonly name = 'VS Code Language Model API';

  async isAvailable(): Promise<boolean> {
    if (typeof vscode.lm === 'undefined' || typeof vscode.lm.selectChatModels !== 'function') {
      return false;
    }
    try {
      const models = await vscode.lm.selectChatModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async sendPrompt(prompt: string, options?: { systemPrompt?: string }): Promise<AgentResponse> {
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      throw new Error('No VS Code language models available.');
    }
    const model = models[0];
    const messages: vscode.LanguageModelChatMessage[] = [];
    if (options?.systemPrompt) {
      messages.push(vscode.LanguageModelChatMessage.User(`[System Instructions]: ${options.systemPrompt}`));
    }
    messages.push(vscode.LanguageModelChatMessage.User(prompt));

    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
    let fullText = '';
    for await (const chunk of response.text) {
      fullText += chunk;
    }
    return { text: fullText };
  }
}

export class CliAgentBridge implements AgentBridge {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly command: string,
    private readonly defaultArgs: string[] = []
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', [this.command]);
      return true;
    } catch {
      return false;
    }
  }

  async sendPrompt(prompt: string, options?: { systemPrompt?: string }): Promise<AgentResponse> {
    const combinedPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\nTask:\n${prompt}`
      : prompt;

    // Run agent command with prompt input
    const { stdout } = await execFileAsync(this.command, [...this.defaultArgs, combinedPrompt], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });

    return { text: stdout };
  }
}

export function getDefaultBridges(): AgentBridge[] {
  return [
    new VsCodeLmBridge(),
    new CliAgentBridge('agy', 'Google Antigravity (agy)', 'agy', ['--raw']),
    new CliAgentBridge('claude', 'Claude Code', 'claude', ['-p']),
    new CliAgentBridge('codex', 'Codex CLI', 'codex', ['exec']),
    new CliAgentBridge('copilot', 'Copilot CLI', 'copilot', ['exec']),
  ];
}

export async function resolveAvailableAgent(preferredId?: string): Promise<AgentBridge> {
  const bridges = getDefaultBridges();
  if (preferredId) {
    const matched = bridges.find(b => b.id === preferredId);
    if (matched && await matched.isAvailable()) {
      return matched;
    }
  }
  for (const bridge of bridges) {
    if (await bridge.isAvailable()) {
      return bridge;
    }
  }
  throw new Error('No active coding agent or VS Code language model found. Please enable Copilot, AGY, Claude Code, or configure an agent.');
}
