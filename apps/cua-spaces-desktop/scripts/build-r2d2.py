#!/usr/bin/env python3
"""Build the Linux fork using the matching, checksum-verified native release."""
from pathlib import Path
import hashlib
import os
import re
import shutil
import subprocess
import sys

desktop=Path(__file__).resolve().parents[1]
root=desktop.parents[1]
web=desktop.parent/'cua-spaces-web'
cache=Path.home()/'.cache/r2d2-cua/build'
cache.mkdir(parents=True,exist_ok=True)
tag='cua-spaces-v0.11.0'
base='039eb33770c300e59b8342017250ff3a0191469a'
subprocess.run(['git','merge-base','--is-ancestor',base,'HEAD'],cwd=root,check=True)
for name in ['checksums.txt','cua-spaces_0.11.0_amd64.deb']:
    subprocess.run(['gh','release','download',tag,'--repo','trycua/cua','--pattern',name,'--dir',str(cache),'--skip-existing'],check=True)
package=cache/'cua-spaces_0.11.0_amd64.deb'
expected=next(line.split()[0] for line in (cache/'checksums.txt').read_text().splitlines() if line.split()[-1].lstrip('*')==package.name)
if hashlib.sha256(package.read_bytes()).hexdigest()!=expected:
    raise SystemExit('Upstream package checksum mismatch.')
extracted=cache/'extracted'
if extracted.exists():shutil.rmtree(extracted)
subprocess.run(['dpkg-deb','-x',str(package),str(extracted)],check=True)
resources=extracted/'opt/Cua Spaces/resources'
native=desktop/'native/linux-x64'
native.mkdir(parents=True,exist_ok=True)
for file in (resources/'native').iterdir():
    if file.is_file():shutil.copy2(file,native/file.name)
assets=resources/'web/assets'
glue=next(p for p in assets.glob('core-*.js') if 'core_bg-' in p.read_text())
source=glue.read_text()
match=re.search(r'/assets/(core_bg-[A-Za-z0-9_-]+\.wasm)',source)
if not match:raise SystemExit('No matching app-core WASM asset in pinned release.')
wasm=web/'src/bridge/core/wasm'
wasm.mkdir(parents=True,exist_ok=True)
(wasm/'core.js').write_text(source.replace('/assets/'+match[1],'./'+match[1]))
shutil.copy2(assets/match[1],wasm/match[1])
if '--prepare-only' in sys.argv:raise SystemExit(0)
env=os.environ|{'GITHUB_REPOSITORY':'jmqcooper/cua','CUA_SPACES_ARCHS':'x64','CUA_SPACES_VERSION':'0.11.0-r2d2.3'}
for cwd,command in [(web,['pnpm','install','--frozen-lockfile']),(desktop,['pnpm','install','--frozen-lockfile']),(web,['pnpm','exec','vite','build']),(web,['pnpm','typecheck']),(desktop,['pnpm','build']),(desktop,['node','--test','controller.check.mjs']),(desktop,['pnpm','exec','vitest','run','test/assistant.test.ts']),(desktop,['pnpm','exec','electron-builder','--linux','deb','--config','electron-builder.config.cjs','--publish','never'])]:
    subprocess.run(command,cwd=cwd,env=env,check=True)
print('Built '+str(desktop/'dist/cua-spaces_0.11.0-r2d2.3_amd64.deb'))
