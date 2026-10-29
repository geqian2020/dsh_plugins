import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BookStore } from '../src/store.mjs';

const agent = { session: { header: { id: 'search-test', agentPreset: 'book-companion' } } };

test('recall tolerates a wrong character from ASR, but does not invent hits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-search-'));
  const store = new BookStore(path.join(dir, 'reading.sqlite'));
  try {
    store.add(agent, { kind: 'material', text: '现在大家都说宫崎俊是个女权主义者', source: 'test:asr' });
    assert.equal(store.search(agent, '宫崎俊').length, 1, 'exact hit');
    assert.equal(store.search(agent, '宫崎骏').length, 1, 'one wrong character still found');
    assert.equal(store.search(agent, '不存在的词组').length, 0, 'no fuzzy false positive');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
