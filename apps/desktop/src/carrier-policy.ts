/**
 * Product policy switches for the Desktop carrier.
 *
 * ACCOUNT_ONLY：本产品只提供账号登录入口，个人工作区/终端命令等非账号入口保留实现，
 * 但在逻辑层直接拒绝，避免在同一个 dsh-home 里产生“个人身份”会话绑定。
 * 关闭该开关即可恢复原有入口行为，无需改动分支代码。
 */
export const ACCOUNT_ONLY = true
