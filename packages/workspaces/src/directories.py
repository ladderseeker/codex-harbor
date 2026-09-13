"""Read-only, bounded directory listing beneath an administrator-configured root."""
import json
import os
import stat
import sys

root, relative = sys.argv[1:]
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
handles = []

def identity(fd):
    value = os.fstat(fd)
    return value.st_dev, value.st_ino

def verify_chain():
    current = os.stat(root, follow_symlinks=False)
    if (current.st_dev, current.st_ino) != identity(handles[0]):
        raise ValueError('root changed')
    for parent, child in zip(handles, handles[1:]):
        check = os.open('..', flags, dir_fd=child)
        try:
            if identity(check) != identity(parent):
                raise ValueError('directory moved')
        finally:
            os.close(check)

try:
    if len(relative) > 2048 or '\\' in relative or '\x00' in relative:
        raise ValueError('invalid path')
    parts = relative.split('/') if relative else []
    if any(part in ('', '.', '..') for part in parts):
        raise ValueError('invalid segment')
    handles.append(os.open(root, flags))
    for part in parts:
        handles.append(os.open(part, flags, dir_fd=handles[-1]))
    verify_chain()
    directories = []
    truncated = False
    size = 0
    with os.scandir(handles[-1]) as entries:
        for index, entry in enumerate(entries):
            if index >= 2000:
                truncated = True
                break
            # Skip names that cannot round-trip through the API path contract.
            name = entry.name
            if '\\' in name or any(0xD800 <= ord(c) <= 0xDFFF for c in name):
                continue
            try:
                directory = stat.S_ISDIR(entry.stat(follow_symlinks=False).st_mode)
            except FileNotFoundError:
                continue
            if not directory:
                continue
            item_path = '/'.join(parts + [name])
            if len(item_path) > 2048:
                truncated = True
                continue
            item = {'name': name, 'path': item_path}
            item_size = len(json.dumps(item).encode('utf-8'))
            if len(directories) >= 200 or size + item_size > 196608:
                truncated = True
                break
            directories.append(item)
            size += item_size
    verify_chain()
    directories.sort(key=lambda item: item['name'])
    print(json.dumps({'path': relative, 'directories': directories, 'truncated': truncated}))
except (OSError, ValueError):
    print('Project folder is inaccessible or unsafe', file=sys.stderr)
    sys.exit(1)
finally:
    for fd in reversed(handles):
        os.close(fd)
