// Consume real SQLite output with the shipped Tauri review model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isValidEvent, parseEventLog, replayEvents, serializeEvents } from '../../open-pdf-studio/js/review/shared-review-core.js';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.env.PYTHON || 'python', ['-m', 'tests.export_review'], { cwd, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const { events, snapshot } = JSON.parse(result.stdout);
assert.ok(events.every(isValidEvent));
const parsed = parseEventLog(serializeEvents(events));
assert.equal(parsed.invalid, 0);
assert.equal(parsed.partial, false);
// Reconnect can repeat older events; the actual app model deduplicates them.
const replay = replayEvents([...parsed.events.slice(2), ...parsed.events]);
assert.equal(replay.events.length, 4);
const annotation = replay.annotations.get('a1');
assert.equal(annotation.deleted, false);
assert.equal(annotation.head, snapshot.annotations[0].base);
assert.deepEqual(annotation.data, snapshot.annotations[0].data);
assert.deepEqual(annotation.history.map(e => e.user), ['Alice','Bob','Alice','Bob']);
assert.ok(annotation.history.every(e => !e.concurrent));
assert.equal(replay.maxClock, snapshot.cursor);
assert.ok(replayEvents(events.slice(0,3)).annotations.get('a1').deleted);
console.log('PASS: SQLite events replay in the shipped review core, including reconnect, deletion and restoration');
