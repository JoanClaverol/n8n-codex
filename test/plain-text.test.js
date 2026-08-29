// The chat UI renders replies as plain text — plainText() is the hard
// guarantee that leaked markdown never reaches the student as literal ** / _.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainText } from '../src/agent/plain-text.js';

test('unwraps paired emphasis, code, headings, links, bullets', () => {
  assert.equal(plainText('**bold** and *it* and ***both***'), 'bold and it and both');
  assert.equal(plainText('__bold__ and _it_ and ___both___'), 'bold and it and both');
  assert.equal(plainText('use `get_workflow` first'), 'use get_workflow first');
  assert.equal(plainText('## Done\n> note\n* item one\n+ item two'), 'Done\nnote\n- item one\n- item two');
  assert.equal(plainText('see [the tab](http://x/wf/1)'), 'see the tab (http://x/wf/1)');
  assert.equal(plainText('```json\n{"a":1}\n```'), '{"a":1}\n');
});

test('leaves non-markdown asterisks and underscores alone', () => {
  assert.equal(plainText('{{ $json.x * 2 }}'), '{{ $json.x * 2 }}');
  assert.equal(plainText('2 ** 8 is 256'), '2 ** 8 is 256');
  assert.equal(plainText('$json.some_field and snake_case_name'), '$json.some_field and snake_case_name');
  assert.equal(plainText('del /q * | echo "quoted"'), 'del /q * | echo "quoted"');
  assert.equal(plainText('a*b and x = *ptr'), 'a*b and x = *ptr');
});
