/** Host-only lifecycle helper. Callers must authenticate each request first.
 * Never treats a Profile, process ID or login registration as authorization. */
export interface MemberProcessKey { organizationId: string; principalId: string }
export interface MemberProcessHandle { alive(): boolean; stop(): Promise<void> }
export interface MemberProcessAdapter<T extends MemberProcessHandle> {
  start(member: Readonly<MemberProcessKey>, loginId: string): Promise<T>;
  /** Optional exhaustive quiescence check, including jobs, schedules and plugin work.
   * A session/list-only check must not return idle. Missing/unknown means retain. */
  inspectIdle?(handle: T): Promise<'idle' | 'busy' | 'unknown'>;
}
interface Entry<T> { member: Readonly<MemberProcessKey>; logins: Set<string>; revision: number; tail: Promise<unknown>; handle?: T }
export class MemberProcessSupervisor<T extends MemberProcessHandle> {
  private entries = new Map<string, Entry<T>>();
  constructor(private readonly adapter: MemberProcessAdapter<T>) {}
  private entry(member: MemberProcessKey) {
    if (!member.organizationId || !member.principalId) throw new Error('Verified member required');
    const key = JSON.stringify([member.organizationId, member.principalId]);
    let entry = this.entries.get(key);
    if (!entry) { entry = { member: Object.freeze({ ...member }), logins: new Set(), revision: 0, tail: Promise.resolve() }; this.entries.set(key, entry); }
    return entry;
  }
  private queue<R>(entry: Entry<T>, fn: () => Promise<R>): Promise<R> {
    const next = entry.tail.catch(() => undefined).then(fn); entry.tail = next; return next;
  }
  async login(member: MemberProcessKey, loginId: string): Promise<T> {
    if (!loginId) throw new Error('Login registration required');
    const entry = this.entry(member); entry.revision++;
    return this.queue(entry, async () => {
      if (!entry.handle?.alive()) { entry.handle = undefined; const handle = await this.adapter.start(entry.member, loginId); if (!handle.alive()) throw new Error('Member process failed to start'); entry.handle = handle; }
      entry.logins.add(loginId); return entry.handle;
    });
  }
  async logout(member: MemberProcessKey, loginId: string): Promise<void> {
    const entry = this.entry(member); entry.revision++;
    await this.queue(entry, async () => { entry.logins.delete(loginId); });
    // Logout revokes browser access elsewhere; it must not terminate background work.
  }
  async recycleIfIdle(member: MemberProcessKey): Promise<'retained' | 'stopped' | 'absent'> {
    const entry = this.entry(member); const revision = entry.revision;
    return this.queue(entry, async () => {
      if (!entry.handle?.alive()) { entry.handle = undefined; return 'absent'; }
      if (entry.logins.size || !this.adapter.inspectIdle) return 'retained';
      let idle: string;
      try { idle = await this.adapter.inspectIdle(entry.handle); } catch { return 'retained'; }
      if (idle !== 'idle' || entry.logins.size || revision !== entry.revision) return 'retained';
      await entry.handle.stop();
      if (entry.handle.alive()) throw new Error('Member process did not stop');
      entry.handle = undefined; return 'stopped';
    });
  }
}
