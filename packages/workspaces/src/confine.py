"""Trusted directory-relative project admission; accepts only administrator root + relative path."""
import json, os, stat, sys
root, relative, create = sys.argv[1:]
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
handles = []
try:
    fd = os.open(root, flags)
    handles.append(fd)
    for part in relative.split('/'):
        if part in ('', '.', '..') or '\\' in part or '\x00' in part:
            raise ValueError('invalid segment')
        if create == 'true':
            try:
                os.mkdir(part, mode=0o700, dir_fd=fd)
            except FileExistsError:
                pass
        fd = os.open(part, flags, dir_fd=fd)
        handles.append(fd)
    # Detect renames during traversal. The launcher must independently confine mounts.
    path = os.path.realpath(os.path.join(root, relative))
    final = os.stat(path, follow_symlinks=False)
    held = os.fstat(fd)
    if (final.st_dev, final.st_ino) != (held.st_dev, held.st_ino):
        raise ValueError('directory changed during admission')
    if not path.startswith(os.path.realpath(root) + os.sep):
        raise ValueError('outside root')
    print(json.dumps({'path': path}))
except (OSError, ValueError):
    print('Project path is inaccessible or unsafe', file=sys.stderr)
    sys.exit(1)
finally:
    for fd in reversed(handles):
        os.close(fd)
