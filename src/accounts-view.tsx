import { AddAccountForm } from './add-account-form'
import { DeleteAccountControl } from './delete-account-control'

type Account = { id: string; name: string; currency: string; comment: string | null; transactions: number; positions: number }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const activity = (account: Account) => account.transactions === 0 ? 'No activity yet' : `${plural(account.positions, 'position')} · ${plural(account.transactions, 'transaction')}`

export function AccountsView({ accounts }: { accounts: Account[] }) {
  return <>
    <header><a href="/" className="brand"><span>Localfolio</span></a><div className="actions"><a className="back" href="/">Back to portfolio</a></div></header>
    <main>
      <section className="card accounts">
        <h1>Accounts</h1>
        {accounts.length === 0 ? <p className="muted">No accounts yet. Add one below, then record buys or import positions.</p>
          : <ul className="account-list">{accounts.map((account) => <li key={account.id}>
            <div><strong>{account.name}</strong> <span className="muted">{account.currency}</span>
              {account.comment && <small>{account.comment}</small>}
              <small>{activity(account)}</small></div>
            <DeleteAccountControl accountId={account.id} name={account.name} transactions={account.transactions} />
          </li>)}</ul>}
        <h2>Add an account</h2>
        <AddAccountForm />
      </section>
    </main>
  </>
}
