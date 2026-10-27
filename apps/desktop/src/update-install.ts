/** Windows 安装包校验；安装本身由独立进度进程静默执行。 */
import { open, stat } from 'node:fs/promises'

const PE_SIGNATURE = 'PE\0\0'

/** 校验 DOS/PE 头，拒绝 HTML 错误页或被截断的下载文件。 */
export async function verifyWindowsInstaller(executable: string): Promise<boolean> {
  try {
    const info = await stat(executable)
    if (!info.isFile() || info.size < 64) return false
    const handle = await open(executable, 'r')
    try {
      const head = Buffer.alloc(64)
      await handle.read(head, 0, head.length, 0)
      if (head.toString('latin1', 0, 2) !== 'MZ') return false
      const signatureOffset = head.readUInt32LE(0x3c)
      if (signatureOffset < 64 || signatureOffset > info.size - 4) return false
      const signature = Buffer.alloc(4)
      await handle.read(signature, 0, 4, signatureOffset)
      return signature.toString('latin1') === PE_SIGNATURE
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}
