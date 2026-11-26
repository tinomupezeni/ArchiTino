import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseDeepCritiqueResponse,
  buildDeepCritiquePrompt,
  requestDeepAgentCritique,
} from '../src/deepCritique';
import { EvidenceGraph } from '../src/graph';
import { AgentBridge, AgentResponse } from '../src/agentBridge';

test('parseDeepCritiqueResponse parses structured report and recommendations', () => {
  const json = JSON.stringify({
    executiveSummary: 'System shows strong decoupling but high DB read pressure.',
    securityVerdict: 'Safe with Gateway perimeter',
    scalabilityVerdict: 'Bottleneck at single Postgres master',
    reliabilityVerdict: 'Resilient message worker retries',
    recommendations: [
      {
        title: 'Add Read Replica',
        category: 'scalability',
        severity: 'high',
        explanation: 'Primary database handles both analytical and transactional queries.',
        suggestedAction: 'Route GET queries to a replica pool.',
      },
    ],
    revisedMermaid: 'graph TD\\n  A --> B',
  });

  const parsed = parseDeepCritiqueResponse(json);
  assert.equal(parsed.executiveSummary, 'System shows strong decoupling but high DB read pressure.');
  assert.equal(parsed.securityVerdict, 'Safe with Gateway perimeter');
  assert.equal(parsed.recommendations.length, 1);
  assert.equal(parsed.recommendations[0].category, 'scalability');
  assert.equal(parsed.recommendations[0].severity, 'high');
});

test('buildDeepCritiquePrompt formats nodes, edges and PRD context', () => {
  const graph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 's1', kind: 'service', label: 'Auth Service', evidence: [] },
      { id: 'd1', kind: 'database', label: 'Auth DB', evidence: [] },
    ],
    edges: [
      { id: 'e1', from: 's1', to: 'd1', kind: 'writes', confidence: 'declared', evidence: [] },
    ],
  };

  const prompt = buildDeepCritiquePrompt(graph, '# Target PRD: High Throughput Auth');
  assert.ok(prompt.includes('Auth Service'));
  assert.ok(prompt.includes('Auth DB'));
  assert.ok(prompt.includes('Target PRD'));
});

test('requestDeepAgentCritique queries mock agent and returns parsed report', async () => {
  class MockAgentBridge implements AgentBridge {
    readonly id = 'mock-critic';
    readonly name = 'Mock Critic';
    async isAvailable(): Promise<boolean> {
      return true;
    }
    async sendPrompt(_prompt: string): Promise<AgentResponse> {
      return {
        text: JSON.stringify({
          executiveSummary: 'Viable architecture.',
          securityVerdict: 'Good',
          scalabilityVerdict: 'Good',
          reliabilityVerdict: 'Good',
          recommendations: [
            {
              title: 'Add Circuit Breaker',
              category: 'reliability',
              severity: 'medium',
              explanation: 'Avoid cascading timeouts on third-party payment gateway.',
              suggestedAction: 'Wrap payment client in resilience decorator.',
            },
          ],
        }),
      };
    }
  }

  const graph: EvidenceGraph = {
    version: 1,
    nodes: [{ id: 'n1', kind: 'service', label: 'Payment Gateway', evidence: [] }],
    edges: [],
  };

  const report = await requestDeepAgentCritique(graph, new MockAgentBridge());
  assert.equal(report.executiveSummary, 'Viable architecture.');
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.recommendations[0].title, 'Add Circuit Breaker');
});
