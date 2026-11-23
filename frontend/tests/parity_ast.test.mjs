import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource, collectTopLevel, duplicatedInFile } from '../tools/parity_ast.js';

const names = (src) => collectTopLevel('x.ts', src).names;

test('1. 不同文件同名声明不判重（bool/SelectField 场景）', () => {
  const m = new Map([['a.ts', [{ name: 'SelectField', kind: 'variable' }]], ['b.ts', [{ name: 'SelectField', kind: 'variable' }]]]);
  assert.deepEqual(duplicatedInFile(m), []);
});

test('2. 同一文件内同名变量声明两次判重', () => {
  const m = new Map([['a.ts', [{ name: 'foo', kind: 'variable' }, { name: 'bar', kind: 'variable' }, { name: 'foo', kind: 'variable' }]]]);
  assert.deepEqual(duplicatedInFile(m), ['foo: a.ts']);
});

test('3. 全部不同名不判重', () => {
  const m = new Map([['a.ts', [{ name: 'x', kind: 'variable' }]], ['b.ts', [{ name: 'z', kind: 'variable' }]]]);
  assert.deepEqual(duplicatedInFile(m), []);
});

test('4. 字符串中的 // 不被当注释剥离', () => {
  assert.ok(normalizeSource('const a = "http://x//y";').includes('http://x//y'));
});

test('5. 字符串中的 /* */ 不被当注释剥离', () => {
  assert.ok(normalizeSource('const b = "a/*keep*/c";').includes('a/*keep*/c'));
});

test('6. 真正的块注释与行注释被剥离，空白折叠', () => {
  assert.equal(normalizeSource('a /* c */ b'), 'a b');
  assert.equal(normalizeSource('a // c\n b'), 'a b');
});

test('7. 函数重载（el 三声明）不判重，且 collectTopLevel 全收集', () => {
  const src = 'export function el(tag: string): void;\nexport function el(tag: number): void;\nexport function el(tag: any): void {}';
  const items = names(src);
  assert.equal(items.filter((n) => n.name === 'el').length, 3);
  assert.deepEqual(duplicatedInFile(new Map([['ui.ts', items]])), []);
});

test('8. 端到端：跨文件同名 const 不判重，同文件重复 const 判重', () => {
  const a = names('const shared = 1;');
  const b = names('const shared = 2;');
  assert.deepEqual(duplicatedInFile(new Map([['a.ts', a], ['b.ts', b]])), []);
  const c = names('const dup = 1;\nconst dup = 2;');
  assert.deepEqual(duplicatedInFile(new Map([['c.ts', c]])), ['dup: c.ts']);
});
