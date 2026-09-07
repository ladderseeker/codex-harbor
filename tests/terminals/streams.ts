import {
  expect,
  request,
  type BrowserContext,
  type APIResponse,
} from "@playwright/test";
import type { Pool } from "pg";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
export async function terminalStreamChecks(h: {
  context: BrowserContext;
  db: Pool;
  origin: string;
  directOrigin: string;
  csrf: string;
  t: any;
  command: (route: string, data: unknown, key?: string) => Promise<APIResponse>;
}) {
  const { context, db, origin, csrf, t, command } = h;
  const made = await command(`/workspaces/${t.workspace_id}/terminals`, {
    permissionProfile: "workspace-write",
    cols: 80,
    rows: 24,
  });
  expect(made.status(), await made.text()).toBe(202);
  const term = (await made.json()).terminal;
  const base = `/api/v1/terminals/${term.id}`;
  await expect
    .poll(
      async () =>
        (await db.query("SELECT state FROM terminals WHERE id=$1", [term.id]))
          .rows[0].state,
      { timeout: 20000 },
    )
    .toBe("running");
  const token = async (profile: string) => {
    const r = await command("/security/api-tokens", {
      name: "Terminal stream boundary",
      scopes: ["terminal:read", "terminal:control"],
      projectIds: [t.project_id],
      permissionProfile: profile,
      expiresInDays: 1,
    });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const low = await token("read-only"),
    granted = await token("workspace-write");
  const machine = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: "Bearer " + low.secret },
  });
  const sockets: WebSocket[] = [];
  const url = origin.replace("https:", "wss:") + base + "/stream";
  const denied = async (headers: Record<string, string>) => {
    const s = new WebSocket(url, { rejectUnauthorized: false, headers });
    sockets.push(s);
    let opened = false;
    s.on("open", () => (opened = true));
    s.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Upgrade denial deadline")),
        5000,
      );
      s.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(opened).toBe(false);
  };
  const connect = async (cursor = 0) => {
    const messages: any[] = [];
    const s = new WebSocket(url, {
      rejectUnauthorized: false,
      headers: { Authorization: "Bearer " + granted.secret },
    });
    sockets.push(s);
    s.on("error", () => {});
    s.on("message", (b) => messages.push(JSON.parse(b.toString())));
    await new Promise<void>((resolve, reject) => {
      s.once("open", resolve);
      s.once("error", reject);
    });
    s.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        generation: term.generation,
        cursor,
      }),
    );
    await expect
      .poll(() => messages.some((m) => m.type === "state"))
      .toBe(true);
    return { s, messages };
  };
  try {
    const deniedControl = await machine.post(origin + base + "/control", {
      headers: { "Idempotency-Key": `${Date.now()}:${randomUUID()}` },
      data: {
        generation: term.generation,
        expectedEpoch: 0,
        acknowledgeUncertainInput: false,
      },
    });
    expect(deniedControl.status()).toBe(403);
    const altered = await token("workspace-write");
    // Valid issuer/verifier; its independent project grant excludes this resource.
    await db.query("UPDATE api_tokens SET project_ids=$2 WHERE id=$1", [
      altered.token.id,
      [randomUUID()],
    ]);
    await denied({ Authorization: "Bearer " + altered.secret });
    await denied({
      Authorization: "Bearer " + granted.secret,
      Origin: "https://hostile.invalid",
    });
    const cookie = (await context.cookies(origin))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    await denied({ Cookie: cookie, Origin: "https://hostile.invalid" });
    const viewers = [];
    for (let i = 0; i < 4; i++) viewers.push(await connect());
    await denied({ Authorization: "Bearer " + granted.secret });
    for (const v of viewers) v.s.terminate();
    await new Promise((r) => setTimeout(r, 300));
    const acquired = await command(`/terminals/${term.id}/control`, {
      generation: term.generation,
      expectedEpoch: 0,
      acknowledgeUncertainInput: false,
    });
    const c = (await acquired.json()).control;
    let sequence = 0;
    const input = async (text: string) => {
      const r = await context.request.post(origin + base + "/input", {
        headers: { Origin: origin, "X-CSRF-Token": csrf },
        data: {
          version: 1,
          generation: term.generation,
          epoch: c.epoch,
          controllerId: c.controllerId,
          sequence: ++sequence,
          data: Buffer.from(text).toString("base64"),
        },
      });
      expect(r.status(), await r.text()).toBe(200);
    };
    const snapshot = await (
      await context.request.get(origin + base + "/output?cursor=0")
    ).json();
    // Commit actual shell output strictly between HTTP snapshot and WS subscribe.
    await input("printf 'BETWEEN_%s\\n' SNAPSHOT\n");
    await expect
      .poll(async () =>
        (
          await db.query(
            "SELECT bytes FROM terminal_output WHERE terminal_id=$1 ORDER BY sequence",
            [term.id],
          )
        ).rows
          .map((r) => r.bytes.toString())
          .join(""),
      )
      .toContain("BETWEEN_SNAPSHOT");
    const fast = await connect(snapshot.cursor);
    let fastClose: unknown = null;
    fast.s.on("close", (code, reason) => {
      fastClose = { code, reason: reason.toString() };
    });
    const watch = setInterval(() => {
      if (fast.s.readyState === WebSocket.OPEN)
        fast.s.send(
          JSON.stringify({
            type: "watch",
            version: 1,
            generation: term.generation,
          }),
        );
    }, 6000);
    fast.s.once("close", () => clearInterval(watch));
    const output = () =>
      fast.messages.filter((m) => m.type === "output").flatMap((m) => m.chunks);
    await expect
      .poll(() =>
        output()
          .map((c) => Buffer.from(c.data, "base64").toString())
          .join(""),
      )
      .toContain("BETWEEN_SNAPSHOT");
    // Split UTF-8 and ANSI escape sequences cross independent output captures.
    await input(
      "node -e 'process.stdout.write(Buffer.from([27,91]));setTimeout(()=>process.stdout.write(Buffer.from([51,50,109,226])),100);setTimeout(()=>process.stdout.write(Buffer.from([130,172,27,91,48,109,10])),200)'\n",
    );
    await expect
      .poll(() =>
        Buffer.concat(
          output().map((c) => Buffer.from(c.data, "base64")),
        ).toString(),
      )
      .toContain("\u001b[32m€\u001b[0m");
    expect(new Set(output().map((c) => c.sequence)).size).toBe(output().length);
    // A real WebSocket peer uses the private API loopback directly to exclude
    // reverse-proxy buffering. It advertises a tiny receive window, then stops
    // reading. No Harbor send/poll method is mocked or slowed down.
    const slow = spawn(
      "python3",
      [
        "-c",
        String.raw`
import socket,ssl,os,json,struct,time,urllib.parse,base64
u=urllib.parse.urlparse(os.environ['STREAM_URL']);s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024);s.settimeout(12);s.connect((u.hostname,u.port));
if u.scheme=='wss': s=ssl._create_unverified_context().wrap_socket(s,server_hostname=u.hostname)
s.sendall(('GET '+u.path+' HTTP/1.1\r\nHost: '+u.netloc+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+base64.b64encode(os.urandom(16)).decode()+'\r\nAuthorization: Bearer '+os.environ['STREAM_TOKEN']+'\r\n\r\n').encode())
h=b''
while not h.endswith(b'\r\n\r\n'): h+=s.recv(1)
assert b'101 Switching Protocols' in h
b=json.dumps({'type':'hello','version':1,'generation':int(os.environ['STREAM_GENERATION']),'cursor':int(os.environ['STREAM_CURSOR'])},separators=(',',':')).encode();mask=os.urandom(4);s.sendall(bytes([129,128|len(b)])+mask+bytes(v^mask[i%4] for i,v in enumerate(b)))
print('READY',flush=True);time.sleep(25)
try:
 while s.recv(65536): pass
 print('CLOSED',flush=True)
except (ConnectionResetError,ssl.SSLEOFError): print('CLOSED',flush=True)
`,
      ],
      {
        env: {
          ...process.env,
          STREAM_URL: h.directOrigin.replace("http:", "ws:") + base + "/stream",
          STREAM_TOKEN: granted.secret,
          STREAM_GENERATION: String(term.generation),
          STREAM_CURSOR: String(
            (
              await db.query(
                "SELECT output_sequence FROM terminals WHERE id=$1",
                [term.id],
              )
            ).rows[0].output_sequence,
          ),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let slowStatus = "",
      slowError = "";
    slow.stdout.on("data", (b) => (slowStatus += b.toString()));
    slow.stderr.on(
      "data",
      (b) => (slowError = (slowError + b.toString()).slice(-1000)),
    );
    try {
      await expect
        .poll(() => slowStatus, {
          message: "Nonreading peer direct WS handshake",
        })
        .toContain("READY");
      await input(
        "node -e 'let n=0;const t=setInterval(()=>{process.stdout.write(Buffer.alloc(32768,120));if(++n===128){clearInterval(t);process.stdout.write(\"\\nFAST_VIEWER_DONE\\n\")}},150)'\n",
      );
      // Once retention is active, block its parent row during real output. The
      // flusher must wait there before taking the terminal lock: repeated UPDATEs
      // can fire unchanged-FK checks and otherwise invert the viewer lock order.
      await expect
        .poll(
          async () =>
            Number(
              (
                await db.query(
                  "SELECT output_floor FROM terminals WHERE id=$1",
                  [term.id],
                )
              ).rows[0].output_floor,
            ),
          { timeout: 15000 },
        )
        .toBeGreaterThan(0);
      const parent = await db.connect();
      try {
        await parent.query("BEGIN");
        await parent.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
          t.project_id,
        ]);
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  "SELECT 1 FROM pg_stat_activity WHERE application_name='p006-supervisor' AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM projects%'",
                )
              ).rowCount,
            { timeout: 5000 },
          )
          .toBeGreaterThan(0);
        const probe = await db.connect();
        try {
          await probe.query("BEGIN");
          await probe.query(
            "SELECT id FROM terminals WHERE id=$1 FOR UPDATE NOWAIT",
            [term.id],
          );
        } finally {
          await probe.query("ROLLBACK");
          probe.release();
        }
      } finally {
        await parent.query("ROLLBACK");
        parent.release();
      }
      await expect
        .poll(
          () =>
            Buffer.concat(
              output().map((c) => Buffer.from(c.data, "base64")),
            ).includes(Buffer.from("FAST_VIEWER_DONE")),
          { timeout: 25000 },
        )
        .toBe(true);
      await expect
        .poll(() => slowStatus, {
          timeout: 15000,
          message: "Bounded slow-reader detachment: " + slowError,
        })
        .toContain("CLOSED");
      expect(fast.s.readyState).toBe(WebSocket.OPEN);
      expect(
        (await db.query("SELECT state FROM terminals WHERE id=$1", [term.id]))
          .rows[0].state,
      ).toBe("running");
    } catch (error) {
      const state = (
        await db.query(
          "SELECT state,failure_code,output_sequence,output_floor,output_lost FROM terminals WHERE id=$1",
          [term.id],
        )
      ).rows[0];
      throw Error(
        "Slow-reader boundary: " +
          JSON.stringify({
            state,
            fast: fast.s.readyState,
            fastClose,
            chunks: output().length,
            slowStatus,
            slowError,
            error: String(error).slice(0, 1000),
          }),
      );
    } finally {
      slow.kill("SIGKILL");
    }
  } finally {
    for (const s of sockets) s.terminate();
    await machine.dispose();
    await command(`/terminals/${term.id}/terminate`, {
      generation: term.generation,
    });
    await expect
      .poll(
        async () =>
          (
            await db.query("SELECT retired FROM terminals WHERE id=$1", [
              term.id,
            ])
          ).rows[0].retired,
        { timeout: 20000 },
      )
      .toBe(true);
  }
}
