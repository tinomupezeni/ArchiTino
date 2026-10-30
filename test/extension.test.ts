import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { isWithinWorkspace, scanWorkspace } from '../src/scanner';
import { openEvidenceSource } from '../src/navigation';
import { analyzeCompose } from '../src/compose';
import { analyzeModelWorkspaces } from '../src/modelWorkspace';
import { validateGraph } from '../src/graph';
import { analyzeComposeWorkspaces } from '../src/composeWorkspace';
import { analyzeComponentWorkspaces } from '../src/componentWorkspace';

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'test must open a workspace');
  assert.equal(isWithinWorkspace(vscode.Uri.joinPath(folder.uri, 'package.json')), true);
  assert.equal(isWithinWorkspace(vscode.Uri.file(`${folder.uri.fsPath}-other/package.json`)), false);
  assert.equal(isWithinWorkspace(vscode.Uri.parse(`${folder.uri.toString()}/../outside.txt`)), false);
  assert.equal(await openEvidenceSource({ uri: vscode.Uri.joinPath(folder.uri, 'package.json').toString(), line: 2, extractor: 'test' }), true);
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, 1);
  assert.equal(await openEvidenceSource({ uri: vscode.Uri.file(`${folder.uri.fsPath}-other/package.json`).toString(), line: 1, extractor: 'test' }), false);
  const source = new vscode.CancellationTokenSource();
  const result = await scanWorkspace(2, source.token);
  assert.ok(result.files.length <= 2);
  assert.ok(result.files.every(isWithinWorkspace));
  source.cancel();
  await assert.rejects(scanWorkspace(2, source.token), vscode.CancellationError);
  const extension = vscode.extensions.getExtension('tinomupezeni.archi');
  assert.ok(extension, 'development extension must be loaded');
  await extension.activate();
  await vscode.commands.executeCommand('archi.analyzeWorkspace');
  let opened = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    opened = vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'Archi Diagram'));
    if (opened) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(opened, 'analysis should open a diagram tab');
  if (folder.name === 'HBEC') {
    const composeUri = vscode.Uri.joinPath(folder.uri, 'docker-compose.yml');
    const composeSource = new TextDecoder().decode(await vscode.workspace.fs.readFile(composeUri));
    const system = analyzeCompose(composeSource, composeUri.toString()).graph;
    const data = await analyzeModelWorkspaces(system, new vscode.CancellationTokenSource().token);
    assert.ok(data.graph.nodes.length > 100, 'HBEC should yield a substantial data map');
    assert.deepEqual(validateGraph(data.graph), []);
    const byId = new Map(data.graph.nodes.map(node => [node.id, node]));
    const has = (owner: string, from: string, field: string, to: string, kind: string) => data.graph.edges.some(edge =>
      byId.get(edge.from)?.owner === owner && byId.get(edge.from)?.model === from && edge.field === field && byId.get(edge.to)?.model === to && edge.kind === kind && edge.evidence[0].line > 0);
    const expected: [string, string, string, string, string][] = [
      ['admin-backend', 'ExamPaper', 'exam_board', 'ExamBoard', 'foreign_key'],
      ['admin-backend', 'ExamPaper', 'subject', 'Subject', 'foreign_key'],
      ['admin-backend', 'ExamPaper', 'shared_with_subjects', 'Subject', 'many_to_many'],
      ['admin-backend', 'ExamPaper', 'created_by', 'AdminUser', 'foreign_key'],
      ['admin-backend', 'Artifact', 'release', 'SyllabusRelease', 'foreign_key'],
      ['admin-backend', 'RevisionNote', 'topic', 'Topic', 'foreign_key'],
      ['admin-backend', 'QuizQuestion', 'quiz', 'Quiz', 'foreign_key'],
      ['student-backend', 'Paper', 'exam_board', 'ExamBoard', 'foreign_key'],
      ['student-backend', 'Paper', 'generated_for', 'User', 'foreign_key'],
      ['student-backend', 'Paper', 'shared_with_subjects', 'Subject', 'many_to_many'],
      ['student-backend', 'ParentProfile', 'user', 'User', 'one_to_one'],
      ['student-backend', 'StudentProfile', 'user', 'User', 'one_to_one'],
      ['student-backend', 'PracticeSession', 'artifact', 'Artifact', 'foreign_key'],
      ['student-backend', 'PaperRating', 'paper', 'Paper', 'foreign_key'],
      ['payments', 'Subscription', 'user_reference_id', 'UserReference', 'foreign_key'],
      ['payments', 'Payment', 'subscription_id', 'Subscription', 'foreign_key'],
      ['payments', 'PaymentTransactionLog', 'payment_id', 'Payment', 'foreign_key'],
      ['notifications', 'Notification', 'draft_id', 'NotificationDraft', 'foreign_key'],
      ['notifications', 'TicketEvent', 'ticket_id', 'Ticket', 'foreign_key'],
      ['harness', 'Question', 'paper_id', 'Paper', 'foreign_key'],
      ['harness', 'Question', 'parent_id', 'Question', 'foreign_key'],
      ['harness', 'LearningGuideMessage', 'session_id', 'LearningGuideSession', 'foreign_key'],
    ];
    for (const relation of expected) assert.ok(has(...relation), 'missing HBEC relation: ' + relation.join(' '));
    assert.equal(data.graph.edges.some(edge => byId.get(edge.from)?.model === 'ContentGapReport' && edge.field === 'subject_id'), false);
    assert.equal(data.graph.edges.some(edge => byId.get(edge.from)?.model === 'UserReference' && edge.field === 'external_user_id'), false);
    assert.equal(data.graph.nodes.find(node => node.owner === 'payments' && node.model === 'Payment')?.database, 'hbec_payments');
    const productionUri = vscode.Uri.joinPath(folder.uri, 'docker-compose.production.yml');
    const selection = { workspaceState: { get: () => productionUri.toString() } } as unknown as vscode.ExtensionContext;
    const production = await analyzeComposeWorkspaces(selection, new vscode.CancellationTokenSource().token);
    assert.ok(production.graph.nodes.find(node => node.label === 'payments')?.paths?.includes('PAYMENTS'));
    const productionData = await analyzeModelWorkspaces(production.graph, new vscode.CancellationTokenSource().token);
    assert.ok(productionData.graph.nodes.some(node => node.owner === 'payments' && node.model === 'Payment' && node.database === 'hbec_payments'));
    const relation = data.graph.edges.find(edge => byId.get(edge.from)?.owner === 'payments' && edge.field === 'subscription_id');
    assert.ok(relation);
    assert.equal(await openEvidenceSource(relation.evidence[0]), true);
    process.stdout.write('HBEC data map: ' + data.files + ' files, ' + data.graph.nodes.length + ' data nodes, ' + data.graph.edges.length + ' graph edges\n');

    const components = await analyzeComponentWorkspaces(system, new vscode.CancellationTokenSource().token);
    assert.deepEqual(validateGraph(components.graph), []);
    assert.ok(components.files > 0 && components.files < components.graph.nodes.length, 'files should count urls.py/tasks.py/views.py files read, not graph nodes');
    const loginRoute = components.graph.nodes.find(node => node.kind === 'route' && node.owner === 'student-backend' && node.label === '/api/auth/login/');
    assert.ok(loginRoute, 'expected the student login route to be resolved through config/urls.py -> apps.accounts.urls');
    assert.equal(loginRoute?.view, 'StudentLoginView');
    assert.ok(loginRoute && (await openEvidenceSource(loginRoute.evidence[0])), 'route evidence should open');
    const servesEdge = components.graph.edges.find(edge => edge.kind === 'serves' && edge.to === loginRoute?.id);
    assert.ok(servesEdge, 'expected a serves edge from student-backend to its login route');
    const resetTask = components.graph.nodes.find(node => node.kind === 'task' && node.owner === 'student-backend' && node.symbol === 'send_password_reset_email_task');
    assert.ok(resetTask, 'expected the Celery password-reset task to be found');
    assert.ok((resetTask?.evidence.length ?? 0) >= 2, 'expected both the task definition and at least one .delay() trigger site as evidence');
    assert.ok(resetTask && (await openEvidenceSource(resetTask.evidence[1])), 'trigger-site evidence should open');
    process.stdout.write('HBEC components: ' + components.files + ' files, ' + components.graph.nodes.length + ' nodes, ' + components.graph.edges.length + ' edges, ' + components.diagnostics.length + ' diagnostics\n');
  }
  source.dispose();
}
