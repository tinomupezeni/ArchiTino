import { EvidenceGraph, GraphNode, GraphEdge, NodeKind, stableId } from './graph';

export interface CritiqueItem {
  type: 'strength' | 'weakness' | 'security';
  title: string;
  detail: string;
  nodeIds?: string[];
  edgeIds?: string[];
}

export interface GraphCritiqueReport {
  overallScore: number; // 0 - 100
  critiques: CritiqueItem[];
}

export function evaluateArchitectureRules(graph: EvidenceGraph): GraphCritiqueReport {
  const critiques: CritiqueItem[] = [];

  const nodeMap = new Map<string, GraphNode>();
  const inEdges = new Map<string, GraphEdge[]>();
  const outEdges = new Map<string, GraphEdge[]>();

  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
    inEdges.set(node.id, []);
    outEdges.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (outEdges.has(edge.from)) outEdges.get(edge.from)!.push(edge);
    if (inEdges.has(edge.to)) inEdges.get(edge.to)!.push(edge);
  }

  // 1. Security Check: Direct Client/Public Ingress to Database
  for (const node of graph.nodes) {
    if (node.kind === 'database') {
      const incoming = inEdges.get(node.id) || [];
      for (const edge of incoming) {
        const caller = nodeMap.get(edge.from);
        if (caller && /client|frontend|web|browser|mobile|public|gateway/i.test(caller.label)) {
          critiques.push({
            type: 'security',
            title: `Direct Database Exposure: ${caller.label} -> ${node.label}`,
            detail: `External client "${caller.label}" connects directly to database "${node.label}" without an intermediary application or authentication service.`,
            nodeIds: [caller.id, node.id],
            edgeIds: [edge.id],
          });
        }
      }
    }
  }

  // 2. Reliability: Single Point of Failure (SPOF)
  for (const node of graph.nodes) {
    const incoming = inEdges.get(node.id) || [];
    const outgoing = outEdges.get(node.id) || [];
    if (incoming.length >= 3 && node.kind === 'service' && outgoing.length > 0) {
      critiques.push({
        type: 'weakness',
        title: `Potential Single Point of Failure: ${node.label}`,
        detail: `Service "${node.label}" handles critical fan-in traffic from ${incoming.length} upstream components. Failure or cascade timeouts here will disrupt the system.`,
        nodeIds: [node.id],
      });
    }
  }

  // 3. Resilience: Isolated Nodes
  for (const node of graph.nodes) {
    const incoming = inEdges.get(node.id) || [];
    const outgoing = outEdges.get(node.id) || [];
    if (incoming.length === 0 && outgoing.length === 0 && graph.nodes.length > 1) {
      critiques.push({
        type: 'weakness',
        title: `Isolated Component: ${node.label}`,
        detail: `Component "${node.label}" has no inbound or outbound connections.`,
        nodeIds: [node.id],
      });
    }
  }

  // 4. Coupling: Cyclic Direct Calls
  for (const edge of graph.edges) {
    if (edge.kind === 'calls') {
      const returnEdge = (outEdges.get(edge.to) || []).find(e => e.to === edge.from && e.kind === 'calls');
      if (returnEdge && edge.from < edge.to) { // avoid double reporting
        const n1 = nodeMap.get(edge.from);
        const n2 = nodeMap.get(edge.to);
        critiques.push({
          type: 'weakness',
          title: `Cyclic Synchronous Call: ${n1?.label || edge.from} <-> ${n2?.label || edge.to}`,
          detail: `Direct synchronous mutual call between "${n1?.label}" and "${n2?.label}" creates tight circular coupling and deadlock risks under load.`,
          nodeIds: [edge.from, edge.to],
          edgeIds: [edge.id, returnEdge.id],
        });
      }
    }
  }

  // 5. Strengths: Asynchronous Decoupling via Queue / Cache
  const brokerNodes = graph.nodes.filter(n => n.kind === 'broker' || /queue|kafka|rabbitmq|pubsub|redis/i.test(n.label));
  if (brokerNodes.length > 0) {
    critiques.push({
      type: 'strength',
      title: `Asynchronous Decoupling Enabled`,
      detail: `Message broker / queue components (${brokerNodes.map(n => n.label).join(', ')}) decouple asynchronous event publishing from consumers.`,
      nodeIds: brokerNodes.map(n => n.id),
    });
  }

  // 6. Strengths: Gateway Abstraction
  const gatewayNodes = graph.nodes.filter(n => /gateway|bff|proxy/i.test(n.label));
  if (gatewayNodes.length > 0) {
    critiques.push({
      type: 'strength',
      title: `Gateway Boundary Protection`,
      detail: `Gateway component (${gatewayNodes.map(n => n.label).join(', ')}) provides a single perimeter for auth, rate-limiting, and routing.`,
      nodeIds: gatewayNodes.map(n => n.id),
    });
  }

  let penalty = 0;
  for (const c of critiques) {
    if (c.type === 'security') penalty += 35;
    if (c.type === 'weakness') penalty += 15;
  }

  const bonus = critiques.filter(c => c.type === 'strength').length * 10;
  const overallScore = Math.max(0, Math.min(100, 100 - penalty + bonus));

  return {
    overallScore,
    critiques,
  };
}

export function addGraphNode(
  graph: EvidenceGraph,
  label: string,
  kind: NodeKind,
  group: string = 'Custom'
): { graph: EvidenceGraph; node: GraphNode } {
  const id = stableId('custom-node', label, kind, String(Date.now()));
  const node: GraphNode = {
    id,
    kind,
    label,
    group,
    evidence: [{ uri: 'custom://archi/sandbox', line: 1, extractor: 'archi-sandbox' }],
  };

  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, node],
    },
    node,
  };
}

export function removeGraphNode(graph: EvidenceGraph, nodeId: string): EvidenceGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(n => n.id !== nodeId),
    edges: graph.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
  };
}

export function addGraphEdge(
  graph: EvidenceGraph,
  fromId: string,
  toId: string,
  kind: string = 'calls',
  label?: string
): { graph: EvidenceGraph; edge: GraphEdge } {
  const edgeId = stableId('custom-edge', fromId, toId, kind, label || '', String(Date.now()));
  const edge: GraphEdge = {
    id: edgeId,
    from: fromId,
    to: toId,
    kind,
    confidence: 'inferred',
    label,
    evidence: [{ uri: 'custom://archi/sandbox', line: 1, extractor: 'archi-sandbox' }],
  };

  return {
    graph: {
      ...graph,
      edges: [...graph.edges, edge],
    },
    edge,
  };
}

export function removeGraphEdge(graph: EvidenceGraph, edgeId: string): EvidenceGraph {
  return {
    ...graph,
    edges: graph.edges.filter(e => e.id !== edgeId),
  };
}
