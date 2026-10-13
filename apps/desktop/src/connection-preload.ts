/** Only the carrier's own login documents receive this preload. No member token API. */
import { ipcRenderer } from 'electron'

window.addEventListener('DOMContentLoaded', () => {
  const status = document.querySelector<HTMLElement>('#status')
  /**
   * 统一渲染状态提示：pending 灰、ok 绿、error 红；空文本时由 CSS 自动隐藏。
   * 文案只是提示，不承担真实进度；避免出现与实际阶段不符的措辞。
   */
  const show = (kind: 'pending' | 'ok' | 'error', text: string): void => {
    if (!status) return
    status.className = `show ${kind}`
    status.textContent = text
  }
  const accountForm = document.querySelector<HTMLFormElement>('#account-login')
  const enterpriseForm = document.querySelector<HTMLFormElement>('#enterprise-login')
  if (accountForm && status) {
    let busy = false
    const perform = async (value: { username: string, password: string }): Promise<void> => {
      if (busy) return
      busy = true; show('pending', '正在登录…')
      const button = accountForm.querySelector<HTMLButtonElement>('button[type="submit"]')
      if (button) button.disabled = true
      let admitted = false
      try {
        const result = await ipcRenderer.invoke('workdsh:account-login', value) as { error?: string, ok?: boolean }
        if (result.error) show('error', result.error)
        else if (result.ok) { show('ok', '登录成功'); admitted = true }
        else show('pending', '登录中…')
      } catch { show('error', '无法完成登录，请稍后重试') }
      finally {
        busy = false
        // 登录成功后保持按钮禁用：窗口即将切换为主界面，不需要再次提交。
        if (button && !admitted && !accountForm.dataset.shutdown) button.disabled = false
      }
    }
    accountForm.addEventListener('submit', event => {
      event.preventDefault()
      const account = document.querySelector<HTMLInputElement>('#account')!
      const password = document.querySelector<HTMLInputElement>('#password')!
      const value = { username: account.value, password: password.value }
      password.value = ''
      void perform(value)
    })
  }
  if (enterpriseForm && status) {
    let busy = false
    const perform = async (value: { account: string, password: string }): Promise<void> => {
      if (busy) return
      busy = true; show('pending', '正在核验企业账号并准备本机运行…')
      for (const button of enterpriseForm.querySelectorAll('button')) button.disabled = true
      try {
        const result = await ipcRenderer.invoke('workdsh:enterprise-login', value) as { error?: string }
        if (result.error) show('error', result.error)
        else show('ok', '认证成功')
      } catch { show('error', '无法完成操作，请返回入口后重试') }
      finally {
        busy = false
        for (const button of enterpriseForm.querySelectorAll('button')) button.disabled = false
      }
    }
    enterpriseForm.addEventListener('submit', event => {
      event.preventDefault()
      const account = document.querySelector<HTMLInputElement>('#account')!
      const password = document.querySelector<HTMLInputElement>('#password')!
      const value = { account: account.value, password: password.value }
      password.value = ''
      void perform(value)
    })
  }
})
