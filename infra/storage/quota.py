#!/usr/bin/env python3
"""Trusted, bounded XFS pool assignment and read-only admission. No runner code is executed."""
import os, sys, json, re, stat, fcntl, struct, subprocess
SAFE=re.compile(r'^[a-zA-Z0-9/_-]+$')
FSGETXATTR=0x801c581f
PROJINHERIT=0x200

def command(*args):
    p=subprocess.run(args,check=True,capture_output=True,text=True,timeout=8,env={'PATH':os.environ.get('PATH','/usr/sbin:/usr/bin:/sbin:/bin'),'LC_ALL':'C'})
    if len(p.stdout)>1048576: raise ValueError('quota output limit')
    return p.stdout

def trusted(path):
    if not path.startswith('/') or not SAFE.fullmatch(path) or os.path.realpath(path)!=path: raise ValueError('canonical trusted path required')
    p=path
    while True:
        s=os.lstat(p)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise ValueError('untrusted ancestor')
        parent=os.path.dirname(p)
        if p==parent: break
        p=parent

def attributes(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        data=bytearray(28);fcntl.ioctl(fd,FSGETXATTR,data,True)
        flags,_,_,project,_,_=struct.unpack('IIIII8s',data)
        return flags,project
    finally:os.close(fd)

def check_tree(path,project,maximum):
    count=0
    for base,dirs,files in os.walk(path,followlinks=False):
        for name in ['.']+dirs+files:
            target=base if name=='.' else os.path.join(base,name);s=os.lstat(target);count+=1
            if count>maximum*2+1:raise ValueError('tree inspection limit')
            if stat.S_ISLNK(s.st_mode):continue
            if not(stat.S_ISREG(s.st_mode)or stat.S_ISDIR(s.st_mode)):raise ValueError('unsupported inode')
            flags,pid=attributes(target)
            if pid!=project or(stat.S_ISDIR(s.st_mode)and not flags&PROJINHERIT):raise ValueError('quota inheritance mismatch')

def verify(quota_root,profile,headroom=True):
    trusted(quota_root)
    flags,project=attributes(quota_root)
    if not project or not flags&PROJINHERIT:raise ValueError('project quota absent')
    filesystem=json.loads(command('findmnt','--json','--target',quota_root,'--output','TARGET,FSTYPE,OPTIONS'))['filesystems'][0]
    if filesystem['fstype']!='xfs' or not any(x in filesystem['options'].split(',')for x in ['prjquota','pquota']):raise ValueError('XFS enforcement required')
    mount=filesystem['target'];state=command('xfs_quota','-x','-c','state -p',mount)
    if 'Accounting: ON' not in state or 'Enforcement: ON' not in state:raise ValueError('quota enforcement off')
    storage={'status':'known'}
    for kind,ceiling,multiple in [('b',profile['blockHardLimitBytes'],1024),('i',profile['inodeHardLimit'],1)]:
        report=command('xfs_quota','-x','-c',f'report -p -{kind} -n -N -L {project} -U {project}',mount)
        rows=[re.match(r'^#?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)',line.strip())for line in report.splitlines()]
        rows=[m for m in rows if m and int(m[1])==project]
        if len(rows)!=1 or not 0<int(rows[0][4])*multiple<=ceiling:raise ValueError('hard quota exceeds ceiling')
        storage['usedBytes'if kind=='b'else'usedInodes']=int(rows[0][2])*multiple
        storage['byteLimit'if kind=='b'else'inodeLimit']=int(rows[0][4])*multiple
        reserve=profile.get('reserveBytes',8388608)if kind=='b'else profile.get('reserveInodes',16)
        if headroom and (int(rows[0][4])-int(rows[0][2]))*multiple<reserve:raise ValueError('quota headroom unavailable')
    space=os.statvfs(quota_root)
    if headroom and (space.f_bavail*space.f_frsize<profile.get('reserveBytes',8388608)or space.f_favail<profile.get('reserveInodes',16)):raise ValueError('filesystem headroom unavailable')
    check_tree(quota_root,project,profile['inodeHardLimit'])
    workspace=os.path.join(quota_root,'workspace');s=os.lstat(workspace)
    if not stat.S_ISDIR(s.st_mode)or s.st_uid!=10001 or s.st_mode&0o700!=0o700:raise ValueError('runner access unavailable')
    native=os.path.join(quota_root,'native');trusted(native)
    return workspace,storage

def main():
    if sys.platform!='linux'or os.getuid()!=0:raise ValueError('trusted Linux storage authority required')
    profile=json.loads(os.environ['HARBOR_XFS_PROFILE']);request=json.loads(sys.stdin.read(800001))
    root=next(r for r in profile['roots']if r['id']==request['rootId'])
    trusted(root['path']);trusted(root['pool']);state=os.environ['HARBOR_LAUNCHER_STATE_DIR'];trusted(state)
    relative=request['relativePath'];parts=relative.split('/')
    if len(parts)>2 or not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}',parts[0])or(len(parts)==2 and parts[1]!='workspace'):raise ValueError('managed project name required')
    target=os.path.join(root['path'],parts[0]);action=request['action']
    if any(os.stat(state).st_dev==os.stat(r['path']).st_dev for r in profile['roots']):raise ValueError('Control storage must be outside project filesystem')
    with open(os.path.join(state,'storage.lock'),'a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        identities=set()
        for configured in profile['roots']:
            for parent in [configured['path'],configured['pool']]:
                trusted(parent);children=os.listdir(parent)
                if len(children)>1000:raise ValueError('project pool inspection limit')
                for child in children:
                    candidate=os.path.join(parent,child);trusted(candidate)
                    _,pid=attributes(candidate);identity=(os.stat(candidate).st_dev,pid)
                    if not pid or identity in identities:raise ValueError('duplicate filesystem project ID')
                    identities.add(identity)
        if action=='allocate':
            if os.path.lexists(target):raise ValueError('project already exists')
            slots=sorted(os.listdir(root['pool']))
            if not slots or len(slots)>1000:raise ValueError('quota pool unavailable')
            slot=os.path.join(root['pool'],slots[0]);verify(slot,profile)
            os.rename(slot,target)
        elif action not in ['validate','native','clearCredentials','inspect','attachments']:raise ValueError('unsupported action')
        workspace,storage=verify(target,profile,action not in ['clearCredentials','inspect'])
        if action=='attachments':
            from attachments import publish
            print(json.dumps(publish(target,request)));return
        if action=='inspect':print(json.dumps(storage));return
        if action=='clearCredentials':
            parent=os.open(os.path.join(target,'native'),os.O_DIRECTORY|os.O_NOFOLLOW)
            removed=0
            try:
                sessions=os.listdir(parent)
                if len(sessions)>1000:raise ValueError('native home limit')
                for session in sessions:
                    if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',session):raise ValueError('native home identity mismatch')
                    fd=os.open(session,os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
                    try:
                        if os.fstat(fd).st_uid!=10001:raise ValueError('native home ownership mismatch')
                        try:os.unlink('auth.json',dir_fd=fd);removed+=1
                        except FileNotFoundError:pass
                        os.fsync(fd)
                    finally:os.close(fd)
            finally:os.close(parent)
            print(json.dumps({'removedCount':removed}));return
        if action=='native':
            session=request['sessionId']
            if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',session):raise ValueError('invalid session')
            parent=os.open(os.path.join(target,'native'),os.O_DIRECTORY|os.O_NOFOLLOW)
            try:
                try:os.mkdir(session,0o700,dir_fd=parent);os.chown(session,10001,10001,dir_fd=parent,follow_symlinks=False)
                except FileExistsError:pass
                fd=os.open(session,os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
                try:
                    info=os.fstat(fd)
                    if info.st_uid!=10001 or info.st_mode&0o700!=0o700:raise ValueError('native ownership mismatch')
                finally:os.close(fd)
                workspace=os.path.join(target,'native',session)
            finally:os.close(parent)
        s=os.stat(workspace,follow_symlinks=False)
        print(json.dumps({'canonical':workspace,'device':str(s.st_dev),'inode':str(s.st_ino)}))
try:main()
except ValueError as error:
    reason=str(error)
    sys.stderr.write(('Managed XFS storage unavailable: '+reason if re.fullmatch('[a-zA-Z -]{1,80}',reason) else 'Managed XFS storage unavailable')+'\n');sys.exit(2)
except Exception:sys.stderr.write('Managed XFS storage unavailable\n');sys.exit(2)
