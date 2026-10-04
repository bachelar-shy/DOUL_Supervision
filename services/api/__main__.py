import argparse
from pathlib import Path
import uvicorn
from .main import create_app

p=argparse.ArgumentParser(description="Local development only; production adapters are not configured")
p.add_argument("--demo",action="store_true")
p.add_argument("--port",type=int,default=8791)
p.add_argument("--database",default=".local/mvp.sqlite3")
a=p.parse_args()
if not a.demo:p.error("--demo is required; no production authentication adapter is configured")
app=create_app(a.database,demo=True)
uvicorn.run(app,host="127.0.0.1",port=a.port,log_level="info")
