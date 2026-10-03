/** Caps how many provider calls one worker has in flight. */
export class Semaphore {
  #available: number;
  #waiting: Array<() => void> = [];

  constructor(max: number) {
    this.#available = Math.max(1, Math.floor(max));
  }

  /** Resolves with a release function once a slot is free. */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.#available > 0) {
      this.#available--;
      return this.#releaser();
    }
    await new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const index = this.#waiting.indexOf(grant);
        if (index !== -1) this.#waiting.splice(index, 1);
        reject(signal?.reason);
      };
      this.#waiting.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    return this.#releaser();
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) next();
      else this.#available++;
    };
  }
}
