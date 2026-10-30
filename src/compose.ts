import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';
import path from 'node:path';
import { EvidenceGraph, GraphEdge, GraphNode, SourceEvidence, stableId } from './graph';

type ComposeService = Record<string, unknown>;
export interface ComposeAnalysis { graph: EvidenceGraph; diagnostics: string[]; serviceCount: number; }
export interface ComposeOptions {
  serviceAliases?: Record<string, string>;
  serviceGroups?: Record<string, string>;
}

const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function envMap(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const result: Record<string, string> = {};
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const at = entry.indexOf('=');
      if (at > 0) result[entry.slice(0, at)] = entry.slice(at + 1);
    }
    return result;
  }
  return Object.fromEntries(Object.entries(record(value)).filter(([, val]) => str(val) !== undefined).map(([key, val]) => [key, String(val)]));
}

function hostFromUrl(value: string): { host: string; path: string; scheme: string } | undefined {
  try {
    const safe = value.replace(/\$\{[^}]*\}/g, 'placeholder');
    const url = new URL(safe);
    return { host: url.hostname, path: url.pathname.replace(/^\//, ''), scheme: url.protocol.replace(/:$/, '') };
  } catch { return undefined; }
}

export function logicalServiceName(name: string, allNames: ReadonlySet<string>): string {
  const colorless = name.replace(/-(blue|green)$/, '');
  const withoutProcess = colorless.replace(/-(worker|beat)$/, '');
  if (withoutProcess !== colorless && allNames.has(withoutProcess)) return withoutProcess;
  if (colorless === 'student-worker' || colorless === 'student-beat') return allNames.has('student-backend') ? 'student-backend' : colorless;
  if (colorless === 'admin-worker' || colorless === 'admin-beat') return allNames.has('admin-backend') ? 'admin-backend' : colorless;
  return colorless;
}

function groupOf(name: string): string {
  if (name.includes('student')) return 'Student';
  if (name.includes('admin')) return 'Admin';
  if (name.includes('harness')) return name === 'harness-db' ? 'Infrastructure' : 'Harness';
  if (name.includes('notification')) return 'Notifications';
  if (name.includes('payment')) return 'Payments';
  if (name.includes('school')) return 'Schools';
  return 'Infrastructure';
}

function kindOf(name: string): GraphNode['kind'] {
  if (name.includes('redis')) return 'cache';
  if (/^(postgres|db|.*-db)$/.test(name)) return 'database';
  return 'service';
}

export function analyzeCompose(source: string, uri: string, options: ComposeOptions = {}): ComposeAnalysis {
  const diagnostics: string[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { merge: true, lineCounter, uniqueKeys: true });
  if (doc.errors.length) {
    return { graph: { version: 1, nodes: [], edges: [] }, diagnostics: doc.errors.map(error => `Compose YAML: ${error.message}`), serviceCount: 0 };
  }
  let root: Record<string, unknown>;
  try { root = record(doc.toJS({ maxAliasCount: 1000 })); }
  catch (error) {
    return { graph: { version: 1, nodes: [], edges: [] }, diagnostics: [`Compose aliases: ${error instanceof Error ? error.message : String(error)}`], serviceCount: 0 };
  }
  const services = record(root.services);
  const names = Object.keys(services);
  if (names.length === 0) diagnostics.push('No Compose services found.');
  const allNames = new Set(names);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const serviceNode = doc.getIn(['services'], true);
  const serviceMap = isMap(serviceNode) ? serviceNode : undefined;

  function lineFor(service: string, section?: string, key?: string): number {
    const own = serviceMap?.get(service, true);
    const serviceKey = serviceMap?.items.find(item => isScalar(item.key) && String(item.key.value) === service)?.key;
    const serviceLine = isScalar(serviceKey) ? serviceKey.range?.[0] ?? 0 : 0;
    if (isMap(own) && section) {
      const part = own.get(section, true);
      if (isMap(part) && key) {
        const item = part.items.find(pair => isScalar(pair.key) && String(pair.key.value) === key);
        if (item && isScalar(item.key) && item.key.range) return lineCounter.linePos(item.key.range[0]).line;
      }
      const item = own.items.find(pair => isScalar(pair.key) && String(pair.key.value) === section);
      if (item && isScalar(item.key) && item.key.range) return lineCounter.linePos(item.key.range[0]).line;
    }
    return lineCounter.linePos(serviceLine).line;
  }

  function evidence(service: string, section?: string, key?: string): SourceEvidence {
    return { uri, line: lineFor(service, section, key), extractor: 'compose' };
  }

  function ensureNode(name: string): GraphNode {
    const requested = options.serviceAliases?.[name];
    const logical = requested && /^[\w.-]{1,80}$/.test(requested) ? requested : logicalServiceName(name, allNames);
    const id = stableId(uri, 'service', logical);
    let node = nodes.get(id);
    if (!node) {
      const requestedGroup = options.serviceGroups?.[logical];
      const group = requestedGroup && requestedGroup.length <= 50 && !/[\r\n<>]/.test(requestedGroup) ? requestedGroup : groupOf(logical);
      node = { id, kind: kindOf(logical), label: logical, group, members: [], paths: [], evidence: [] };
      nodes.set(id, node);
    }
    if (!node.members?.includes(name)) {
      node.members?.push(name);
      node.evidence.push(evidence(name));
    }
    return node;
  }

  function addEdge(from: GraphNode, to: GraphNode, kind: string, label: string, sourceEvidence: SourceEvidence): void {
    if (from.id === to.id) return;
    const id = stableId(uri, 'edge', from.id, to.id, kind, label);
    const existing = edges.get(id);
    if (existing) {
      if (!existing.evidence.some(e => e.line === sourceEvidence.line && e.uri === sourceEvidence.uri)) existing.evidence.push(sourceEvidence);
    } else {
      edges.set(id, { id, from: from.id, to: to.id, kind, label, confidence: 'declared', evidence: [sourceEvidence] });
    }
  }

  for (const name of names) ensureNode(name);
  for (const [name, rawService] of Object.entries(services)) {
    const service = record(rawService) as ComposeService;
    const from = ensureNode(name);
    const build = typeof service.build === 'string' ? service.build : str(record(service.build).context);
    if (build && !build.includes('$' + '{')) {
      const relative = path.posix.normalize(build.replace(/\\/g, '/').replace(/^\.\//, ''));
      if (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative) && !from.paths?.includes(relative)) {
        from.paths?.push(relative);
      }
    }
    const dependencies = service.depends_on;
    const dependsNames = Array.isArray(dependencies) ? dependencies : Object.keys(record(dependencies));
    for (const target of dependsNames) {
      if (typeof target !== 'string' || !allNames.has(target)) continue;
      addEdge(from, ensureNode(target), 'depends_on', 'startup dependency', evidence(name, 'depends_on', target));
    }
    const env = envMap(service.environment);
    for (const [key, value] of Object.entries(env)) {
      if (SECRET_KEY.test(key)) continue;
      if (key === 'POSTGRES_DB' && /^[\w.-]+$/.test(value)) {
        const id = stableId(uri, 'database', value);
        if (!nodes.has(id)) nodes.set(id, { id, kind: 'database', label: value, group: 'Infrastructure', evidence: [evidence(name, 'environment', key)] });
        addEdge(from, nodes.get(id)!, 'database', 'uses database', evidence(name, 'environment', key));
        continue;
      }
      if (key === 'POSTGRES_HOST' && allNames.has(value)) {
        addEdge(from, ensureNode(value), 'database_host', 'database host', evidence(name, 'environment', key));
        continue;
      }
      if (!/(?:URL|URI|ENDPOINT)$/.test(key)) continue;
      const parsed = hostFromUrl(value);
      if (!parsed) continue;
      if (allNames.has(parsed.host)) {
        const target = ensureNode(parsed.host);
        const kind = parsed.scheme.startsWith('redis') ? 'redis' : parsed.scheme.startsWith('postgres') ? 'database_host' : 'http';
        addEdge(from, target, kind, key, evidence(name, 'environment', key));
      }
      if (parsed.scheme.startsWith('postgres') && /^[\w.-]+$/.test(parsed.path)) {
        const id = stableId(uri, 'database', parsed.path);
        if (!nodes.has(id)) nodes.set(id, { id, kind: 'database', label: parsed.path, group: 'Infrastructure', evidence: [evidence(name, 'environment', key)] });
        addEdge(from, nodes.get(id)!, 'database', 'uses database', evidence(name, 'environment', key));
      }
    }
  }
  return { graph: { version: 1, nodes: [...nodes.values()], edges: [...edges.values()] }, diagnostics, serviceCount: names.length };
}
