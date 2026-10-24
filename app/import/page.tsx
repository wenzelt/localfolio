import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { authenticated } from '../../src/web-auth'
import { PositionsImportView } from '../../src/positions-import-view'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import positions' }

export default async function Page() {
  if (!authenticated((await cookies()).toString(), process.env.SESSION_SECRET ?? '', Date.now())) redirect('/login')
  return <PositionsImportView />
}
