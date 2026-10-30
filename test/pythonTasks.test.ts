import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCeleryFile } from '../src/pythonTasks';

test('shared_task definitions are found with and without an explicit name', () => {
  const source = [
    'from celery import shared_task',
    '',
    '@shared_task',
    'def send_password_reset_email_task(user_id: str) -> None:',
    '    pass',
    '',
    '@shared_task(name="apps.ai_gateway.tasks.rebuild_learner_portraits_task")',
    'def rebuild_learner_portraits_task():',
    '    pass',
    '',
    'def not_a_task():',
    '    pass',
  ].join('\n');
  const result = parseCeleryFile(source, 'apps/accounts/tasks.py');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks[0], { symbol: 'send_password_reset_email_task', explicitName: undefined, line: 4 });
  assert.equal(result.tasks[1].symbol, 'rebuild_learner_portraits_task');
  assert.equal(result.tasks[1].explicitName, 'apps.ai_gateway.tasks.rebuild_learner_portraits_task');
});

test('delay and apply_async call sites are found by object symbol', () => {
  const source = [
    'from .tasks import send_password_reset_email_task',
    '',
    'def view(request):',
    '    send_password_reset_email_task.delay(str(user.pk))',
    '    other_task.apply_async(args=[1])',
    '    local_var.save()',
  ].join('\n');
  const result = parseCeleryFile(source, 'apps/accounts/views.py');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls[0], { symbol: 'send_password_reset_email_task', method: 'delay', line: 4 });
  assert.deepEqual(result.calls[1], { symbol: 'other_task', method: 'apply_async', line: 5 });
});

test('a syntax error produces a diagnostic rather than throwing', () => {
  const result = parseCeleryFile('def (:', 'apps/x/tasks.py');
  assert.equal(result.tasks.length, 0);
  assert.equal(result.calls.length, 0);
});
