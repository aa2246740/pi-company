import { afterEach, describe, expect, it } from 'vitest'
import { installRuntimeI18n, setLocale, stopRuntimeI18n } from '../i18n/runtime'

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('runtime i18n', () => {
  afterEach(() => {
    stopRuntimeI18n()
    window.localStorage.clear()
    document.body.innerHTML = ''
  })

  it('defaults to English and can restore Chinese copy', async () => {
    window.localStorage.clear()
    document.body.innerHTML = `
      <main>
        <h1>快速开始</h1>
        <p>从零到运行第一个 agent 公司，不超过 5 分钟。</p>
        <input placeholder="输入引导消息..." aria-label="打开菜单" />
      </main>
    `

    installRuntimeI18n()
    await settle()

    expect(document.documentElement.lang).toBe('en')
    expect(document.querySelector('h1')?.textContent).toBe('Quick Start')
    expect(document.querySelector('p')?.textContent).toContain('under five minutes')
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('Type steering message...')

    setLocale('zh-CN')
    await settle()

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.querySelector('h1')?.textContent).toBe('快速开始')
    expect(document.querySelector('p')?.textContent).toContain('不超过 5 分钟')
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('输入引导消息...')
  })
})
