/**
 * 内置签名公钥表：keyId -> 公钥。
 *
 * 公钥可以是 PEM（`-----BEGIN PUBLIC KEY-----`）或 base64 编码的 DER SPKI，两者都由
 * `node:crypto` 的 `createPublicKey` 解析。后台当前签名钥的 keyId 是 `2026a`。
 *
 * 新 keyId 的真实公钥由后台运维提供后填入这里；表中缺失对应 keyId 时验签按「签名缺失」
 * fail closed 拒绝，不会因为「没有公钥」而放宽成放行。
 */
export const ASSET_SIGNATURE_PUBLIC_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // 后台签名钥 2026a：base64 编码的 DER SPKI，与 PEM 等价。
  '2026a': 'MCowBQYDK2VwAyEAkqd3SqgQ5bcVCpsnIVAzOWhKmN46AGcCbEoUGFoIj/s=',
});
