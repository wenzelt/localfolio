// In production the framework hides a server error's message and passes only a reference (the digest) that matches a line in the app log.
// After a Docker or host restart the usual cause is a stopped database, so the page says that first and shows how to check it.
export function ErrorNotice({ error, retry }: { error: unknown; retry: () => void }) {
  const reference = error instanceof Error && 'digest' in error && typeof error.digest === 'string' ? error.digest : null
  return <main className="login"><section className="card">
    <p className="brand">Localfolio</p>
    <h1>This page could not load</h1>
    <p className="muted">The most common cause is that the database is not running. On the server, check it and start it if needed:</p>
    <p><code>docker compose ps</code></p>
    <p><code>docker compose up -d --wait db</code></p>
    <p className="muted">Your saved data stays in the database volume. If the database is running, the app log names the cause:</p>
    <p><code>docker compose --profile app logs app --tail 50</code></p>
    {reference && <p className="muted">Error reference to look for in that log: <code>{reference}</code></p>}
    <button type="button" onClick={() => retry()}>Try again</button>
  </section></main>
}
