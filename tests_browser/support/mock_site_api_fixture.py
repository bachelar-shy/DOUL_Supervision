"""Owned local test process for the synthetic project, never a deployment adapter."""
import argparse
import uvicorn
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter
from scripts.mock_project_setup import setup

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True)
    parser.add_argument('--port',type=int,required=True)
    args=parser.parse_args()
    store=SQLiteSnapshotAdapter(args.database,demo=True)
    try:setup(store)
    finally:store.close()
    app=create_app(args.database,demo=True,queue_enabled=True)
    uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning')
