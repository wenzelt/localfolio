#!/usr/bin/env node
// Use the PostgreSQL tools shipped with the Compose database, so no host client installation is needed.
import { spawnSync } from 'node:child_process'
import { closeSync, openSync, unlinkSync } from 'node:fs'

function docker(args, input = 'ignore', output = 'pipe') {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'db', ...args], { stdio: [input, output, 'pipe'] })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr?.toString().trim() || 'PostgreSQL transfer failed')
  return result.stdout?.toString().trim()
}

const [operation, file, database = 'portfolio', ...extra] = process.argv.slice(2)
let descriptor
let partialBackup = false
try {
  if (!['backup', 'restore'].includes(operation) || !file || extra.length > 0 || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(database)) {
    throw new Error('Usage: node scripts/portfolio-transfer.mjs <backup|restore> <file.dump> [database=portfolio]')
  }
  if (operation === 'backup') {
    // Exclusive creation protects old backups; the archive contains private financial records.
    descriptor = openSync(file, 'wx', 0o600)
    partialBackup = true
    docker(['pg_dump', '-U', 'portfolio', '-d', database, '--format=custom', '--no-owner', '--no-acl'], 'ignore', descriptor)
    partialBackup = false
    console.log(`Backup saved to ${file}. Keep this private; it contains your full portfolio.`)
  } else {
    descriptor = openSync(file, 'r')
    const objects = docker(['psql', '-U', 'portfolio', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc',
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'"])
    if (objects !== '0') throw new Error('Restore requires an empty database. Stop app/workers and use a fresh database; existing data will not be overwritten.')
    // No --clean: never delete existing data. An error rolls the entire restore back.
    docker(['pg_restore', '-U', 'portfolio', '-d', database, '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl'], descriptor, 'ignore')
    console.log(`Restored ${file} into ${database}.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Portfolio transfer failed')
  process.exitCode = 1
} finally {
  if (descriptor !== undefined) closeSync(descriptor)
  if (partialBackup) unlinkSync(file)
}
