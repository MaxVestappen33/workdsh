import type { ChildProcess } from 'node:child_process'
export const PRODUCT_SERVICES: Readonly<Record<string, string>>
export function inspectStartedHost(ctx: { fiber: { state: number }; get(name: string): unknown; registry: { values(): Iterable<{ name?: string; fibers: Iterable<{ state: number }> }> } }, products: Readonly<Record<string, string>>, platformServices: readonly string[]): { kind: string; products: string[]; services: string[]; installAnchor: string }
export function prepareHostSmokeProbe(home: string): string
export function hostSmokeEnvironment(home: string, primary: string, executable: string, parent?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function scrubHostDiagnostics(value: string): string
export function waitForPackagedHostReady(child: ChildProcess, options?: { timeoutMs?: number }): { ready: Promise<{ url: string; receipt: { kind: string; products: string[]; services: string[]; installAnchor: string }; diagnostics(): string }>; diagnostics(): string }
