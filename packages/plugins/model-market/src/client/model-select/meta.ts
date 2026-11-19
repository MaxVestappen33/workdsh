/**
 * 会话模型选择器的展示数据。
 *
 * 官方会话目录只提供 id / name / description / reasoning，没有倍率、促销标签、
 * 上下文窗口和繁忙程度。这些字段按产品要求先做界面效果：已知模型走本地映射
 * （数值取自产品参考图），未收录的模型用确定性兜底，保证任何目录都能渲染完整。
 * 真正的数据来源在后端接入后替换本文件，界面不需要改动。
 */

export type TagTone = 'green' | 'orange' | 'gray' | 'blue';

export interface TagPresentation {
  readonly text: string;
  readonly tone: TagTone;
}

export interface ModelPresentation {
  /** 消耗倍率：相对基准价格。 */
  readonly multiplier: number;
  readonly tag?: TagPresentation;
  /** 上下文窗口展示值；当前只展示，不支持按会话切换。 */
  readonly context: string;
}

export interface TierDefinition {
  readonly id: 'fast' | 'balanced' | 'deep';
  readonly name: string;
  readonly multiplier: number;
  readonly summary: string;
  readonly description: string;
}

/** Auto 档位：界面上是一个开关，语义是先展示、调度待后端接入。 */
export const AUTO_ENTRY = {
  name: 'Auto',
  summary: '按任务复杂度自动选择',
  /** Auto 选中后浮层里唯一保留的一行说明，对齐产品参考图的文案结构。 */
  inline: '警务助手 基于效果与速度帮助您选择最优模型',
  description: '根据任务复杂度自动选择档位与模型：简单任务走快速，复杂任务自动升级。',
  note: '自动判档与逐请求调度需要服务端接入后生效，当前仅切换展示。',
} as const;

/** 三个预置档位；名称、倍率与说明对齐产品参考图。 */
export const TIERS: readonly TierDefinition[] = [
  {
    id: 'fast',
    name: '快速',
    multiplier: 0.15,
    summary: '响应最快，成本最低',
    description: '面向简单问答、轻量改写和快速确认，优先选用低延迟模型，适合对响应速度敏感的任务。',
  },
  {
    id: 'balanced',
    name: '均衡',
    multiplier: 0.5,
    summary: '速度与质量兼顾',
    description: '在响应速度和输出质量之间取平衡，适合日常开发、文档整理与多轮对话。',
  },
  {
    id: 'deep',
    name: '极致',
    multiplier: 1,
    summary: '优先深度与准确性',
    description: '优先深度与准确性，适合复杂分析和高要求任务。',
  },
];

const TAGS = {
  night: { text: '夜间折扣', tone: 'green' },
  offPeak: { text: '闲时折扣', tone: 'green' },
  free: { text: '限时免费', tone: 'green' },
  subscribe: { text: '订阅优先', tone: 'orange' },
  member: { text: '会员 2.5 折', tone: 'gray' },
} as const satisfies Record<string, TagPresentation>;

interface KnownModel {
  readonly multiplier: number;
  readonly tag?: TagPresentation;
  readonly context?: string;
}

/**
 * 已知模型的展示元数据（数值来自产品参考图，仅用于界面验收）。
 * 匹配时按 key 长度倒序做包含匹配，因此 `hy4-flash` 不会被 `hy4` 抢先命中。
 */
const KNOWN_MODELS: Readonly<Record<string, KnownModel>> = {
  'deepseek-v4.1-flash': { multiplier: 0.11, tag: TAGS.night },
  'deepseek-v4-pro': { multiplier: 0.51, tag: TAGS.night },
  'deepseek-v4.1-pro': { multiplier: 0.72, tag: TAGS.offPeak },
  'kimi-k3.1-pro': { multiplier: 0.97, tag: TAGS.subscribe },
  'kimi-k3': { multiplier: 1.62 },
  'kimi-k2.8-preview': { multiplier: 0.77, tag: TAGS.subscribe },
  'glm-5.3-flashx': { multiplier: 0.31 },
  'glm-5.3-flash': { multiplier: 0.08, tag: TAGS.subscribe },
  'glm-5.3': { multiplier: 0.69, tag: TAGS.subscribe },
  'glm-5.2': { multiplier: 0.79, tag: TAGS.night },
  'minimax-m3.1-flash': { multiplier: 0.08 },
  'xiaomi-mimo-v2.6-pro': { multiplier: 0.13 },
  'seed-2.1-pro-0915': { multiplier: 0.8 },
  'seed-2.1-turbo': { multiplier: 0.1, tag: TAGS.member },
  'seed-evolving': { multiplier: 0.8 },
  'seed-code': { multiplier: 0.03, tag: TAGS.member },
  'step-5-preview': { multiplier: 0.33 },
  'space-bunny': { multiplier: 0.08 },
  'hy4-flash': { multiplier: 0, tag: TAGS.free },
  hy4: { multiplier: 0.29 },
  'qwen3-max': { multiplier: 0.62 },
  'claude-sonnet-4-5': { multiplier: 1.24 },
};

