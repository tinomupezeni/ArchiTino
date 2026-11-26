import { EvidenceGraph, GraphNode, GraphEdge, NodeKind, stableId } from './graph';
import { AgentBridge } from './agentBridge';

export interface PrdSynthesizedNode {
  name: string;
  kind: 'service' | 'database' | 'cache' | 'broker' | 'module' | 'route' | 'task';
  description?: string;
  sourceLine?: number;
}

export interface PrdSynthesizedEdge {
  from: string;
  to: string;
  kind: 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'depends_on';
  label?: string;
  sourceLine?: number;
}

export interface PrdArchitectureResult {
  title: string;
  summary: string;
  nodes: PrdSynthesizedNode[];
  edges: PrdSynthesizedEdge[];
  strengths: string[];
  weaknesses: string[];
  securityRisks: string[];
  mermaid: string;
}

const SYSTEM_PROMPT = `You are a Principal Software Architect and Systems Design Specialist.
Your task is to analyze a Product Requirements Document (PRD) or technical design specification and extract:
1. Core system components / architecture nodes (e.g. services, databases, caches, message brokers, external gateways).
2. Directed relationships and interactions between them (calls, reads, writes, publishes, consumes, depends_on).
3. Initial architectural critique: strengths, weaknesses, and potential security risks of the proposed design.
4. Clean Mermaid diagram syntax representing the flow.

You must respond ONLY with a valid JSON object matching this schema:
{
  "title": "Short architecture title",
  "summary": "Brief 1-3 sentence architecture summary",
  "nodes": [
    { "name": "Auth Service", "kind": "service", "description": "Handles authentication and tokens", "sourceLine": 12 }
  ],
  "edges": [
    { "from": "Web App", "to": "Auth Service", "kind": "calls", "label": "POST /auth/login", "sourceLine": 15 }
  ],
  "strengths": ["Clear domain separation", "Decoupled async worker queue"],
  "weaknesses": ["Direct database coupling between Service A and Service B"],
  "securityRisks": ["Missing rate limiting on authentication endpoint"],
  "mermaid": "graph TD\\n  A[Web App] -->|POST /auth/login| B[Auth Service]"
}
Do not wrap in markdown quotes if possible, or if wrapped in markdown \`\`\`json ... \`\`\`, ensure it is clean valid parseable JSON.`;

export function buildPrdPrompt(prdText: string, filename: string): string {
  return `PRD Document File: ${filename}\n\n=== PRD CONTENT START ===\n${prdText}\n=== PRD CONTENT END ===\n\nAnalyze this PRD and return the architecture JSON object.`;
}

export function parseAgentPrdResponse(rawText: string): PrdArchitectureResult {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  // Find first '{' and last '}' in case the model prefixed or postfixed conversational text
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(cleaned);

  return {
    title: String(parsed.title || 'PRD Architecture Flow'),
    summary: String(parsed.summary || ''),
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes.map((n: Record<string, unknown>) => ({
      name: String(n.name || 'Component'),
      kind: (n.kind as PrdSynthesizedNode['kind']) || 'service',
      description: typeof n.description === 'string' ? n.description : undefined,
      sourceLine: typeof n.sourceLine === 'number' ? n.sourceLine : 1,
    })) : [],
    edges: Array.isArray(parsed.edges) ? parsed.edges.map((e: Record<string, unknown>) => ({
      from: String(e.from || ''),
      to: String(e.to || ''),
      kind: (e.kind as PrdSynthesizedEdge['kind']) || 'calls',
      label: typeof e.label === 'string' ? e.label : undefined,
      sourceLine: typeof e.sourceLine === 'number' ? e.sourceLine : 1,
    })) : [],
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String) : [],
    securityRisks: Array.isArray(parsed.securityRisks) ? parsed.securityRisks.map(String) : [],
    mermaid: String(parsed.mermaid || ''),
  };
}

export function convertPrdResultToEvidenceGraph(result: PrdArchitectureResult, prdUri: string): EvidenceGraph {
  const nameToId = new Map<string, string>();
  const nodes: GraphNode[] = [];

  for (const item of result.nodes) {
    const id = stableId('prd', prdUri, item.name);
    nameToId.set(item.name.toLowerCase().trim(), id);

    nodes.push({
      id,
      kind: item.kind as NodeKind,
      label: item.name,
      evidence: [
        {
          uri: prdUri,
          line: item.sourceLine ?? 1,
          extractor: 'prd-agent',
        },
      ],
      group: 'PRD Architecture',
    });
  }

  const edges: GraphEdge[] = [];

  for (const item of result.edges) {
    const fromId = nameToId.get(item.from.toLowerCase().trim());
    const toId = nameToId.get(item.to.toLowerCase().trim());

    if (!fromId || !toId) {
      continue;
    }

    const edgeId = stableId('prd-edge', fromId, toId, item.kind, item.label || '');
    edges.push({
      id: edgeId,
      from: fromId,
      to: toId,
      kind: item.kind,
      confidence: 'inferred',
      label: item.label,
      evidence: [
        {
          uri: prdUri,
          line: item.sourceLine ?? 1,
          extractor: 'prd-agent',
        },
      ],
    });
  }

  return {
    version: 1,
    nodes,
    edges,
  };
}

export async function synthesizeArchitectureFromPrd(
  prdContent: string,
  filename: string,
  prdUri: string,
  agent: AgentBridge
): Promise<{ result: PrdArchitectureResult; graph: EvidenceGraph }> {
  const prompt = buildPrdPrompt(prdContent, filename);
  const response = await agent.sendPrompt(prompt, { systemPrompt: SYSTEM_PROMPT });
  const result = parseAgentPrdResponse(response.text);
  const graph = convertPrdResultToEvidenceGraph(result, prdUri);
  return { result, graph };
}
