import * as vscode from 'vscode';
import { analyzeComposeWorkspaces } from '../src/composeWorkspace';
import { analyzeModelWorkspaces } from '../src/modelWorkspace';
import { analyzeComponentWorkspaces } from '../src/componentWorkspace';

const fakeContext = { workspaceState: { get: () => undefined, update: async () => undefined } } as unknown as vscode.ExtensionContext;

interface Pass {
  label: string;
  elapsedMs: number;
  files: number;
  nodes: number;
  edges: number;
  rssMb: number;
}

async function runOnce(label: string): Promise<Pass> {
  const token = new vscode.CancellationTokenSource().token;
  const start = Date.now();
  const compose = await analyzeComposeWorkspaces(fakeContext, token);
  const models = await analyzeModelWorkspaces(compose.graph, token);
  const components = await analyzeComponentWorkspaces(compose.graph, token);
  const elapsedMs = Date.now() - start;
  return {
    label,
    elapsedMs,
    files: compose.files + models.files + components.files,
    nodes: compose.graph.nodes.length + models.graph.nodes.length + components.graph.nodes.length,
    edges: compose.graph.edges.length + models.graph.edges.length + components.graph.edges.length,
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  };
}

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('benchmark must open a workspace');
  const extension = vscode.extensions.getExtension('tinomupezeni.archi');
  await extension?.activate();
  const cold = await runOnce('cold');
  const warm = await runOnce('warm');
  for (const pass of [cold, warm]) {
    process.stdout.write(
      `ARCHI_BENCHMARK ${folder.name} ${pass.label}: ${pass.elapsedMs} ms, ${pass.files} files, `
      + `${pass.nodes} nodes, ${pass.edges} edges, ${pass.rssMb} MB RSS\n`,
    );
  }
}
