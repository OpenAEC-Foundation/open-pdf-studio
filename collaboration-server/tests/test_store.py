from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from opds_collaboration import Conflict, Denied, Invalid, Store
from opds_collaboration.store import MAX_EVENT_BYTES, SESSION_SECONDS

PASSWORD = 'a long test password'


def request(event='e1', ann='a1', op='create', base=None, text='First'):
    return {'id': event, 'ann': ann, 'op': op, 'base': base, 'data': None if op == 'delete' else
            {'id': ann, 'type': 'textbox', 'page': 1, 'text': text, 'x': 10.5, 'y': 20}}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'review.db'
        self.now = 1_700_000_000
        self.store = Store(self.path, clock=lambda: self.now)
        self.alice = self.store.create_user('Alice', PASSWORD)
        self.bob = self.store.create_user('Bob', PASSWORD)
        self.a = self.store.login('ALICE', PASSWORD)
        self.b = self.store.login('Bob', PASSWORD)
        self.doc = self.store.create_document(self.a, 'Drawing A.pdf')

    def test_credentials_and_session_tokens_are_not_stored_in_plaintext(self):
        with sqlite3.connect(self.path) as db:
            rows = db.execute('SELECT salt,password_hash FROM users').fetchall()
            self.assertNotEqual(rows[0], rows[1])
            self.assertNotEqual(db.execute('SELECT token_hash FROM sessions').fetchone()[0], self.a)
            self.assertNotIn(PASSWORD, '\n'.join(db.iterdump()))
        for name, password in [('Alice', 'a wrong test password'), ('unknown', PASSWORD)]:
            with self.assertRaises(Denied):
                self.store.login(name, password)

    def test_canonical_user_names_are_unique(self):
        with self.assertRaises(Invalid):
            self.store.create_user(' alice ', PASSWORD)
        self.store.create_user('Élodie', PASSWORD)
        with self.assertRaises(Invalid):
            self.store.create_user('E\u0301lodie', PASSWORD)
        with self.assertRaises(Invalid):
            self.store.create_user('short', 'short')

    def test_expiry_logout_disable_and_reenable_require_new_sessions(self):
        self.now += SESSION_SECONDS
        with self.assertRaises(Denied):
            self.store.snapshot(self.a, self.doc)
        self.a = self.store.login('Alice', PASSWORD)
        self.store.logout(self.a)
        with self.assertRaises(Denied):
            self.store.create_document(self.a, 'No access')
        self.a = self.store.login('Alice', PASSWORD)
        self.store.set_disabled(self.alice, True)
        with self.assertRaises(Denied):
            self.store.replay(self.a, self.doc)
        with self.assertRaises(Denied):
            self.store.login('Alice', PASSWORD)
        self.store.set_disabled(self.alice, False)
        with self.assertRaises(Denied):
            self.store.snapshot(self.a, self.doc)
        self.store.snapshot(self.store.login('Alice', PASSWORD), self.doc)

    def test_private_document_checks_every_read_and_write(self):
        operations = [lambda: self.store.snapshot(self.b, self.doc),
                      lambda: self.store.replay(self.b, self.doc),
                      lambda: self.store.append(self.b, self.doc, request()),
                      lambda: self.store.grant(self.b, self.doc, self.bob, 'editor')]
        for op in operations:
            with self.assertRaises(Denied):
                op()
        with self.assertRaises(Denied):
            self.store.snapshot(self.a, 'unknown-document')

    def test_reader_cannot_write_and_revocation_applies_to_retry(self):
        self.store.grant(self.a, self.doc, self.bob, 'reader')
        self.assertEqual(self.store.snapshot(self.b, self.doc)['cursor'], 0)
        with self.assertRaises(Denied):
            self.store.append(self.b, self.doc, request())
        with self.assertRaises(Denied):
            self.store.grant(self.b, self.doc, self.bob, 'editor')
        self.store.grant(self.a, self.doc, self.bob, 'editor')
        self.store.append(self.b, self.doc, request())
        self.store.grant(self.a, self.doc, self.bob, None)
        for op in [lambda: self.store.replay(self.b, self.doc), lambda: self.store.append(self.b, self.doc, request())]:
            with self.assertRaises(Denied):
                op()
        with self.assertRaises(Invalid):
            self.store.grant(self.a, self.doc, self.alice, None)

    def test_identical_retry_preserves_original_result_and_changed_retry_conflicts(self):
        original = self.store.append(self.a, self.doc, request())
        self.now += 5
        self.assertEqual(self.store.append(self.a, self.doc, request()), original)
        self.assertEqual(self.store.replay(self.a, self.doc)['cursor'], 1)
        with self.assertRaises(Conflict):
            self.store.append(self.a, self.doc, request(text='changed'))
        self.store.grant(self.a, self.doc, self.bob, 'editor')
        with self.assertRaises(Conflict):
            self.store.append(self.b, self.doc, request())
        other = self.store.create_document(self.a, 'B.pdf')
        self.assertEqual(self.store.append(self.a, other, request())['revision'], 1)

    def test_server_assigns_actor_clock_and_timestamp(self):
        supplied = request(); supplied['user'] = 'Someone else'
        with self.assertRaises(Invalid):
            self.store.append(self.a, self.doc, supplied)
        event = self.store.append(self.a, self.doc, request())
        self.assertEqual((event['uk'], event['user'], event['clock'], event['seq']), (self.alice, 'Alice', 1, 1))
        self.assertEqual(event['at'], '2023-11-14T22:13:20.000Z')

    def test_stale_edit_or_delete_preserves_current_snapshot(self):
        self.store.append(self.a, self.doc, request())
        self.store.append(self.a, self.doc, request('e2', op='edit', base='e1', text='Second'))
        for op in ('edit', 'delete'):
            with self.assertRaises(Conflict) as error:
                self.store.append(self.a, self.doc, request('stale-'+op, op=op, base='e1'))
            self.assertEqual(error.exception.current, 'e2')
        snapshot = self.store.snapshot(self.a, self.doc)
        self.assertEqual(snapshot['cursor'], 2)
        self.assertEqual(snapshot['annotations'][0]['data']['text'], 'Second')

    def test_delete_keeps_history_and_restore_is_explicit(self):
        self.store.append(self.a, self.doc, request())
        self.store.append(self.a, self.doc, request('e2', op='delete', base='e1'))
        self.assertIsNone(self.store.snapshot(self.a, self.doc)['annotations'][0]['data'])
        with self.assertRaises(Conflict):
            self.store.append(self.a, self.doc, request('e3'))
        self.store.append(self.a, self.doc, request('e4', op='edit', base='e2', text='Restored'))
        self.assertEqual(len(self.store.replay(self.a, self.doc)['events']), 3)
        self.assertEqual(self.store.snapshot(self.a, self.doc)['annotations'][0]['data']['text'], 'Restored')

    def test_restart_pagination_and_reconnect_do_not_lose_events(self):
        for i in range(5):
            self.store.append(self.a, self.doc, request('e'+str(i), 'a'+str(i)))
        other = Store(self.path, clock=lambda: self.now)
        first = other.replay(self.a, self.doc, limit=2)
        self.assertEqual((first['cursor'], first['head'], first['hasMore']), (2, 5, True))
        second = other.replay(self.a, self.doc, after=first['cursor'], limit=2)
        third = other.replay(self.a, self.doc, after=second['cursor'], limit=2)
        self.assertEqual([e['revision'] for e in first['events']+second['events']+third['events']], [1,2,3,4,5])
        self.assertFalse(third['hasMore'])
        self.assertEqual(other.replay(self.a, self.doc, after=5)['events'], [])
        self.assertEqual(other.snapshot(self.a, self.doc)['cursor'], 5)
        for cursor in (-1, True, 1.5, 6, 2**64):
            with self.assertRaises(Invalid):
                other.replay(self.a, self.doc, after=cursor)

    def test_concurrent_updates_from_same_base_commit_once(self):
        self.store.grant(self.a, self.doc, self.bob, 'editor')
        self.store.append(self.a, self.doc, request())
        barrier = threading.Barrier(2)
        def write(pair):
            token, eid = pair; barrier.wait()
            try:
                return self.store.append(token, self.doc, request(eid, op='edit', base='e1', text=eid))
            except Conflict:
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(write, [(self.a, 'alice-edit'), (self.b, 'bob-edit')]))
        self.assertEqual(sum(x is not None for x in result), 1)
        self.assertEqual(self.store.snapshot(self.a, self.doc)['cursor'], 2)

    def test_parallel_creates_and_retries_have_no_lost_or_duplicate_events(self):
        def write(i):
            return self.store.append(self.a, self.doc, request('e'+str(i), 'a'+str(i)))
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(write, list(range(12))*2))
        self.assertEqual(len(results), 24)
        self.assertEqual([e['revision'] for e in self.store.replay(self.a, self.doc)['events']], list(range(1,13)))
        self.assertEqual(len(self.store.snapshot(self.a, self.doc)['annotations']), 12)

    def test_mid_transaction_failure_rolls_back_every_table(self):
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TRIGGER fail_head BEFORE INSERT ON heads BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.append(self.a, self.doc, request())
        self.assertEqual(self.store.replay(self.a, self.doc)['events'], [])
        self.assertEqual(self.store.snapshot(self.a, self.doc)['cursor'], 0)
        with sqlite3.connect(self.path) as db:
            db.execute('DROP TRIGGER fail_head')
        self.assertEqual(self.store.append(self.a, self.doc, request())['revision'], 1)

    def test_invalid_snapshots_leave_no_history(self):
        invalid = []
        for data in (None, [], {'id':'other','type':'textbox','page':1}, {'id':'a1','type':'textbox','page':True}):
            r = request(); r['data'] = data; invalid.append(r)
        for value in (float('nan'), float('inf'), 2**64, b'bytes', 'x'*MAX_EVENT_BYTES, {'__proto__': {'admin': True}}):
            r = request(); r['data']['text'] = value; invalid.append(r)
        deep = {}; child = deep
        for _ in range(40):
            child['child'] = {}; child = child['child']
        r = request(); r['data']['nested'] = deep; invalid.append(r)
        for r in invalid:
            with self.assertRaises(Invalid):
                self.store.append(self.a, self.doc, r)
        self.assertEqual(self.store.snapshot(self.a, self.doc)['cursor'], 0)

    def test_sql_metacharacters_are_data_and_documents_are_isolated(self):
        other = self.store.create_document(self.b, "'); DROP TABLE events; --")
        self.store.append(self.b, other, request(text="'); DROP TABLE users; --"))
        self.assertEqual(self.store.snapshot(self.a, self.doc)['annotations'], [])
        self.assertEqual(len(self.store.snapshot(self.b, other)['annotations']), 1)
        with self.assertRaises(Denied):
            self.store.replay(self.a, other)

    def test_returned_values_cannot_mutate_committed_data(self):
        r = request(); event = self.store.append(self.a, self.doc, r)
        r['data']['text'] = event['data']['text'] = 'mutated'
        snapshot = self.store.snapshot(self.a, self.doc)
        self.assertEqual(snapshot['annotations'][0]['data']['text'], 'First')
        snapshot['annotations'].clear()
        self.assertEqual(len(self.store.snapshot(self.a, self.doc)['annotations']), 1)

    def test_future_schema_is_refused_without_changing_version(self):
        with sqlite3.connect(self.path) as db:
            db.execute('PRAGMA user_version=999')
        with self.assertRaises(Invalid):
            Store(self.path)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 999)


if __name__ == '__main__':
    unittest.main()
