#!/usr/bin/env python3
"""Prebuild a disposable copy; never change the source app or its native directory."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='doul-expo-ios-') as directory:
    sandbox = Path(directory)
    shutil.copy2(root / 'package.json', sandbox / 'package.json')
    shutil.copytree(root / 'apps/mobile', sandbox / 'apps/mobile',
                    ignore=shutil.ignore_patterns('node_modules', '.expo', 'ios', 'android'))
    (sandbox / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
    environment = {**os.environ, 'EXPO_NO_TELEMETRY': '1', 'CI': '1'}
    subprocess.run(['node', str(root / 'node_modules/expo/bin/cli'), 'prebuild',
                    '--platform', 'ios', '--no-install'], cwd=sandbox / 'apps/mobile',
                   env=environment, check=True)
    projects = list((sandbox / 'apps/mobile/ios').glob('*.xcodeproj/project.pbxproj'))
    if len(projects) != 1:
        raise SystemExit('Expected exactly one generated iOS project')
    subprocess.run(['node', str(root / 'scripts/check_xcode_compatibility.cjs'),
                    str(projects[0])], cwd=root, check=True)