const KNOWN_KEYS = Object.keys(KNOWN_MODELS).sort((left, right) => right.length - left.length);

/** FNV-1a：只用来给未收录的模型生成稳定而非随机的展示值。 */
function hashOf(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(2)}x`;
}

export function presentationOf(modelId: string): ModelPresentation {
  const normalized = modelId.trim().toLowerCase();
  const knownKey = KNOWN_KEYS.find(key => normalized === key || normalized.includes(key));
  if (knownKey) {
    const known = KNOWN_MODELS[knownKey];
    return {
      multiplier: known.multiplier,
      ...(known.tag ? { tag: known.tag } : {}),
      context: known.context ?? '300K',
    };
  }
  // 未收录：0.05x–1.24x 的确定性占位，界面不出现随机跳动。
  const multiplier = Math.round((0.05 + (hashOf(normalized) % 120) / 100) * 100) / 100;
  return { multiplier, context: '300K' };
}

export type BusyLevel = 'idle' | 'light' | 'heavy';

export interface BusyPresentation {
  readonly level: BusyLevel;
  readonly label: string;
}

const BUSY_LABELS: Readonly<Record<BusyLevel, string>> = {
  idle: '空闲',
  light: '轻微拥堵',
  heavy: '极度拥堵',
};

/** 繁忙程度没有官方信号：按模型 id 生成稳定的演示值（约 60% 空闲 / 30% 轻微 / 10% 拥堵）。 */
export function busyOf(modelId: string): BusyPresentation {
  const bucket = hashOf(`${modelId}:busy`) % 10;
  const level: BusyLevel = bucket < 6 ? 'idle' : bucket < 9 ? 'light' : 'heavy';
  return { level, label: BUSY_LABELS[level] };
}

export type ModelFamily = 'glm' | 'kimi' | 'deepseek' | 'seed' | 'hy' | 'minimax' | 'step' | 'mimo' | 'generic';

export function familyOf(modelId: string): ModelFamily {
  const id = modelId.toLowerCase();
  if (id.includes('glm') || id.includes('zhipu')) return 'glm';
  if (id.includes('kimi') || id.includes('moonshot')) return 'kimi';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('seed') || id.includes('doubao')) return 'seed';
  if (id.includes('hy4') || id.includes('hunyuan')) return 'hy';
  if (id.includes('minimax')) return 'minimax';
  if (id.includes('step')) return 'step';
  if (id.includes('mimo') || id.includes('xiaomi')) return 'mimo';
  return 'generic';
}

/** 模型行首的字形图标：家族首字母，没有可用字母时退回名称首字符。 */
export function monogramOf(name: string, modelId: string): string {
  const family = familyOf(modelId);
  if (family !== 'generic') {
    const letters: Readonly<Record<Exclude<ModelFamily, 'generic'>, string>> = {
      glm: 'G',
      kimi: 'K',
      deepseek: 'D',
      seed: 'S',
      hy: 'H',
      minimax: 'M',
      step: 'P',
      mimo: 'X',
    };
    return letters[family];
  }
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : 'M';
}

/** 官方目录没有描述时按家族给一句克制的说明，避免详情面板出现空白。 */
export function fallbackDescription(modelId: string): string {
  switch (familyOf(modelId)) {
    case 'glm':
      return '中文理解与工具调用表现均衡，适合通用任务。';
    case 'kimi':
      return '擅长长上下文阅读、资料整理与长程任务。';
    case 'deepseek':
      return '擅长通用对话、代码与长文本处理。';
    case 'seed':
      return '面向日常问答与内容生成，响应较快。';
    case 'hy':
      return '通用对话模型，适合日常任务。';
    case 'minimax':
      return '长文本与多轮对话能力较强。';
    case 'step':
      return '推理与多模态能力均衡。';
    case 'mimo':
      return '轻量通用模型，适合高频短任务。';
    default:
      return '通用对话模型，具体能力以模型说明为准。';
  }
}
