import { parser } from '@lezer/python';
import { SyntaxNode } from '@lezer/common';
import path from 'node:path';
import { EvidenceGraph, GraphColumn, GraphEdge, GraphNode, SourceEvidence, stableId } from './graph';

export interface PythonModelFile {
  uri: string;
  relativePath: string;
  source: string;
  owner: string;
  database?: string;
}

interface RelationDraft {
  field: string;
  kind: 'foreign_key' | 'one_to_one' | 'many_to_many';
  target: string;
  line: number;
  through?: string;
}

interface ModelDraft {
  node: GraphNode;
  owner: string;
  app: string;
  orm: 'django' | 'sqlalchemy';
  relations: RelationDraft[];
}

export interface ModelAnalysis { graph: EvidenceGraph; diagnostics: string[]; files: number; }
export interface ModelOptions { authUserModels?: Record<string, string>; }

export function slice(source: string, node: SyntaxNode | null): string { return node ? source.slice(node.from, node.to) : ''; }
export function children(node: SyntaxNode | null, name: string): SyntaxNode[] { return node?.getChildren(name) ?? []; }
export function callName(source: string, call: SyntaxNode): string {
  return slice(source, call.getChild('MemberExpression') ?? call.getChild('VariableName')).split('.').pop() ?? '';
}
export function literal(source: string, node: SyntaxNode | null): string | undefined {
  if (!node || node.name !== 'String') return undefined;
  const raw = slice(source, node);
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) return undefined;
  if (quote === '"') {
    try { return JSON.parse(raw) as string; } catch { return undefined; }
  }
  return raw.slice(1, -1).replace(/\\'/g, "'");
}
export function firstArgument(argList: SyntaxNode | null): SyntaxNode | null {
  if (!argList) return null;
  const cursor = argList.cursor();
  if (!cursor.firstChild()) return null;
  do {
    const node = cursor.node;
    if (!['(', ')', ','].includes(node.name)) return node;
  } while (cursor.nextSibling());
  return null;
}
export function keyword(source: string, call: SyntaxNode, key: string): string | undefined {
  const args = call.getChild('ArgList');
  if (!args) return undefined;
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'VariableName' || slice(source, child) !== key || child.nextSibling?.name !== 'AssignOp') continue;
    const value = child.nextSibling.nextSibling;
    if (!value) return undefined;
    return value.name === 'String' ? literal(source, value) : slice(source, value);
  }
  return undefined;
}
export function findCalls(node: SyntaxNode, source: string, name: string): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  function visit(current: SyntaxNode): void {
    if (current.name === 'CallExpression' && callName(source, current) === name) found.push(current);
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child);
  }
  visit(node);
  return found;
}
export function appFromPath(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const apps = parts.lastIndexOf('apps');
  if (apps >= 0 && parts[apps + 1]) return parts[apps + 1];
  const models = parts.lastIndexOf('models');
  if (models > 0) return parts[models - 1];
  return parts.at(-2) ?? 'app';
}
export function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) if (source.charCodeAt(index) === 10) line++;
  return line;
}
function className(source: string, classNode: SyntaxNode): string { return slice(source, classNode.getChild('VariableName')); }
function assignmentName(source: string, assign: SyntaxNode): string { return slice(source, assign.getChild('VariableName')); }
function assignmentCall(assign: SyntaxNode): SyntaxNode | null { return assign.getChild('CallExpression'); }
function fieldTarget(source: string, call: SyntaxNode): string | undefined {
  const first = firstArgument(call.getChild('ArgList'));
  if (!first) return keyword(source, call, 'to');
  if (first.nextSibling?.name === 'AssignOp') return keyword(source, call, 'to');
  if (first.name === 'String') return literal(source, first);
  if (first.name === 'VariableName') return slice(source, first);
  if (first.name === 'MemberExpression' && slice(source, first) === 'settings.AUTH_USER_MODEL') return 'settings.AUTH_USER_MODEL';
  return undefined;
}
function directStringAssignment(source: string, assignments: SyntaxNode[], name: string): string | undefined {
  const assign = assignments.find(item => assignmentName(source, item) === name);
  return assign ? literal(source, assign.getChild('String')) : undefined;
}

