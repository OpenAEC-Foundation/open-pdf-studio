"""Isolated stdio adapter for production JS client/sync integration tests.

Uses the real SQLite store; no HTTP socket, object store, existing DB or app.
The native transport is qualified separately in objectstore_integration.py.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from opds_collaboration.store import Store, Conflict, Denied, Invalid

with tempfile.TemporaryDirectory(prefix='opds-js-client-') as folder:
    store = Store(Path(folder) / 'review.sqlite')
    alice = store.create_user('Alice', 'test-password-alice')
    bob = store.create_user('Bob', 'test-password-bob')
    owner = store.login('Alice', 'test-password-alice')
    document = store.create_document(owner, 'Drawing')
    store.grant(owner, document, bob, 'editor')
    sessions = {}
    print(json.dumps({'document': document}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            command, args = request['command'], request['args']
            if command == 'central_review_login':
                handle = 'central-' + str(len(sessions) + 1)
                sessions[handle] = store.login(args['name'], args['password'])
                result = handle
            elif command == 'central_review_logout':
                store.logout(sessions.pop(args['session']))
                result = None
            elif command == 'revoke-bob':
                store.grant(owner, document, bob, None)
                result = None
            else:
                token = sessions[args['session']]
                op = args['operation']
                assert op['document'] == document
                if op['action'] == 'snapshot':
                    body = store.snapshot(token, document)
                elif op['action'] == 'events':
                    body = store.replay(token, document, after=op['after'], limit=op['limit'])
                else:
                    assert op['action'] == 'append'
                    body = store.append(token, document, op['event'])
                result = {'status': 200, 'body': body}
        except Conflict as exc:
            result = {'status': 409, 'body': {'current': exc.current}}
        except Denied:
            result = {'status': 403, 'body': {}}
        except Invalid:
            result = {'status': 400, 'body': {}}
        print(json.dumps(result), flush=True)
