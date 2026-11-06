"""Upload the exact release artifacts requested for the approved logo rollout."""
import hashlib,json,os,re,subprocess,sys
from pathlib import Path

allowed={
 'open-speech-studio':'open-speech-studio', 'open-3d-viewer':'open-3d-viewer',
 'open-paint-studio':'open-paint-studio', 'open-field-studio':'Open-Field-Studio',
 'open-energy-studio':'open-energy-studio', 'open-fem-studio':'open-fem-studio',
 'monty-ifc-viewer':'monty-ifc-viewer', 'open-office-studio':'open-office-studio',
 'open-writer-studio':'open-office-studio', 'open-spreadsheet-studio':'open-office-studio',
 'open-presentation-studio':'open-office-studio', 'open-notition-studio':'open-office-studio',
 'open-email-studio':'open-office-studio',
}
name=sys.argv[1]
entries=json.loads(Path('scripts/logo-store-rollout.json').read_text())
entry=next(x for x in entries if x['snap']==name)
assert name in allowed and entry['repo']==allowed[name], 'App/repository is outside the requested rollout'
tag=entry['tag'];channel=entry['channel']
assert re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',tag)
assert channel in ['stable','beta']
assert os.environ.get('SNAPCRAFT_STORE_CREDENTIALS'), 'Existing publisher credentials are missing'
repo='OpenAEC-Foundation/'+entry['repo']
release=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/releases/tags/{tag}'],text=True))
assert not release['draft'], 'Release is not published'
assert not release['prerelease'] or channel=='beta', 'A prerelease must stay in beta'
filename=f'{name}_{tag[1:]}_amd64.snap'
asset=next(a for a in release['assets'] if a['name']==filename)
digest=asset.get('digest');assert digest and digest.startswith('sha256:')
subprocess.run(['gh','release','download',tag,'-R',repo,'--pattern',filename],check=True)
assert hashlib.sha256(Path(filename).read_bytes()).hexdigest()==digest[7:], 'Snap digest differs from release asset'
metadata=subprocess.check_output(['unsquashfs','-cat',filename,'meta/snap.yaml'],text=True)
assert re.search(r'^name: '+re.escape(name)+r'$',metadata,re.M)
assert re.search(r"^version: ['\"]?"+re.escape(tag[1:])+r"['\"]?$",metadata,re.M)
print(f'Verified {repo} {tag}: {filename}; requested channel {channel}',flush=True)
subprocess.run(['snapcraft','upload',filename,'--release='+channel],check=True)
