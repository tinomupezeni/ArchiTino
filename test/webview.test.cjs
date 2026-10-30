const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { analyzeCompose } = require('../dist/src/compose');
const { analyzePythonModels } = require('../dist/src/pythonModels');

const BODY = '<p id="subtitle"></p><p id="coverage" hidden></p><ul id="diagnostics"></ul>'
  + '<button id="back" hidden></button><nav id="breadcrumbs"></nav>'
  + '<select id="view-mode"><option value="system">System</option><option value="data">Data</option><option value="components">Flows</option></select>'
  + '<select id="owner"></select><select id="app"></select>'
  + '<select id="data-mode"><option value="domain">Domain</option><option value="physical">Physical</option></select>'
  + '<button id="overview"></button><input id="search">'
  + '<select id="relation"><option value="all">All</option><option value="redis">Redis</option></select>'
  + '<input id="zoom" value="100"><button id="unhide" hidden></button>'
  + '<select id="export-format"><option value="svg">SVG</option><option value="png">PNG</option><option value="mermaid">Mermaid</option></select><button id="export"></button>'
  + '<p id="budget-warning" hidden role="status" aria-live="polite"></p>'
  + '<div id="canvas"></div><aside id="details"></aside>';

function mount(initialMessage) {
  const dom = new JSDOM(BODY, { runScripts: 'outside-only' });
  const posted = [];
  dom.window.acquireVsCodeApi = () => ({ postMessage: message => posted.push(message) });
  dom.window.structuredClone = structuredClone;
  const dagreScript = fs.readFileSync(path.join(__dirname, '../media/vendor/dagre.min.js'), 'utf8');
  dom.window.eval('(function(){' + dagreScript + '\nwindow.dagre = dagre;})();');
  const script = fs.readFileSync(path.join(__dirname, '../media/main.js'), 'utf8');
  dom.window.eval(script);
  if (initialMessage) dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: initialMessage }));
  return { dom, posted };
}

function buttonWithText(dom, label) {
  return [...dom.window.document.querySelectorAll('#details button')].find(node => node.textContent === label);
}

test('system map groups services, explores an area, and offers source evidence', () => {
  const source = 'services:\n  student-backend:\n    environment:\n      REDIS_URL: redis://redis:6379/0\n  redis:\n    image: redis:7\n';
  const graph = analyzeCompose(source, 'file:///workspace/compose.yml').graph;
  const { dom, posted } = mount();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'ready');
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph, subtitle: 'test', diagnostics: [] } }));
  assert.equal(dom.window.document.querySelectorAll('.map-node').length, 2);
  assert.equal(dom.window.document.querySelectorAll('.link-hit').length, 1);
  const student = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('Student'));
  student.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const explore = buttonWithText(dom, 'Explore area');
  explore.click();
  assert.ok([...dom.window.document.querySelectorAll('.map-node')].some(node => node.getAttribute('aria-label').includes('student-backend')));
  dom.window.document.querySelector('.link-hit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(dom.window.document.getElementById('details').textContent, /REDIS_URL/);
  dom.window.document.querySelector('#details button').click();
  assert.ok(posted.some(message => message.type === 'openSource' && Number.isInteger(message.evidenceIndex)));
  dom.window.close();
});

function translateOf(node) {
  const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute('transform') || '');
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

test('the default System view ranks groups by dependency direction instead of a fixed grid', () => {
  const source = 'services:\n  payments:\n    build: .\n    environment:\n      POSTGRES_DB: hbec_payments\n';
  const graph = analyzeCompose(source, 'file:///workspace/compose.yml').graph;
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph, subtitle: 'test', diagnostics: [] } }));
  const nodes = [...dom.window.document.querySelectorAll('.map-node')];
  const paymentsGroup = nodes.find(node => node.getAttribute('aria-label').includes('Payments'));
  const infrastructureGroup = nodes.find(node => node.getAttribute('aria-label').includes('Infrastructure'));
  assert.ok(paymentsGroup && infrastructureGroup, 'expected both a Payments and an Infrastructure group node');
  const paymentsPos = translateOf(paymentsGroup);
  const infrastructurePos = translateOf(infrastructureGroup);
  assert.ok(paymentsPos.y < infrastructurePos.y, 'Payments (the dependent) should be ranked above Infrastructure (its database), not placed by alphabetical/fixed order');
  dom.window.close();
});

