import assert from 'node:assert/strict';
import test from 'node:test';
import { appFromModulePath, joinRoutePath, modulePathToRelativeFile, parseUrlModule } from '../src/pythonRoutes';

test('root urls.py resolves includes with prefixes and namespaces', () => {
  const source = [
    'from django.urls import include, path',
    'urlpatterns = [',
    '    path("api/internal/", include("apps.internal.urls", namespace="internal")),',
    '    path("api/auth/", include("apps.accounts.urls", namespace="accounts")),',
    '    path("api/auth/parents/", include("apps.accounts.parent_urls")),',
    ']',
  ].join('\n');
  const result = parseUrlModule(source, 'config/urls.py');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.leaves.length, 0);
  assert.equal(result.includes.length, 3);
  assert.deepEqual(result.includes[1], { prefix: 'api/auth/', modulePath: 'apps.accounts.urls', namespace: 'accounts', line: 4 });
  assert.equal(result.includes[2].modulePath, 'apps.accounts.parent_urls');
  assert.equal(result.includes[2].namespace, undefined);
});

test('app-level urls.py resolves leaf routes including raw-string patterns', () => {
  const source = [
    'from django.urls import path, re_path',
    'urlpatterns = [',
    '    path("login/", StudentLoginView.as_view(), name="student-login"),',
    '    path("signup/", StudentSignupView.as_view(), name="student-signup"),',
    '    re_path(r"^detail/(?P<pk>\\d+)/$", DetailView.as_view()),',
    ']',
  ].join('\n');
  const result = parseUrlModule(source, 'apps/accounts/urls.py');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.includes.length, 0);
  assert.equal(result.leaves.length, 3);
  assert.deepEqual(result.leaves[0], { prefix: 'login/', view: 'StudentLoginView', name: 'student-login', line: 3 });
  assert.equal(result.leaves[2].prefix, '^detail/(?P<pk>\\d+)/$');
  assert.equal(result.leaves[2].view, 'DetailView');
});

test('a dynamic URL prefix is reported as a diagnostic, not fabricated', () => {
  const source = [
    'from django.urls import path',
    'PREFIX = "dynamic/"',
    'urlpatterns = [',
    '    path(PREFIX, SomeView.as_view()),',
    ']',
  ].join('\n');
  const result = parseUrlModule(source, 'apps/x/urls.py');
  assert.equal(result.leaves.length, 0);
  assert.equal(result.includes.length, 0);
  assert.ok(result.diagnostics.some(item => item.includes('unresolved dynamic URL prefix')));
});

test('joinRoutePath, appFromModulePath, and modulePathToRelativeFile compose correctly', () => {
  assert.equal(joinRoutePath('api/auth/', 'login/'), 'api/auth/login/');
  assert.equal(joinRoutePath('', 'health/'), 'health/');
  assert.equal(joinRoutePath('api/auth/', 'login'), 'api/auth/login');
  assert.equal(appFromModulePath('apps.accounts.urls'), 'accounts');
  assert.equal(appFromModulePath('apps.accounts.parent_urls'), 'accounts');
  assert.equal(modulePathToRelativeFile('apps.accounts.urls'), 'apps/accounts/urls.py');
});
