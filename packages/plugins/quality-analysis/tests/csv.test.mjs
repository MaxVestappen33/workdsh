import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/domain/csv.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseCompleteQualityCsv } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const parse = text => parseCompleteQualityCsv(new TextEncoder().encode(text));
test('complete quoted CSV preserves values, multiline fields and leading zeroes', () => {
  const result = parse('\ufeffid,note\r\n0001,"a,b"\r\n0002,"two\nlines ""yes"""\r\n\r\n0003,=SUM(A1)');
  assert.equal(result.complete, true);
  assert.deepEqual(result.rows, [['0001','a,b'], ['0002','two\nlines "yes"'], ['0003','=SUM(A1)']]);
  assert.equal(result.ignoredBlankRecords, 1);
  assert.equal(Object.isFrozen(result.rows[0]), true);
});
test('malformed text is rejected without truncating or replacing bytes', () => {
  for (const [text, code] of [['a,a\n1,2','duplicate-header'], ['a, \n1,2','empty-header'], ['a,b\n1','column-count-mismatch'], ['a\n"bad','unterminated-quote'], ['a\n"x"z','characters-after-quote'], ['a\nx"y','quote-in-unquoted-field'], ['a\n\0','nul-character'], ['', 'missing-header']]) {
    assert.throws(() => parse(text), error => error.code === code);
  }
  assert.throws(() => parseCompleteQualityCsv(new Uint8Array([0xff])), error => error.code === 'invalid-utf8');
});
test('all rows within budget are parsed; oversized sources fail as a whole', () => {
  assert.equal(parse('id\n'+Array.from({length:10000},(_,i)=>i).join('\n')).rows.length, 10000);
  assert.throws(() => parse('id\n'+Array.from({length:10001},(_,i)=>i).join('\n')), error => error.code === 'row-budget-exceeded');
  assert.throws(() => parse(Array.from({length:51},(_,i)=>'c'+i).join(',')), error => error.code === 'column-budget-exceeded');
  assert.throws(() => parseCompleteQualityCsv(new Uint8Array(8*1024*1024+1)), error => error.code === 'byte-budget-exceeded');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => parseCompleteQualityCsv(new TextEncoder().encode('id'),controller.signal), {name:'AbortError'});
});
test('quoted empty rows are explicit data and trailing separators are preserved', () => {
  assert.deepEqual(parse('a,b\n"",\n,').rows, [['',''],['','']]);
});

test('source locations distinguish physical lines and records with blanks and quoted multiline fields',()=>{
 const result=parse('\r\nid,note\r\n\r\n001,"two\r\nlines"\r\n002,end');
 assert.deepEqual(result.locations,[{record:4,line:4},{record:5,line:6}]);
 assert.equal(Object.isFrozen(result.locations[0]),true);
 assert.throws(()=>parse('id,note\n\n001'),error=>error.code==='column-count-mismatch'&&error.record===3);
});
