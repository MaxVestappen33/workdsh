import { readWorkbenchRequestBody } from './request-body.js';
import type { HostWorkbenchRegistration } from './host-registration.js';
export const workbenchRegistrationPath = '/api/workdsh-workbench-registration';
const fail = (code: string, status: number) => Response.json({ ok: false, error: { code, message: '无法确认工作台安装状态，请刷新并核对。' } }, { status });
export async function handleWorkbenchRegistrationRequest(request: Request,
  registration: Pick<HostWorkbenchRegistration<unknown>, 'clientAuthority'>,
  resolveAccess: (signal: AbortSignal) => Promise<() => void>) {
  if (request.method !== 'POST') return fail('workbench/invalid-method', 405);
  try {
    const body = await readWorkbenchRequestBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('workbench/invalid-request');
    const input = body as Record<string, unknown>, payload = input.payload;
    if (Object.keys(input).some(key => !['endpoint', 'payload'].includes(key)) || input.endpoint !== 'client-authority' ||
        !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('workbench/invalid-request');
    const fields = payload as Record<string, unknown>;
    if (Object.keys(fields).length !== 1 || typeof fields.packageName !== 'string' ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(fields.packageName) || fields.packageName.length > 214)
      throw new Error('workbench/invalid-request');
    const authorize = await resolveAccess(request.signal); authorize();
    const authority = await registration.clientAuthority(fields.packageName, request.signal);
    request.signal.throwIfAborted(); authorize();
    return Response.json({ ok: true, value: authority });
  } catch (cause) {
    if (request.signal.aborted) return fail('workbench/request-cancelled', 408);
    const code = cause instanceof Error ? cause.message : '';
    if (code === 'workbench/development-access-denied') return fail(code, 403);
    if (code === 'workbench/invalid-request') return fail(code, 400);
    if (code === 'workbench/request-size-limit') return fail(code, 413);
    if (code === 'workbench/unregistered-package') return fail(code, 404);
    if (['workbench/package-disabled', 'workbench/incompatible-host', 'workbench/installation-changed', 'workbench/installation-declaration-changed', 'workbench/caller-source-changed'].includes(code)) return fail(code, 409);
    return fail('workbench/internal', 500);
  }
}
