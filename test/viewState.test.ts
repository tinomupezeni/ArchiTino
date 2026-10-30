import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeViewState } from '../src/viewState';

test('sanitizeViewState keeps well-formed fields and drops the rest', () => {
  const result = sanitizeViewState({
    hiddenNodeIds: ['abcdef0123456789abcd', 'group:Payments', 'not-an-id', 123],
    labels: { abcdef0123456789abcd: 'Renamed', bad: 'x'.repeat(200) },
    pinned: { abcdef0123456789abcd: { x: 10, y: 20 }, bad: { x: 'nope' } },
    relation: 'http',
    dataMode: 'physical',
    owner: 'payments',
    app: 'billing',
    zoom: 150,
    mode: 'data',
  });
  assert.deepEqual(result.hiddenNodeIds, ['abcdef0123456789abcd', 'group:Payments']);
  assert.deepEqual(result.labels, { abcdef0123456789abcd: 'Renamed' });
  assert.deepEqual(result.pinned, { abcdef0123456789abcd: { x: 10, y: 20 } });
  assert.equal(result.relation, 'http');
  assert.equal(result.dataMode, 'physical');
  assert.equal(result.owner, 'payments');
  assert.equal(result.app, 'billing');
  assert.equal(result.zoom, 150);
  assert.equal(result.mode, 'data');
});

test('sanitizeViewState falls back to defaults for malformed or malicious input', () => {
  const result = sanitizeViewState({
    hiddenNodeIds: 'not-an-array',
    relation: '<script>alert(1)</script>',
    dataMode: 'something-else',
    zoom: 99999,
    mode: 'other',
  });
  assert.deepEqual(result.hiddenNodeIds, []);
  assert.equal(result.relation, 'all');
  assert.equal(result.dataMode, 'domain');
  assert.equal(result.zoom, 180);
  assert.equal(result.mode, undefined);
  assert.equal(sanitizeViewState(null).relation, 'all');
  assert.equal(sanitizeViewState(undefined).dataMode, 'domain');
});

test('sanitizeViewState clamps pinned coordinates and caps large maps', () => {
  const pinned: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < 2005; i++) pinned[i.toString(16).padStart(20, '0')] = { x: 999999, y: -999999 };
  const result = sanitizeViewState({ pinned });
  assert.ok(Object.keys(result.pinned).length <= 2000);
  const first = Object.values(result.pinned)[0];
  assert.equal(first.x, 5000);
  assert.equal(first.y, -5000);
});
