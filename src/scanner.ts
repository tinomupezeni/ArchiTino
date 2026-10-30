import * as vscode from 'vscode';
import path from 'node:path';

const EXCLUDE = '**/{.git,node_modules,dist,build,out,.venv,venv,__pycache__,.next,coverage,media,.vscode-test}/**';

export interface ScanResult {
  files: vscode.Uri[];
  truncated: boolean;
  workspaceCount: number;
}

export async function scanWorkspace(maxFiles: number, token: vscode.CancellationToken, onFolder?: (name: string, current: number, total: number) => void): Promise<ScanResult> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const files: vscode.Uri[] = [];
  let truncated = false;
  for (const [index, folder] of folders.entries()) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    onFolder?.(folder.name, index + 1, folders.length);
    const remaining = maxFiles - files.length;
    if (remaining <= 0) { truncated = true; break; }
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'), EXCLUDE, remaining + 1, token,
    );
    if (matches.length > remaining) truncated = true;
    files.push(...matches.slice(0, remaining));
  }
  return { files, truncated, workspaceCount: folders.length };
}

export function isWithinWorkspace(uri: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(folder => {
    if (folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return false;
    const base = path.posix.normalize(folder.uri.path);
    const target = path.posix.normalize(uri.path);
    return target === base || target.startsWith(`${base.replace(/\/$/, '')}/`);
  });
}
