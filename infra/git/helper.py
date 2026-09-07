"""Fixed nonroot Git/snapshot helper. All paths below are fixed container mounts."""
import os,sys,json,stat,subprocess,hashlib,shutil,re
MAX_BYTES=256*1024*1024
MAX_ENTRIES=10000
OPTIONS={'core.hooksPath':'/dev/null','core.fsmonitor':'false','core.pager':'cat','core.sshCommand':'false','credential.helper':'','maintenance.auto':'false','gc.auto':'0','gc.worktreePruneExpire':'never','protocol.allow':'never','protocol.file.allow':'always','core.protectHFS':'true','core.protectNTFS':'true','transfer.fsckObjects':'true','fetch.fsckObjects':'true'}
ENV={'PATH':'/usr/bin:/bin','HOME':'/tmp','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_ATTR_NOSYSTEM':'1','GIT_OPTIONAL_LOCKS':'0','LC_ALL':'C','GIT_CONFIG_COUNT':str(len(OPTIONS))}
for i,(key,value)in enumerate(OPTIONS.items()): ENV['GIT_CONFIG_KEY_'+str(i)]=key;ENV['GIT_CONFIG_VALUE_'+str(i)]=value

def git(*args):
 p=subprocess.run(['git',*args],env=ENV,capture_output=True,text=True,timeout=20)
 if p.returncode:raise ValueError('Git operation unavailable')
 if len(p.stdout)>1048576:raise ValueError('Git output limit')
 return p.stdout.strip()

def tree(root,copyto=None):
 count=0;total=0;digest=hashlib.sha256()
 def walk(source,destination,depth):
  nonlocal count,total
  if depth>64:raise ValueError('Snapshot depth limit')
  before=os.fstat(source)
  for name in sorted(os.listdir(source)):
   count+=1
   if count>MAX_ENTRIES:raise ValueError('Snapshot entry limit')
   info=os.stat(name,dir_fd=source,follow_symlinks=False)
   if stat.S_ISLNK(info.st_mode)or not(stat.S_ISDIR(info.st_mode)or stat.S_ISREG(info.st_mode)):raise ValueError('Unsupported snapshot entry')
   flags=os.O_RDONLY|os.O_NOFOLLOW|(os.O_DIRECTORY if stat.S_ISDIR(info.st_mode)else 0)
   child=os.open(name,flags,dir_fd=source)
   try:
    opened=os.fstat(child)
    if (info.st_dev,info.st_ino)!=(opened.st_dev,opened.st_ino):raise ValueError('Source identity changed')
    digest.update(json.dumps([name,info.st_mode&0o777,'directory'if stat.S_ISDIR(info.st_mode)else'file',info.st_size if stat.S_ISREG(info.st_mode)else None],separators=(',',':')).encode()+b'\0')
    if stat.S_ISDIR(info.st_mode):
     target=None
     if destination is not None:os.mkdir(name,0o700,dir_fd=destination);target=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=destination)
     try:
      if target is not None:os.fchmod(target,info.st_mode&0o777)
      walk(child,target,depth+1)
     finally:
      if target is not None:os.close(target)
    else:
     total+=info.st_size
     if total>MAX_BYTES:raise ValueError('Snapshot byte limit')
     target=None
     if destination is not None:target=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,info.st_mode&0o777&~0o6000,dir_fd=destination)
     try:
      if target is not None:os.fchmod(target,info.st_mode&0o777)
      content_hash=hashlib.sha256()
      while True:
       data=os.read(child,65536)
       if not data:break
       if os.lseek(child,0,os.SEEK_CUR)>info.st_size:raise ValueError('Source changed during snapshot')
       content_hash.update(data)
       if target is not None:
        at=0
        while at<len(data):at+=os.write(target,data[at:])
      digest.update(content_hash.digest())
      if target is not None:os.fsync(target)
     finally:
      if target is not None:os.close(target)
    after=os.fstat(child)
    if (opened.st_size,opened.st_mtime_ns,opened.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise ValueError('Source changed during snapshot')
   finally:os.close(child)
  digest.update(b'END_DIRECTORY\0')
  after=os.fstat(source)
  if (before.st_mtime_ns,before.st_ctime_ns)!=(after.st_mtime_ns,after.st_ctime_ns):raise ValueError('Source changed during snapshot')
 source=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);destination=os.open(copyto,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)if copyto else None
 try:walk(source,destination,0)
 finally:
  os.close(source)
  if destination is not None:os.close(destination)
 return digest.hexdigest()

def metadata(root):
 count=0
 for base,dirs,files in os.walk(root,followlinks=False):
  count+=len(dirs)+len(files)
  if count>MAX_ENTRIES:raise ValueError('Metadata entry limit')
  for name in dirs+files:
   entry=os.path.join(base,name)
   if os.path.islink(entry)or not(os.path.isfile(entry)or os.path.isdir(entry)):raise ValueError('External metadata entry')
   if name=='alternates' and os.path.getsize(entry):raise ValueError('Alternate object stores unsupported')

