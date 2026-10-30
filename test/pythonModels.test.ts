import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePythonModels, PythonModelFile } from '../src/pythonModels';
import { validateGraph } from '../src/graph';

const django: PythonModelFile = {
  uri: 'file:///project/svc/apps/catalog/models.py',
  relativePath: 'svc/apps/catalog/models.py',
  owner: 'svc',
  database: 'catalog_db',
  source: [
    'from django.db import models',
    'class Author(models.Model):',
    '    name = models.CharField(max_length=80)',
    'class Tag(models.Model):',
    '    name = models.CharField(max_length=80)',
    'class Book(models.Model):',
    '    author = models.ForeignKey("catalog.Author", on_delete=models.CASCADE)',
    '    tags = models.ManyToManyField("catalog.Tag")',
    '    class Meta:',
    '        db_table = "books"',
  ].join('\n'),
};

const sqlalchemy: PythonModelFile = {
  uri: 'file:///project/payments/app/models.py',
  relativePath: 'payments/app/models.py',
  owner: 'payments',
  database: 'payments_db',
  source: [
    'from sqlalchemy import ForeignKey',
    'from sqlalchemy.orm import mapped_column',
    'class User(Base):',
    '    __tablename__ = "users"',
    '    id = mapped_column(primary_key=True)',
    'class Payment(Base):',
    '    __tablename__ = "payments"',
    '    user_id = mapped_column(ForeignKey("users.id"))',
    '    external_user_id = mapped_column()',
  ].join('\n'),
};

test('Django relations and implicit join tables retain physical and domain evidence', () => {
  const result = analyzePythonModels([django]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(validateGraph(result.graph), []);
  const book = result.graph.nodes.find(node => node.model === 'Book');
  const author = result.graph.nodes.find(node => node.model === 'Author');
  const tag = result.graph.nodes.find(node => node.model === 'Tag');
  const join = result.graph.nodes.find(node => node.joinTable);
  assert.ok(book && author && tag && join);
  assert.equal(book.label, 'books');
  assert.ok(result.graph.edges.some(edge => edge.from === book.id && edge.to === author.id && edge.kind === 'foreign_key' && edge.evidence[0].line === 7));
  assert.ok(result.graph.edges.some(edge => edge.from === book.id && edge.to === tag.id && edge.kind === 'many_to_many'));
  assert.equal(result.graph.edges.filter(edge => edge.from === join.id && edge.kind === 'foreign_key').length, 2);
});

test('SQLAlchemy FK is declared; a similarly named ID is not a relation', () => {
  const result = analyzePythonModels([sqlalchemy]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(validateGraph(result.graph), []);
  assert.equal(result.graph.edges.length, 1);
  assert.equal(result.graph.edges[0].field, 'user_id');
});

test('SQLAlchemy secondary relation keeps its declared association table', () => {
  const source = [
    'from sqlalchemy import Table, Column, ForeignKey',
    'from sqlalchemy.orm import relationship',
    'post_tags = Table("post_tags", Base.metadata, Column("post_id", ForeignKey("posts.id")), Column("tag_id", ForeignKey("tags.id")))',
    'class Post(Base):',
    '    __tablename__ = "posts"',
    '    tags: Mapped[list["Tag"]] = relationship(secondary="post_tags")',
    'class Tag(Base):',
    '    __tablename__ = "tags"',
  ].join('\n');
  const result = analyzePythonModels([{ uri: 'file:///project/blog/models.py', relativePath: 'blog/models.py', source, owner: 'blog' }]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(validateGraph(result.graph), []);
  const join = result.graph.nodes.find(node => node.label === 'post_tags');
  assert.ok(join?.joinTable);
  assert.equal(result.graph.edges.filter(edge => edge.from === join.id && edge.kind === 'foreign_key').length, 2);
  assert.ok(result.graph.edges.some(edge => edge.kind === 'many_to_many' && edge.through === 'post_tags'));
});

test('bad model file reports a diagnostic while valid files still contribute', () => {
  const bad = { ...django, uri: 'file:///project/bad/models.py', relativePath: 'bad/models.py', source: 'class Broken(models.Model):\n  field = models.ForeignKey(\n' };
  const result = analyzePythonModels([bad, sqlalchemy]);
  assert.ok(result.diagnostics.some(item => item.includes('syntax error')));
  assert.equal(result.graph.edges.length, 1);
});
