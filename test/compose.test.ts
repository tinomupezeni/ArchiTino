import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCompose } from '../src/compose';
import { validateGraph } from '../src/graph';

const example = [
  'x-common: &common',
  '  API_URL: http://api:8000',
  'services:',
  '  web-blue:',
  '    environment:',
  '      <<: *common',
  '    depends_on:',
  '      - api',
  '    networks: [shared]',
  '  web-green:',
  '    environment:',
  '      <<: *common',
  '  api:',
  '    environment:',
  '      POSTGRES_HOST: db',
  '      POSTGRES_DB: app_data',
  '  db:',
  '    image: postgres:16',
  '    networks: [shared]',
  '  stranger:',
  '    networks: [shared]',
  'networks:',
  '  shared: {}',
].join('\n');

test('Compose resolves anchors, groups variants, and keeps networks from becoming calls', () => {
  const result = analyzeCompose(example, 'file:///workspace/compose.yml');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(validateGraph(result.graph), []);
  const web = result.graph.nodes.find(node => node.label === 'web');
  const api = result.graph.nodes.find(node => node.label === 'api');
  const db = result.graph.nodes.find(node => node.label === 'app_data');
  const stranger = result.graph.nodes.find(node => node.label === 'stranger');
  assert.ok(web && api && db && stranger);
  assert.deepEqual(web.members, ['web-blue', 'web-green']);
  assert.ok(result.graph.edges.some(edge => edge.from === web.id && edge.to === api.id && edge.kind === 'http'));
  assert.ok(result.graph.edges.some(edge => edge.from === api.id && edge.to === db.id && edge.kind === 'database'));
  assert.equal(result.graph.edges.some(edge => edge.from === stranger.id && edge.to === db.id), false);
  assert.equal(result.graph.edges.some(edge => edge.from === stranger.id && edge.to === web.id), false);
  assert.ok(result.graph.edges.every(edge => edge.evidence.every(item => item.line > 0)));
});

test('bad YAML reports a diagnostic without creating guessed facts', () => {
  const result = analyzeCompose('services:\n  bad: [\n', 'file:///workspace/compose.yml');
  assert.ok(result.diagnostics.length);
  assert.equal(result.graph.edges.length, 0);
});

test('explicit aliases and groups override default naming without changing evidence', () => {
  const result = analyzeCompose(example, 'file:///workspace/compose.yml', {
    serviceAliases: { 'web-blue': 'frontend', 'web-green': 'frontend' },
    serviceGroups: { frontend: 'Clients' },
  });
  const frontend = result.graph.nodes.find(node => node.label === 'frontend');
  assert.ok(frontend);
  assert.equal(frontend.group, 'Clients');
  assert.deepEqual(frontend.members, ['web-blue', 'web-green']);
  assert.ok(result.graph.edges.some(edge => edge.from === frontend.id && edge.evidence.length > 0));
});
