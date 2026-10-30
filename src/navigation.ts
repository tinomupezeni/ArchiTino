import * as vscode from 'vscode';
import { SourceEvidence } from './graph';
import { isWithinWorkspace } from './scanner';

export async function openEvidenceSource(evidence: SourceEvidence): Promise<boolean> {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(evidence.uri, true);
  } catch {
    return false;
  }
  if (!isWithinWorkspace(uri)) return false;
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const line = Math.min(Math.max(evidence.line - 1, 0), Math.max(document.lineCount - 1, 0));
    editor.selection = new vscode.Selection(line, 0, line, 0);
    editor.revealRange(new vscode.Range(line, 0, line, 0));
    return true;
  } catch {
    return false;
  }
}
