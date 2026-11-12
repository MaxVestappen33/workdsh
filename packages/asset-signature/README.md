# 资产签名（assets signature）

技能市场安装与启用前的签名校验：按后台签名契约重建载荷，用内置 Ed25519 公钥验签。

- 载荷版本 `workdsh-asset-signature-v1`，文件行 `<path UTF-8 字节数>:<path>:<size>:<sha256>`，
  路径按 UTF-8 字节无符号升序，最后一行同样以 `\n` 结尾。
- 校验顺序：缓存新鲜期（24 小时）→ envelope 一致性 → assetType/assetId 与安装位置匹配 →
  规范化并重建载荷 → 文件集合与逐文件 size/sha256 比对 → `sha256(payload)==digest` →
  keyId 查内置公钥 → Ed25519 验签。
- 任何一步失败都按原因码 `gate/denied-signature-*` / `gate/denied-manifest-*` 拒绝，
  不存在「无签名可放行」的分支。
- 公钥表见 `src/public-keys.ts`：后台 keyId `2026a` 的公钥已内置（base64 DER SPKI）；
  轮换时新增 keyId 条目，旧 keyId 在客户端覆盖完成后移除。表中缺少对应 keyId 时验签 fail closed。
