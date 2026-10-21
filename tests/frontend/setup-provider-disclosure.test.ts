// CyberManju OS — Provider disclosure (tests/frontend/setup-provider-disclosure.test.ts).
// Role: guard OAuth-first setup and explicit disclosure of manual provider fields.
// Exports: Vitest regression suite.
// Integrates: MobileSetupWizard and AccountManagerPanel source contracts.
// Contracts: opening Add custom never authenticates or saves credentials.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { baseParse, NodeTypes, type ElementNode, type RootNode, type TemplateChildNode } from '@vue/compiler-dom'

const mobile = readFileSync('src/components/MobileSetupWizard.vue', 'utf8')
const accounts = readFileSync('src/components/AccountManagerPanel.vue', 'utf8')

function elementById(source: string, id: string): ElementNode | undefined {
  const ast = baseParse(parse(source).descriptor.template!.content)
  function find(node: RootNode | TemplateChildNode): ElementNode | undefined {
    if (node.type === NodeTypes.ELEMENT && node.props.some(prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'id' && prop.value?.content === id)) return node
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        const result = find(child as TemplateChildNode)
        if (result) return result
      }
    }
  }
  return find(ast)
}

describe('setup custom-provider disclosure', () => {
  it('keeps mobile custom provider fields collapsed until Add custom is activated', () => {
    expect(mobile).toContain('const customProviderOpen = ref(false)')
    expect(mobile).toContain('aria-controls="msw-custom-provider-fields" :aria-expanded="customProviderOpen"')
    expect(mobile).toContain('v-if="customProviderOpen" id="msw-custom-provider-fields"')
    expect(mobile).toContain("customProviderOpen ? 'Hide custom' : 'Add custom'")
    expect(mobile).toContain('v-model="prov.name"')
    expect(mobile).toContain('v-model="prov.secret"')
    expect(mobile).toContain('@click="mswSignIn(p.id)"')
  })

  it('keeps account-manager name, token and provider-specific manual fields collapsed accessibly', () => {
    expect(accounts).toContain('const manualEntryOpen = ref(false)')
    expect(accounts).toContain('aria-controls="am-custom-provider-fields" :aria-expanded="manualEntryOpen"')
    expect(accounts).toContain('v-if="manualEntryOpen" id="am-custom-provider-fields"')
    expect(accounts).toContain("manualEntryOpen ? 'Hide custom' : 'Add custom'")
    expect(accounts).toContain('v-model="wiz.name"')
    expect(accounts).toContain('v-model="(wiz as any)[f.key]"')
    expect(accounts).toContain('@click="addProvider(true)"')
  })
  it('nests manual save actions and fields inside the conditional custom panel', () => {
    const custom = elementById(accounts, 'am-custom-provider-fields')!
    expect(custom).toBeDefined()
    expect(custom.loc.source).toContain('@click="addProvider(true)"')
    expect(custom.loc.source).toContain('@click="addProvider(false)"')
    expect(custom.loc.source).toContain('v-model="wiz.name"')
    expect(custom.loc.source).not.toContain('@click="signIn(p.id)"')
    expect(accounts).toContain('aria-label="Authenticate a provider"')
  })
  it('keeps mobile OAuth actions outside the custom panel', () => {
    const custom = elementById(mobile, 'msw-custom-provider-fields')!
    expect(custom).toBeDefined()
    expect(custom.loc.source).toContain('v-model="prov.name"')
    expect(custom.loc.source).not.toContain('@click="mswSignIn(p.id)"')
  })
})
