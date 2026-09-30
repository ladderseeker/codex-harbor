# Managed deploy helper can return truncated output at its capture limit

- Severity: Low. The helper belongs to the managed deploy tooling, which no installed instance uses. Its only known consequence is a failing regression test, plus the risk described under Impact.
- Owner: Awaiting owner selection in this inbox.
- Status: Open. Observed on 30 September 2026 in a cloud Linux container. Earlier passing runs of the same test on other hosts are not identified here.
- Recorded: 30 September 2026.
- Related: [P035's baseline checks](../design/proposals/035-bounded-disk-use.md#baseline-checks), which list this test as an unrelated baseline failure.

## Problem

`run()` in [common.py](../infra/deploy/common.py) captures a child's standard output in a temporary file. The child runs with `RLIMIT_FSIZE` set to `capture_limit`, and `run()` raises "Administrator result limit" only when the captured size is greater than `capture_limit`.

On Linux, a write that crosses `RLIMIT_FSIZE` is shortened to the limit. The next write fails with `EFBIG` and raises `SIGXFSZ`. A child that ignores `SIGXFSZ` and still exits 0 therefore leaves exactly `capture_limit` bytes. `run()` then returns that truncated output as a complete result. Python ignores `SIGXFSZ` by default, so a Python child whose output is one write, through `sys.stdout` or a single `os.write`, exits 0 in this case.

`review_test.Review.test_actual_process_capture_limit_timeout_and_failure` in [review_test.py](../tests/deployment/review_test.py) expects a `RuntimeError` for exactly such a child, and it fails with "RuntimeError not raised".

## Evidence

Observed on 30 September 2026 in a cloud container: Ubuntu 24.04.4, Linux 6.18.44, root, with `/tmp` on an ext-family filesystem. Each child wrote 100,000 bytes to a temporary file under a 32-byte `RLIMIT_FSIZE`.

| Child | Exit | Bytes left |
| --- | --- | --- |
| `python3 -c 'import sys;sys.stdout.write("x"*100000)'` with Python 3.10.20, 3.11.15 and 3.12.3 | 0, with empty standard error | 32 |
| One `os.write(1, b"x"*100000)`, with Python 3.11.15 and 3.12.3 | 0, with empty standard error | 32 |
| The same followed by a second `os.write` | 1, with a traceback | 32 |
| `sh -c 'head -c 100000 /dev/zero'` | 153, "File size limit exceeded" | 32 |

`python3 -m unittest tests.deployment.review_test` fails this one test with Python 3.11.15 and 3.12.3. The other five tests in the file pass.

## Impact

A managed deploy command whose output reaches the capture limit, from a child that exits 0, would be read as complete. Most callers parse JSON, so truncation would probably surface as a parse error rather than as wrong data, but that was not checked for each caller in `backup.py`, `control.py`, `destination.py`, `package.py`, `preflight.py`, `restore.py` and `services.py`.

## Recheck

Run `python3 -m unittest tests.deployment.review_test`. A fix would treat a result that reaches `capture_limit` as over the limit, or detect truncation another way. It then needs the managed tooling's usual validation and both reviews.
