import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceGraph, stableId, validateGraph } from '../src/graph';

test('stable IDs are deterministic and sensitive to all parts', () => {
  assert.equal(stableId('file', 'a'), stableId('file', 'a'));
  assert.notEqual(stableId('file', 'a'), stableId('file', 'b'));
  assert.notEqual(stableId('file', 'a'), stableId('edge', 'a'));
});

test('a factual edge requires valid source evidence and existing endpoints', () => {
  const graph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'a', kind: 'service', label: 'A', evidence: [] },
      { id: 'b', kind: 'database', label: 'B', evidence: [] },
    ],
    edges: [{ id: 'edge', from: 'a', to: 'b', kind: 'uses', confidence: 'declared', evidence: [] }],
  };
  assert.match(validateGraph(graph).join(' '), /lacks evidence/);
  graph.edges[0].evidence = [{ uri: 'file:///workspace/a.yml', line: 12, extractor: 'compose' }];
  assert.deepEqual(validateGraph(graph), []);
  graph.edges[0].to = 'missing';
  assert.match(validateGraph(graph).join(' '), /Missing endpoint/);
});
