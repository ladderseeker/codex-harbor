import unittest, tempfile, os, sys, json, hashlib
from unittest.mock import patch
from pathlib import Path

sys.path.insert(
    0, os.path.realpath(os.path.join(os.path.dirname(__file__), "../../infra/deploy"))
)
from extract import extract


class Extraction(unittest.TestCase):
    def case(self, extra=None, corrupt=False, project_registry=False, wrong_link=False):
        source = "/source/project"
        content = b"\x00\xffbinary"
        file = {
            "type": "file",
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
            "mode": 0o4755,
        }
        registry = {
            "format": 1,
            "backupSchema": 1,
            "units": [
                {
                    "path": source,
                    "inventory": {
                        "files": {
                            ".": {"type": "directory"},
                            "file": file,
                            "link": {"type": "symlink", "target": "/etc/shadow"},
                        }
                    },
                }
            ],
            "dump": {
                "path": "/checkpoint/database.dump",
                "size": 0,
                "sha256": hashlib.sha256(b"").hexdigest(),
            },
        }
        if project_registry:
            registry["units"][0]["inventory"]["files"]["registry.json"] = file
        raw = json.dumps(registry).encode()
        identity = hashlib.sha256(raw).hexdigest()
        snapshot = "a" * 64
        listing = [
            {
                "struct_type": "snapshot",
                "id": snapshot,
                "paths": [
                    source,
                    "/checkpoint/database.dump",
                    "/checkpoint/registry.json",
                ],
            }
        ] + [
            {
                "struct_type": "node",
                "path": p,
                "type": t,
                **({"size": size} if t == "file" else {}),
            }
            for p, t, size in [
                ("/source", "dir", 0),
                (source, "dir", 0),
                (source + "/file", "file", len(content)),
                (source + "/link", "symlink", 0),
                ("/checkpoint", "dir", 0),
                ("/checkpoint/database.dump", "file", 0),
                ("/checkpoint/registry.json", "file", len(raw)),
            ]
        ]
        if project_registry:
            listing.append(
                {
                    "struct_type": "node",
                    "path": source + "/registry.json",
                    "type": "file",
                    "size": len(content),
                }
            )
        if extra:
            listing.append(extra)

        def restic(c, r, args, **kw):
            if args[:2] == ["cat", "tree"]:
                assert args[2] == snapshot + ":" + source
                return json.dumps(
                    {
                        "nodes": [
                            {
                                "name": "link",
                                "type": "symlink",
                                "linktarget": (
                                    "/changed" if wrong_link else "/etc/shadow"
                                ),
                            }
                        ]
                    }
                )
            if args[0] == "ls":
                return "\n".join(json.dumps(x) for x in listing)
            data = (
                raw
                if args[-1] == "/checkpoint/registry.json"
                else (
                    (b"changed" if corrupt else content)
                    if args[-1].endswith("/file")
                    or args[-1] == source + "/registry.json"
                    else b""
                )
            )
            if "output" in kw:
                kw["output"].write(data)
                return ""
            return data.decode()

        return restic, snapshot, identity

    def test_binary_and_external_symlink_remain_in_staging(self):
        mock, snapshot, identity = self.case()
        with tempfile.TemporaryDirectory() as d, patch("extract.restic", mock):
            extract({}, "", snapshot, identity, d)
            self.assertEqual(
                Path(d + "/source/project/file").read_bytes(), b"\x00\xffbinary"
            )
            self.assertEqual(os.readlink(d + "/source/project/link"), "/etc/shadow")
            self.assertEqual(
                os.stat(d + "/source/project/file").st_mode & 0o7777, 0o600
            )

    def test_unregistered_special_inode_refused_before_write(self):
        mock, snapshot, identity = self.case(
            {"struct_type": "node", "path": "/device", "type": "dev"}
        )
        with tempfile.TemporaryDirectory() as d, patch("extract.restic", mock):
            with self.assertRaises(ValueError):
                extract({}, "", snapshot, identity, d)
            self.assertEqual(os.listdir(d), [])

    def test_traversal_refused_before_write(self):
        mock, snapshot, identity = self.case(
            {"struct_type": "node", "path": "/source/../escape", "type": "dir"}
        )
        with tempfile.TemporaryDirectory() as d, patch("extract.restic", mock):
            with self.assertRaises(ValueError):
                extract({}, "", snapshot, identity, d)
            self.assertEqual(os.listdir(d), [])

    def test_snapshot_inventory_verification_and_mutated_source_rejection(self):
        mock, snapshot, identity = self.case()
        with patch("extract.restic", mock):
            result = extract({}, "", snapshot, identity, None, verify_only=True)
            self.assertEqual(result["format"], 1)
        mock, snapshot, identity = self.case(corrupt=True)
        with patch("extract.restic", mock):
            with self.assertRaisesRegex(ValueError, "content"):
                extract({}, "", snapshot, identity, None, verify_only=True)

    def test_project_registry_filename_is_ordinary_content(self):
        mock, snapshot, identity = self.case(project_registry=True)
        with tempfile.TemporaryDirectory() as d, patch("extract.restic", mock):
            extract({}, "", snapshot, identity, None, verify_only=True)
            extract({}, "", snapshot, identity, d)
            self.assertEqual(
                Path(d + "/source/project/registry.json").read_bytes(),
                b"\x00\xffbinary",
            )

    def test_authenticated_tree_target_mismatch_never_completes(self):
        mock, snapshot, identity = self.case(wrong_link=True)
        with tempfile.TemporaryDirectory() as d, patch("extract.restic", mock):
            for verify in [True, False]:
                with self.assertRaisesRegex(ValueError, "symlink mismatch"):
                    extract({}, "", snapshot, identity, d, verify_only=verify)
                self.assertEqual(os.listdir(d), [])

    def test_file_corruption_never_completes(self):
        mock, snapshot, identity = self.case(corrupt=True)
        with tempfile.TemporaryDirectory() as d, patch("extract.restic", mock):
            with self.assertRaises(ValueError):
                extract({}, "", snapshot, identity, d)


if __name__ == "__main__":
    unittest.main()
