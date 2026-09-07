// Attribution on annotation read-back.
//
// The shared session only works if the agent can tell its own shapes from the
// person's redlines. The annotation model has always carried author, subject
// and timestamps (annotations/factory.js) — the MCP summary dropped them, so
// an agent had to memorise every id it created and diff against that list.
//
// These tests pin the four fields into the read-back contract. Losing one
// again is silent: the agent simply stops being able to attribute anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _summarizeAnnotation } from './mcp-bridge.js';

const drawn = {
  id: 'a1',
  type: 'box',
  page: 2,
  x: 40, y: 40, width: 200, height: 120,
  color: '#000000',
  author: 'Grok',
  subject: 'elevation B frame',
  createdAt: '2026-09-02T10:00:00.000Z',
  modifiedAt: '2026-09-02T10:00:00.000Z',
};

test('the four attribution fields survive the summary', () => {
  const s = _summarizeAnnotation(drawn);
  assert.equal(s.author, 'Grok');
  assert.equal(s.subject, 'elevation B frame');
  assert.equal(s.createdAt, '2026-09-02T10:00:00.000Z');
  assert.equal(s.modifiedAt, '2026-09-02T10:00:00.000Z');
});

test('geometry and identity still come through', () => {
  const s = _summarizeAnnotation(drawn);
  assert.equal(s.id, 'a1');
  assert.equal(s.type, 'box');
  assert.equal(s.page, 2);
  assert.equal(s.x, 40);
  assert.equal(s.width, 200);
});

test('an agent can separate its own shapes from a person\'s redlines', () => {
  const redline = {
    id: 'r1', type: 'cloud', page: 2,
    x: 60, y: 60, width: 80, height: 40,
    author: 'Ivan',
    subject: 'this jamb is V.I.F.',
    createdAt: '2026-09-02T10:05:00.000Z',
  };

  const mine = [drawn, redline].map(_summarizeAnnotation).filter((a) => a.author === 'Grok');
  const theirs = [drawn, redline].map(_summarizeAnnotation).filter((a) => a.author !== 'Grok');

  assert.deepEqual(mine.map((a) => a.id), ['a1']);
  assert.deepEqual(theirs.map((a) => a.id), ['r1']);
  assert.equal(theirs[0].subject, 'this jamb is V.I.F.', 'the note travels with the shape');
});

test('timestamps let the agent ask what changed since it last looked', () => {
  const since = '2026-09-02T10:03:00.000Z';
  const older = _summarizeAnnotation(drawn);
  const newer = _summarizeAnnotation({ ...drawn, id: 'a2', modifiedAt: '2026-09-02T10:07:00.000Z' });

  const changed = [older, newer].filter((a) => a.modifiedAt > since);
  assert.deepEqual(changed.map((a) => a.id), ['a2']);
});

test('annotations without attribution are summarised without empty keys', () => {
  // Documents opened from disk carry annotations that predate any of this.
  const bare = { id: 'x', type: 'line', startX: 0, startY: 0, endX: 10, endY: 10 };
  const s = _summarizeAnnotation(bare);

  assert.equal('author' in s, false);
  assert.equal('subject' in s, false);
  assert.equal('createdAt' in s, false);
  assert.equal(s.startX, 0);
  assert.equal(s.endY, 10);
});

test('long text is still truncated, and does not disturb attribution', () => {
  const s = _summarizeAnnotation({ ...drawn, text: 'x'.repeat(500) });
  assert.equal(s.text.length, 201, '200 characters plus the ellipsis');
  assert.equal(s.author, 'Grok');
});
