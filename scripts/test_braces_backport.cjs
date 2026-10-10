#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const braces = require('braces');
const expandAst = require('braces/lib/expand');
const parse = require('braces/lib/parse');
const stringify = require('braces/lib/stringify');

assert.deepEqual(braces.expand('{a,b}'), ['a', 'b']);
assert.deepEqual(braces.expand('a/{b,c}/file{1..2}.txt'), [
  'a/b/file1.txt', 'a/b/file2.txt', 'a/c/file1.txt', 'a/c/file2.txt'
]);
assert.equal(braces.compile('{1..5}'), '([1-5])');
assert.equal(stringify(parse('{a,{b}}'), { escapeInvalid: true }), '{a,{b}}');

function nestedBrace(depth) {
  let pattern = 'x';
  for (let index = 0; index < depth; index++) pattern = `{${pattern},}`;
  return pattern;
}

assert.doesNotThrow(() => parse(nestedBrace(100)));
assert.equal(braces.expand(nestedBrace(100)).length, 101);
assert.doesNotThrow(() => parse(nestedBrace(2), { maxDepth: 2 }));
for (const depth of [101, 250]) {
  const pattern = nestedBrace(depth);
  assert.throws(() => parse(pattern), /Input depth \(101\), exceeds max depth \(100\)/);
  assert.throws(() => braces.compile(pattern), /Input depth \(101\), exceeds max depth \(100\)/);
  assert.throws(() => braces.expand(pattern), /Input depth \(101\), exceeds max depth \(100\)/);
}
const reportedDeepPattern = '{'.repeat(4900) + 'a,b' + '}'.repeat(4900);
assert.equal(reportedDeepPattern.length, 9803);
assert.throws(() => braces.compile(reportedDeepPattern), /Input depth \(101\), exceeds max depth \(100\)/);
assert.throws(() => braces.expand(reportedDeepPattern), /Input depth \(101\), exceeds max depth \(100\)/);
const mixedDeepPattern = '{('.repeat(2498) + 'a,b' + ')}'.repeat(2498);
assert.equal(mixedDeepPattern.length, 9995);
assert.throws(() => braces.compile(mixedDeepPattern), /Input depth \(101\), exceeds max depth \(100\)/);
assert.throws(() => braces.expand(mixedDeepPattern), /Input depth \(101\), exceeds max depth \(100\)/);
assert.throws(() => parse(nestedBrace(101), { maxDepth: 999 }), /Input depth \(101\), exceeds max depth \(100\)/);

function nestedAst(depth) {
  let ast = { type: 'text', value: 'x' };
  for (let index = 0; index < depth; index++) ast = { type: 'brace', nodes: [ast] };
  return { type: 'root', nodes: [ast] };
}

for (const sink of [braces.compile, expandAst, stringify]) {
  assert.throws(() => sink(nestedAst(101)), /exceeds max depth/);
}

const cyclicParent = { type: 'paren' };
const cyclicAst = { type: 'paren', parent: cyclicParent, nodes: [{ type: 'text', value: 'x' }] };
cyclicParent.parent = cyclicAst;
assert.throws(() => expandAst(cyclicAst), /parent chain contains a cycle/);
const selfParent = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
selfParent.parent = selfParent;
assert.throws(() => expandAst(selfParent), /parent chain contains a cycle/);

console.log('braces local backport regression checks passed');