test('the focused drill-down view keeps its simple per-row grid, not the dagre layout', () => {
  const source = 'services:\n  student-backend:\n    environment:\n      REDIS_URL: redis://redis:6379/0\n  redis:\n    image: redis:7\n';
  const graph = analyzeCompose(source, 'file:///workspace/compose.yml').graph;
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph, subtitle: 'test', diagnostics: [] } }));
  const student = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('Student'));
  student.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  buttonWithText(dom, 'Explore area').click();
  const service = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('student-backend'));
  const pos = translateOf(service);
  assert.deepEqual(pos, { x: 60, y: 55 }, 'the focused view should keep its first-slot grid position, unaffected by the dagre layout change');
  dom.window.close();
});

test('data mode switches between model and physical table views', () => {
  const source = [
    'from django.db import models',
    'class Tag(models.Model):',
    '    name = models.CharField(max_length=80)',
    'class Book(models.Model):',
    '    author = models.ForeignKey("accounts.Author", on_delete=models.CASCADE)',
    '    tags = models.ManyToManyField("catalog.Tag")',
    '    class Meta:',
    '        db_table = "books"',
  ].join('\n');
  const authorSource = 'from django.db import models\nclass Author(models.Model):\n    name = models.CharField(max_length=80)\n';
  const dataGraph = analyzePythonModels([
    { uri: 'file:///workspace/catalog/models.py', relativePath: 'svc/apps/catalog/models.py', source, owner: 'svc', database: 'db' },
    { uri: 'file:///workspace/accounts/models.py', relativePath: 'svc/apps/accounts/models.py', source: authorSource, owner: 'svc', database: 'db' },
  ]).graph;
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph: { nodes: [], edges: [] }, dataGraph, subtitle: 'data', diagnostics: [] } }));
  const view = dom.window.document.getElementById('view-mode');
  view.value = 'data';
  view.dispatchEvent(new dom.window.Event('change'));
  const app = dom.window.document.getElementById('app');
  app.value = 'catalog';
  app.dispatchEvent(new dom.window.Event('change'));
  assert.equal(dom.window.document.querySelectorAll('.map-node').length, 3);
  assert.ok([...dom.window.document.querySelectorAll('.map-node')].some(node => node.getAttribute('aria-label').includes('Book')));
  assert.equal(dom.window.document.querySelectorAll('.map-node.outside').length, 1);
  const mode = dom.window.document.getElementById('data-mode');
  mode.value = 'physical';
  mode.dispatchEvent(new dom.window.Event('change'));
  assert.equal(dom.window.document.querySelectorAll('.map-node').length, 4);
  assert.ok([...dom.window.document.querySelectorAll('.map-node')].some(node => node.getAttribute('aria-label').includes('books_tags')));
  dom.window.close();
});

test('unified navigation crosses from a system service to its data and back', () => {
  const composeSource = 'services:\n  payments:\n    build: .\n';
  const systemGraph = analyzeCompose(composeSource, 'file:///workspace/compose.yml').graph;
  const modelSource = 'from django.db import models\nclass Payment(models.Model):\n    amount = models.CharField(max_length=10)\n';
  const dataGraph = analyzePythonModels([
    { uri: 'file:///workspace/payments/models.py', relativePath: 'payments/models.py', source: modelSource, owner: 'payments', database: 'hbec_payments' },
  ]).graph;
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph: systemGraph, dataGraph, subtitle: 'test', diagnostics: [] } }));
  const paymentsGroup = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('Payments'));
  assert.ok(paymentsGroup, 'expected a Payments area node');
  paymentsGroup.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  buttonWithText(dom, 'Explore area').click();
  const paymentsNode = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('payments'));
  assert.ok(paymentsNode, 'expected a payments service node');
  paymentsNode.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const exploreData = buttonWithText(dom, 'Explore data');
  assert.ok(exploreData, 'expected an Explore data action on the service node');
  exploreData.click();
  assert.equal(dom.window.document.getElementById('view-mode').value, 'data');
  assert.equal(dom.window.document.getElementById('owner').value, 'payments');
  assert.ok([...dom.window.document.querySelectorAll('.map-node')].some(node => node.getAttribute('aria-label').includes('Payment')));
  const paymentTable = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('Payment'));
  paymentTable.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const openInSystem = buttonWithText(dom, 'Open in system map');
  assert.ok(openInSystem, 'expected a return path to the system map');
  openInSystem.click();
  assert.equal(dom.window.document.getElementById('view-mode').value, 'system');
  assert.ok([...dom.window.document.querySelectorAll('.map-node')].some(node => node.getAttribute('aria-label').includes('payments')));
  assert.equal(dom.window.document.getElementById('back').hidden, false);
  dom.window.document.getElementById('back').click();
  assert.equal(dom.window.document.getElementById('view-mode').value, 'data');
  dom.window.close();
});

