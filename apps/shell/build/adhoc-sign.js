// electron-builder afterSign hook: contributor builds have no distribution
// identity, but an ad-hoc signature still seals the app bundle so macOS can
// verify that the packaged files were not modified after assembly.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = function (context) {
  if (process.platform !== 'darwin' || process.env.OPEN_GENOFFICE_MAC_IDENTITY?.trim()) return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const entitlements = join(__dirname, 'entitlements.mac.plist')
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, appPath],
    { stdio: 'inherit' },
  )
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
