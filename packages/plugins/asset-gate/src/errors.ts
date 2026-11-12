/** 资产闸门自身的错误类型：不与后台通道错误混用，调用方按 code 决定提示与降级。 */
export type AssetGateErrorCode =
  /** 后台回包结构无法识别。 */
  | 'asset-gate/response-invalid'
  /** 宿主未注入可用的后台通道。 */
  | 'asset-gate/unavailable';

export class AssetGateError extends Error {
  constructor(readonly code: AssetGateErrorCode, message: string) {
    super(message);
    this.name = 'AssetGateError';
  }
}