test('hiding and unhiding a node updates the visible map and persists view state', async () => {
  const source = 'services:\n  student-backend:\n    environment:\n      REDIS_URL: redis://redis:6379/0\n  redis:\n    image: redis:7\n';
  const graph = analyzeCompose(source, 'file:///workspace/compose.yml').graph;
  const { dom, posted } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph, subtitle: 'test', diagnostics: [] } }));
  const before = dom.window.document.querySelectorAll('.map-node').length;
  const student = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('Student'));
  student.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  buttonWithText(dom, 'Explore area').click();
  const service = [...dom.window.document.querySelectorAll('.map-node')].find(node => node.getAttribute('aria-label').includes('student-backend'));
  service.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  buttonWithText(dom, 'Hide').click();
  assert.ok(![...dom.window.document.querySelectorAll('.map-node')].some(node => node.getAttribute('aria-label').includes('student-backend')));
  await new Promise(resolve => setTimeout(resolve, 450));
  const saved = posted.find(message => message.type === 'saveView');
  assert.ok(saved, 'expected a saveView message after hiding a node');
  assert.equal(saved.viewState.hiddenNodeIds.length, 1);
  const unhide = dom.window.document.getElementById('unhide');
  assert.equal(unhide.hidden, false);
  unhide.click();
  assert.equal(dom.window.document.querySelectorAll('.map-node').length, before);
  dom.window.close();
});

test('the Flows view shows a service\'s routes and tasks and links back to the system map', () => {
  const composeSource = 'services:\n  student-backend:\n    build: .\n';
  const systemGraph = analyzeCompose(composeSource, 'file:///workspace/compose.yml').graph;
  const serviceId = systemGraph.nodes.find(node => node.label === 'student-backend').id;
  const componentGraph = {
    version: 1,
    nodes: [
      { id: serviceId, kind: 'service', label: 'student-backend', evidence: [] },
      { id: 'route1', kind: 'route', label: '/api/auth/login', owner: 'student-backend', app: 'accounts', view: 'StudentLoginView', evidence: [{ uri: 'file:///workspace/apps/accounts/urls.py', line: 44, extractor: 'django-urls' }] },
      { id: 'route2', kind: 'route', label: '/api/practice/sessions', owner: 'student-backend', app: 'practice', view: 'PracticeSessionView', evidence: [{ uri: 'file:///workspace/apps/practice/urls.py', line: 7, extractor: 'django-urls' }] },
      { id: 'task1', kind: 'task', label: 'send_password_reset_email_task', owner: 'student-backend', app: 'accounts', symbol: 'send_password_reset_email_task', evidence: [{ uri: 'file:///workspace/apps/accounts/tasks.py', line: 211, extractor: 'celery-task' }, { uri: 'file:///workspace/apps/accounts/views.py', line: 1332, extractor: 'celery-trigger' }] },
    ],
    edges: [
      { id: 'serves1', from: serviceId, to: 'route1', kind: 'serves', confidence: 'declared', evidence: [{ uri: 'file:///workspace/apps/accounts/urls.py', line: 44, extractor: 'django-urls' }] },
      { id: 'serves2', from: serviceId, to: 'route2', kind: 'serves', confidence: 'declared', evidence: [{ uri: 'file:///workspace/apps/practice/urls.py', line: 7, extractor: 'django-urls' }] },
    ],
  };
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph: systemGraph, componentGraph, subtitle: 'test', diagnostics: [] } }));
  assert.equal(dom.window.document.getElementById('view-mode').querySelector('[value=components]').disabled, false);
  const view = dom.window.document.getElementById('view-mode');
  view.value = 'components';
  view.dispatchEvent(new dom.window.Event('change'));
  const owner = dom.window.document.getElementById('owner');
  owner.value = 'student-backend';
  owner.dispatchEvent(new dom.window.Event('change'));
  const app = dom.window.document.getElementById('app');
  assert.equal(app.hidden, false, 'expected an app filter in the Flows view, since one service can own many routes across apps');
  assert.deepEqual([...app.options].map(option => option.value).sort(), ['accounts', 'all', 'practice']);
  app.value = 'all';
  app.dispatchEvent(new dom.window.Event('change'));
  let nodes = [...dom.window.document.querySelectorAll('.map-node')];
  assert.ok(nodes.some(node => node.getAttribute('aria-label').includes('/api/auth/login')));
  assert.ok(nodes.some(node => node.getAttribute('aria-label').includes('/api/practice/sessions')));
  assert.ok(nodes.some(node => node.getAttribute('aria-label').includes('send_password_reset_email_task')));
  app.value = 'accounts';
  app.dispatchEvent(new dom.window.Event('change'));
  nodes = [...dom.window.document.querySelectorAll('.map-node')];
  assert.ok(nodes.some(node => node.getAttribute('aria-label').includes('/api/auth/login')), 'accounts-app route should stay visible');
  assert.ok(!nodes.some(node => node.getAttribute('aria-label').includes('/api/practice/sessions')), 'practice-app route should be filtered out when scoped to accounts');
  const taskNode = nodes.find(node => node.getAttribute('aria-label').includes('send_password_reset_email_task'));
  taskNode.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(dom.window.document.getElementById('details').textContent, /1 trigger site/);
  const openInSystem = buttonWithText(dom, 'Open in system map');
  assert.ok(openInSystem, 'expected a return path from a task to the owning service');
  openInSystem.click();
  assert.equal(dom.window.document.getElementById('view-mode').value, 'system');
  dom.window.close();
});