def clean_common():
 metadata('/git-common')
 config=b'[core]\nrepositoryformatversion = 0\nbare = true\nhooksPath = /dev/null\n[gc]\nauto = 0\nworktreePruneExpire = never\n'
 fd=os.open('/git-common/config',os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
 try:os.write(fd,config);os.fsync(fd)
 finally:os.close(fd)
 for base,dirs,files in os.walk('/git-common/worktrees'):
  if 'config.worktree'in files:os.unlink(os.path.join(base,'config.worktree'))

def source_view(source):
 gitpath=os.path.join(source,'.git')
 if not os.path.lexists(gitpath):return None
 if os.path.islink(gitpath):raise ValueError('Unsafe Git directory')
 if os.path.isdir(gitpath):common=gitpath;admin=gitpath
 elif os.path.isfile(gitpath):
  value=open(gitpath).read(512).strip()
  if not value.startswith('gitdir: /git-common/worktrees/'):raise ValueError('External Git directory unsupported')
  admin=value[8:];common='/git-common'
  if os.path.dirname(admin)!='/git-common/worktrees'or not os.path.isdir(admin):raise ValueError('External Git directory unsupported')
 else:raise ValueError('Unsafe Git directory')
 metadata(common)
 view='/tmp/source-view'
 if os.path.exists(view):shutil.rmtree(view)
 os.mkdir(view,0o700)
 # Only objects/refs are referenced read-only; executable configuration is never imported.
 for name in ['objects','refs']:os.symlink(os.path.join(common,name),os.path.join(view,name))
 for name,parent in [('HEAD',admin),('index',admin),('packed-refs',common),('shallow',common)]:
  sourcefile=os.path.join(parent,name)
  if os.path.isfile(sourcefile):
   if os.path.getsize(sourcefile)>16777216:raise ValueError('Git output limit')
   shutil.copyfile(sourcefile,os.path.join(view,name),follow_symlinks=False)
 with open(view+'/config','w')as config:config.write('[core]\nrepositoryformatversion = 0\nbare = true\nhooksPath = /dev/null\n')
 return view

def inspect(source):
 view=source_view(source)
 if view is None:return {'git':False,'dirty':False,'head':None,'branch':None,'snapshotHash':tree(source)}
 args=['--git-dir='+view,'--work-tree='+source]
 head=git(*args,'rev-parse','--verify','HEAD^{commit}')
 if any(line.startswith('160000 ')for line in git(*args,'ls-tree','-r',head).splitlines()):raise ValueError('Submodules unsupported')
 branch=git(*args,'rev-parse','--abbrev-ref','HEAD')
 dirty=bool(git(*args,'status','--porcelain=v1','--untracked-files=all','--ignore-submodules=all'))
 return {'git':True,'dirty':dirty,'head':head,'branch':None if branch=='HEAD'else branch}

def main():
 request=json.loads(sys.stdin.read(8193));action=request['action'];source='/source'
 if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',request['workspaceId']):raise ValueError('Workspace identity invalid')
 target='/harbor/workspaces/'+request['workspaceId']
 info=inspect(source)
 if action=='inspect':print(json.dumps(info));return
 if action=='copy':
  if info['git']:raise ValueError('Copy is for non Git sources')
  before=tree(source,target)
  if tree(source)!=before:raise ValueError('Source changed during snapshot')
  print(json.dumps({'baseRevision':None,'sourceDirty':False,'snapshotHash':before}));return
 if action!='worktree'or not info['git']:raise ValueError('Git source required')
 if not os.path.exists('/git-common/HEAD'):
  if not os.path.isdir('/source/.git'):raise ValueError('Initial import requires Local Git repository')
  git('clone','--bare','--no-local','--no-hardlinks','--template=','/tmp/source-view','/git-common')
 clean_common()
 # Explicit creation refreshes committed objects through the same sanitized read-only view.
 git('--git-dir=/git-common','fetch','--no-tags','--no-write-fetch-head','/tmp/source-view',info['head'])
 revision=request.get('revision')or info['head']
 if len(revision)not in[40,64]or any(c not in '0123456789abcdef'for c in revision):raise ValueError('Exact commit required')
 commit=git('--git-dir=/git-common','rev-parse','--verify',revision+'^{commit}')
 git('--git-dir=/git-common','worktree','add','--detach','--lock','--reason','Harbor registered workspace','--',target,commit)
 if inspect(source)!=info:raise ValueError('Source changed during import')
 print(json.dumps({'baseRevision':commit,'sourceDirty':info['dirty']}))
try:main()
except Exception as error:
 reason=str(error);allowed=['Git operation unavailable','Git output limit','Source identity changed','Source changed during snapshot','Source changed during import','Snapshot byte limit','Snapshot entry limit','Snapshot depth limit','Unsupported snapshot entry','External metadata entry','Alternate object stores unsupported','External Git directory unsupported','Unsafe Git directory','Copy is for non Git sources','Git source required','Submodules unsupported','Exact commit required','Initial import requires Local Git repository']
 print(json.dumps({'error':reason if reason in allowed else 'Managed workspace operation unavailable'}));sys.exit(2)
