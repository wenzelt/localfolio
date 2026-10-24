import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { healthResponse } from './health'

const url = new URL(process.env.DATABASE_URL!)
url.pathname = '/portfolio_test'
const sql = postgres(url.toString())
afterAll(() => sql.end())

describe('healthResponse', () => {
  it('reports healthy when the database answers', async () => {
    const response = await healthResponse(sql)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('reports unavailable without leaking the error when the database fails', async () => {
    const broken = (() => Promise.reject(new Error('password authentication failed for user portfolio'))) as unknown as Sql
    const response = await healthResponse(broken)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unavailable' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('reports unavailable when the database does not answer in time', async () => {
    const hung = (() => new Promise(() => {})) as unknown as Sql
    const response = await healthResponse(hung, 20)
    expect(response.status).toBe(503)
  })
})
