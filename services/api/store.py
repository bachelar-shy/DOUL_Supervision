"""SQLite development adapter around the merged reference engine.

The snapshot format is explicit JSON, never pickle. BEGIN IMMEDIATE serializes
commands across instances. Audit, history, idempotency and blobs commit together.
A normalized PostgreSQL adapter is a later deployment task.
"""
import base64
from contextlib import contextmanager
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
from threading import RLock
from app.reference.engine import Engine
from app.reference.documents import Documents

ENGINE_MAPS = ('_records','_history','_idempotency','_record_machines','_notifications')
DOC_MAPS = ('_snapshots','_signatures','_idempotency')


def encode_map(value):
    return [[list(key) if isinstance(key,tuple) else key, item] for key,item in value.items()]


def decode_map(value):
    return {tuple(key) if isinstance(key,list) else key:item for key,item in value}


class Store:
    def __init__(self, path=':memory:', demo=True):
        if path != ':memory:':Path(path).parent.mkdir(parents=True,exist_ok=True)
        self.lock=RLock()
        self.db=sqlite3.connect(path,check_same_thread=False,isolation_level=None,timeout=15)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, content BLOB NOT NULL)')
        self.engine=Engine();self.documents=Documents(self.engine)
        self.meta={};self.uploads={};self.requests={};self.conflicts=[]
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                if not self._load():
                    if not demo:raise RuntimeError('No production provisioning/authentication adapter configured')
                    from .demo import seed
                    data=seed(self.engine)
                    for fid,content in data.pop('blobs').items():self.put_blob(fid,content)
                    self.meta=data;self._save()
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK');raise

    def export_state(self):
        return dict(format=1,engine={k:encode_map(getattr(self.engine,k)) for k in ENGINE_MAPS},audit=self.engine._audit,escalations=[list(k) for k in self.engine._escalation_keys],documents={k:encode_map(getattr(self.documents,k)) for k in DOC_MAPS},documentBytes={k:base64.b64encode(v).decode() for k,v in self.documents._bytes.items()},meta=self.meta,uploads=self.uploads,requests=self.requests,conflicts=self.conflicts)

    def restore(self, state):
        if state['format'] != 1:raise RuntimeError('Unsupported development snapshot format')
        for key,value in state['engine'].items():setattr(self.engine,key,decode_map(value))
        self.engine._audit=state['audit'];self.engine._escalation_keys={tuple(k) for k in state['escalations']}
        for key,value in state['documents'].items():setattr(self.documents,key,decode_map(value))
        self.documents._bytes={k:base64.b64decode(v) for k,v in state['documentBytes'].items()}
        self.engine.documents=deepcopy(self.documents._snapshots)
        self.meta=state['meta'];self.uploads=state['uploads'];self.requests=state['requests'];self.conflicts=state['conflicts']

    def _load(self):
        row=self.db.execute('SELECT payload FROM state WHERE id=1').fetchone()
        if row:self.restore(json.loads(row[0]))
        return bool(row)

    def _save(self):
        payload=json.dumps(self.export_state(),ensure_ascii=False,allow_nan=False)
        self.db.execute('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',(payload,))

    @contextmanager
    def transaction(self, write=False):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            self._load()
            before=deepcopy(self.export_state())
            try:
                yield self
                if write:self._save()
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK');self.restore(before);raise

    def put_blob(self, file_id, content):
        self.db.execute('INSERT INTO blobs(id,content) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content',(file_id,content))

    def blob(self, file_id):
        row=self.db.execute('SELECT content FROM blobs WHERE id=?',(file_id,)).fetchone()
        if row is None:raise KeyError('Blob not found')
        return bytes(row[0])

    def close(self):
        self.db.close()
