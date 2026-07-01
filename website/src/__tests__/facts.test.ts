/**
 * 数据完整性测试
 * 验证 facts.ts 中的数据与 pi-company-facts.md 一致
 */
import { describe, it, expect } from 'vitest'
import {
  productSummary,
  roles,
  benchmarkSummary,
  benchmarkRows,
  cliCommands,
  extensionCommands,
  piTools,
  prGates,
  rateLimitPolicy,
  wakePolicy,
  troubleshooting,
} from '../data/facts'

describe('productSummary', () => {
  it('should have correct name', () => {
    expect(productSummary.name).toBe('pi-company')
  })

  it('should have core workflow', () => {
    expect(productSummary.coreWorkflow).toContain('human')
    expect(productSummary.coreWorkflow).toContain('lead')
    expect(productSummary.coreWorkflow).toContain('coder')
    expect(productSummary.coreWorkflow).toContain('merge')
  })

  it('should have scope items', () => {
    expect(productSummary.scope.length).toBeGreaterThan(0)
    expect(productSummary.scope).toContain('Pi 原生，本地单机运行')
  })

  it('should have benchmark evidence', () => {
    expect(benchmarkSummary.record).toContain('0 负')
    expect(benchmarkRows.length).toBe(4)
    expect(benchmarkRows[0].result).toBe('win')
  })
})

describe('roles', () => {
  it('should have 6 roles', () => {
    expect(roles).toHaveLength(6)
  })

  it('should have correct role IDs', () => {
    const roleIds = roles.map(r => r.id)
    expect(roleIds).toContain('lead')
    expect(roleIds).toContain('pm')
    expect(roleIds).toContain('researcher')
    expect(roleIds).toContain('coder')
    expect(roleIds).toContain('reviewer')
    expect(roleIds).toContain('tester')
  })

  it('each role should have required fields', () => {
    roles.forEach(role => {
      expect(role.id).toBeTruthy()
      expect(role.name).toBeTruthy()
      expect(role.responsibility).toBeTruthy()
      expect(role.boundaries).toBeInstanceOf(Array)
      expect(role.commonMistakes).toBeInstanceOf(Array)
    })
  })
})

describe('cliCommands', () => {
  it('should have commands', () => {
    expect(cliCommands.length).toBeGreaterThan(0)
  })

  it('each command should have required fields', () => {
    cliCommands.forEach(cmd => {
      expect(cmd.command).toBeTruthy()
      expect(cmd.description).toBeTruthy()
      expect(cmd.category).toBeTruthy()
    })
  })

  it('should include init command', () => {
    const initCmd = cliCommands.find(c => c.command.includes('init'))
    expect(initCmd).toBeDefined()
  })

  it('should include status command', () => {
    const statusCmd = cliCommands.find(c => c.command.includes('status'))
    expect(statusCmd).toBeDefined()
  })
})

describe('extensionCommands', () => {
  it('should have commands', () => {
    expect(extensionCommands.length).toBeGreaterThan(0)
  })

  it('should include /company-status', () => {
    const cmd = extensionCommands.find(c => c.command === '/company-status')
    expect(cmd).toBeDefined()
  })

  it('should include /company-brief', () => {
    const cmd = extensionCommands.find(c => c.command === '/company-brief')
    expect(cmd).toBeDefined()
  })
})

describe('piTools', () => {
  it('should have tools', () => {
    expect(piTools.length).toBeGreaterThan(0)
  })

  it('should include company_status', () => {
    const tool = piTools.find(t => t.name === 'company_status')
    expect(tool).toBeDefined()
  })

  it('should include company_lead_brief', () => {
    const tool = piTools.find(t => t.name === 'company_lead_brief')
    expect(tool).toBeDefined()
  })

  it('should include company_merge_pr', () => {
    const tool = piTools.find(t => t.name === 'company_merge_pr')
    expect(tool).toBeDefined()
  })
})

describe('prGates', () => {
  it('should have gates', () => {
    expect(prGates.length).toBeGreaterThan(0)
  })

  it('each gate should have required fields', () => {
    prGates.forEach(gate => {
      expect(gate.id).toBeTruthy()
      expect(gate.label).toBeTruthy()
      expect(typeof gate.required).toBe('boolean')
    })
  })

  it('should include root-clean gate', () => {
    const gate = prGates.find(g => g.id === 'root-clean')
    expect(gate).toBeDefined()
    expect(gate?.required).toBe(true)
  })
})

describe('rateLimitPolicy', () => {
  it('should have correct max concurrent', () => {
    expect(rateLimitPolicy.maxConcurrent).toBe(3)
  })

  it('should have start spacing', () => {
    expect(rateLimitPolicy.startSpacing).toBeTruthy()
  })

  it('should have backoff values', () => {
    expect(rateLimitPolicy.firstBackoff).toBeTruthy()
    expect(rateLimitPolicy.maxBackoff).toBeTruthy()
  })
})

describe('wakePolicy', () => {
  it('should have human steering always wake lead', () => {
    expect(wakePolicy.humanSteering).toContain('始终唤醒')
  })

  it('should have cooldown', () => {
    expect(wakePolicy.cooldown).toBeTruthy()
  })

  it('should have per-agent limit', () => {
    expect(wakePolicy.perAgentLimit).toBeTruthy()
  })
})

describe('troubleshooting', () => {
  it('should have items', () => {
    expect(troubleshooting.length).toBeGreaterThan(0)
  })

  it('each item should have required fields', () => {
    troubleshooting.forEach(item => {
      expect(item.symptom).toBeTruthy()
      expect(item.diagnosis).toBeTruthy()
      expect(item.solution).toBeTruthy()
    })
  })
})
