import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-experimental-agent-team';
import * as Persona from '@deepseek-ai/dsh-persona';
import * as SkillFiles from '@deepseek-ai/dsh-skill-filesystem';
import { expertPersonaConfig, expertPresetDir, readExpertPreset, resolveAgentsHome } from './preset-compiler.js';
import { join } from 'node:path';
import { ExpertsError } from '../domain/values.js';

/** 资产闸门是可选宿主能力：缺失或两个专家子闸门都关时完全透明。 */
type ExpertAssetType = 'expert' | 'expert_group';

interface AssetGateLike {
  enabled(assetType: ExpertAssetType): boolean;
  decide(request: { assetType: ExpertAssetType; assetId: string; usage: 'use' }): Promise<{ allow: boolean; reason: string; message: string }>;
  unlisted(): { reason: string; message: string };
  /** 拒绝审计只入队；实现侧吞掉所有异常，不影响准入判断。 */
  auditDenied?(input: {
    readonly layer: 'call_expert';
    readonly reasonCode: string;
    readonly assetType?: string;
    readonly assetId?: string;
    readonly assetName?: string;
  }): void;
}

/** 判定只需要已解析出的绑定、修订与来源清单。 */
interface ResolvedRoleLike {
  readonly binding: { readonly expertRevisionRef: { readonly expertId: string } };
  readonly revision: { readonly expertId: string; readonly definition: { readonly team?: unknown } };
}

/**
 * 专家准入：按安装清单判定，与工具层同一套口径与原因码。
 *
 * 团队成员不单独持有清单，解析到所属专家团（lead）记录；`resolveNativeRole` 已校验
 * 成员属于该团、且成员与主任务同主体，这里不再重复判断身份。
 * 两个专家子闸门都关时只做一次同步策略读取，不解析身份、不读清单。
 */
async function admitExpertAsset(
  ctx: Context,
  role: ResolvedRoleLike,
  membership: { readonly role?: string } | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const gate = ctx.reflect.get('workdshAssetGate') as AssetGateLike | undefined;
  if (!gate) return;
  if (!gate.enabled('expert') && !gate.enabled('expert_group')) return;
  signal?.throwIfAborted();
  const teammate = membership?.role === 'teammate';
  const targetId = teammate ? role.binding.expertRevisionRef.expertId : role.revision.expertId;
  const manifest = ctx.workdshExperts.installManifestOf(targetId);
  const assetType: ExpertAssetType = manifest?.assetType
    ?? (teammate || role.revision.definition.team ? 'expert_group' : 'expert');
  if (!gate.enabled(assetType)) return;
  if (manifest?.source === 'market' && manifest.assetId) {
    const decision = await gate.decide({ assetType, assetId: manifest.assetId, usage: 'use' });
    if (!decision.allow) {
      gate.auditDenied?.({ layer: 'call_expert', reasonCode: decision.reason, assetType, assetId: manifest.assetId });
      throw new ExpertsError(decision.reason, decision.message);
    }
    return;
  }
  if (manifest?.source === 'builtin') return;
  // local 或无清单（用户自建/导入）：按未上架拒绝。
  const denial = gate.unlisted();
  gate.auditDenied?.({
    layer: 'call_expert',
    reasonCode: denial.reason,
    assetType,
    ...(manifest?.assetId ? { assetId: manifest.assetId } : {}),
  });
  throw new ExpertsError(denial.reason, denial.message);
}

/** Asset admission and role composition only. No child driver, mailbox or Team state. */
export function registerExpertExecutionGuard(ctx: Context, options: { agentsHome?: string } = {}): void {
  const agentsHome = resolveAgentsHome(options.agentsHome);
  const installed = new WeakMap<Agent, string>();

  async function prepare(agent: Agent, signal: AbortSignal | undefined, creating: boolean): Promise<void> {
    const membership = ctx.agentTeams.tryMembership(agent);
    const root = membership?.root ?? agent;
    const header = agent.session.header;
    const actor = await ctx.workdshIdentity.resolve({ sessionId: String(root.id) }, signal);
    let role;
    try {
      role = await ctx.workdshExperts.resolveNativeRole(actor, String(root.id), membership?.role === 'teammate' ? membership.name : undefined, signal);
    } catch (error) {
      const unbound = error instanceof ExpertsError && error.code === 'experts/not-found' && error.details?.reason === 'unbound';
      // The trusted create endpoint stores a Lead asset binding after Agent creation.
      // Its first pre-step must still verify the binding before reaching the model.
      // A resumed official Team child is announced before Team's own serial
      // recovery listener may have restored its runtime membership. Defer only
      // this creation edge; agent/pre-step below still requires the recovered
      // root binding and rejects a genuinely unbound expert child.
      if (unbound && creating && !membership && header.parentSession) return;
      if (unbound && (!header.agentPreset?.startsWith('wd-exp-') || creating && root === agent && !header.parentSession)) return;
      throw error;
    }
    if (role.binding.presetRevisionRef !== header.agentPreset) throw new ExpertsError('experts/conflict', '原生任务 preset 与固定专家组合不一致。');
    if (membership?.role === 'teammate') {
      if (header.parentSession !== root.id || header.cwd !== root.session.header.cwd) throw new ExpertsError('experts/conflict', '官方成员与主任务的父关系或工作区不一致。');
      const childActor = await ctx.workdshIdentity.resolve({ sessionId: String(agent.id) }, signal);
      if (childActor.principalId !== actor.principalId || childActor.organizationId !== actor.organizationId) throw new ExpertsError('experts/forbidden', '成员和主任务不属于同一授权主体。');
    }
    const { revision } = role;
    await admitExpertAsset(ctx, role, membership, signal);
    if (root === agent && !revision.definition.team) return;
    if (installed.get(agent) === revision.compositionDigest) return;
    signal?.throwIfAborted();
    // Read only our already verified immutable composition, not arbitrary plugins.
    const rows = (JSON.parse(await readExpertPreset(revision.presetRevisionRef, agentsHome)) as { plugins: { name?: string; config?: SkillFiles.Config }[] }).plugins;
    const skills = rows.find(row => row.name === '@deepseek-ai/dsh-skill-filesystem')?.config;
    if (!skills) throw new ExpertsError('experts/dependency-missing', '固定专家组合缺少技能目录。');
    const definition = revision.definition;
    const packageRoot = definition.packageDocuments ? join(expertPresetDir(revision.presetRevisionRef, agentsHome), 'expert-package') : undefined;
    // The official Agent scope owns these providers and their disposal.
    const persona = agent.ctx.plugin(Persona, expertPersonaConfig({ definition, packageRoot, teamMembers: revision.teamMembers }));
    ctx.effect(() => () => persona.dispose());
    await persona;
    const skillFiles = agent.ctx.plugin(SkillFiles, skills);
    ctx.effect(() => () => skillFiles.dispose());
    await skillFiles;
    signal?.throwIfAborted();
    installed.set(agent, revision.compositionDigest);
  }

  ctx.on('agent/created', async ({ agent, signal }) => { await prepare(agent, signal, true); });
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    await prepare(agent, signal, false);
    return next();
  });
}