test('graph message restores saved view state including hidden nodes and data scope', () => {
  const composeSource = 'services:\n  payments:\n    build: .\n';
  const systemGraph = analyzeCompose(composeSource, 'file:///workspace/compose.yml').graph;
  const modelSource = 'from django.db import models\nclass Payment(models.Model):\n    amount = models.CharField(max_length=10)\n';
  const dataGraph = analyzePythonModels([
    { uri: 'file:///workspace/payments/models.py', relativePath: 'payments/models.py', source: modelSource, owner: 'payments', database: 'hbec_payments' },
  ]).graph;
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    data: {
      type: 'graph',
      graph: systemGraph,
      dataGraph,
      subtitle: 'test',
      diagnostics: [],
      viewState: { hiddenNodeIds: [], labels: {}, pinned: {}, relation: 'all', dataMode: 'physical', owner: 'payments', app: 'all', zoom: 120, mode: 'data' },
      coverage: { nodes: 2, edges: 0, unresolved: 0, skipped: 0 },
    },
  }));
  assert.equal(dom.window.document.getElementById('view-mode').value, 'data');
  assert.equal(dom.window.document.getElementById('owner').value, 'payments');
  assert.equal(dom.window.document.getElementById('data-mode').value, 'physical');
  assert.equal(dom.window.document.getElementById('coverage').hidden, false);
  assert.match(dom.window.document.getElementById('coverage').textContent, /2 nodes/);
  dom.window.close();
});

test('the canvas and its nodes/edges expose an accessible, non-flattened role tree', () => {
  const source = 'services:\n  student-backend:\n    environment:\n      REDIS_URL: redis://redis:6379/0\n  redis:\n    image: redis:7\n';
  const graph = analyzeCompose(source, 'file:///workspace/compose.yml').graph;
  const { dom } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph, subtitle: 'test', diagnostics: [] } }));
  const svg = dom.window.document.querySelector('#canvas svg');
  assert.equal(svg.getAttribute('role'), 'group', 'role="img" would flatten the diagram\'s interactive children out of the accessibility tree');
  const node = dom.window.document.querySelector('.map-node');
  assert.equal(node.getAttribute('role'), 'button');
  assert.equal(node.getAttribute('tabindex'), '0');
  const edge = dom.window.document.querySelector('.link-hit');
  assert.equal(edge.getAttribute('role'), 'button');
  assert.equal(edge.getAttribute('tabindex'), '0');
  dom.window.close();
});

test('exporting the current view produces Mermaid and standalone SVG content', () => {
  const source = 'services:\n  student-backend:\n    environment:\n      REDIS_URL: redis://redis:6379/0\n  redis:\n    image: redis:7\n';
  const graph = analyzeCompose(source, 'file:///workspace/compose.yml').graph;
  const { dom, posted } = mount();
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph, subtitle: 'test', diagnostics: [] } }));
  const format = dom.window.document.getElementById('export-format');
  const exportBtn = dom.window.document.getElementById('export');
  format.value = 'mermaid';
  exportBtn.click();
  const mermaidMessage = posted.find(message => message.type === 'export' && message.format === 'mermaid');
  assert.ok(mermaidMessage, 'expected a mermaid export message');
  assert.match(mermaidMessage.content, /^flowchart TD/);
  assert.match(mermaidMessage.content, /Student/);
  format.value = 'svg';
  exportBtn.click();
  const svgMessage = posted.find(message => message.type === 'export' && message.format === 'svg');
  assert.ok(svgMessage, 'expected an svg export message');
  assert.match(svgMessage.content, /<svg[^>]*xmlns=/);
  assert.match(svgMessage.content, /Student/);
  dom.window.close();
});
