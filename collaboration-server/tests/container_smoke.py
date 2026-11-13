"""Run only against an explicitly supplied locally built test image.

Creates/removes its own uniquely named container and volume. No image push,
external S3 traffic, user files or pre-existing containers are involved.
"""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import secrets
import shutil
import tempfile
from pathlib import Path
import subprocess
import sys
import time
import uuid


def docker(*args, input=None, check=True):
    return subprocess.run(['docker', *args], input=input, text=True, capture_output=True,
                          check=check, timeout=90).stdout.strip()


def main(image):
    with tempfile.TemporaryDirectory() as temp:
        source = Path(__file__).resolve().parents[1]
        shutil.copy2(source / 'compose.yaml', Path(temp) / 'compose.yaml')
        shutil.copy2(source / '.env.example', Path(temp) / '.env')
        docker('compose', '-f', str(Path(temp) / 'compose.yaml'), 'config', '--quiet')
    name = 'opds-review-smoke-' + uuid.uuid4().hex
    volume = name + '-data'
    password = secrets.token_urlsafe(24)
    docker('volume', 'create', volume)
    try:
        alice = docker('run', '--rm', '-i', '-v', volume+':/data', image,
                       'create-user', 'Alice', '--password-stdin', input=password+'\n')
        bob = docker('run', '--rm', '-i', '-v', volume+':/data', image,
                     'create-user', 'Bob', '--password-stdin', input=password+'\n')
        docker('run', '-d', '--name', name, '--read-only', '--tmpfs', '/tmp:size=256m',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
               '-v', volume+':/data', '-p', '127.0.0.1::8080',
               '-e', 'OPDS_S3_BUCKET=private-reviews', '-e', 'OPDS_S3_ENDPOINT=http://127.0.0.1:9',
               '-e', 'AWS_ACCESS_KEY_ID=test', '-e', 'AWS_SECRET_ACCESS_KEY=test',
               '-e', 'AWS_EC2_METADATA_DISABLED=true', image)
        info = json.loads(docker('inspect', name))[0]
        assert info['Config']['User'] == '10001:10001'
        port = int(info['NetworkSettings']['Ports']['8080/tcp'][0]['HostPort'])

        def request(method, path, body=None, token=None):
            headers = {'Content-Type':'application/json'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            try:
                connection.request(method, path, None if body is None else json.dumps(body), headers)
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        def login(user):
            status, body = request('POST','/v1/login',{'name':user,'password':password})
            assert status == 200, status
            return body['token']

        for _ in range(100):
            try:
                if request('GET','/v1/login')[0] == 405:
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError('container server did not start')
        a, b = login('Alice'), login('Bob')
        status, document = request('POST','/v1/documents',{'title':'Container review'},a)
        assert status == 201
        url = '/v1/documents/' + document['id']
        assert request('POST', url+'/members', {'userId':bob,'role':'editor'},a)[0] == 200
        with ThreadPoolExecutor() as pool:
            pending = pool.submit(request,'GET',url+'/events?wait=3',None,b)
            event = {'id':'event','ann':'annotation','op':'create','base':None,
                     'data':{'id':'annotation','type':'textbox','page':1}}
            assert request('POST',url+'/events',event,a)[0] == 200
            assert pending.result(5)[1]['cursor'] == 1
        assert request('GET',url+'/pdf',None,b)[0] == 404
        assert request('GET',url,None,a)[1]['cursor'] == 1
        docker('exec',name,'python','-m','opds_collaboration','backup','/data/snapshot.backup')
        inventory = docker('run','--rm','-v',volume+':/data',image,'--database','/data/snapshot.backup','list-users')
        assert alice in inventory and bob in inventory
        docker('restart', name)
        # Docker may allocate a different host port when restarting a container
        # whose published port was left ephemeral. Follow its current binding.
        info = json.loads(docker('inspect', name))[0]
        port = int(info['NetworkSettings']['Ports']['8080/tcp'][0]['HostPort'])
        last_status = None
        for _ in range(100):
            try:
                status, snapshot = request('GET',url,None,a)
                last_status = status
                if status == 200:
                    break
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(0.1)
        else:
            raise AssertionError(f'restart snapshot unavailable (HTTP {last_status}); ' +
                                 docker('logs',name,check=False))
        assert snapshot['cursor'] == 1
        docker('exec',name,'python','-m','opds_collaboration','disable-user',bob)
        assert request('GET',url,None,b)[0] == 403
        print('PASS: non-root Docker server, account provisioning, two-client replay, backup, restart and revocation')
    finally:
        docker('rm','-f',name,check=False)
        docker('volume','rm',volume,check=False)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: container_smoke.py LOCAL_TEST_IMAGE')
    main(sys.argv[1])
