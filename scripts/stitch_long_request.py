"""Bounded local wrapper for MCP Inspector 2.9.0 CLI timeout omission.

Inspector's CLI does not pass serverSettings.requestTimeout to InspectorClient.
Keep the installed original unchanged; a sibling copy supplies a 300-second
request default. Credentials remain in the existing Inspector configuration and
are never read or printed by this script. Only the wrapper path is returned.
"""
from pathlib import Path
import hashlib
import json
import subprocess


def wrapper():
    matches=list((Path.home()/'.npm/_npx').glob('*/node_modules/@modelcontextprotocol/inspector'))
    source=next((p for p in matches if (p/'clients/cli/build/index.js').exists()),None)
    if source is None:
        raise RuntimeError('Install MCP Inspector first; no credentials or settings were changed')
    metadata=json.loads((source/'package.json').read_text())
    if metadata['version']!='2.9.0':
        raise RuntimeError('Re-check request timeout handling for this Inspector version')
    path=source/'clients/cli/build/index.js';target=path.with_name('doul-long-request.js')
    original=path.read_text();needle='this.requestTimeout = options.timeout;'
    if original.count(needle)!=1:raise RuntimeError('Unexpected source; no patch applied')
    updated=original.replace(needle,'this.requestTimeout = options.timeout ?? 300000;')
    if target.exists() and target.read_text()!=updated:raise RuntimeError('Existing wrapper differs; refusing overwrite')
    if not target.exists():target.write_text(updated)
    subprocess.run(['node','--check',str(target)],check=True,capture_output=True)
    return target


if __name__=='__main__':print(wrapper())
