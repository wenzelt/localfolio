import postgres from 'postgres'
import { deleteAccountRequest, postAccountRequest } from '../../../src/accounts-routes'

const sql = postgres(process.env.DATABASE_URL ?? '')
const deps = () => ({ sql, secret: process.env.SESSION_SECRET ?? '', now: Date.now() })

export async function POST(request: Request) {
  return postAccountRequest(request, deps())
}

export async function DELETE(request: Request) {
  return deleteAccountRequest(request, deps())
}
