"""Emit a real persisted review for the JavaScript compatibility test."""
import json
from pathlib import Path
import tempfile

from opds_collaboration import Store

with tempfile.TemporaryDirectory() as folder:
    store = Store(Path(folder) / 'review.db')
    alice = store.create_user('Alice', 'a long test password')
    bob = store.create_user('Bob', 'another long test password')
    a = store.login('Alice', 'a long test password')
    b = store.login('Bob', 'another long test password')
    doc = store.create_document(a, 'Review.pdf')
    store.grant(a, doc, bob, 'editor')
    data = {'id': 'a1', 'type': 'textbox', 'page': 1, 'text': 'Original', 'x': 10, 'y': 20}
    store.append(a, doc, {'id':'e1','ann':'a1','op':'create','base':None,'data':data})
    data['text'] = 'Revised by Bob'
    store.append(b, doc, {'id':'e2','ann':'a1','op':'edit','base':'e1','data':data})
    store.append(a, doc, {'id':'e3','ann':'a1','op':'delete','base':'e2','data':None})
    store.append(b, doc, {'id':'e4','ann':'a1','op':'edit','base':'e3','data':data})
    print(json.dumps({'events': store.replay(a, doc)['events'], 'snapshot': store.snapshot(a, doc)}))
