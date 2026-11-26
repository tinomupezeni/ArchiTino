import { EvidenceGraph } from './graph';
import { AgentBridge } from './agentBridge';

export interface DeepCritiqueRecommendation {
  title: string;
  category: 'security' | 'reliability' | 'scalability' | 'cost';
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  suggestedAction: string;
}

export interface DeepCritiqueReport {
  executiveSummary: string;
  securityVerdict: string;
  scalabilityVerdict: string;
  reliabilityVerdict: string;
  recommendations: DeepCritiqueRecommendation[];
  revisedMermaid?: string;
}

const DEEP_CRITIQUE_SYSTEM_PROMPT = `You are an elite Principal Software & Systems Architect, SRE Lead, and Security Auditor.
Your task is to analyze a proposed system architecture graph and evaluate its production viability, security posture, resilience under load, and architectural trade-offs.

You must respond ONLY with a valid JSON object matching this schema:
{
  "executiveSummary": "Concise 2-3 sentence overview of this design's viability.",
  "securityVerdict": "Overall security assessment (e.g. Clean / High Risk / Needs Gateway)",
  "scalabilityVerdict": "Overall scalability assessment (e.g. Handles 10k RPS / Monolith DB bottleneck)",
  "reliabilityVerdict": "Overall reliability assessment (e.g. Resilient via async queues / Fragile SPOF)",
  "recommendations": [
    {
      "title": "Introduce Read-Replica or Redis Cache",
      "category": "scalability",
      "severity": "high",
      "explanation": "High read traffic directly hits primary database without caching layer.",
      "suggestedAction": "Add a Redis cache node between Service A and DB"
    }
  ],
  "revisedMermaid": "graph TD\\n  A --> B"
}
Do not wrap in markdown quotes if possible, or if wrapped in markdown \`\`\`json ... \`\`\`, ensure it is clean valid parseable JSON.`;

export function buildDeepCritiquePrompt(graph: EvidenceGraph, prdContext?: string): string {
  const nodeList = graph.nodes.map(n => `- [${n.kind.toUpperCase()}] "${n.label}" (id: ${n.id}${n.group ? ', group: ' + n.group : ''})`).join('\n');
  const edgeList = graph.edges.map(e => {
    const from = graph.nodes.find(n => n.id === e.from)?.label || e.from;
    const to = graph.nodes.find(n => n.id === e.to)?.label || e.to;
    return `- "${from}" --[${e.kind}${e.label ? ': ' + e.label : ''}]--> "${to}"`;
  }).join('\n');

  let prompt = `=== CURRENT ARCHITECTURE TOPOLOGY ===\nComponents:\n${nodeList || 'None'}\n\nInteractions / Links:\n${edgeList || 'None'}\n`;

  if (prdContext) {
    prompt += `\n=== PRD / DESIGN SPEC CONTEXT ===\n${prdContext.slice(0, 4000)}\n`;
  }

  prompt += `\nEvaluate this system topology thoroughly. Provide actionable architectural, security, and scalability critiques in the required JSON format.`;
  return prompt;
}

export function parseDeepCritiqueResponse(rawText: string): DeepCritiqueReport {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(cleaned);

  return {
    executiveSummary: String(parsed.executiveSummary || 'No summary provided.'),
    securityVerdict: String(parsed.securityVerdict || 'Unassessed'),
    scalabilityVerdict: String(parsed.scalabilityVerdict || 'Unassessed'),
    reliabilityVerdict: String(parsed.reliabilityVerdict || 'Unassessed'),
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((r: Record<string, unknown>) => ({
      title: String(r.title || 'Architectural Note'),
      category: (['security', 'reliability', 'scalability', 'cost'].includes(String(r.category)) ? r.category : 'reliability') as DeepCritiqueRecommendation['category'],
      severity: (['high', 'medium', 'low'].includes(String(r.severity)) ? r.severity : 'medium') as DeepCritiqueRecommendation['severity'],
      explanation: String(r.explanation || ''),
      suggestedAction: String(r.suggestedAction || ''),
    })) : [],
    revisedMermaid: typeof parsed.revisedMermaid === 'string' ? parsed.revisedMermaid : undefined,
  };
}

export async function requestDeepAgentCritique(
  graph: EvidenceGraph,
  agent: AgentBridge,
  prdContext?: string
): Promise<DeepCritiqueReport> {
  const prompt = buildDeepCritiquePrompt(graph, prdContext);
  const response = await agent.sendPrompt(prompt, { systemPrompt: DEEP_CRITIQUE_SYSTEM_PROMPT });
  return parseDeepCritiqueResponse(response.text);
}
