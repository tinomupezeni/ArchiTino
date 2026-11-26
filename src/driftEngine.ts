import { EvidenceGraph } from './graph';

export interface ComponentDriftItem {
  name: string;
  kind: string;
  status: 'matched' | 'missing_in_code' | 'unexpected_in_code';
  detail: string;
}

export interface LinkDriftItem {
  from: string;
  to: string;
  kind: string;
  status: 'matched' | 'missing_in_code' | 'unexpected_in_code';
  detail: string;
}

export interface ArchitectureDriftReport {
  conformanceScore: number; // 0 - 100%
  totalSpecComponents: number;
  totalCodeComponents: number;
  components: ComponentDriftItem[];
  links: LinkDriftItem[];
  summary: string;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function compareSpecVsCodeArchitecture(
  specGraph: EvidenceGraph,
  codeGraph: EvidenceGraph
): ArchitectureDriftReport {
  const specNodes = specGraph.nodes.filter(n => !n.id.startsWith('group:'));
  const codeNodes = codeGraph.nodes.filter(n => !n.id.startsWith('group:'));

  const codeNodeMap = new Map<string, typeof codeNodes[0]>();
  for (const n of codeNodes) {
    codeNodeMap.set(normalizeName(n.label), n);
  }

  const specNodeMap = new Map<string, typeof specNodes[0]>();
  for (const n of specNodes) {
    specNodeMap.set(normalizeName(n.label), n);
  }

  const componentDrifts: ComponentDriftItem[] = [];
  let matchedComponents = 0;

  // 1. Check spec components against code
  for (const sNode of specNodes) {
    const norm = normalizeName(sNode.label);
    if (codeNodeMap.has(norm)) {
      matchedComponents++;
      componentDrifts.push({
        name: sNode.label,
        kind: sNode.kind,
        status: 'matched',
        detail: `Declared in PRD spec and implemented in codebase.`,
      });
    } else {
      componentDrifts.push({
        name: sNode.label,
        kind: sNode.kind,
        status: 'missing_in_code',
        detail: `Specified in PRD but no corresponding service/database found in code.`,
      });
    }
  }

  // 2. Check code components not in spec
  for (const cNode of codeNodes) {
    const norm = normalizeName(cNode.label);
    if (!specNodeMap.has(norm)) {
      componentDrifts.push({
        name: cNode.label,
        kind: cNode.kind,
        status: 'unexpected_in_code',
        detail: `Running in code/compose but not specified in PRD architecture.`,
      });
    }
  }

  // 3. Check Links / Inter-service communication drift
  const linkDrifts: LinkDriftItem[] = [];
  const codeEdges = codeGraph.edges;
  const specEdges = specGraph.edges;

  const codeEdgeSet = new Set<string>();
  for (const e of codeEdges) {
    const fromNode = codeGraph.nodes.find(n => n.id === e.from);
    const toNode = codeGraph.nodes.find(n => n.id === e.to);
    if (fromNode && toNode) {
      codeEdgeSet.add(`${normalizeName(fromNode.label)}->${normalizeName(toNode.label)}`);
    }
  }

  let matchedLinks = 0;

  for (const sEdge of specEdges) {
    const fromNode = specGraph.nodes.find(n => n.id === sEdge.from);
    const toNode = specGraph.nodes.find(n => n.id === sEdge.to);
    if (!fromNode || !toNode) continue;

    const key = `${normalizeName(fromNode.label)}->${normalizeName(toNode.label)}`;
    if (codeEdgeSet.has(key)) {
      matchedLinks++;
      linkDrifts.push({
        from: fromNode.label,
        to: toNode.label,
        kind: sEdge.kind,
        status: 'matched',
        detail: `Connection exists in both PRD spec and code wiring.`,
      });
    } else {
      linkDrifts.push({
        from: fromNode.label,
        to: toNode.label,
        kind: sEdge.kind,
        status: 'missing_in_code',
        detail: `Specified in PRD but no network link, route call, or foreign key found in code.`,
      });
    }
  }

  const totalSpecItems = specNodes.length + specEdges.length;
  const totalMatched = matchedComponents + matchedLinks;
  const conformanceScore = totalSpecItems > 0 ? Math.round((totalMatched / totalSpecItems) * 100) : 100;

  const missingCount = componentDrifts.filter(c => c.status === 'missing_in_code').length;
  const unexpectedCount = componentDrifts.filter(c => c.status === 'unexpected_in_code').length;

  const summary = `Conformance: ${conformanceScore}%. ${matchedComponents} components matched, ${missingCount} missing in code, ${unexpectedCount} undocumented code components.`;

  return {
    conformanceScore,
    totalSpecComponents: specNodes.length,
    totalCodeComponents: codeNodes.length,
    components: componentDrifts,
    links: linkDrifts,
    summary,
  };
}
