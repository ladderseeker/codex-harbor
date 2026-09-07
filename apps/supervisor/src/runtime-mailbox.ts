/** A poisoned runtime can never enqueue or apply another notification. */
export class RuntimeMailbox {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;
  private bytes = 0;
  poisoned = false;
  constructor(
    private readonly terminal: (reason: string) => void,
    private readonly maxCount = 256,
    private readonly maxBytes = 1_048_576,
  ) {}
  poison(reason: string) {
    if (this.poisoned) return;
    this.poisoned = true;
    // Runs outside the queue: close() may synchronously report disconnect.
    this.terminal(reason);
  }
  enqueue(size: number, apply: () => Promise<void>) {
    if (this.poisoned) return;
    if (this.count >= this.maxCount || this.bytes + size > this.maxBytes) {
      this.poison("Runtime notification backlog exceeded");
      return;
    }
    this.count++;
    this.bytes += size;
    this.tail = this.tail
      .then(async () => {
        if (!this.poisoned) await apply();
      })
      .catch(() =>
        this.poison(
          "Runtime persistence failed; history requires reconciliation",
        ),
      )
      .finally(() => {
        this.count--;
        this.bytes -= size;
      });
  }
  async drained() {
    await this.tail;
  }
}
