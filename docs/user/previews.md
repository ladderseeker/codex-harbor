# Private project previews

The P011 preview interface is available in its development branch; complete acceptance and independent review remain in progress. See the [delivery report](../reports/2026-09-08-p011-development.md) for tested sources and remaining gates.

Select a registered workspace, then open **Project previews**. Save a name, an existing package script, an application port, and a permission profile. The application must already have its dependencies and listen on the supplied `PORT` on loopback. Harbor runs the package script inside a dedicated confined runner; it does not install dependencies or accept a host command or upstream URL.

Choose **Read only** when the application can run without writing its checkout. A read-only preview permits ordinary edits while reserving its checkout against metadata operations. **Workspace write** reserves exclusive write access; other writers wait until the preview is retired. Missing scripts, unavailable dependencies, and writes under a read-only profile appear as failures. Change the settings deliberately before starting again.

Start the preview and wait for readiness. **Prepare private access**, then **Open preview in new tab**, opens the application on its own HTTPS origin. Access belongs to your current signed-in browser and expires; preparing access again renews it explicitly. Sharing the address does not share access. Project JavaScript receives no Harbor account or API-token authority. HTTP pages, SSE and WebSocket traffic are supported within the documented limits; embedding and public sharing are excluded.

The panel shows readiness, launch settings, process logs and cleanup status. Logs are plain text with a bounded retained tail; a loss indicator means output may be incomplete. Closing the application tab does not stop its process. Use **Stop preview** to retire the whole runner and relay, including background processes. A preview also stops when its execution lifetime expires.

If retirement is uncertain, Harbor retains the reservation. Review the warning and explicitly acknowledge the unresolved attempt before retrying retirement. It does not automatically replay the package script. Restarting the supervisor invalidates old access and requires a deliberate new start after retirement. Emergency stop and deployment drain also revoke access and retire execution.

An administrator must enable the separate preview hostname and TLS profile. If it is unavailable, contact the installation administrator; changing the application port cannot expose an arbitrary VPS service. The [developer guide](../developer/previews.md) explains configuration and verification. Exact protocol, capacity and authority contracts remain in [P011](../../design/proposals/011-private-project-previews.md) and [D007](../../design/decisions/007-confined-project-preview-origins.md).
