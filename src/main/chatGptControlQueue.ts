type ChatGptControlOperationBase = 'check-login' | 'show-window' | 'recover-window' | 'list-models';
export type ChatGptControlOperation = ChatGptControlOperationBase | `gemini:${ChatGptControlOperationBase}`;

export class ChatGptControlQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly singleFlightKeys = new Set<string>();
  private queued = 0;

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    this.queued += 1;
    const scheduled = this.tail.catch(() => undefined).then(operation);
    let tracked!: Promise<T>;
    tracked = scheduled.finally(() => {
      if (this.inFlight.get(key) === tracked) this.inFlight.delete(key);
      this.queued = Math.max(0, this.queued - 1);
    });
    this.inFlight.set(key, tracked);
    this.tail = tracked.catch(() => undefined);
    return tracked;
  }

  runSingleFlight<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    this.queued += 1;
    let tracked!: Promise<T>;
    tracked = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.inFlight.get(key) === tracked) {
          this.inFlight.delete(key);
          this.singleFlightKeys.delete(key);
        }
        this.queued = Math.max(0, this.queued - 1);
      });
    this.inFlight.set(key, tracked);
    this.singleFlightKeys.add(key);
    return tracked;
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const scheduled = this.tail.catch(() => undefined).then(operation);
    const tracked = scheduled.finally(() => {
      this.queued = Math.max(0, this.queued - 1);
    });
    this.tail = tracked.catch(() => undefined);
    return tracked;
  }

  acquireExclusive(): Promise<() => void> {
    this.queued += 1;
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const acquired = this.tail.catch(() => undefined).then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.queued = Math.max(0, this.queued - 1);
        releaseHold();
      };
    });
    this.tail = acquired.then(() => hold).catch(() => undefined);
    return acquired;
  }

  isInFlight(key: string) {
    return this.inFlight.has(key);
  }

  waitForSerializedIdle() {
    return this.tail.catch(() => undefined).then(() => undefined);
  }

  waitForSingleFlight(key: string) {
    const operation = this.singleFlightKeys.has(key) ? this.inFlight.get(key) : undefined;
    return operation ? operation.catch(() => undefined).then(() => undefined) : Promise.resolve();
  }

  waitForSingleFlights(keys: readonly string[]) {
    return Promise.all(keys.map((key) => this.waitForSingleFlight(key))).then(() => undefined);
  }

  get pendingCount() {
    return this.queued;
  }
}
