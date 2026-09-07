"""Private external Codex protocol fixture backed by an actual run-owned PTY.
This fixture makes no filesystem/network isolation claim; supported Linux tests
exercise the pinned Codex runner instead. No Harbor component is replaced.
"""
import base64, errno, fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios
if os.environ.get('NODE_ENV') != 'test' or os.environ.get('HARBOR_FIXTURE_MODE') != 'private-test':
    raise RuntimeError('Private fixture disabled')
child = None
master = None
request_id = None
process_id = None
exited = False

def emit(value):
    sys.stdout.write(json.dumps(value, separators=(',', ':')) + '\n')
    sys.stdout.flush()

def cleanup(*_):
    # Close the master before waiting: a flooding PTY can otherwise keep the
    # shell's terminal teardown blocked while this handler stops draining it.
    if master is not None:
        try: os.close(master)
        except OSError: pass
    if child:
        # Interactive job control creates child process groups in the same
        # fixture-owned session. Retire that entire session, including jobs
        # orphaned after the shell exits; this is not a Linux sandbox proof.
        listing = subprocess.check_output(['/bin/ps','-axo','pid='], timeout=3)
        if len(listing) > 1048576: raise RuntimeError('Fixture process listing bound')
        for value in listing.split():
            pid = int(value)
            try:
                if os.getsid(pid) == child: os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError): pass
        # Job control can move the shell out of its original process group.
        # Kill the exact unreaped child as well as its owned session jobs.
        if not exited:
            try: os.kill(child, signal.SIGKILL)
            except ProcessLookupError: pass
        try: os.waitpid(child, 0)
        except ChildProcessError: pass
    sys.exit(0)

signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)
buffer = b''
while True:
    ready, _, _ = select.select([0] + ([master] if master is not None else []), [], [], .05)
    if 0 in ready:
        data = os.read(0, 16384)
        if not data: cleanup()
        buffer += data
        if len(buffer) > 65536: cleanup()
        while b'\n' in buffer:
            line, buffer = buffer.split(b'\n', 1)
            message = json.loads(line)
            method, params = message.get('method'), message.get('params', {})
            if method == 'initialized': continue
            result = {}
            if method == 'initialize':
                result = {'userAgent':'harbor-private-pty-fixture/0.153.4','platformFamily':'unix','platformOs':sys.platform}
            elif method == 'command/exec':
                if child or params.get('command') != ['/bin/bash','--noprofile','--norc','-i'] or params.get('tty') is not True:
                    raise RuntimeError('Invalid fixed PTY launch')
                request_id, process_id = message['id'], params['processId']
                child, master = pty.fork()
                if child == 0:
                    os.chdir(os.environ['HARBOR_FIXTURE_WORKSPACE'])
                    os.execve('/bin/bash', params['command'], {'PATH':os.environ['PATH'],'TERM':'xterm-256color','HISTFILE':'/dev/null','PS1':'harbor-test$ '})
                continue
            elif method in ('command/exec/resize','command/exec/write'):
                if master is None or exited or params.get('processId') != process_id:
                    emit({'id':message['id'],'error':{'code':-32600,'message':'no active command/exec for process id '+json.dumps(params.get('processId'))}})
                    continue
                if method.endswith('/resize'):
                    size = params['size']
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH',size['rows'],size['cols'],0,0))
                else:
                    data = base64.b64decode(params['deltaBase64'], validate=True)
                    if not 1 <= len(data) <= 4096: raise RuntimeError('Input bound')
                    os.write(master, data)
            else:
                raise RuntimeError('Unsupported private terminal method')
            emit({'id':message['id'],'result':result})
    if master in ready:
        try: data = os.read(master, 16384)
        except OSError as error:
            if error.errno != errno.EIO: raise
            data = b''
        if data:
            emit({'method':'command/exec/outputDelta','params':{'processId':process_id,'stream':'stdout','deltaBase64':base64.b64encode(data).decode(),'capReached':False}})
        else:
            os.close(master)
            master = None
    if child and not exited:
        pid, status = os.waitpid(child, os.WNOHANG)
        if pid:
            exited = True
            emit({'id':request_id,'result':{'exitCode':os.waitstatus_to_exitcode(status),'stdout':'','stderr':''}})
