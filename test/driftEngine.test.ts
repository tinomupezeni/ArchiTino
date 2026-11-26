import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { compareSpecVsCodeArchitecture } from '../src/driftEngine';
import { EvidenceGraph } from '../src/graph';

test('compareSpecVsCodeArchitecture detects matched, missing, and unexpected components', () => {
  const specGraph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 's1', kind: 'service', label: 'Auth Service', evidence: [] },
      { id: 's2', kind: 'service', label: 'Billing Service', evidence: [] },
      { id: 's3', kind: 'database', label: 'Auth DB', evidence: [] },
    ],
    edges: [
      { id: 'se1', from: 's1', to: 's3', kind: 'writes', confidence: 'declared', evidence: [] },
      { id: 'se2', from: 's1', to: 's2', kind: 'calls', confidence: 'declared', evidence: [] },
    ],
  };

  const codeGraph: EvidenceGraph = {
    version: 1,
    nodes: [
      { id: 'c1', kind: 'service', label: 'Auth Service', evidence: [] },
      { id: 'c3', kind: 'database', label: 'Auth DB', evidence: [] },
      { id: 'c4', kind: 'cache', label: 'Redis Session Cache', evidence: [] }, // Undocumented in spec
    ],
    edges: [
      { id: 'ce1', from: 'c1', to: 'c3', kind: 'writes', confidence: 'declared', evidence: [] },
    ],
  };

  const drift = compareSpecVsCodeArchitecture(specGraph, codeGraph);

  assert.ok(drift.conformanceScore < 100);
  assert.equal(drift.totalSpecComponents, 3);
  assert.equal(drift.totalCodeComponents, 3);

  const matchedComp = drift.components.find(c => c.name === 'Auth Service');
  assert.equal(matchedComp?.status, 'matched');

  const missingComp = drift.components.find(c => c.name === 'Billing Service');
  assert.equal(missingComp?.status, 'missing_in_code');

  const unexpectedComp = drift.components.find(c => c.name === 'Redis Session Cache');
  assert.equal(unexpectedComp?.status, 'unexpected_in_code');

  const matchedLink = drift.links.find(l => l.from === 'Auth Service' && l.to === 'Auth DB');
  assert.equal(matchedLink?.status, 'matched');

  const missingLink = drift.links.find(l => l.from === 'Auth Service' && l.to === 'Billing Service');
  assert.equal(missingLink?.status, 'missing_in_code');
});
