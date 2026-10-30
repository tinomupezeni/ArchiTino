import { createHash } from 'node:crypto';

export type NodeKind = 'workspace' | 'file' | 'service' | 'database' | 'cache' | 'broker' | 'table' | 'module' | 'domain' | 'route' | 'task';
export type Confidence = 'declared' | 'inferred' | 'unresolved';

export interface SourceEvidence {
  uri: string;
  line: number;
  extractor: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  evidence: SourceEvidence[];
  group?: string;
  members?: string[];
  paths?: string[];
  owner?: string;
  database?: string;
  model?: string;
  app?: string;
  orm?: 'django' | 'sqlalchemy';
  columns?: GraphColumn[];
  joinTable?: boolean;
  view?: string;
  symbol?: string;
}

export interface GraphColumn {
  name: string;
  primaryKey?: boolean;
  nullable?: boolean;
  foreignKey?: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  confidence: Confidence;
  evidence: SourceEvidence[];
  label?: string;
  field?: string;
  cardinality?: string;
  through?: string;
}

export interface EvidenceGraph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function stableId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
}

export function validateGraph(graph: EvidenceGraph): string[] {
  const problems: string[] = [];
  if (graph.version !== 1) problems.push('Unsupported graph version');
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id || ids.has(node.id)) problems.push(`Duplicate or empty node ID: ${node.id}`);
    ids.add(node.id);
    validateEvidence(node.evidence, `node ${node.id}`, problems);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.id || edgeIds.has(edge.id)) problems.push(`Duplicate or empty edge ID: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push(`Missing endpoint: ${edge.id}`);
    if (!['declared', 'inferred', 'unresolved'].includes(edge.confidence)) problems.push(`Invalid confidence: ${edge.id}`);
    if (edge.confidence !== 'unresolved' && edge.evidence.length === 0) problems.push(`Factual edge lacks evidence: ${edge.id}`);
    validateEvidence(edge.evidence, `edge ${edge.id}`, problems);
  }
  return problems;
}

function validateEvidence(items: SourceEvidence[], owner: string, problems: string[]): void {
  for (const item of items) {
    if (!item.uri || !Number.isInteger(item.line) || item.line < 1 || !item.extractor) {
      problems.push(`Invalid evidence on ${owner}`);
    }
  }
}
