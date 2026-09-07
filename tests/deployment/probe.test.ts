import test from "node:test";
import assert from "node:assert/strict";
import { inspectionMount } from "../../infra/deploy/probe-mount.ts";
test("removed-checkout inspection preserves historical binding and selects only registered Local read-only inputs", () => {
  const history = Object.freeze({
    workspace_state: "removed",
    workspace_id: "removed",
    canonical_path: "/missing",
    common_path: "/old-common",
    local_workspace_id: "local",
    local_path: "/restored/workspace",
    local_device: "12",
    local_inode: "34",
    local_state: "ready",
  });
  assert.deepEqual(inspectionMount(history), {
    workspaceId: "local",
    workspacePath: "/restored/workspace",
    workspaceDevice: "12",
    workspaceInode: "34",
  });
  assert.equal(history.workspace_id, "removed");
  assert.throws(
    () => inspectionMount({ ...history, local_inode: null }),
    /unavailable/,
  );
  assert.throws(
    () => inspectionMount({ ...history, local_state: "removed" }),
    /unavailable/,
  );
});
