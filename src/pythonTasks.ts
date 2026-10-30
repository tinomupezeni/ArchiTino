import { parser } from '@lezer/python';
import { SyntaxNode } from '@lezer/common';
import { lineOf, literal, slice } from './pythonModels';

export interface TaskDraft {
  symbol: string;
  explicitName?: string;
  line: number;
}

export interface TaskCallDraft {
  symbol: string;
  method: 'delay' | 'apply_async';
  line: number;
}

export interface CeleryFile {
  tasks: TaskDraft[];
  calls: TaskCallDraft[];
  diagnostics: string[];
}

function decoratorName(source: string, decorator: SyntaxNode): string {
  const target = decorator.getChild('MemberExpression') ?? decorator.getChild('VariableName');
  if (!target) return '';
  return slice(source, target).split('.').pop() ?? '';
}

function decoratorKeyword(source: string, decorator: SyntaxNode, key: string): string | undefined {
  const args = decorator.getChild('ArgList');
  if (!args) return undefined;
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'VariableName' || slice(source, child) !== key || child.nextSibling?.name !== 'AssignOp') continue;
    const value = child.nextSibling.nextSibling;
    return value?.name === 'String' ? literal(source, value) : undefined;
  }
  return undefined;
}

function visit(node: SyntaxNode, onNode: (node: SyntaxNode) => void): void {
  onNode(node);
  for (let child = node.firstChild; child; child = child.nextSibling) visit(child, onNode);
}

export function parseCeleryFile(source: string, relativePath: string): CeleryFile {
  const tasks: TaskDraft[] = [];
  const calls: TaskCallDraft[] = [];
  const diagnostics: string[] = [];
  let tree;
  try { tree = parser.parse(source); }
  catch (error) {
    diagnostics.push(relativePath + ': parser failed: ' + (error instanceof Error ? error.message : String(error)));
    return { tasks, calls, diagnostics };
  }
  visit(tree.topNode, node => {
    if (node.name === 'DecoratedStatement') {
      const fn = node.getChild('FunctionDefinition');
      const decorator = node.getChild('Decorator');
      if (!fn || !decorator) return;
      const name = decoratorName(source, decorator);
      if (name !== 'task' && name !== 'shared_task') return;
      const symbol = slice(source, fn.getChild('VariableName'));
      if (!symbol) return;
      tasks.push({ symbol, explicitName: decoratorKeyword(source, decorator, 'name'), line: lineOf(source, fn.from) });
      return;
    }
    if (node.name === 'CallExpression') {
      const member = node.getChild('MemberExpression');
      if (!member) return;
      const property = member.getChild('PropertyName');
      const object = member.getChild('VariableName');
      const methodName = property ? slice(source, property) : '';
      if (!object || (methodName !== 'delay' && methodName !== 'apply_async')) return;
      calls.push({ symbol: slice(source, object), method: methodName, line: lineOf(source, node.from) });
    }
  });
  return { tasks, calls, diagnostics };
}
