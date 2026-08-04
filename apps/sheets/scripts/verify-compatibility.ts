import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { applyPlanToXlsx } from '../src/gateway/xlsx-gateway'
import type { ChangePlan } from '../src/domain/workbook.types'

async function main(): Promise<void> {
  const fixturePath = resolve('fixtures/generated/compatibility-basic.xlsx')
  const source = await readFile(fixturePath)
  const plan: ChangePlan = {
    transactionId: 'compatibility-check',
    baseRevision: 0,
    cellChanges: [{
      sheetId: 'sheet-1',
      address: 'A1',
      before: { value: 'Old' },
      after: { value: 'Verified' },
    }],
    sheetRenames: [],
    structuralChanges: [],
    formatChanges: [],
    warnings: [],
  }
  const mutation = await applyPlanToXlsx(source, plan, { 'sheet-1': 'Sheet1' })
  const beforeByPath = new Map(mutation.beforeEntries.map((entry) => [entry.path, entry.sha256]))
  const changedEntries = mutation.afterEntries
    .filter((entry) => beforeByPath.get(entry.path) !== entry.sha256)
    .map((entry) => entry.path)
  const unexpectedChanges = changedEntries.filter((path) => !mutation.touchedEntries.includes(path))
  const report = {
    fixture: 'compatibility-basic.xlsx',
    passed: unexpectedChanges.length === 0,
    touchedEntries: mutation.touchedEntries,
    changedEntries,
    unexpectedChanges,
    preservedEntryCount: mutation.afterEntries.length - changedEntries.length,
  }

  await mkdir(resolve('reports'), { recursive: true })
  await writeFile(resolve('reports/compatibility.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.passed) process.exitCode = 1
}

void main()
