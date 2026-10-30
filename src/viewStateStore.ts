import * as vscode from 'vscode';
import { defaultViewState, sanitizeViewState, ViewState } from './viewState';

function viewUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, '.archi', 'views', 'default.json');
}

export async function loadViewState(folder: vscode.WorkspaceFolder | undefined): Promise<ViewState> {
  if (!folder) return defaultViewState();
  try {
    const bytes = await vscode.workspace.fs.readFile(viewUri(folder));
    return sanitizeViewState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return defaultViewState();
  }
}

export async function saveViewState(folder: vscode.WorkspaceFolder | undefined, state: unknown): Promise<void> {
  if (!folder) return;
  const sanitized = sanitizeViewState(state);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.archi', 'views'));
  await vscode.workspace.fs.writeFile(viewUri(folder), new TextEncoder().encode(JSON.stringify(sanitized, null, 2)));
}
