/** Windows 安装包校验与安装器交接；不经过 shell，参数固定。 */
import { spawn } from 'node:child_process'
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

/**
 * 以静默方式启动 NSIS 安装器：`/S` 跳过界面，`--updated` 表示覆盖升级。
 * 只等待 spawn 成功，不等待安装结束；调用方随后退出应用，由安装器接管。
 */
export async function launchWindowsInstaller(executable: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('当前平台不支持静默安装')
  if (!await verifyWindowsInstaller(executable)) throw new Error('安装包不是有效的 Windows 安装程序')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['/S', '--updated'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    })
    const cleanup = (): void => {
      child.off('error', onError)
      child.off('spawn', onSpawn)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onSpawn = (): void => {
      cleanup()
      child.unref()
      resolve()
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}
