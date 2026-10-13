/** Only the carrier's own login documents receive this preload. No member token API. */
import { ipcRenderer } from 'electron'

window.addEventListener('DOMContentLoaded', () => {
  const status = document.querySelector<HTMLElement>('#status')
  const accountForm = document.querySelector<HTMLFormElement>('#account-login')
  const enterpriseForm = document.querySelector<HTMLFormElement>('#enterprise-login')
  if (accountForm && status) {
    let busy = false
    const perform = async (value: { username: string, password: string }): Promise<void> => {
      if (busy) return
      busy = true; status.textContent = '正在登录…'
      const button = accountForm.querySelector<HTMLButtonElement>('button[type="submit"]')
      if (button) button.disabled = true
      try {
        const result = await ipcRenderer.invoke('workdsh:account-login', value) as { error?: string, ok?: boolean }
        status.textContent = result.error ?? (result.ok ? '登录成功，正在准备运行环境…' : '登录中…')
      } catch { status.textContent = '无法完成登录，请稍后重试' }
      finally {
        busy = false
        if (button && !accountForm.dataset.shutdown) button.disabled = false
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
      busy = true; status.textContent = '正在核验企业账号并准备本机运行…'
      for (const button of enterpriseForm.querySelectorAll('button')) button.disabled = true
      try {
        const result = await ipcRenderer.invoke('workdsh:enterprise-login', value) as { error?: string }
        if (result.error) status.textContent = result.error
        else status.textContent = '正在启动本机官方 DSH…'
      } catch { status.textContent = '无法完成操作，请返回入口后重试' }
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
