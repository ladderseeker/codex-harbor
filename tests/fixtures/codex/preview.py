"""External Codex protocol fixture; real package script, no Harbor mocks/isolation claim."""
import base64,json,os,select,shutil,signal,subprocess,sys
if os.environ.get('NODE_ENV')!='test' or os.environ.get('HARBOR_FIXTURE_MODE')!='private-test':
    raise RuntimeError('Private preview fixture disabled')
child=None
process_id=None
request_id=None
exited=False
streams={}
def emit(value):
    sys.stdout.write(json.dumps(value,separators=(',',':'))+'\n');sys.stdout.flush()
def cleanup(*_):
    if child:
        listing=subprocess.check_output(['/bin/ps','-axo','pid='],timeout=3)
        if len(listing)>1048576: raise RuntimeError('Fixture process bound')
        for value in listing.split():
            pid=int(value)
            try:
                if os.getsid(pid)==child.pid:os.kill(pid,signal.SIGKILL)
            except (ProcessLookupError,PermissionError):pass
        try:child.wait(timeout=3)
        except subprocess.TimeoutExpired:raise RuntimeError('Fixture retirement unconfirmed')
    sys.exit(0)
signal.signal(signal.SIGTERM,cleanup);signal.signal(signal.SIGINT,cleanup)
buffer=b''
while True:
    ready,_,_=select.select([0]+list(streams),[],[],.05)
    if 0 in ready:
        data=os.read(0,16384)
        if not data:cleanup()
        buffer+=data
        if len(buffer)>65536:cleanup()
        while b'\n' in buffer:
            line,buffer=buffer.split(b'\n',1)
            message=json.loads(line);method=message.get('method');params=message.get('params',{})
            if method=='initialized':continue
            if method=='initialize':
                emit({'id':message['id'],'result':{'userAgent':'harbor-private-preview-fixture/0.153.4','platformFamily':'unix','platformOs':sys.platform}})
            elif method=='command/exec':
                command=params.get('command',[])
                if child or len(command)!=3 or command[:2]!=['/usr/local/bin/npm','run'] or params.get('tty') is not False:raise RuntimeError('Invalid fixed preview launch')
                environment={'PATH':os.environ['PATH']}
                environment.update({k:v for k,v in params.get('env',{}).items() if isinstance(v,str)})
                child=subprocess.Popen([shutil.which('npm'),'run',command[2]],cwd=os.environ['HARBOR_FIXTURE_WORKSPACE'],env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
                streams={child.stdout.fileno():'stdout',child.stderr.fileno():'stderr'}
                request_id=message['id'];process_id=params['processId']
            elif method=='command/exec/write':
                if not child or exited or params.get('processId')!=process_id:
                    emit({'id':message['id'],'error':{'code':-32600,'message':'no active command/exec for process id '+json.dumps(params.get('processId'))}})
                elif params.get('deltaBase64')!='':raise RuntimeError('Preview accepts no typed input')
                else:emit({'id':message['id'],'result':{}})
            else:raise RuntimeError('Unsupported external preview method')
    for fd in list(streams):
        if fd in ready:
            data=os.read(fd,16384)
            if data:emit({'method':'command/exec/outputDelta','params':{'processId':process_id,'stream':streams[fd],'deltaBase64':base64.b64encode(data).decode(),'capReached':False}})
            else:streams.pop(fd)
    if child and not exited and child.poll() is not None:
        exited=True
        emit({'id':request_id,'result':{'exitCode':child.returncode,'stdout':'','stderr':''}})
