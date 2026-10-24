// In-memory login throttle (resets on restart). The 256-bit key makes guessing infeasible; this just stops noise and log spam.
export type Clock = () => number;
export class LoginLimiter {
  private perIp = new Map<string, number[]>();
  private all: number[] = [];
  constructor(private opts = { perIp: 5, global: 50, windowMs: 15 * 60_000 }, private now: Clock = Date.now) {}
  private prune(list: number[]) { const cut = this.now() - this.opts.windowMs; while (list.length && list[0] <= cut) list.shift(); return list; }
  /** Seconds to wait if this ip is blocked, else 0. */
  blockedFor(ip: string): number {
    const mine = this.prune(this.perIp.get(ip) ?? []);
    const all = this.prune(this.all);
    const hit = mine.length >= this.opts.perIp ? mine : all.length >= this.opts.global ? all : null;
    return hit ? Math.max(1, Math.ceil((hit[0] + this.opts.windowMs - this.now()) / 1000)) : 0;
  }
  fail(ip: string) {
    const t = this.now();
    const mine = this.perIp.get(ip) ?? [];
    mine.push(t); this.perIp.set(ip, mine); this.all.push(t);
    if (this.perIp.size > 5000) for (const [k, v] of this.perIp) if (!this.prune(v).length) this.perIp.delete(k);
  }
  success(ip: string) { this.perIp.delete(ip); }
}
