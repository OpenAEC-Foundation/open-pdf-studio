import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESENTED_KEY, MAX_PRESENTED, isJobFile, readPresented, writePresented,
  unpresentedJobs, nextPresented, sameSet,
} from './print-queue-presented.js';

function memoryStorage(initial) {
  const map = new Map(initial === undefined ? [] : [[PRESENTED_KEY, initial]]);
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
}

test('only spooled job basenames count as job files', () => {
  assert.ok(isJobFile('job_1730000000000.pdf'));
  assert.ok(isJobFile('job_1730000000000__Report.pdf'));
  assert.ok(isJobFile('job_1__a..b.pdf'));
  for (const bad of ['latest.pdf', 'JOB_1.PDF', 'job_1.PDF', 'job_1.txt', '../job_1.pdf', 'job_\\..\\x.pdf', 'sub/job_1.pdf',
    'job_1:stream.pdf', 'job_.pdf', '', null, 42, `job_${'x'.repeat(300)}.pdf`]) {
    assert.equal(isJobFile(bad), false, String(bad));
  }
});

test('reading tolerates missing, corrupt and foreign storage content', () => {
  assert.equal(readPresented(null).size, 0);
  assert.equal(readPresented(memoryStorage()).size, 0);
  assert.equal(readPresented(memoryStorage('{not json')).size, 0);
  assert.equal(readPresented(memoryStorage('{"a":1}')).size, 0);
  const s = readPresented(memoryStorage(JSON.stringify(['job_1.pdf', 'C:\\Users\\x\\file.pdf', 7])));
  assert.deepEqual([...s], ['job_1.pdf']);
  const throwing = { getItem() { throw new Error('blocked'); } };
  assert.equal(readPresented(throwing).size, 0);
});

test('writing stores sorted unique job names and survives a full storage', () => {
  const st = memoryStorage();
  assert.equal(writePresented(st, ['job_2.pdf', 'job_1.pdf', 'job_2.pdf', '../evil.pdf']), true);
  assert.equal(st.map.get(PRESENTED_KEY), JSON.stringify(['job_1.pdf', 'job_2.pdf']));
  assert.deepEqual([...readPresented(st)], ['job_1.pdf', 'job_2.pdf']);
  assert.equal(writePresented({ setItem() { throw new Error('quota'); } }, ['job_1.pdf']), false);
  assert.equal(writePresented(null, ['job_1.pdf']), false);
  const many = Array.from({ length: MAX_PRESENTED + 5 }, (_, i) => `job_${String(i).padStart(5, '0')}.pdf`);
  writePresented(st, many);
  assert.equal(readPresented(st).size, MAX_PRESENTED);
});

test('unpresented jobs are the spooled jobs not shown before', () => {
  const list = [{ file: 'job_1.pdf' }, { file: 'job_2.pdf' }, { file: 'latest.pdf' }, null];
  assert.deepEqual(unpresentedJobs(list, new Set(['job_1.pdf'])), [{ file: 'job_2.pdf' }]);
  assert.deepEqual(unpresentedJobs(null, new Set()), []);
});

test('the remembered set follows the spool and grows only when shown', () => {
  const list = [{ file: 'job_1.pdf' }, { file: 'job_3.pdf' }];
  const before = new Set(['job_1.pdf', 'job_2.pdf']);
  assert.deepEqual([...nextPresented(list, before, false)], ['job_1.pdf']);
  assert.deepEqual([...nextPresented(list, before, true)], ['job_1.pdf', 'job_3.pdf']);
  assert.ok(sameSet(new Set(['a', 'b']), new Set(['b', 'a'])));
  assert.equal(sameSet(new Set(['a']), new Set(['a', 'b'])), false);
});
