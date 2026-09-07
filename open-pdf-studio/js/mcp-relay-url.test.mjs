// Pure tests for relay URL resolution.
//
// If this is wrong the tab has no way to reach the relay and the whole shared
// session is dead — with no error the person would understand. The relative
// form is the one that matters most: it is what lets a single build be served
// from any host, same-origin with the relay behind one reverse proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelayUrls } from './mcp-transport.js';

const httpsPage = { protocol: 'https:', host: 'pdf.ngc.example' };
const httpPage = { protocol: 'http:', host: '127.0.0.1:4173' };

test('a relative path resolves against the page, over TLS', () => {
  const r = resolveRelayUrls('/ws', httpsPage);
  assert.equal(r.httpBase, 'https://pdf.ngc.example');
  assert.equal(r.wsUrl, 'wss://pdf.ngc.example/ws');
});

test('a relative path stays plaintext on a plaintext page', () => {
  // Mixed content would be blocked by the browser, so the scheme has to track
  // the page rather than being hardcoded either way.
  const r = resolveRelayUrls('/ws', httpPage);
  assert.equal(r.httpBase, 'http://127.0.0.1:4173');
  assert.equal(r.wsUrl, 'ws://127.0.0.1:4173/ws');
});

test('a nested relative path is preserved', () => {
  const r = resolveRelayUrls('/relay/ws', httpsPage);
  assert.equal(r.wsUrl, 'wss://pdf.ngc.example/relay/ws');
});

test('an absolute wss URL is used as given', () => {
  const r = resolveRelayUrls('wss://relay.ngc.example/ws', httpsPage);
  assert.equal(r.httpBase, 'https://relay.ngc.example');
  assert.equal(r.wsUrl, 'wss://relay.ngc.example/ws');
});

test('an absolute ws URL keeps its port — the dev case', () => {
  const r = resolveRelayUrls('ws://127.0.0.1:9224/ws', httpPage);
  assert.equal(r.httpBase, 'http://127.0.0.1:9224');
  assert.equal(r.wsUrl, 'ws://127.0.0.1:9224/ws');
});

test('an http(s) URL is accepted and converted to the socket scheme', () => {
  const r = resolveRelayUrls('https://relay.ngc.example/ws', httpsPage);
  assert.equal(r.httpBase, 'https://relay.ngc.example');
  assert.equal(r.wsUrl, 'wss://relay.ngc.example/ws');
});

test('a bare origin defaults to the /ws path', () => {
  const r = resolveRelayUrls('wss://relay.ngc.example', httpsPage);
  assert.equal(r.wsUrl, 'wss://relay.ngc.example/ws');
});

test('garbage returns null rather than a broken URL', () => {
  assert.equal(resolveRelayUrls('not a url', httpsPage), null);
  assert.equal(resolveRelayUrls('', httpsPage), null);
  assert.equal(resolveRelayUrls(null, httpsPage), null);
});

test('http and ws forms of one relay agree on both endpoints', () => {
  // The two ways of writing the same deployment must not diverge — a mismatch
  // would mint the session against one origin and open the socket on another.
  const a = resolveRelayUrls('wss://relay.ngc.example/ws', httpsPage);
  const b = resolveRelayUrls('https://relay.ngc.example/ws', httpsPage);
  assert.deepEqual(a, b);
});
