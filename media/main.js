(() => {
  const api = acquireVsCodeApi();
  const ns = 'http://www.w3.org/2000/svg';
  const NODE_BUDGET = 60;
  const subtitle = document.getElementById('subtitle');
  const coverageEl = document.getElementById('coverage');
  const canvas = document.getElementById('canvas');
  const details = document.getElementById('details');
  const search = document.getElementById('search');
  const relation = document.getElementById('relation');
  const overview = document.getElementById('overview');
  const zoom = document.getElementById('zoom');
  const diagnostics = document.getElementById('diagnostics');
  const viewMode = document.getElementById('view-mode');
  const ownerSelect = document.getElementById('owner');
  const appSelect = document.getElementById('app');
  const dataMode = document.getElementById('data-mode');
  const backBtn = document.getElementById('back');
  const breadcrumbsEl = document.getElementById('breadcrumbs');
  const unhideBtn = document.getElementById('unhide');
  const budgetWarning = document.getElementById('budget-warning');
  const exportFormat = document.getElementById('export-format');
  const exportBtn = document.getElementById('export');
  const addComponentBtn = document.getElementById('add-component');
  const connectNodesBtn = document.getElementById('connect-nodes');
  const deepCritiqueBtn = document.getElementById('deep-critique');
  const checkDriftBtn = document.getElementById('check-drift');
  const critiqueBanner = document.getElementById('critique-banner');
  const toggleFullscreenBtn = document.getElementById('toggle-fullscreen');
  let connectSourceNode = null;
  let systemGraph = { nodes: [], edges: [] };
  let dataGraph = { nodes: [], edges: [] };
  let componentGraph = { nodes: [], edges: [] };
  let graph = { nodes: [], edges: [] };
  let focus = null;
  let selected = null;
  let breadcrumbs = [];
  let hiddenIds = new Set();
  let labelOverrides = new Map();
  let pinned = new Map();
  let lastPositions = new Map();
  let dragMoved = false;
  let saveTimer = null;

  function svg(tag, attrs) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    return node;
  }
  function text(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }
  function button(label, action) {
    const node = text('button', label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function displayLabel(node) {
    return labelOverrides.get(node.id) || node.label;
  }
  function sourceButtons(item, parent) {
    (item.evidence || []).forEach((source, index) => {
      const short = source.uri.split('/').pop() || source.uri;
      parent.append(button('Open ' + short + ':' + source.line, () => api.postMessage({ type: 'openSource', id: item.id, evidenceIndex: index })));
    });
  }
  function scheduleSaveView() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.postMessage({
        type: 'saveView',
        viewState: {
          hiddenNodeIds: [...hiddenIds],
          labels: Object.fromEntries(labelOverrides),
          pinned: Object.fromEntries(pinned),
          relation: relation.value,
          dataMode: dataMode.value,
          owner: ownerSelect.value || undefined,
          app: appSelect.value || undefined,
          zoom: Number(zoom.value),
          mode: viewMode.value,
        },
      });
    }, 400);
  }
  function updateUnhideButton() {
    unhideBtn.hidden = hiddenIds.size === 0;
    unhideBtn.textContent = 'Unhide ' + hiddenIds.size + ' node(s)';
  }
  const MODE_LABELS = { system: 'System', data: 'Data', components: 'Flows' };
  function updateBackButton() {
    backBtn.hidden = breadcrumbs.length === 0;
    breadcrumbsEl.textContent = breadcrumbs.map(item => MODE_LABELS[item.mode] || item.mode).join(' › ');
  }
  function renameControls(node, parent) {
    if (node.id.startsWith('group:')) return;
    const input = document.createElement('input');
    input.value = displayLabel(node);
    input.setAttribute('aria-label', 'Rename ' + node.label);
    parent.append(input, button('Rename', () => {
      const value = input.value.trim().slice(0, 80);
      if (value && value !== node.label) labelOverrides.set(node.id, value);
      else labelOverrides.delete(node.id);
      scheduleSaveView();
      render();
    }));
  }
  function hideControl(node, parent) {
    if (node.id.startsWith('group:')) return;
    parent.append(button('Hide', () => {
      hiddenIds.add(node.id);
      selected = null;
      details.textContent = 'Select a node or connection.';
      scheduleSaveView();
      updateUnhideButton();
      render();
    }));
  }
  function crossViewControl(node, parent) {
    if (viewMode.value === 'system' && !node.id.startsWith('group:')) {
      if (dataGraph.nodes.some(item => item.owner === node.label)) parent.append(button('Explore data', () => navigateToOwnerView('data', node.label)));
      if (componentGraph.nodes.some(item => item.owner === node.label)) parent.append(button('Explore flows', () => navigateToOwnerView('components', node.label)));
    }
    if ((viewMode.value === 'data' || viewMode.value === 'components') && node.owner && systemGraph.nodes.some(item => item.label === node.owner)) {
      parent.append(button('Open in system map', () => navigateToSystem(node.owner)));
    }
  }
  function navigateToOwnerView(mode, ownerLabel) {
    breadcrumbs.push({ mode: 'system', focus, selected, search: search.value, relation: relation.value, zoom: zoom.value });
    viewMode.value = mode;
    changeView();
    if ([...ownerSelect.options].some(option => option.value === ownerLabel)) ownerSelect.value = ownerLabel;
    populateApps();
    appSelect.value = 'all';
    updateBackButton();
    render();
  }
  function navigateToSystem(ownerLabel) {
    breadcrumbs.push({ mode: viewMode.value, owner: ownerSelect.value, app: appSelect.value, dataMode: dataMode.value, search: search.value, zoom: zoom.value });
    viewMode.value = 'system';
    changeView();
    const target = systemGraph.nodes.find(item => item.label === ownerLabel);
    focus = target?.group || null;
    selected = target?.id || null;
    updateBackButton();
    render();
  }
  function goBack() {
    const previous = breadcrumbs.pop();
    if (!previous) return;
    viewMode.value = previous.mode;
    changeView();
    if (previous.mode === 'system') {
      focus = previous.focus;
      selected = previous.selected;
    } else {
      if (previous.owner) ownerSelect.value = previous.owner;
      populateApps();
      if (previous.app) appSelect.value = previous.app;
      if (previous.mode === 'data') dataMode.value = previous.dataMode || 'domain';
    }
    search.value = previous.search || '';
    if (previous.relation) relation.value = previous.relation;
    zoom.value = previous.zoom || 100;
    updateBackButton();
    render();
  }
  function inspectNode(node) {
    selected = node.id;
    details.replaceChildren();
    details.append(text('h2', displayLabel(node)));
    details.append(text('p', node.kind + (node.group ? ' · ' + node.group : '') + (node.database ? ' · ' + node.database : '')));
    if (node.model) details.append(text('p', 'Model: ' + node.model + ' · table: ' + (dataGraph.nodes.find(item => item.id === node.id)?.label || node.label)));
    if (node.columns?.length) {
      const list = document.createElement('ul');
      for (const column of node.columns) list.append(text('li', column.name + (column.primaryKey ? ' PK' : '') + (column.foreignKey ? ' FK' : '') + (column.nullable ? ' nullable' : '')));
      details.append(list);
    }
    if (node.members && node.members.length) details.append(text('p', 'Compose members: ' + node.members.join(', ')));
    if (node.kind === 'route') details.append(text('p', 'View: ' + (node.view || 'unresolved')));
    if (node.kind === 'task') details.append(text('p', Math.max((node.evidence || []).length - 1, 0) + ' trigger site(s)'));
    sourceButtons(node, details);
    crossViewControl(node, details);
    renameControls(node, details);
    hideControl(node, details);
    if (!node.id.startsWith('group:')) {
      details.append(button('Delete component', () => {
        api.postMessage({ type: 'mutateDeleteNode', nodeId: node.id });
        selected = null;
        details.textContent = 'Component deleted.';
      }));
    }
    if (node.id.startsWith('group:')) {
      details.append(text('p', graph.nodes.filter(item => item.group === node.label).length + ' components in this area.'));
      details.append(button('Explore area', () => { focus = node.label; render(); }));
    }
    render();
  }
  function inspectEdge(edge) {
    selected = edge.id;
    details.replaceChildren();
    const names = new Map(graph.nodes.map(node => [node.id, displayLabel(node)]));
    details.append(text('h2', edge.fromLabel + ' → ' + edge.toLabel));
    details.append(text('p', edge.originals.length + ' source-backed connection(s)'));
    for (const original of edge.originals) {
      const section = document.createElement('section');
      section.className = 'edge-evidence';
      section.append(text('strong', (names.get(original.from) || '?') + ' → ' + (names.get(original.to) || '?') + ' · ' + original.kind));
      section.append(text('p', (original.label || original.kind) + (original.cardinality ? ' · ' + original.cardinality : '') + (original.through ? ' via ' + original.through : '') + ' · ' + original.confidence));
      sourceButtons(original, section);
      details.append(section);
    }
    details.append(button('Disconnect link', () => {
      for (const orig of edge.originals) {
        api.postMessage({ type: 'mutateDeleteEdge', edgeId: orig.id });
      }
      selected = null;
      details.textContent = 'Link disconnected.';
    }));
    render();
  }
  function project() {
    const visible = graph.nodes.filter(node => !hiddenIds.has(node.id));
    if (viewMode.value === 'data') {
      const ownerNodes = visible.filter(node => node.owner === ownerSelect.value);
      const base = ownerNodes.filter(node => appSelect.value === 'all' || node.app === appSelect.value);
      const ids = new Set(base.map(node => node.id));
      if (appSelect.value !== 'all') {
        for (const edge of graph.edges) {
          if (ids.has(edge.from) && ownerNodes.some(node => node.id === edge.to)) ids.add(edge.to);
        }
      }
      const nodes = ownerNodes
        .filter(node => ids.has(node.id) && (dataMode.value === 'physical' || !node.joinTable))
        .map(node => Object.assign({}, node, {
          label: dataMode.value === 'domain' ? (labelOverrides.get(node.id) || node.model || node.label) : displayLabel(node),
          outsideScope: appSelect.value !== 'all' && node.app !== appSelect.value,
        }));
      const included = new Set(nodes.map(node => node.id));
      const joinTableLabelsForOwner = new Set(graph.nodes.filter(node => node.joinTable && node.owner === ownerSelect.value).map(node => node.label));
      const joinTableIds = new Set(graph.nodes.filter(node => node.joinTable).map(node => node.id));
      const edges = graph.edges
        .filter(edge => included.has(edge.from) && included.has(edge.to))
        .filter(edge => dataMode.value === 'physical'
          ? edge.kind !== 'many_to_many' || (!!edge.through && !joinTableLabelsForOwner.has(edge.through))
          : !joinTableIds.has(edge.from))
        .map(edge => Object.assign({}, edge, { originals: [edge] }));
      return { nodes, edges };
    }
    if (viewMode.value === 'components') {
      // The owning service is implied by the owner selector, not drawn: every
      // route/task here belongs to one service, so a hub node plus one edge
      // per child would be pure visual noise, not new information.
      const nodes = visible
        .filter(node => node.kind !== 'service' && node.owner === ownerSelect.value)
        .filter(node => appSelect.value === 'all' || node.app === appSelect.value)
        .map(node => Object.assign({}, node, { label: displayLabel(node) }));
      const included = new Set(nodes.map(node => node.id));
      const edges = graph.edges
        .filter(edge => included.has(edge.from) && included.has(edge.to))
        .map(edge => Object.assign({}, edge, { originals: [edge] }));
      return { nodes, edges };
    }
    if (visible.every(node => !node.group)) {
      return { nodes: visible.map(node => Object.assign({}, node, { label: displayLabel(node) })), edges: graph.edges.map(edge => Object.assign({}, edge, { originals: [edge] })) };
    }
    const nodes = new Map();
    const idMap = new Map();
    for (const node of visible) {
      if (node.group === focus) {
        nodes.set(node.id, Object.assign({}, node, { label: displayLabel(node) }));
        idMap.set(node.id, node.id);
      } else {
        const group = node.group || 'Other';
        const id = 'group:' + group;
        if (!nodes.has(id)) nodes.set(id, { id, label: group, group, kind: 'domain', evidence: [] });
        idMap.set(node.id, id);
      }
    }
    const edges = new Map();
    for (const edge of graph.edges) {
      if (relation.value !== 'all' && relation.value !== edge.kind) continue;
      if (relation.value === 'all' && edge.kind === 'depends_on') continue;
      const from = idMap.get(edge.from);
      const to = idMap.get(edge.to);
      if (!from || !to || from === to) continue;
      const key = from + '|' + to;
      if (!edges.has(key)) edges.set(key, { id: key, from, to, kind: edge.kind, originals: [] });
      edges.get(key).originals.push(edge);
    }
    for (const edge of edges.values()) {
      if (new Set(edge.originals.map(item => item.kind)).size > 1) edge.kind = 'mixed';
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }
  const BOX_WIDTH = 220;
  const BOX_HEIGHT = 92;
  function dagreLayout(nodes, edges) {
    const positions = new Map();
    if (typeof dagre === 'undefined' || !nodes.length) return positions;
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 20, marginy: 20, acyclicer: 'greedy' });
    g.setDefaultEdgeLabel(() => ({}));
    for (const node of nodes) g.setNode(node.id, { width: BOX_WIDTH, height: BOX_HEIGHT });
    const seen = new Set();
    for (const edge of edges) {
      if (edge.from === edge.to) continue;
      const key = edge.from + '|' + edge.to;
      if (seen.has(key)) continue;
      seen.add(key);
      g.setEdge(edge.from, edge.to);
    }
    dagre.layout(g);
    for (const node of nodes) {
      const info = g.node(node.id);
      if (info) positions.set(node.id, { x: info.x - BOX_WIDTH / 2, y: info.y - BOX_HEIGHT / 2 });
    }
    return positions;
  }
  function layout(nodes, edges) {
    const positions = new Map();
    const order = ['Student', 'Admin', 'Schools', 'Harness', 'Notifications', 'Payments', 'Infrastructure', 'Other'];
    if (viewMode.value === 'data' || viewMode.value === 'components') {
      [...nodes].sort((a, b) => a.label.localeCompare(b.label)).forEach((node, index) => {
        positions.set(node.id, { x: 60 + (index % 3) * 300, y: 55 + Math.floor(index / 3) * 145 });
      });
    } else if (!focus) {
      const dagrePositions = dagreLayout(nodes, edges);
      if (dagrePositions.size) {
        for (const [id, pos] of dagrePositions) positions.set(id, pos);
      } else {
        const sorted = [...nodes].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
        sorted.forEach((node, index) => positions.set(node.id, { x: 60 + (index % 3) * 300, y: 55 + Math.floor(index / 3) * 185 }));
      }
    } else {
      const own = nodes.filter(node => node.group === focus && !node.id.startsWith('group:')).sort((a, b) => a.label.localeCompare(b.label));
      const other = nodes.filter(node => !own.includes(node)).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
      own.forEach((node, index) => positions.set(node.id, { x: 60 + (index % 3) * 300, y: 55 + Math.floor(index / 3) * 145 }));
      const offset = Math.ceil(own.length / 3) + 1;
      other.forEach((node, index) => positions.set(node.id, { x: 60 + (index % 3) * 300, y: 55 + (offset + Math.floor(index / 3)) * 145 }));
    }
    for (const node of nodes) {
      const pin = pinned.get(node.id);
      if (pin) positions.set(node.id, pin);
    }
    return positions;
  }
  function startDrag(event, node) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const scale = Number(zoom.value) / 100;
    const start = lastPositions.get(node.id) || { x: 0, y: 0 };
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    function onMove(moveEvent) {
      const dx = (moveEvent.clientX - startX) / scale;
      const dy = (moveEvent.clientY - startY) / scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      dragMoved = moved;
    }
    function onUp(upEvent) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        const dx = (upEvent.clientX - startX) / scale;
        const dy = (upEvent.clientY - startY) / scale;
        pinned.set(node.id, { x: start.x + dx, y: start.y + dy });
        scheduleSaveView();
        render();
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }
  function render() {
    const view = project();
    const positions = layout(view.nodes, view.edges);
    lastPositions = positions;
    const height = Math.max(480, ...[...positions.values()].map(pos => pos.y + 145));
    const width = Math.max(980, ...[...positions.values()].map(pos => pos.x + BOX_WIDTH + 60));
    const scale = Number(zoom.value) / 100;
    overview.hidden = !focus;
    budgetWarning.hidden = !(viewMode.value === 'system' && !focus && view.nodes.length > NODE_BUDGET);
    if (!budgetWarning.hidden) budgetWarning.textContent = 'Showing all ' + view.nodes.length + ' components, above the ' + NODE_BUDGET + '-node default budget. Use search or explore an area to narrow the view.';
    canvas.replaceChildren();
    const root = svg('svg', { width: width * scale, height: height * scale, viewBox: '0 0 ' + width + ' ' + height, role: 'group', 'aria-label': 'Architecture diagram' });
    const defs = svg('defs');
    const marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--vscode-descriptionForeground)' }));
    defs.append(marker);
    root.append(defs);
    const nodeById = new Map(view.nodes.map(node => [node.id, node]));
    const membersByGroup = new Map();
    for (const item of graph.nodes) {
      if (!item.group) continue;
      if (!membersByGroup.has(item.group)) membersByGroup.set(item.group, []);
      membersByGroup.get(item.group).push(item);
    }
    const lanes = new Map();
    for (const edge of view.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const pair = edge.from + '|' + edge.to;
      const lane = lanes.get(pair) || 0;
      lanes.set(pair, lane + 1);
      const cx = from.x + 110, cy = from.y + 46, dx = to.x + 110 - cx, dy = to.y + 46 - cy;
      const border = Math.min(dx ? 110 / Math.abs(dx) : Infinity, dy ? 46 / Math.abs(dy) : Infinity);
      const sx = cx + dx * border, sy = cy + dy * border;
      const tx = to.x + 110 - dx * border, ty = to.y + 46 - dy * border;
      const bend = lane * 20 - 10;
      const curve = 'M ' + sx + ' ' + sy + ' Q ' + ((sx + tx) / 2 + bend) + ' ' + ((sy + ty) / 2 - bend) + ' ' + tx + ' ' + ty;
      root.append(svg('path', { d: curve, class: 'link ' + edge.kind + (selected === edge.id ? ' selected' : ''), 'marker-end': 'url(#arrow)' }));
      edge.fromLabel = nodeById.get(edge.from)?.label || '?';
      edge.toLabel = nodeById.get(edge.to)?.label || '?';
      const hit = svg('path', { d: curve, class: 'link-hit', tabindex: 0, role: 'button', 'aria-label': edge.fromLabel + ' to ' + edge.toLabel + ', ' + edge.kind });
      hit.addEventListener('click', () => inspectEdge(edge));
      hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') inspectEdge(edge); });
      root.append(hit);
    }
    const query = search.value.trim().toLowerCase();
    for (const node of view.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const groupMembers = node.id.startsWith('group:') ? membersByGroup.get(node.label) : undefined;
      const matches = !query || node.label.toLowerCase().includes(query) || (groupMembers && groupMembers.some(item => displayLabel(item).toLowerCase().includes(query)));
      const group = svg('g', { transform: 'translate(' + pos.x + ' ' + pos.y + ')', class: 'map-node ' + node.kind + (node.outsideScope ? ' outside' : '') + (matches ? '' : ' dim') + (selected === node.id ? ' selected' : '') + (pinned.has(node.id) ? ' pinned' : ''), tabindex: 0, role: 'button', 'aria-label': node.label + ' ' + node.kind });
      group.append(svg('rect', { width: 220, height: 92, rx: 10 }));
      const label = svg('text', { x: 16, y: 31, class: 'node-title' });
      label.textContent = node.label.length > 25 ? node.label.slice(0, 23) + '…' : node.label;
      group.append(label);
      const sub = svg('text', { x: 16, y: 61, class: 'node-subtitle' });
      sub.textContent = groupMembers ? groupMembers.length + ' components' : node.members?.length > 1 ? node.members.length + ' deployment members' : node.kind === 'table' ? (dataMode.value === 'physical' ? (node.columns || []).filter(item => item.primaryKey || item.foreignKey).slice(0, 2).map(item => item.name).join(', ') || 'table' : node.app || 'model') : node.kind === 'route' ? (node.view || 'route') : node.kind === 'task' ? Math.max((node.evidence || []).length - 1, 0) + ' trigger site(s)' : node.kind;
      group.append(sub);
      group.addEventListener('pointerdown', event => startDrag(event, node));
      group.addEventListener('click', () => { if (dragMoved) { dragMoved = false; return; } inspectNode(node); });
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') inspectNode(node); });
      root.append(group);
    }
    canvas.append(root);
  }
  function buildExportSvg() {
    const liveSvg = canvas.querySelector('svg');
    if (!liveSvg) return null;
    const clone = liveSvg.cloneNode(true);
    const liveEls = liveSvg.querySelectorAll('*');
    const cloneEls = clone.querySelectorAll('*');
    liveEls.forEach((liveEl, index) => {
      const cloneEl = cloneEls[index];
      if (!cloneEl) return;
      const computed = window.getComputedStyle(liveEl);
      if (computed.fill && computed.fill !== 'none') cloneEl.setAttribute('fill', computed.fill);
      if (computed.stroke && computed.stroke !== 'none') cloneEl.setAttribute('stroke', computed.stroke);
      if (computed.strokeWidth) cloneEl.setAttribute('stroke-width', computed.strokeWidth);
      if (computed.opacity) cloneEl.setAttribute('opacity', computed.opacity);
    });
    const background = svg('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: window.getComputedStyle(document.body).backgroundColor || '#1e1e1e' });
    clone.insertBefore(background, clone.firstChild);
    clone.setAttribute('xmlns', ns);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }
  function buildMermaid() {
    const view = project();
    const safeId = id => 'n' + id.replace(/[^a-zA-Z0-9]/g, '_');
    const lines = ['flowchart TD'];
    for (const node of view.nodes) lines.push('  ' + safeId(node.id) + '["' + displayLabel(node).replace(/"/g, "'") + '"]');
    for (const edge of view.edges) lines.push('  ' + safeId(edge.from) + ' -->|' + (edge.kind || '') + '| ' + safeId(edge.to));
    return lines.join('\n') + '\n';
  }
  function svgToPngBase64(svgString, width, height) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const bitmap = document.createElement('canvas');
        bitmap.width = Math.max(1, Math.round(width));
        bitmap.height = Math.max(1, Math.round(height));
        const context = bitmap.getContext('2d');
        context.drawImage(image, 0, 0, bitmap.width, bitmap.height);
        try {
          resolve(bitmap.toDataURL('image/png').split(',')[1]);
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('failed to rasterize diagram'));
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    });
  }
  exportBtn.addEventListener('click', async () => {
    const format = exportFormat.value;
    if (format === 'mermaid' || format === 'compose' || format === 'adr') {
      api.postMessage({ type: 'export', format, content: format === 'mermaid' ? buildMermaid() : '' });
      return;
    }
    const svgString = buildExportSvg();
    if (!svgString) return;
    if (format === 'svg') {
      api.postMessage({ type: 'export', format, content: svgString });
      return;
    }
    const liveSvg = canvas.querySelector('svg');
    const width = Number(liveSvg.getAttribute('width')) || 980;
    const height = Number(liveSvg.getAttribute('height')) || 480;
    try {
      const base64 = await svgToPngBase64(svgString, width, height);
      api.postMessage({ type: 'export', format, content: base64, encoding: 'base64' });
    } catch {
      details.replaceChildren(text('p', 'PNG export failed in this view; try SVG instead.'));
    }
  });
  search.addEventListener('input', render);
  relation.addEventListener('change', () => { scheduleSaveView(); render(); });
  zoom.addEventListener('input', () => { scheduleSaveView(); render(); });
  overview.addEventListener('click', () => { focus = null; selected = null; render(); });
  backBtn.addEventListener('click', goBack);
  unhideBtn.addEventListener('click', () => { hiddenIds.clear(); scheduleSaveView(); updateUnhideButton(); render(); });
  function populateApps() {
    const current = appSelect.value;
    appSelect.replaceChildren();
    appSelect.append(new Option('All apps', 'all'));
    const source = viewMode.value === 'components' ? componentGraph : dataGraph;
    const apps = [...new Set(source.nodes.filter(node => node.owner === ownerSelect.value).map(node => node.app).filter(Boolean))].sort();
    for (const app of apps) appSelect.append(new Option(app, app));
    appSelect.value = apps.includes(current) ? current : apps[0] || 'all';
  }
  function changeView() {
    graph = viewMode.value === 'data' ? dataGraph : viewMode.value === 'components' ? componentGraph : systemGraph;
    ownerSelect.hidden = viewMode.value === 'system';
    appSelect.hidden = viewMode.value === 'system';
    dataMode.hidden = viewMode.value !== 'data';
    relation.hidden = viewMode.value !== 'system';
    focus = null;
    selected = null;
    details.textContent = 'Select a node or connection.';
    render();
  }
  viewMode.addEventListener('change', () => { breadcrumbs = []; updateBackButton(); changeView(); scheduleSaveView(); });
  ownerSelect.addEventListener('change', () => { populateApps(); scheduleSaveView(); render(); });
  appSelect.addEventListener('change', () => { scheduleSaveView(); render(); });
  dataMode.addEventListener('change', () => { scheduleSaveView(); render(); });
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'graph') return;
    systemGraph = message.graph;
    dataGraph = message.dataGraph || { nodes: [], edges: [] };
    componentGraph = message.componentGraph || { nodes: [], edges: [] };
    const state = message.viewState || {};
    hiddenIds = new Set(state.hiddenNodeIds || []);
    labelOverrides = new Map(Object.entries(state.labels || {}));
    pinned = new Map(Object.entries(state.pinned || {}));
    breadcrumbs = [];
    ownerSelect.replaceChildren();
    const dataOwners = dataGraph.nodes.some(node => node.owner);
    const componentOwners = componentGraph.nodes.some(node => node.owner);
    const owners = [...new Set([...dataGraph.nodes, ...componentGraph.nodes].map(node => node.owner).filter(Boolean))].sort();
    for (const owner of owners) ownerSelect.append(new Option(owner, owner));
    if (dataOwners) populateApps();
    viewMode.querySelector('[value=data]').disabled = !dataOwners;
    viewMode.querySelector('[value=components]').disabled = !componentOwners;
    graph = systemGraph;
    subtitle.textContent = message.subtitle;
    if (message.coverage) {
      coverageEl.hidden = false;
      coverageEl.textContent = message.coverage.nodes + ' nodes · ' + message.coverage.edges + ' links · ' + message.coverage.unresolved + ' unresolved · ' + message.coverage.skipped + ' skipped';
    } else {
      coverageEl.hidden = true;
    }
    focus = null;
    diagnostics.replaceChildren();
    for (const issue of message.diagnostics || []) diagnostics.append(text('li', issue));
    diagnostics.hidden = !diagnostics.children.length;
    relation.value = state.relation || 'all';
    dataMode.value = state.dataMode || 'domain';
    zoom.value = state.zoom || 100;
    if (state.mode === 'data' && dataOwners) viewMode.value = 'data';
    else if (state.mode === 'components' && componentOwners) viewMode.value = 'components';
    updateUnhideButton();
    updateBackButton();
    changeView();
    if (state.owner && [...ownerSelect.options].some(option => option.value === state.owner)) {
      ownerSelect.value = state.owner;
      populateApps();
      if (state.app) appSelect.value = state.app;
    }
    if (message.critique && critiqueBanner) {
      renderCritique(message.critique);
    }
    render();
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'deepCritiqueReport') return;
    const report = message.report;
    details.replaceChildren();
    details.append(text('h2', 'AI Architecture Critique (' + (message.agentName || 'Agent') + ')'));
    details.append(text('p', report.executiveSummary));

    const verdicts = document.createElement('div');
    verdicts.append(text('p', 'Security: ' + report.securityVerdict));
    verdicts.append(text('p', 'Scalability: ' + report.scalabilityVerdict));
    verdicts.append(text('p', 'Reliability: ' + report.reliabilityVerdict));
    details.append(verdicts);

    if (report.recommendations && report.recommendations.length) {
      details.append(text('h3', 'Recommendations'));
      for (const rec of report.recommendations) {
        const item = document.createElement('div');
        item.className = 'critique-item ' + (rec.severity === 'high' ? 'security' : 'weakness');
        item.append(text('strong', '[' + rec.category.toUpperCase() + ' - ' + rec.severity.toUpperCase() + '] ' + rec.title));
        item.append(text('p', rec.explanation));
        if (rec.suggestedAction) {
          item.append(text('small', 'Action: ' + rec.suggestedAction));
        }
        details.append(item);
      }
    }
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'driftReport') return;
    const report = message.report;
    details.replaceChildren();
    details.append(text('h2', 'Spec Conformance: ' + report.conformanceScore + '%'));
    details.append(text('p', report.summary));

    details.append(text('h3', 'Component Drift'));
    for (const comp of report.components) {
      const item = document.createElement('div');
      item.className = 'critique-item ' + (comp.status === 'matched' ? 'strength' : comp.status === 'missing_in_code' ? 'security' : 'weakness');
      item.append(text('strong', '[' + comp.status.replace(/_/g, ' ').toUpperCase() + '] ' + comp.name + ' (' + comp.kind + ')'));
      item.append(text('p', comp.detail));
      details.append(item);
    }

    if (report.links && report.links.length) {
      details.append(text('h3', 'Interaction Drift'));
      for (const link of report.links) {
        const item = document.createElement('div');
        item.className = 'critique-item ' + (link.status === 'matched' ? 'strength' : 'security');
        item.append(text('strong', '[' + link.status.replace(/_/g, ' ').toUpperCase() + '] ' + link.from + ' → ' + link.to + ' (' + link.kind + ')'));
        item.append(text('p', link.detail));
        details.append(item);
      }
    }
  });

  function renderCritique(report) {
    critiqueBanner.replaceChildren();
    const scoreClass = report.overallScore >= 80 ? 'good' : report.overallScore >= 50 ? 'warning' : 'danger';
    const scoreText = 'Architecture Health Score: ' + report.overallScore + '/100';
    const scoreEl = text('div', scoreText);
    scoreEl.className = 'critique-score ' + scoreClass;
    critiqueBanner.append(scoreEl);

    for (const item of (report.critiques || []).slice(0, 4)) {
      const el = document.createElement('div');
      el.className = 'critique-item ' + item.type;
      el.append(text('strong', item.title + ': '));
      el.append(text('span', item.detail));
      critiqueBanner.append(el);
    }
    critiqueBanner.hidden = (report.critiques || []).length === 0;
  }

  if (addComponentBtn) {
    addComponentBtn.addEventListener('click', () => {
      const label = prompt('Component name (e.g. Auth Service, Redis Cache):');
      if (!label || !label.trim()) return;
      const kind = prompt('Kind (service, database, cache, broker):', 'service') || 'service';
      api.postMessage({ type: 'mutateAddNode', label: label.trim(), kind });
    });
  }

  if (connectNodesBtn) {
    connectNodesBtn.addEventListener('click', () => {
      if (!selected) {
        alert('Please select a source component first on the diagram, then click Connect.');
        return;
      }
      const sourceNode = graph.nodes.find(n => n.id === selected);
      if (!sourceNode) return;
      const targets = graph.nodes.filter(n => n.id !== selected && !n.id.startsWith('group:'));
      if (targets.length === 0) {
        alert('No other components available to connect.');
        return;
      }
      const targetLabels = targets.map((t, idx) => (idx + 1) + '. ' + displayLabel(t)).join('\n');
      const pick = prompt('Connect "' + displayLabel(sourceNode) + '" to which target? Enter number:\n' + targetLabels);
      if (!pick) return;
      const index = parseInt(pick, 10) - 1;
      if (index >= 0 && index < targets.length) {
        const target = targets[index];
        const kind = prompt('Connection type (calls, reads, writes, publishes, consumes):', 'calls') || 'calls';
        const label = prompt('Connection label / protocol (e.g. REST, gRPC, WebSocket):', '') || undefined;
        api.postMessage({ type: 'mutateAddEdge', fromId: sourceNode.id, toId: target.id, kind, label });
      }
    });
  }

  if (deepCritiqueBtn) {
    deepCritiqueBtn.addEventListener('click', () => {
      details.replaceChildren();
      details.append(text('h2', 'Deep AI Architecture Critique'));
      details.append(text('p', 'Requesting multi-dimensional assessment from active coding agent...'));
      api.postMessage({ type: 'requestDeepCritique' });
    });
  }

  if (checkDriftBtn) {
    checkDriftBtn.addEventListener('click', () => {
      details.replaceChildren();
      details.append(text('h2', 'Architecture Spec vs. Code Drift'));
      details.append(text('p', 'Comparing active architecture against extracted codebase facts...'));
      api.postMessage({ type: 'checkDrift' });
    });
  }

  if (toggleFullscreenBtn) {
    toggleFullscreenBtn.addEventListener('click', () => {
      document.body.classList.toggle('full-view');
      const isFull = document.body.classList.contains('full-view');
      toggleFullscreenBtn.textContent = isFull ? '✕ Exit Full View' : '⛶ Full View';
      toggleFullscreenBtn.setAttribute('aria-pressed', String(isFull));
    });
  }
  api.postMessage({ type: 'ready' });
})();
