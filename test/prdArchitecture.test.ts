import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseAgentPrdResponse,
  convertPrdResultToEvidenceGraph,
  synthesizeArchitectureFromPrd,
  PrdArchitectureResult,
} from '../src/prdArchitecture';
import { AgentBridge, AgentResponse } from '../src/agentBridge';
import { validateGraph } from '../src/graph';

test('parseAgentPrdResponse handles clean JSON', () => {
  const json = JSON.stringify({
    title: 'Order Processing System',
    summary: 'Handles user orders and payment flows asynchronously.',
    nodes: [
      { name: 'API Gateway', kind: 'service', description: 'Public entry point', sourceLine: 10 },
      { name: 'Order Service', kind: 'service', description: 'Order processing', sourceLine: 20 },
      { name: 'Order DB', kind: 'database', description: 'Postgres order store', sourceLine: 25 },
    ],
    edges: [
      { from: 'API Gateway', to: 'Order Service', kind: 'calls', label: 'POST /orders', sourceLine: 12 },
      { from: 'Order Service', to: 'Order DB', kind: 'writes', label: 'insert order', sourceLine: 22 },
    ],
    strengths: ['Clear service boundary'],
    weaknesses: ['Synchronous checkout bottleneck'],
    securityRisks: ['Unencrypted payment token storage'],
    mermaid: 'graph TD\\n  A[API Gateway] --> B[Order Service]',
  });

  const parsed = parseAgentPrdResponse(json);
  assert.equal(parsed.title, 'Order Processing System');
  assert.equal(parsed.nodes.length, 3);
  assert.equal(parsed.edges.length, 2);
  assert.equal(parsed.strengths.length, 1);
  assert.equal(parsed.weaknesses.length, 1);
  assert.equal(parsed.securityRisks.length, 1);
});

test('parseAgentPrdResponse handles markdown code blocks and conversational text', () => {
  const raw = `Here is the architecture based on your PRD:
\`\`\`json
{
  "title": "Notification Engine",
  "summary": "Sends notifications.",
  "nodes": [
    { "name": "Worker", "kind": "service" }
  ],
  "edges": [],
  "strengths": ["Lightweight"],
  "weaknesses": [],
  "securityRisks": []
}
\`\`\`
Let me know if you want changes!`;

  const parsed = parseAgentPrdResponse(raw);
  assert.equal(parsed.title, 'Notification Engine');
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].name, 'Worker');
});

test('convertPrdResultToEvidenceGraph creates a valid EvidenceGraph with stable IDs and evidence', () => {
  const sampleResult: PrdArchitectureResult = {
    title: 'Chat System',
    summary: 'Realtime chat',
    nodes: [
      { name: 'Web Client', kind: 'service', sourceLine: 5 },
      { name: 'Chat Service', kind: 'service', sourceLine: 15 },
      { name: 'Redis PubSub', kind: 'cache', sourceLine: 25 },
    ],
    edges: [
      { from: 'Web Client', to: 'Chat Service', kind: 'calls', label: 'WebSocket', sourceLine: 8 },
      { from: 'Chat Service', to: 'Redis PubSub', kind: 'publishes', label: 'messages', sourceLine: 18 },
    ],
    strengths: ['Low latency'],
    weaknesses: [],
    securityRisks: ['No message rate limiting'],
    mermaid: 'graph TD\\n  A --> B',
  };

  const prdUri = 'file:///workspace/docs/PRD.md';
  const graph = convertPrdResultToEvidenceGraph(sampleResult, prdUri);

  const problems = validateGraph(graph);
  assert.deepEqual(problems, []);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes[0].evidence[0].uri, prdUri);
  assert.equal(graph.nodes[0].evidence[0].line, 5);
  assert.equal(graph.edges[0].evidence[0].line, 8);
});

test('synthesizeArchitectureFromPrd calls agent bridge and returns validated result', async () => {
  class MockAgentBridge implements AgentBridge {
    readonly id = 'mock-agent';
    readonly name = 'Mock Agent';
    async isAvailable(): Promise<boolean> {
      return true;
    }
    async sendPrompt(_prompt: string): Promise<AgentResponse> {
      return {
        text: JSON.stringify({
          title: 'Mock Architecture',
          summary: 'Mocked for testing',
          nodes: [
            { name: 'Service A', kind: 'service', sourceLine: 1 },
            { name: 'DB A', kind: 'database', sourceLine: 2 },
          ],
          edges: [
            { from: 'Service A', to: 'DB A', kind: 'writes', label: 'persist', sourceLine: 3 },
          ],
          strengths: ['Mock strength'],
          weaknesses: ['Mock weakness'],
          securityRisks: ['Mock risk'],
          mermaid: 'graph TD\\n  A --> B',
        }),
      };
    }
  }

  const agent = new MockAgentBridge();
  const prdUri = 'file:///workspace/PRD.md';
  const { result, graph } = await synthesizeArchitectureFromPrd('# My PRD', 'PRD.md', prdUri, agent);

  assert.equal(result.title, 'Mock Architecture');
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(validateGraph(graph).length, 0);
});
