import * as vscode from 'vscode';
import { EvidenceGraph, stableId } from './graph';

export function makeFixture(files: vscode.Uri[], folders: readonly vscode.WorkspaceFolder[]): EvidenceGraph {
  const nodes: EvidenceGraph['nodes'] = [];
  const edges: EvidenceGraph['edges'] = [];
  for (const folder of folders) {
    const rootId = stableId('workspace', folder.uri.toString());
    nodes.push({ id: rootId, kind: 'workspace', label: folder.name, evidence: [] });
    for (const file of files.filter(uri => uri.toString().startsWith(`${folder.uri.toString().replace(/\/$/, '')}/`)).slice(0, 6)) {
      const fileId = stableId('file', file.toString());
      const evidence = [{ uri: file.toString(), line: 1, extractor: 'phase1-fixture' }];
      nodes.push({ id: fileId, kind: 'file', label: vscode.workspace.asRelativePath(file), evidence });
      edges.push({ id: stableId('contains', rootId, fileId), from: rootId, to: fileId, kind: 'contains', confidence: 'declared', evidence });
    }
  }
  return { version: 1, nodes, edges };
}
