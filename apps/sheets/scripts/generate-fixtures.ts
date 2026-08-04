import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { buildCompatibilityFixture } from '../tests/fixture-builder'

async function main(): Promise<void> {
  const outputDirectory = resolve('fixtures/generated')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(resolve(outputDirectory, 'compatibility-basic.xlsx'), await buildCompatibilityFixture())
  process.stdout.write('Generated fixtures/generated/compatibility-basic.xlsx\n')
}

void main()
