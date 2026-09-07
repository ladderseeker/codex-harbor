"""Trusted fixed workspace directory operations, extending quota.py admission."""
import os,sys,json,stat,uuid,fcntl,shutil,ctypes
# quota.py has an explicit main guard; import its trusted primitives without
# executing the stdin dispatcher or truncating Python source at a text marker.
from quota import trusted,verify,attributes
def identity(path):
 info=os.stat(path,follow_symlinks=False)
 return {'canonical':path,'device':str(info.st_dev),'inode':str(info.st_ino)}
def main():
 if sys.platform!='linux'or os.getuid()!=0:raise ValueError()
 request=json.loads(sys.stdin.read(8193));profile=json.loads(os.environ['HARBOR_XFS_PROFILE']);root=next(r for r in profile['roots']if r['id']==request['rootId'])
 trusted(root['path']);trusted(root['pool']);state=os.environ['HARBOR_LAUNCHER_STATE_DIR'];trusted(state)
 name=request['relativePath'].split('/')[0]
 if not name or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'for c in name):raise ValueError()
 workspace=str(uuid.UUID(request['workspaceId']));project=os.path.join(root['path'],name)
 with open(os.path.join(state,'storage.lock'),'a')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  if any(os.stat(state).st_dev==os.stat(r['path']).st_dev for r in profile['roots']):raise ValueError()
  identities=set()
  for configured in profile['roots']:
   for folder in [configured['path'],configured['pool']]:
    trusted(folder)
    for entry in os.listdir(folder):
     candidate=os.path.join(folder,entry);trusted(candidate);_,pid=attributes(candidate);key=(os.stat(candidate).st_dev,pid)
     if not pid or key in identities:raise ValueError()
     identities.add(key)
  verify(project,profile,request['action']=='prepare')
  if request['action']=='sync':
   fd=os.open(project,os.O_DIRECTORY|os.O_NOFOLLOW)
   try:
    expected=request.get('identity')or request.get('source')
    if expected and str(os.fstat(fd).st_dev)!=expected['device']:raise ValueError()
    libc=ctypes.CDLL(None,use_errno=True);libc.syncfs.argtypes=[ctypes.c_int];libc.syncfs.restype=ctypes.c_int
    if libc.syncfs(fd)!=0:raise OSError(ctypes.get_errno(),'Project durability barrier failed')
   finally:os.close(fd)
   print(json.dumps({'synced':True}));return
  parent=os.path.join(project,'workspaces');common=os.path.join(project,'git-common')
  expected=request.get('source')or request.get('identity')
  if expected:
   relative=expected.get('relativePath',request['relativePath']);candidate=os.path.join(root['path'],relative)
   parts=relative.split('/')
   if parts[0]!=name or not (parts==[name,'workspace'] or len(parts)==4 and parts[1]=='workspaces' and parts[3]=='checkout' and str(uuid.UUID(parts[2]))==parts[2]):raise ValueError()
   candidate_parent=os.path.dirname(candidate)
   if request['action']=='abandon'and not os.path.lexists(candidate_parent):trusted(os.path.dirname(candidate_parent))
   else:trusted(candidate_parent)
   if request['action']=='abandon'and not os.path.lexists(candidate):actual=expected
   else:actual=identity(candidate)
   if os.path.lexists(candidate)and(os.path.realpath(candidate)!=candidate or not stat.S_ISDIR(os.lstat(candidate).st_mode)or os.stat(candidate).st_uid!=10001):raise ValueError()
   if any(actual[k]!=expected[k]for k in ['device','inode']):raise ValueError()
   if expected.get('canonical')and actual['canonical']!=expected['canonical']:raise ValueError()
  # Checkout source and selected identity are separate fields. Validate every
  # supplied common identity even when source takes precedence for the checkout.
  common_identities=[value['common']for value in [request.get('source'),request.get('identity')]if value and value.get('common')]
  for expected_common in common_identities:
   current=identity(common);info=os.lstat(common)
   if os.path.realpath(common)!=common or not stat.S_ISDIR(info.st_mode)or info.st_uid!=10001:raise ValueError()
   if any(current[k]!=expected_common[k]for k in ['canonical','device','inode']):raise ValueError()
  if request['action']=='fingerprint':
   # Reuse only the trusted bounded dirfd snapshot routine; no host Git command.
   helper_namespace={};helper_file=os.path.join(os.path.dirname(__file__),'..','git','helper.py')
   helper_source=open(helper_file).read().split('try:main()')[0];exec(compile(helper_source,'helper.py','exec'),helper_namespace)
   target=request['identity'];current=identity(candidate)
   if any(current[k]!=target[k]for k in ['canonical','device','inode']):raise ValueError()
   if target.get('common'):
    common_identity=identity(common)
    if any(common_identity[k]!=target['common'][k]for k in ['canonical','device','inode']):raise ValueError()
   print(json.dumps({'checkout':helper_namespace['tree'](candidate),'common':helper_namespace['tree'](common)if target.get('common')else None}));return
  if request['action']=='validate':print(json.dumps({'valid':True}));return

  if request['action']=='prepare':
   try:os.mkdir(parent,0o700)
   except FileExistsError:pass
   trusted(parent)
   target=os.path.join(parent,workspace)
   if not os.path.exists(target)and len(os.listdir(parent))>=16:raise ValueError()
   try:os.mkdir(target,0o700)
   except FileExistsError:trusted(target)
   checkout=os.path.join(target,'checkout')
   try:os.mkdir(checkout,0o700);os.chown(checkout,10001,10001)
   except FileExistsError:
    if os.path.islink(checkout)or os.stat(checkout).st_uid!=10001 or os.listdir(checkout):raise ValueError()

   if request['kind']=='worktree':
    try:os.mkdir(common,0o700);os.chown(common,10001,10001)
    except FileExistsError:pass
    if os.path.islink(common)or os.stat(common).st_uid!=10001:raise ValueError()
   value=identity(checkout)
   if request['kind']=='worktree':value['common']=identity(common)
   print(json.dumps(value));return
  target=os.path.join(parent,workspace)
  if os.path.exists(target):trusted(target)
  elif request['action']!='abandon':raise ValueError()
  checkout=os.path.join(target,'checkout');expected=request['identity']
  value=identity(checkout)if os.path.lexists(checkout)else expected if request['action']=='abandon'else identity(checkout)
  if any(value[k]!=expected[k]for k in ['canonical','device','inode']):raise ValueError()
  if request['action']in['remove','abandon']:
   # Only the exact registered UUID directory; no Git back-reference supplies authority.
   if expected.get('common'):
    current=identity(common)
    if any(current[k]!=expected['common'][k]for k in ['canonical','device','inode']):raise ValueError()
    commonfd=os.open(common,os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
     try:worktreesfd=os.open('worktrees',os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=commonfd)
     except FileNotFoundError:worktreesfd=None
     if worktreesfd is not None:
      try:
       try:shutil.rmtree(workspace,dir_fd=worktreesfd)
       except FileNotFoundError:pass
      finally:os.close(worktreesfd)
    finally:os.close(commonfd)
   if os.path.lexists(checkout):shutil.rmtree(checkout)
   if os.path.exists(target):os.rmdir(target)
   print(json.dumps({'removed':True}));return
  raise ValueError()
try:main()
except Exception:print(json.dumps({'error':'Managed workspace storage unavailable'}));sys.exit(2)
