// Fails when a color literal appears in src outside the token blocks (:root and :root[data-theme]) of index.css.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/
const failures = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(tsx?|css)$/.test(name)) check(path)
  }
}

function check(path) {
  let inRoot = false
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (path.endsWith('index.css')) {
        if (/^\s*:root(\[[^\]]*\])?\s*\{/.test(line)) inRoot = true
        else if (inRoot && /^\s*\}/.test(line)) {
          inRoot = false
          return
        }
        if (inRoot) return
      }
      if (COLOR.test(line)) failures.push(`${path}:${i + 1}: ${line.trim()}`)
    })
}

walk('src')
if (failures.length > 0) {
  console.error('Color literals outside the :root block:\n' + failures.join('\n'))
  process.exit(1)
}