export function analyzePythonModels(files: PythonModelFile[], options: ModelOptions = {}): ModelAnalysis {
  const drafts: ModelDraft[] = [];
  const diagnostics: string[] = [];
  for (const file of files) {
    const source = file.source;
    let tree;
    try { tree = parser.parse(source); }
    catch (error) {
      diagnostics.push(file.relativePath + ': parser failed: ' + (error instanceof Error ? error.message : String(error)));
      continue;
    }
    const cursor = tree.cursor();
    let syntaxError = false;
    do { if (cursor.type.isError) { syntaxError = true; break; } } while (cursor.next());
    if (syntaxError) {
      diagnostics.push(file.relativePath + ': Python syntax error; file skipped');
      continue;
    }
    const isDjango = /(?:from|import)\s+django\b|from\s+django\./.test(source);
    const app = appFromPath(file.relativePath);
    for (const assign of children(tree.topNode, 'AssignStatement')) {
      const tableCall = assignmentCall(assign);
      if (!tableCall || callName(source, tableCall) !== 'Table') continue;
      const tableName = fieldTarget(source, tableCall);
      if (!tableName) {
        diagnostics.push(file.relativePath + ':' + lineOf(source, assign.from) + ' unresolved SQLAlchemy Table name');
        continue;
      }
      const columns: GraphColumn[] = [];
      const relations: RelationDraft[] = [];
      for (const column of findCalls(tableCall, source, 'Column')) {
        const name = fieldTarget(source, column);
        if (!name) continue;
        const fk = findCalls(column, source, 'ForeignKey')[0];
        columns.push({ name, primaryKey: keyword(source, column, 'primary_key') === 'True', nullable: keyword(source, column, 'nullable') === 'True', foreignKey: !!fk });
        if (fk) {
          const target = fieldTarget(source, fk);
          if (target) relations.push({ field: name, kind: 'foreign_key', target, line: lineOf(source, fk.from) });
          else diagnostics.push(file.relativePath + ':' + lineOf(source, fk.from) + ' unresolved association foreign key');
        }
      }
      const evidence = [{ uri: file.uri, line: lineOf(source, assign.from), extractor: 'sqlalchemy' }];
      const node: GraphNode = {
        id: stableId('table', file.owner, tableName),
        kind: 'table',
        label: tableName,
        app,
        orm: 'sqlalchemy',
        owner: file.owner,
        database: file.database,
        columns,
        joinTable: relations.length >= 2,
        evidence,
      };
      drafts.push({ node, owner: file.owner, app, orm: 'sqlalchemy', relations });
    }
    for (const classNode of children(tree.topNode, 'ClassDefinition')) {
      const name = className(source, classNode);
      if (!name || name === 'Meta') continue;
      const body = classNode.getChild('Body');
      const assignments = children(body, 'AssignStatement');
      const meta = children(body, 'ClassDefinition').find(item => className(source, item) === 'Meta');
      const metaAssignments = children(meta?.getChild('Body') ?? null, 'AssignStatement');
      const table = directStringAssignment(source, assignments, '__tablename__');
      const orm: 'django' | 'sqlalchemy' | undefined = table ? 'sqlalchemy' : isDjango ? 'django' : undefined;
      if (!orm) continue;
      if (orm === 'django' && metaAssignments.some(item => assignmentName(source, item) === 'abstract' && /(?:True|true)\s*$/.test(slice(source, item)))) continue;
      const columns: GraphColumn[] = [];
      const relations: RelationDraft[] = [];
      const relationshipCalls: { field: string; call: SyntaxNode; assign: SyntaxNode }[] = [];
      for (const assign of assignments) {
        const field = assignmentName(source, assign);
        const call = assignmentCall(assign);
        if (!field || !call) continue;
        const nameOfCall = callName(source, call);
        if (orm === 'django') {
          if (nameOfCall !== 'ForeignKey' && !/Field$/.test(nameOfCall)) continue;
          const relational = ['ForeignKey', 'OneToOneField', 'ManyToManyField'].includes(nameOfCall);
          if (nameOfCall !== 'ManyToManyField') {
            columns.push({
              name: relational ? (keyword(source, call, 'db_column') || field + '_id') : field,
              primaryKey: keyword(source, call, 'primary_key') === 'True' || /AutoField$/.test(nameOfCall),
              nullable: keyword(source, call, 'null') === 'True',
              foreignKey: relational,
            });
          }
          if (relational) {
            const target = fieldTarget(source, call);
            if (!target) diagnostics.push(file.relativePath + ':' + lineOf(source, call.from) + ' unresolved Django target for ' + name + '.' + field);
            else relations.push({
              field,
              kind: nameOfCall === 'ForeignKey' ? 'foreign_key' : nameOfCall === 'OneToOneField' ? 'one_to_one' : 'many_to_many',
              target,
              line: lineOf(source, call.from),
              through: keyword(source, call, 'through'),
            });
          }
        } else if (nameOfCall === 'mapped_column' || nameOfCall === 'Column') {
          const first = firstArgument(call.getChild('ArgList'));
          const explicitName = first?.name === 'String' ? literal(source, first) : undefined;
          const fk = findCalls(call, source, 'ForeignKey')[0];
          columns.push({
            name: explicitName || field,
            primaryKey: keyword(source, call, 'primary_key') === 'True',
            nullable: keyword(source, call, 'nullable') === 'True',
            foreignKey: !!fk,
          });
          if (fk) {
            const target = fieldTarget(source, fk);
            if (!target) diagnostics.push(file.relativePath + ':' + lineOf(source, fk.from) + ' unresolved SQLAlchemy target for ' + name + '.' + field);
            else relations.push({ field, kind: 'foreign_key', target, line: lineOf(source, fk.from) });
          }
        } else if (nameOfCall === 'relationship') {
          relationshipCalls.push({ field, call, assign });
        }
      }
      if (orm === 'django' && columns.length === 0 && relations.length === 0 && !directStringAssignment(source, metaAssignments, 'db_table')) continue;
      const tableName = table || directStringAssignment(source, metaAssignments, 'db_table') || app + '_' + name.toLowerCase();
      const id = stableId('table', file.owner, tableName);
      const evidence: SourceEvidence[] = [{ uri: file.uri, line: lineOf(source, classNode.from), extractor: orm }];
      const node: GraphNode = { id, kind: 'table', label: tableName, model: name, app, orm, owner: file.owner, database: file.database, columns, evidence };
      drafts.push({ node, owner: file.owner, app, orm, relations });
      for (const relationship of relationshipCalls) {
        const secondary = keyword(source, relationship.call, 'secondary');
        if (secondary) {
          const typeNames = slice(source, relationship.assign.getChild('TypeDef')).match(/\b[A-Z][A-Za-z0-9_]*\b/g)?.filter(item => !['Mapped', 'List', 'Optional', 'Sequence', 'Set'].includes(item)) ?? [];
          const target = fieldTarget(source, relationship.call) || typeNames.at(-1);
          if (target) relations.push({ field: relationship.field, kind: 'many_to_many', target, line: lineOf(source, relationship.call.from), through: secondary });
          else diagnostics.push(file.relativePath + ':' + lineOf(source, relationship.call.from) + ' unresolved SQLAlchemy secondary relationship');
        }
      }
    }
  }
  const byModel = new Map<string, ModelDraft>();
  const byTable = new Map<string, ModelDraft>();
  for (const draft of drafts) {
    if (draft.node.model) byModel.set(draft.owner + ':' + draft.app + '.' + draft.node.model, draft);
    byTable.set(draft.owner + ':' + draft.node.label, draft);
  }
  const edges: GraphEdge[] = [];
  const joinNodes: GraphNode[] = [];
  const joinEdges: GraphEdge[] = [];
  for (const draft of drafts) {
    for (const relation of draft.relations) {
      let target: ModelDraft | undefined;
      if (draft.orm === 'django') {
        const name = relation.target === 'settings.AUTH_USER_MODEL' ? options.authUserModels?.[draft.owner] : relation.target;
        if (name === 'self') target = draft;
        else if (name?.includes('.')) {
          target = byModel.get(draft.owner + ':' + name);
        } else {
          target = byModel.get(draft.owner + ':' + draft.app + '.' + name);
          if (!target) {
            const matches = drafts.filter(item => item.owner === draft.owner && item.node.model === name);
            if (matches.length === 1) target = matches[0];
          }
        }
      } else if (relation.kind === 'many_to_many') {
        const matches = drafts.filter(item => item.owner === draft.owner && item.node.model === relation.target.replace(/['"]/g, ''));
        if (matches.length === 1) target = matches[0];
      } else {
        const tableName = relation.target.includes('.') ? relation.target.slice(0, relation.target.lastIndexOf('.')) : '';
        target = byTable.get(draft.owner + ':' + tableName) || byTable.get(draft.owner + ':' + tableName.split('.').pop());
      }
      const evidence = [{ uri: draft.node.evidence[0].uri, line: relation.line, extractor: draft.orm }];
      if (!target) {
        diagnostics.push(draft.node.model + '.' + relation.field + ': unresolved target ' + relation.target + ' in ' + draft.owner);
        continue;
      }
      if (target.owner !== draft.owner || (draft.node.database && target.node.database && draft.node.database !== target.node.database)) {
        diagnostics.push(draft.node.model + '.' + relation.field + ': target crosses a database boundary');
        continue;
      }
      edges.push({
        id: stableId('relation', draft.node.id, target.node.id, relation.field, relation.kind),
        from: draft.node.id,
        to: target.node.id,
        kind: relation.kind,
        label: relation.field,
        field: relation.field,
        cardinality: relation.kind === 'foreign_key' ? 'many to one' : relation.kind === 'one_to_one' ? 'one to one' : 'many to many',
        through: relation.through,
        confidence: 'declared',
        evidence,
      });
      if (draft.orm === 'django' && relation.kind === 'many_to_many' && !relation.through) {
        const joinName = draft.node.label + '_' + relation.field;
        const joinId = stableId('join-table', draft.owner, joinName);
        joinNodes.push({
          id: joinId,
          kind: 'table',
          label: joinName,
          app: draft.app,
          orm: 'django',
          owner: draft.owner,
          database: draft.node.database,
          joinTable: true,
          columns: [
            { name: (draft.node.model ?? 'source').toLowerCase() + '_id', foreignKey: true },
            { name: (target.node.model ?? 'target').toLowerCase() + '_id', foreignKey: true },
          ],
          evidence,
        });
        for (const [to, field] of [[draft.node, (draft.node.model ?? 'source').toLowerCase()], [target.node, (target.node.model ?? 'target').toLowerCase()]] as const) {
          joinEdges.push({
            id: stableId('join-fk', joinId, to.id, field),
            from: joinId,
            to: to.id,
            kind: 'foreign_key',
            label: field + '_id',
            field: field + '_id',
            cardinality: 'many to one',
            confidence: 'declared',
            evidence,
          });
        }
      }
    }
  }
  const nodes = [...new Map([...drafts.map(draft => draft.node), ...joinNodes].map(node => [node.id, node])).values()];
  return { graph: { version: 1, nodes, edges: [...edges, ...joinEdges] }, diagnostics, files: files.length };
}
