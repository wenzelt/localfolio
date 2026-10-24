import { LoginForm } from '../../src/dashboard'

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <LoginForm error={(await searchParams).error === '1'} />
}
