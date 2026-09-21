"""Fixed personal attachment publisher. Paths derive only from dedicated native home."""
import base64, hashlib, json, os, re, stat, sys
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
LIMIT = 10485760

def directory(parent, name, create=False, private=False, traverse=False):
    if create:
        try: os.mkdir(name, 0o700, dir_fd=parent); os.fsync(parent)
        except FileExistsError: pass
    # Linux O_PATH needs search permission, not directory-list permission. The
    # installed root-owned 0711 container deliberately grants only search access.
    access = getattr(os, 'O_PATH', os.O_RDONLY) if traverse else os.O_RDONLY
    fd = os.open(name, access | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    s = os.fstat(fd)
    if s.st_uid not in (0, os.getuid()) or (s.st_mode & 0o022 and not (s.st_uid == 0 and s.st_mode & stat.S_ISVTX)) or (private and (s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700)):
        os.close(fd); raise ValueError('unsafe directory ownership')
    return fd

def publish(request):
    home = request['home']; session = request['sessionId']; workspace = request['workspace']
    if not UUID.fullmatch(session) or not os.path.isabs(home) or os.path.normpath(home) != home or os.path.realpath(home) != home:
        raise ValueError('invalid dedicated home')
    parent = os.path.dirname(home)
    target = os.path.join(parent, 'home', 'attachments', session)
    if os.path.commonpath([workspace, target]) in (workspace, target) or os.path.commonpath([home, target]) == home: raise ValueError('attachment workspace overlap')
    files = request['files']
    if not isinstance(files, list) or len(files) > 4 or len({x['id'] for x in files}) != len(files): raise ValueError('attachment count')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parent.split('/')[1:]:
            child = directory(fd, part, traverse=True); os.close(fd); fd = child
        parent_info = os.fstat(fd)
        private_state = parent_info.st_uid == os.getuid() and stat.S_IMODE(parent_info.st_mode) == 0o700
        root_container = parent_info.st_uid == 0 and not parent_info.st_mode & 0o022
        if not private_state and not root_container: raise ValueError('trusted state required')
        native = directory(fd, os.path.basename(home), private=True); os.close(native)
        if private_state:
            # mkdir/fsync require a readable descriptor; never reopen the installed
            # root container for listing or try to create its service-owned home.
            child = directory(fd, '.', private=True); os.close(fd); fd = child
        for part in ['home', 'attachments', session]:
            # A recorded directory must never be silently recreated after removal.
            create = not bool(request.get('directory')) and (part != 'home' or private_state)
            child = directory(fd, part, create=create, private=True)
            os.close(fd); fd = child
        info = os.fstat(fd); expected = request.get('directory')
        if expected and (expected['canonical'] != target or expected['device'] != str(info.st_dev) or expected['inode'] != str(info.st_ino)): raise ValueError('directory identity mismatch')
        if len(os.listdir(fd)) > 64: raise ValueError('directory count')
        results = []; total = 0
        for item in files:
            name = item['id']; encoded = item['content']
            if not UUID.fullmatch(name) or len(encoded) > ((LIMIT + 2) // 3) * 4: raise ValueError('file limit')
            data = base64.b64decode(encoded, validate=True); total += len(data)
            if not data or len(data) > LIMIT or total > 2 * LIMIT or hashlib.sha256(data).hexdigest() != item['digest']: raise ValueError('file content')
            try: f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            except FileNotFoundError:
                if item.get('device') or item.get('inode'): raise ValueError('bound file missing')
                temporary = name + '.pending'
                try: os.unlink(temporary, dir_fd=fd)
                except FileNotFoundError: pass
                f = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o444, dir_fd=fd)
                try:
                    view = memoryview(data)
                    while view: view = view[os.write(f, view):]
                    # Creation mode is filtered by the installed service's 0077
                    # umask. Set only this new, unpublished descriptor explicitly.
                    os.fchmod(f, 0o444)
                    os.fsync(f)
                finally: os.close(f)
                os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
                os.unlink(temporary, dir_fd=fd); os.fsync(fd)
                f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                s = os.fstat(f)
                if s.st_nlink == 2 and not item.get('inode'):
                    residue = os.stat(name + '.pending', dir_fd=fd, follow_symlinks=False)
                    if residue.st_dev != s.st_dev or residue.st_ino != s.st_ino: raise ValueError('publication residue')
                    os.unlink(name + '.pending', dir_fd=fd); os.fsync(fd); s = os.fstat(f)
                if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o444 or s.st_nlink != 1 or s.st_size != len(data): raise ValueError('file ownership')
                if item.get('device') and (item['device'] != str(s.st_dev) or item['inode'] != str(s.st_ino)): raise ValueError('file identity')
                if os.read(f, LIMIT + 1) != data: raise ValueError('file digest')
                results.append({'id': name, 'device': str(s.st_dev), 'inode': str(s.st_ino)})
            finally: os.close(f)
        return {'directory': {'canonical': target, 'device': str(info.st_dev), 'inode': str(info.st_ino)}, 'files': results}
    finally: os.close(fd)

if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(29 * 1024 * 1024 + 1)
        if len(raw) > 29 * 1024 * 1024: raise ValueError('request limit')
        print(json.dumps(publish(json.loads(raw))))
    except Exception:
        print('Attachment publication or identity verification failed', file=sys.stderr)
        sys.exit(1)
