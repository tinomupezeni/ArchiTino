import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateDockerComposeFromGraph, generateAdrFromGraph } from '../src/scaffoldGenerator';
import { EvidenceGraph } from '../src/graph';

test('generateDockerComposeFromGraph builds valid services, depends_on, and environment variables', () => {
  const graph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'app1', kind: 'service', label: 'Order Service', evidence: [] },
      { id: 'db1', kind: 'database', label: 'Postgres DB', evidence: [] },
      { id: 'cache1', kind: 'cache', label: 'Redis Cache', evidence: [] },
      { id: 'mq1', kind: 'broker', label: 'RabbitMQ', evidence: [] },
    ],
    edges: [
      { id: 'e1', from: 'app1', to: 'db1', kind: 'writes', confidence: 'declared', evidence: [] },
      { id: 'e2', from: 'app1', to: 'cache1', kind: 'reads', confidence: 'declared', evidence: [] },
      { id: 'e3', from: 'app1', to: 'mq1', kind: 'publishes', confidence: 'declared', evidence: [] },
    ],
  };

  const scaffold = generateDockerComposeFromGraph(graph);
  assert.ok(scaffold.yaml.includes('order-service:'));
  assert.ok(scaffold.yaml.includes('postgres-db:'));
  assert.ok(scaffold.yaml.includes('redis-cache:'));
  assert.ok(scaffold.yaml.includes('rabbitmq:'));
  assert.ok(scaffold.yaml.includes('depends_on:'));
  assert.ok(scaffold.yaml.includes('- postgres-db'));
  assert.ok(scaffold.yaml.includes('- redis-cache'));
  assert.ok(scaffold.yaml.includes('- rabbitmq'));
  assert.ok(scaffold.envExample.includes('POSTGRES_DB_HOST=postgres-db'));
  assert.ok(scaffold.envExample.includes('REDIS_CACHE_URL=redis://redis-cache:6379/0'));
});

test('generateAdrFromGraph produces complete ADR Markdown with Mermaid block', () => {
  const graph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'svc1', kind: 'service', label: 'Payment Gateway', evidence: [] },
      { id: 'svc2', kind: 'service', label: 'Fraud Detection', evidence: [] },
    ],
    edges: [
      { id: 'e1', from: 'svc1', to: 'svc2', kind: 'calls', confidence: 'declared', evidence: [] },
    ],
  };

  const adr = generateAdrFromGraph(graph, 'Payment Gateway Architecture');
  assert.ok(adr.markdown.includes('# ADR: Payment Gateway Architecture'));
  assert.ok(adr.markdown.includes('```mermaid'));
  assert.ok(adr.markdown.includes('flowchart TD'));
  assert.ok(adr.markdown.includes('Payment Gateway (service)'));
  assert.ok(adr.markdown.includes('Fraud Detection (service)'));
});
