'use client'

import { ErrorNotice } from '../src/error-notice'

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorNotice error={error} retry={retry} />
}
