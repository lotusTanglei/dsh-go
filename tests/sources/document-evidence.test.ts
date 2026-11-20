import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createDocumentEvidence } from '../../src/sources/document-evidence.js'

const roots: string[] = []
function root() { const path = mkdtempSync(join(tmpdir(),'document-evidence-')); roots.push(path); return path }
afterEach(() => { for (const p of roots.splice(0)) { const target = realpathSync(p); if (!target.startsWith(resolve(tmpdir()) + '/') && !target.startsWith('/private' + resolve(tmpdir()) + '/')) throw new Error('unsafe fixture cleanup'); rmSync(target,{recursive:true,force:true}) } })
describe('restricted immutable document evidence', () => {
  it('round-trips exact original text/position/strike/images without globally weakening DB redaction', () => {
    const dir=root(), store=createDocumentEvidence(dir)
    const original={doc:'https://doc.weixin.qq.com/sheet/private', text:'原文\n~~不是格式解析~~', cells:[{strike:'yes',address:'A4'}], images:[{data:'opaque exact bytes'}]}
    const digest=store.put(original)
    expect(store.read(digest)).toEqual(original)
    expect(store.put(original)).toBe(digest)
    expect(readFileSync(join(dir,'document-evidence',`${digest}.json`),'utf8')).toBe(JSON.stringify(original))
  })
  it('detects tampering and refuses arbitrary paths, symlinks and unsafe file permissions', () => {
    const dir=root(), store=createDocumentEvidence(dir), digest=store.put({text:'captured'})
    expect(()=>store.read('../outside')).toThrow()
    const file=join(dir,'document-evidence',`${digest}.json`)
    chmodSync(file,0o644); expect(()=>store.read(digest)).toThrow('document_evidence_permissions')
    chmodSync(file,0o600); writeFileSync(file,'{}'); expect(()=>store.read(digest)).toThrow('document_evidence_corrupt')
    const other='b'.repeat(64); symlinkSync(file,join(dir,'document-evidence',`${other}.json`))
    expect(()=>store.read(other)).toThrow()
  })
  it('repairs an owned incomplete final hash artifact with verified identical bytes', () => {
    const dir=root(), store=createDocumentEvidence(dir), value={text:'same immutable input'}, digest=store.put(value)
    const file=join(dir,'document-evidence',`${digest}.json`)
    writeFileSync(file,'')
    expect(()=>store.read(digest)).toThrow('document_evidence_corrupt')
    expect(store.put(value)).toBe(digest)
    expect(store.read(digest)).toEqual(value)
  })
  it('refuses a substituted evidence directory', () => {
    const dir=root(), target=root()
    symlinkSync(target,join(dir,'document-evidence'))
    expect(()=>createDocumentEvidence(dir)).toThrow('document_evidence_permissions')
  })
})
