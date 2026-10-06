"""Export previously authorized frozen internal snapshots, never current records."""
import argparse
import json
import os
from pathlib import Path
from .render import LocalDocumentRuntime


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--snapshot',required=True);parser.add_argument('--html',required=True)
    parser.add_argument('--format',choices=['docx','pdf'],required=True)
    parser.add_argument('--output',required=True);parser.add_argument('--cache',required=True)
    args=parser.parse_args()
    result=LocalDocumentRuntime(args.cache).export(json.loads(Path(args.snapshot).read_text()),Path(args.html).read_bytes(),args.format)
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as file:file.write(result['content'])
    print(json.dumps({'sha256':result['sha256'],'sourceSnapshotId':result['manifest']['sourceSnapshotId'],'legalSignatureTransferred':False}))

if __name__=='__main__':main()
