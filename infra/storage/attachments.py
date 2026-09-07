"""Fixed immutable attachment publication, invoked only by quota.py's trusted admission."""
import os,stat,re,base64,hashlib
UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
def publish(target,request):
    session=request['sessionId']
    if not UUID.fullmatch(session):raise ValueError('invalid attachment session')
    files=request.get('files',[])
    if len(files)>4:raise ValueError('attachment count limit')
    parent=os.path.join(target,'attachments')
    for path in [parent,os.path.join(parent,session)]:
        try:os.mkdir(path,0o755)
        except FileExistsError:pass
        parentfd=os.open(os.path.dirname(path),os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(parentfd)
        finally:os.close(parentfd)
        s=os.lstat(path)
        if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:raise ValueError('attachment directory ownership')
    directory=os.path.join(parent,session)
    fd=os.open(directory,os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd);expected=request.get('directory')
        if expected and (str(info.st_dev)!=expected['device']or str(info.st_ino)!=expected['inode']or directory!=expected['canonical']):raise ValueError('attachment directory identity')
        if len(os.listdir(fd))>64:raise ValueError('attachment directory limit')
        results=[];total=0
        for item in files:
            name=item['id'];data=base64.b64decode(item['content'],validate=True);total+=len(data)
            if not UUID.fullmatch(name)or len(data)>262144 or total>524288 or hashlib.sha256(data).hexdigest()!=item['digest']:raise ValueError('attachment content identity')
            # A stable private temporary name makes crash residue bounded. Never overwrite a published inode.
            try:
                f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
            except FileNotFoundError:
                if item.get('device')or item.get('inode'):raise ValueError('attachment file missing')
                temporary=name+'.pending'
                try:os.unlink(temporary,dir_fd=fd)
                except FileNotFoundError:pass
                f=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444,dir_fd=fd)
                try:
                    view=memoryview(data)
                    while view:view=view[os.write(f,view):]
                    os.fsync(f)
                finally:os.close(f)
                os.link(temporary,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
                os.unlink(temporary,dir_fd=fd);os.fsync(fd)
                f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
            try:
                s=os.fstat(f)
                if s.st_nlink==2 and not item.get('inode'):
                    residue=os.stat(name+'.pending',dir_fd=fd,follow_symlinks=False)
                    if residue.st_ino!=s.st_ino or residue.st_dev!=s.st_dev:raise ValueError('attachment publication residue')
                    os.unlink(name+'.pending',dir_fd=fd);os.fsync(fd);s=os.fstat(f)
                if not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_mode&0o222 or s.st_nlink!=1 or s.st_size!=len(data):raise ValueError('attachment file ownership')
                if item.get('device')and(str(s.st_dev)!=item['device']or str(s.st_ino)!=item['inode']):raise ValueError('attachment file identity')
                if os.read(f,262145)!=data:raise ValueError('attachment file content')
                results.append({'id':name,'device':str(s.st_dev),'inode':str(s.st_ino)})
            finally:os.close(f)
        os.fsync(fd)
        return {'directory':{'canonical':directory,'device':str(info.st_dev),'inode':str(info.st_ino)},'files':results}
    finally:os.close(fd)
