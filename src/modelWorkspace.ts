import * as vscode from 'vscode';
import path from 'node:path';
import { EvidenceGraph, GraphNode } from './graph';
import { analyzePythonModels, ModelAnalysis, PythonModelFile } from './pythonModels';
import { parser } from '@lezer/python';

const MAX_MODEL_FILES = 500;
const MAX_MODEL_BYTES = 500_000;
const EXCLUDE = '**/{.git,node_modules,dist,build,out,.venv,venv,__pycache__,migrations,tests,.vscode-test}/**';

function ownerFor(relativePath: string, services: GraphNode[], fallback: string): { owner: string; database?: string } {
  const normalized = relativePath.replace(/\\/g, '/');
  const matched = services.flatMap(node => (node.paths ?? []).map(relative => ({ node, relative })))
    .filter(item => normalized === item.relative || normalized.startsWith(item.relative.replace(/\/$/, '') + '/'))
    .sort((a, b) => b.relative.length - a.relative.length || Number(!!b.node.database) - Number(!!a.node.database) || a.node.label.length - b.node.label.length);
  const chosen = matched[0]?.node;
  return { owner: chosen?.label ?? fallback, database: chosen?.database };
}

function authUserSetting(source: string): string | undefined {
  const tree = parser.parse(source);
  for (const assign of tree.topNode.getChildren('AssignStatement')) {
    const variable = assign.getChild('VariableName');
    if (!variable || source.slice(variable.from, variable.to) !== 'AUTH_USER_MODEL') continue;
    const value = assign.getChild('String');
    if (!value) return undefined;
    const raw = source.slice(value.from, value.to);
    if ((raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0]) return raw.slice(1, -1);
  }
  return undefined;
}

export async function analyzeModelWorkspaces(systemGraph: EvidenceGraph, token: vscode.CancellationToken, onProgress?: (message: string) => void): Promise<ModelAnalysis> {
  const allFiles: PythonModelFile[] = [];
  const diagnostics: string[] = [];
  const authUserModels: Record<string, string> = {};
  const services = systemGraph.nodes.filter(node => node.kind === 'service' && node.paths?.length);
  const databases = new Map<string, string[]>();
  for (const edge of systemGraph.edges.filter(item => item.kind === 'database')) {
    const target = systemGraph.nodes.find(node => node.id === edge.to);
    if (target) databases.set(edge.from, [...(databases.get(edge.from) ?? []), target.label]);
  }
  for (const service of services) {
    const names = [...new Set(databases.get(service.id) ?? [])];
    if (names.length === 1) service.database = names[0];
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    for (const service of services) {
      for (const relative of service.paths ?? []) {
        if (authUserModels[service.label]) break;
        for (const settingsPath of ['config/settings/base.py', 'config/settings.py', 'settings.py']) {
          const uri = vscode.Uri.joinPath(folder.uri, relative, settingsPath);
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > 100_000) continue;
            const setting = authUserSetting(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
            if (setting) authUserModels[service.label] = setting;
          } catch { /* This service does not have this settings file. */ }
          if (authUserModels[service.label]) break;
        }
      }
    }
    const patterns = ['**/models.py', '**/models/**/*.py'];
    const found = new Map<string, vscode.Uri>();
    for (const pattern of patterns) {
      const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), EXCLUDE, MAX_MODEL_FILES + 1, token);
      for (const uri of matches) found.set(uri.toString(), uri);
    }
    if (found.size > MAX_MODEL_FILES) diagnostics.push(folder.name + ': model-file limit reached');
    for (const uri of [...found.values()].slice(0, MAX_MODEL_FILES)) {
      if (token.isCancellationRequested) throw new vscode.CancellationError();
      const relativePath = path.posix.relative(folder.uri.path, uri.path);
      onProgress?.(relativePath);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_MODEL_BYTES) {
          diagnostics.push(relativePath + ': model file exceeds 500 KB limit');
          continue;
        }
        const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        const ownership = ownerFor(relativePath, services, folder.name);
        allFiles.push({ uri: uri.toString(), relativePath, source, ...ownership });
      } catch (error) {
        diagnostics.push(relativePath + ': read failed: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  const result = analyzePythonModels(allFiles, { authUserModels });
  return { graph: result.graph, diagnostics: [...diagnostics, ...result.diagnostics], files: result.files };
}
