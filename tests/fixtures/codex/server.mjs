import { spawn } from "node:child_process";
import { markdownStart, markdownEnd } from "./markdown.mjs";
const activating = new Set();
const crashOnInterrupt = new Set();
import { createInterface } from "node:readline";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  openSync,
  closeSync,
  constants,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
const stateFile = process.env.HARBOR_FIXTURE_STATE_FILE;
let saved = [];
if (stateFile && existsSync(stateFile)) {
  if (statSync(stateFile).size > 4194304) throw Error("Fixture history bound");
  saved = JSON.parse(readFileSync(stateFile, "utf8"));
}
const threads = new Map(saved);
const persist = () => {
  if (!stateFile) return;
  mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
  const data = JSON.stringify([...threads]);
  if (Buffer.byteLength(data) > 4194304) throw Error("Fixture history bound");
  const temp = stateFile + "." + process.pid + ".tmp";
  writeFileSync(temp, data, { mode: 0o600 });
  renameSync(temp, stateFile);
};
const pending = new Map();
const timers = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const event = (method, params) => send({ method, params });
let initialized = false;
let authenticated = false;
function finish(threadId, turnId, text, status = "completed", streamedItemId) {
  const turn = threads.get(threadId)?.turns.find((t) => t.id === turnId);
  if (!turn || turn.status !== "inProgress") return;
  turn.status = status;
  if (text) {
    const itemId = streamedItemId ?? randomUUID();
    if (!streamedItemId && !text.includes("[completion-only]"))
      event("item/agentMessage/delta", { threadId, turnId, itemId, delta: text.includes("[partial-final]") ? "Partial response" : text });
    turn.items.push({
      id: itemId,
      type: "agentMessage",
      text,
      phase: null,
      memoryCitation: null,
      delivery: null,
      questions: null,
    });
    event("item/completed", {
      threadId,
      turnId,
      item: turn.items.at(-1),
      startedAtMs: 0,
      completedAtMs: 0,
    });
  }
  persist();
  event("turn/completed", { threadId, turn });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  const p = m.params ?? {};
  if (!m.method) {
    const saved = pending.get(m.id);
    if (saved) {
      pending.delete(m.id);
      if (saved.childRejectionParent) {
        const parent = saved.childRejectionParent;
        const text = m.error ? "Child approval rejected safely" : "UNSAFE CHILD APPROVAL";
        const item = {id:randomUUID(),type:"agentMessage",text,phase:null,memoryCitation:null,delivery:null,questions:null};
        parent.turn.items.push(item);
        event("item/completed", {threadId:parent.threadId,turnId:parent.turn.id,item,startedAtMs:0,completedAtMs:0});
        return;
      }
      finish(
        saved.threadId,
        saved.turnId,
        m.result?.decision === "decline"
          ? "Approval declined."
          : "Approved input received.",
      );
    }
    return;
  }
  const result = (value) => send({ id: m.id, result: value });
  if (m.method === "initialized") return;
  if (m.method === "initialize") {
    initialized = true;
    const answer = () =>
      result({
        userAgent: "codex-harbor-fixture/0.153.4",
        platformFamily: "unix",
        platformOs: "linux",
      });
    return setTimeout(
      answer,
      Math.min(
        5000,
        Math.max(0, Number(process.env.HARBOR_FIXTURE_INIT_DELAY_MS) || 0),
      ),
    );
  }
  if (!initialized)
    return send({
      id: m.id,
      error: { code: -32600, message: "Not initialized" },
    });
  if (m.method === "thread/start") {
    const thread = {
      id: randomUUID(),
      sessionId: randomUUID(),
      forkedFromId: null,
      parentThreadId: null,
      preview: "",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      historyMode: "legacy",
      modelProvider: "openai",
      model: "fixture",
      reasoningEffort: "medium",
      createdAt: 0,
      updatedAt: 0,
      recencyAt: null,
      status: { type: "idle" },
      path: null,
      cwd: "/workspace",
      cliVersion: "0.153.4",
      source: { custom: "codex-harbor-fixture" },
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    };
    threads.set(thread.id, thread);
    persist();
    return result({
      thread,
      model: "fixture",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/workspace",
      instructionSources: [],
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: { type: "readOnly", networkAccess: false },
      reasoningEffort: "medium",
    });
  }
  if (m.method === "thread/read" || m.method === "thread/resume")
    return result({ thread: threads.get(p.threadId) });
  if (m.method === "model/list")
    return result({
      data: [
        {
          id: "fixture",
          model: "fixture",
          upgrade: null,
          upgradeInfo: null,
          availabilityNux: null,
          displayName: "Deterministic fixture",
          description: "Private deterministic protocol fixture",
          modelSpecialty: null,
          hidden: false,
          defaultReasoningEffort: "medium",
          inputModalities: ["text", "image"],
          supportsPersonality: false,
          multiAgentVersion: null,
          additionalSpeedTiers: [],
          serviceTiers: [],
          defaultServiceTier: null,
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Low" },
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
          ],
        },
      ].flatMap((model) => process.env.HARBOR_FIXTURE_EXTENDED_MODELS === "1" ? [model, {
        ...model, id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6 Astra", isDefault: false,
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({reasoningEffort, description: reasoningEffort})),
      }] : [model]),
      nextCursor: null,
    });
  if (m.method === "account/login/start" && p.type === "apiKey") {
    authenticated = true;
    return result({ type: "apiKey" });
  }
  if (m.method === "account/logout") {
    authenticated = false;
    return result({});
  }
  if (m.method === "account/read")
    return result({
      account: authenticated ? { type: "apiKey" } : null,
      requiresOpenaiAuth: true,
    });
  if (m.method === "turn/start") {
    if (process.env.HARBOR_FIXTURE_TRACE_FILE)
      appendFileSync(
        process.env.HARBOR_FIXTURE_TRACE_FILE,
        JSON.stringify({
          method: "turn/start",
          model: p.model,
          effort: p.effort,
          threadId: p.threadId,
          attachmentTypes: p.input.map((i) => i.type),
          attachmentPaths: p.input
            .filter((i) => i.type === "localImage")
            .map((i) => i.path),
        }) + "\n",
      );
    const text = p.input[0].text;
    const marker=text.match(/\[workspace-marker:([a-zA-Z0-9_-]{1,64})\]/);
    if(marker && process.env.HARBOR_FIXTURE_WORKSPACE){const fd=openSync(join(process.env.HARBOR_FIXTURE_WORKSPACE,'harbor-marker.txt'),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o644);try{writeFileSync(fd,marker[1])}finally{closeSync(fd)}}
    const turn = {
      id: randomUUID(),
      status: "inProgress",
      items: [],
      itemsView: "full",
      error: null,
      startedAt: 0,
      completedAt: null,
      durationMs: null,
    };
    if (text.includes("[interrupt-crash]")) crashOnInterrupt.add(turn.id);
    threads.get(p.threadId).turns.push(turn);
    persist();
    if (text.includes("[crash-before-ack]")) return process.exit(31);
    if (text.includes("[timeout]")) return;
    if (!text.includes("[child-thread]")) result({ turn });
    if (text.includes("[child-thread]")) {
      const childThread = randomUUID(), childTurn = randomUUID();
      const childItem = {id:randomUUID(),type:"agentMessage",text:"CHILD MUST NOT APPEAR",phase:null,memoryCitation:null,delivery:null,questions:null};
      // More than the parent mailbox count limit: foreign traffic is not charged.
      for (let childEvent=0;childEvent<300;childEvent++)
        event("item/agentMessage/delta", {threadId:childThread,turnId:childTurn,itemId:childItem.id,delta:childItem.text});
      event("item/completed", {threadId:childThread,turnId:childTurn,item:childItem,startedAtMs:0,completedAtMs:0});
      event("turn/completed", {threadId:childThread,turn:{id:childTurn,status:"completed",items:[childItem],itemsView:"full",error:null,startedAt:0,completedAt:0,durationMs:0}});
      const requestId=randomUUID();
      pending.set(requestId,{childRejectionParent:{threadId:p.threadId,turn}});
      send({id:requestId,method:"item/commandExecution/requestApproval",params:{threadId:childThread,turnId:childTurn,itemId:randomUUID(),kind:"command",startedAtMs:0,environmentId:null,command:"touch forbidden-child-approval",cwd:process.cwd()}});
      const parentItem={...childItem,id:randomUUID(),text:"Parent waiting after child"};
      turn.items.push(parentItem);
      event("item/completed", {threadId:p.threadId,turnId:turn.id,item:parentItem,startedAtMs:0,completedAtMs:0});
      result({ turn });
    }
    if (text.includes("[command-result]")) {
      const item = {type:"commandExecution", id:randomUUID(), pluginId:null, scriptPath:null, command:"pnpm test", cwd:process.cwd(), processId:null, source:"agent", status:"inProgress", commandActions:[], aggregatedOutput:null, exitCode:null, durationMs:null};
      event("item/started", {threadId:p.threadId,turnId:turn.id,item,startedAtMs:0});
      event("item/commandExecution/outputDelta", {threadId:p.threadId,turnId:turn.id,itemId:item.id,delta:"running tests\n"});
      item.status="completed"; item.aggregatedOutput="Tests passed\n"; item.exitCode=0; item.durationMs=1;
      turn.items.push(item);
      event("item/completed", {threadId:p.threadId,turnId:turn.id,item,startedAtMs:0,completedAtMs:1});
    }
    if (text.includes("[activation-completed]"))
      return setTimeout(
        () => finish(p.threadId, turn.id, "done", "completed"),
        50,
      );
    if (text.includes("[activation-delay]")) {
      activating.add(turn.id);
      return setTimeout(() => {
        activating.delete(turn.id);
        event("turn/started", { threadId: p.threadId, turn });
        timers.set(
          turn.id,
          setTimeout(
            () => finish(p.threadId, turn.id, "done", "completed"),
            1500,
          ),
        );
      }, 150);
    }
    if (text.includes("[background]")) {
      if(process.send) process.send({ background: true });
      else spawn("/bin/sleep",["300"],{stdio:"ignore"});
    }
    const writeMatch = /\[write-file:(p018-[a-z0-9-]+\.txt)\]/.exec(text);
    if(writeMatch) writeFileSync(join(process.env.HARBOR_FIXTURE_WORKSPACE || process.cwd(),writeMatch[1]),"P018 "+writeMatch[1]);
    if (text.includes("[input-flood]")) {
      const id = randomUUID();
      pending.set(id, { threadId: p.threadId, turnId: turn.id });
      send({
        id,
        method: "item/tool/requestUserInput",
        params: {
          threadId: p.threadId,
          turnId: turn.id,
          itemId: randomUUID(),
          isBlocking: true,
          autoResolutionMs: null,
          questions: [
            {
              id: "choice",
              header: "Choice",
              question: "Continue?",
              isOther: false,
              isSecret: false,
              options: null,
            },
          ],
        },
      });
    }
    if (text.includes("[flood]") || text.includes("[input-flood]"))
      for (let i = 0; i < 400; i++)
        event("item/agentMessage/delta", {
          threadId: p.threadId,
          turnId: turn.id,
          itemId: "flood",
          delta: "x".repeat(4096),
        });
    // The ACK regression isolates request persistence from an earlier started
    // notification. Both the RPC result and following approval are real protocol
    // messages; no Harbor persistence is mocked.
    if (!text.includes("[ack-lock]")) event("turn/started", { threadId: p.threadId, turn });
    if(text.includes("[retirement-unknown]")){process.send?.({retirementUnknown:true});return setTimeout(()=>process.exit(34),50)}
    if (text.includes("[crash]")) return setTimeout(() => process.exit(32), 50);
    if (text.includes("[approval]") || text.includes("[input]")) {
      const id = randomUUID();
      pending.set(id, { threadId: p.threadId, turnId: turn.id });
      return setTimeout(
        () =>
          send({
            id,
            method: text.includes("[input]")
              ? "item/tool/requestUserInput"
              : "item/commandExecution/requestApproval",
            params: {
              kind: "command",
              environmentId: null,
              isBlocking: true,
              autoResolutionMs: null,
              threadId: p.threadId,
              turnId: turn.id,
              itemId: randomUUID(),
              startedAtMs: 0,
              command: "printf fixture",
              ...(text.includes("[input]")
                ? {
                    questions: [
                      {
                        id: "choice",
                        header: "Choice",
                        question: "Continue?",
                        isOther: false,
                        isSecret: false,
                        options: [
                          { label: "Yes", description: "Continue fixture" },
                        ],
                      },
                    ],
                  }
                : {}),
            },
          }),
        text.includes("[ack-lock]") ? 100 : 30,
      );
    }
    if (text === "[activity-group]") {
      let index = 0;
      const command = () => {
        const item = {type:"commandExecution", id:randomUUID(), pluginId:null, scriptPath:null, command:`printf 'command ${++index}'`, cwd:process.cwd(), processId:null, source:"agent", status:"inProgress", commandActions:[], aggregatedOutput:null, exitCode:null, durationMs:null};
        event("item/started", {threadId:p.threadId,turnId:turn.id,item,startedAtMs:0});
        event("item/commandExecution/outputDelta", {threadId:p.threadId,turnId:turn.id,itemId:item.id,delta:`running command ${index}\n`});
        timers.set(turn.id, setTimeout(() => {
          item.status="completed"; item.aggregatedOutput=`command ${index}\n  literal <diagnostic>\n`; item.exitCode=0; item.durationMs=1500;
          turn.items.push(item);
          event("item/completed", {threadId:p.threadId,turnId:turn.id,item,startedAtMs:0,completedAtMs:1500});
          if(index < 3) command(); else finish(p.threadId, turn.id, "Activity complete.", "completed");
        }, 1500));
      };
      command();
      return;
    }
    if (text === "[markdown]") {
      const itemId = randomUUID();
      event("item/agentMessage/delta", { threadId: p.threadId, turnId: turn.id, itemId, delta: markdownStart });
      timers.set(turn.id, setTimeout(() => {
        event("item/agentMessage/delta", { threadId: p.threadId, turnId: turn.id, itemId, delta: markdownEnd });
        finish(p.threadId, turn.id, markdownStart + markdownEnd, "completed", itemId);
      }, 3000));
      return;
    }
    timers.set(
      turn.id,
      setTimeout(
        () =>
          finish(
            p.threadId,
            turn.id,
            text.includes("[hostile]")
              ? "<script>window.compromised=true</script>"
              : "Fixture response: " + text,
          ),
        text.includes("[child-thread]")
          ? 3000
          : text.includes("[interrupt-crash]")
          ? 5000
          : text.includes("[delay-long]") ? 10000 : text.includes("[delay]")
            ? 1500
            : 100,
      ),
    );
    return;
  }
  if (m.method === "turn/interrupt") {
    if (crashOnInterrupt.has(p.turnId)) return process.exit(33);
    if (activating.has(p.turnId))
      return send({
        id: m.id,
        error: { code: -32600, message: "no active turn to interrupt" },
      });
    clearTimeout(timers.get(p.turnId));
    result({});
    finish(p.threadId, p.turnId, "", "interrupted");
    return;
  }
  if (m.method === "turn/steer") return result({ turnId: p.expectedTurnId });
  send({ id: m.id, error: { code: -32601, message: "Unsupported" } });
});
