import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { BuyView } from '../../src/buy-view'
import { listAccounts } from '../../src/ledger-entry'
import { openReadOnly } from '../../src/valuation-cli'
import { authenticated } from '../../src/web-auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add a buy' }
const sql = openReadOnly(process.env.DATABASE_URL ?? '')

export default async function Page({ searchParams }: { searchParams: Promise<{ account?: string; symbol?: string }> }) {
  if (!authenticated((await cookies()).toString(), process.env.SESSION_SECRET ?? '', Date.now())) redirect('/login')
  const { account, symbol } = await searchParams
  return <BuyView accounts={await listAccounts(sql)} today={new Date().toISOString().slice(0, 10)} account={account} symbol={symbol} />
}
