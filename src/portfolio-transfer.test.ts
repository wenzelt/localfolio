import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const suffix = crypto.randomUUID().replaceAll('-', '')
const source = `portfolio_transfer_test_source_${suffix}`
const target = `portfolio_transfer_test_target_${suffix}`
const directory = mkdtempSync(join(tmpdir(), 'portfolio-transfer-'))
const archive = join(directory, 'portfolio.dump')
const docker = (...args: string[]) => execFileSync('docker', ['compose', 'exec', '-T', 'db', ...args], { encoding: 'utf8' })
const sql = (database: string, statement: string) => docker('psql', '-U', 'portfolio', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', statement).trim()
const transfer = (...args: string[]) => spawnSync(process.execPath, ['scripts/portfolio-transfer.mjs', ...args], { encoding: 'utf8' })

describe('portable full-state backup and restore', () => {
  beforeAll(() => {
    docker('createdb', '-U', 'portfolio', source)
    docker('createdb', '-U', 'portfolio', target)
    sql(source, `
      CREATE TABLE accounts (id text PRIMARY KEY, name text, is_excluded boolean);
      CREATE TABLE transactions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id text REFERENCES accounts(id), quantity numeric, occurred_at timestamptz);
      CREATE TABLE security_quotes (symbol text PRIMARY KEY, price numeric);
      INSERT INTO accounts VALUES ('a', 'Broker', false), ('b', 'Excluded', true);
      INSERT INTO transactions (account_id, quantity, occurred_at) VALUES ('a', 0.123456789123456789, '2026-01-02T10:11:12Z');
      INSERT INTO security_quotes VALUES ('EXAMPLE', 123.456789);
    `)
  }, 30_000)

  afterAll(() => {
    docker('dropdb', '-U', 'portfolio', '--if-exists', source)
    docker('dropdb', '-U', 'portfolio', '--if-exists', target)
    rmSync(directory, { recursive: true, force: true })
  }, 30_000)

  it('round-trips settings, exact decimals, history, caches, constraints and sequence state', () => {
    const saved = transfer('backup', archive, source)
    expect(saved.status, saved.stderr).toBe(0)
    expect(readFileSync(archive).subarray(0, 5).toString()).toBe('PGDMP')
    expect(statSync(archive).mode & 0o777).toBe(0o600)
    const restored = transfer('restore', archive, target)
    expect(restored.status, restored.stderr).toBe(0)
    expect(sql(target, "SELECT name || ':' || is_excluded::text FROM accounts ORDER BY id")).toBe('Broker:false\nExcluded:true')
    expect(sql(target, 'SELECT quantity::text FROM transactions')).toBe('0.123456789123456789')
    expect(sql(target, "SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') FROM transactions")).toBe('2026-01-02 10:11:12')
    expect(sql(target, 'SELECT price::text FROM security_quotes')).toBe('123.456789')
    expect(sql(target, "INSERT INTO transactions (account_id, quantity) VALUES ('a', 2) RETURNING id")).toContain('2')
    expect(sql(target, "SELECT count(*) FROM pg_constraint WHERE conrelid = 'transactions'::regclass")).toBe('2')
  }, 30_000)

  it('refuses to overwrite an existing backup file', () => {
    const path = join(directory, 'existing.dump')
    writeFileSync(path, 'keep me')
    expect(transfer('backup', path, source).status).not.toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('keep me')
  })

  it('refuses restoring into a populated database without changing it', () => {
    const result = transfer('restore', archive, source)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('empty database')
    expect(sql(source, 'SELECT count(*) FROM transactions')).toBe('1')
  })

  it('rejects an invalid archive without leaving partial tables', () => {
    const bad = join(directory, 'invalid.dump')
    writeFileSync(bad, 'not a PostgreSQL archive')
    sql(target, 'DROP TABLE IF EXISTS transactions, accounts, security_quotes')
    const result = transfer('restore', bad, target)
    expect(result.status).not.toBe(0)
    expect(sql(target, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v')")).toBe('0')
  })

  it('removes partial backups when the source cannot be dumped', () => {
    const path = join(directory, 'partial.dump')
    expect(transfer('backup', path, `missing_${suffix}`).status).not.toBe(0)
    expect(existsSync(path)).toBe(false)
  })

  it('rejects missing arguments and unknown operations', () => {
    expect(transfer().status).not.toBe(0)
    expect(transfer('delete', archive, source).status).not.toBe(0)
  })
})
