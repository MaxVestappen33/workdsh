/** Only the carrier's own login document receives this preload. No member token API. */
import { ipcRenderer } from 'electron'

window.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector<HTMLFormElement>('#enterprise-login')
  const status = document.querySelector<HTMLElement>('#status')
  if (!form || !status) return
  let busy = false
  const perform = async (value: { account: string, password: string }): Promise<void> => {
    if (busy) return
    busy = true; status.textContent = '正在核验企业账号并准备本机运行…'
    for (const button of form.querySelectorAll('button')) button.disabled = true
    try {
      const result = await ipcRenderer.invoke('workdsh:enterprise-login', value) as { error?: string }
      if (result.error) status.textContent = result.error
      else status.textContent = '正在启动本机官方 DSH…'
    } catch { status.textContent = '无法完成操作，请返回入口后重试' }
    finally {
      busy = false
      for (const button of form.querySelectorAll('button')) button.disabled = false
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault()
    const account = document.querySelector<HTMLInputElement>('#account')!
    const password = document.querySelector<HTMLInputElement>('#password')!
    const value = { account: account.value, password: password.value }
    password.value = ''
    void perform(value)
  })
})
