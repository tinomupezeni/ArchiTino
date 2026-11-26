import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  evaluateArchitectureRules,
  addGraphNode,
  removeGraphNode,
  addGraphEdge,
  removeGraphEdge,
} from '../src/graphSandbox';
import { EvidenceGraph, validateGraph } from '../src/graph';

test('evaluateArchitectureRules catches direct database exposure from client', () => {
  const baseGraph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'service', label: 'Mobile App', evidence: [{ uri: 'doc://1', line: 1, extractor: 'test' }] },
      { id: 'n2', kind: 'database', label: 'Users Postgres DB', evidence: [{ uri: 'doc://1', line: 2, extractor: 'test' }] },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', kind: 'reads', confidence: 'declared', evidence: [{ uri: 'doc://1', line: 3, extractor: 'test' }] },
    ],
  };

  const report = evaluateArchitectureRules(baseGraph);
  const security = report.critiques.filter(c => c.type === 'security');
  assert.equal(security.length, 1);
  assert.match(security[0].title, /Direct Database Exposure/);
  assert.ok(report.overallScore < 100);
});

test('evaluateArchitectureRules detects cyclic synchronous calls', () => {
  const baseGraph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'service', label: 'Payment Service', evidence: [{ uri: 'doc://1', line: 1, extractor: 'test' }] },
      { id: 'n2', kind: 'service', label: 'Notification Service', evidence: [{ uri: 'doc://1', line: 2, extractor: 'test' }] },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', kind: 'calls', confidence: 'declared', evidence: [{ uri: 'doc://1', line: 3, extractor: 'test' }] },
      { id: 'e2', from: 'n2', to: 'n1', kind: 'calls', confidence: 'declared', evidence: [{ uri: 'doc://1', line: 4, extractor: 'test' }] },
    ],
  };

  const report = evaluateArchitectureRules(baseGraph);
  const weakness = report.critiques.filter(c => c.type === 'weakness');
  assert.equal(weakness.length, 1);
  assert.match(weakness[0].title, /Cyclic Synchronous Call/);
});

test('evaluateArchitectureRules recognizes asynchronous decoupling strength with broker', () => {
  const baseGraph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'service', label: 'Producer Service', evidence: [{ uri: 'doc://1', line: 1, extractor: 'test' }] },
      { id: 'n2', kind: 'broker', label: 'Kafka Queue', evidence: [{ uri: 'doc://1', line: 2, extractor: 'test' }] },
      { id: 'n3', kind: 'service', label: 'Consumer Worker', evidence: [{ uri: 'doc://1', line: 3, extractor: 'test' }] },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', kind: 'publishes', confidence: 'declared', evidence: [{ uri: 'doc://1', line: 4, extractor: 'test' }] },
      { id: 'e2', from: 'n3', to: 'n2', kind: 'consumes', confidence: 'declared', evidence: [{ uri: 'doc://1', line: 5, extractor: 'test' }] },
    ],
  };

  const report = evaluateArchitectureRules(baseGraph);
  const strengths = report.critiques.filter(c => c.type === 'strength');
  assert.ok(strengths.some(s => s.title.includes('Asynchronous Decoupling')));
  assert.equal(report.overallScore, 100);
});

test('mutation helpers correctly add and remove nodes and edges preserving graph validity', () => {
  let graph: EvidenceGraph = {
    version: 1,
    nodes: [],
    edges: [],
  };

  // Add nodes
  const r1 = addGraphNode(graph, 'Auth Gateway', 'service');
  graph = r1.graph;
  const r2 = addGraphNode(graph, 'Session Redis', 'cache');
  graph = r2.graph;

  assert.equal(graph.nodes.length, 2);
  assert.equal(validateGraph(graph).length, 0);

  // Add edge
  const r3 = addGraphEdge(graph, r1.node.id, r2.node.id, 'reads', 'get token');
  graph = r3.graph;
  assert.equal(graph.edges.length, 1);
  assert.equal(validateGraph(graph).length, 0);

  // Remove edge
  graph = removeGraphEdge(graph, r3.edge.id);
  assert.equal(graph.edges.length, 0);

  // Remove node
  graph = removeGraphNode(graph, r1.node.id);
  assert.equal(graph.nodes.length, 1);
  assert.equal(validateGraph(graph).length, 0);
});
