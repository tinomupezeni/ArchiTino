import { parser } from '@lezer/python';
import { SyntaxNode } from '@lezer/common';
import { callName, children, firstArgument, keyword, lineOf, slice } from './pythonModels';

export interface UrlInclude {
  prefix: string;
  modulePath: string;
  namespace?: string;
  line: number;
}

export interface UrlLeaf {
  prefix: string;
  view?: string;
  name?: string;
  line: number;
}

export interface UrlModule {
  includes: UrlInclude[];
  leaves: UrlLeaf[];
  diagnostics: string[];
}

function rawString(source: string, node: SyntaxNode | null): string | undefined {
  if (!node || node.name !== 'String') return undefined;
  const raw = slice(source, node);
  const match = raw.match(/^([A-Za-z]{0,2})(['"])/);
  if (!match) return undefined;
  const prefix = match[1].toLowerCase();
  if (prefix.includes('f')) return undefined;
  const quote = match[2];
  if (raw.length < match[0].length + 1 || raw.at(-1) !== quote) return undefined;
  return raw.slice(match[0].length, raw.length - 1);
}

function nextPositional(node: SyntaxNode): SyntaxNode | null {
  let cursor: SyntaxNode | null = node.nextSibling;
  while (cursor) {
    if (cursor.name === ',') { cursor = cursor.nextSibling; continue; }
    if (cursor.name === 'VariableName' && cursor.nextSibling?.name === 'AssignOp') return null;
    return cursor;
  }
  return null;
}

function viewName(source: string, node: SyntaxNode | null): string | undefined {
  if (!node) return undefined;
  if (node.name === 'CallExpression') {
    const callee = node.getChild('MemberExpression') ?? node.getChild('VariableName');
    if (!callee) return undefined;
    return slice(source, callee).replace(/\.as_view$/, '');
  }
  if (node.name === 'MemberExpression' || node.name === 'VariableName') return slice(source, node);
  return undefined;
}

function urlPatternsArray(source: string, topNode: SyntaxNode): SyntaxNode | null {
  for (const assign of children(topNode, 'AssignStatement')) {
    if (slice(source, assign.getChild('VariableName')) === 'urlpatterns') return assign.getChild('ArrayExpression');
  }
  return null;
}

function urlCalls(source: string, array: SyntaxNode): SyntaxNode[] {
  const calls: SyntaxNode[] = [];
  for (let child = array.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CallExpression' && ['path', 're_path'].includes(callName(source, child))) calls.push(child);
  }
  return calls;
}

export function parseUrlModule(source: string, relativePath: string): UrlModule {
  const includes: UrlInclude[] = [];
  const leaves: UrlLeaf[] = [];
  const diagnostics: string[] = [];
  let tree;
  try { tree = parser.parse(source); }
  catch (error) {
    diagnostics.push(relativePath + ': parser failed: ' + (error instanceof Error ? error.message : String(error)));
    return { includes, leaves, diagnostics };
  }
  const array = urlPatternsArray(source, tree.topNode);
  if (!array) return { includes, leaves, diagnostics };
  for (const call of urlCalls(source, array)) {
    const args = call.getChild('ArgList');
    const first = firstArgument(args);
    const prefix = rawString(source, first);
    const line = lineOf(source, call.from);
    if (prefix === undefined) {
      diagnostics.push(relativePath + ':' + line + ' unresolved dynamic URL prefix');
      continue;
    }
    const target = first ? nextPositional(first) : null;
    const name = args ? keyword(source, call, 'name') : undefined;
    if (target && target.name === 'CallExpression' && callName(source, target) === 'include') {
      const includeArgs = target.getChild('ArgList');
      const moduleArg = firstArgument(includeArgs);
      const modulePath = rawString(source, moduleArg);
      const namespace = includeArgs ? keyword(source, target, 'namespace') : undefined;
      if (!modulePath) {
        diagnostics.push(relativePath + ':' + lineOf(source, target.from) + ' unresolved include() target');
        continue;
      }
      includes.push({ prefix, modulePath, namespace, line });
    } else {
      const view = viewName(source, target);
      if (!view) diagnostics.push(relativePath + ':' + line + ' unresolved view target for route "' + prefix + '"');
      leaves.push({ prefix, view, name, line });
    }
  }
  return { includes, leaves, diagnostics };
}

export function joinRoutePath(...parts: (string | undefined)[]): string {
  const filtered = parts.filter((part): part is string => !!part);
  const trailingSlash = filtered.length > 0 && /\/$/.test(filtered[filtered.length - 1]);
  const segments = filtered.map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  const joined = segments.join('/');
  return trailingSlash && joined ? joined + '/' : joined;
}

export function appFromModulePath(modulePath: string): string {
  const parts = modulePath.split('.');
  const appsIndex = parts.indexOf('apps');
  if (appsIndex >= 0 && parts[appsIndex + 1]) return parts[appsIndex + 1];
  return parts[0] ?? modulePath;
}

export function modulePathToRelativeFile(modulePath: string): string {
  return modulePath.split('.').join('/') + '.py';
}
