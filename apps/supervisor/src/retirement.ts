export interface Retirable {
  closeAndWait(): Promise<void>;
  inspectProcesses(): Promise<{ status: string }>;
}
/** Failed confirmations remain owned until the trusted inspector establishes absence. */
export class RetirementRegistry<T extends Retirable> {
  private readonly entries = new Map<T, Promise<boolean>>();
  retire(transport: T) {
    const prior = this.entries.get(transport);
    if (prior) return prior;
    let settle!: (confirmed: boolean) => void;
    const pending = new Promise<boolean>((resolve) => (settle = resolve));
    this.entries.set(transport, pending);
    void transport
      .closeAndWait()
      .then(() => {
        this.entries.delete(transport);
        settle(true);
      })
      .catch(() => settle(false));
    return pending;
  }
  async confirmed(only?: T) {
    for (const [transport, pending] of this.entries) {
      if (only && transport !== only) continue;
      if (await pending) continue;
      try {
        if ((await transport.inspectProcesses()).status === "runtime_gone") {
          this.entries.delete(transport);
          continue;
        }
      } catch {}
      return false;
    }
    return true;
  }
}
