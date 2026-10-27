import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { listAccountSummaries } from '../../src/accounts'
import { AccountsView } from '../../src/accounts-view'
import { openReadOnly } from '../../src/valuation-cli'
import { authenticated } from '../../src/web-auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Accounts' }
const sql = openReadOnly(process.env.DATABASE_URL ?? '')

export default async function Page() {
  if (!authenticated((await cookies()).toString(), process.env.SESSION_SECRET ?? '', Date.now())) redirect('/login')
  return <AccountsView accounts={await listAccountSummaries(sql)} />
}
