import { Link } from 'react-router-dom'

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Market insights', to: '/insights' },
      { label: 'News', to: '/news' },
      { label: 'Pricing', to: '/pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy', to: '/privacy' },
      { label: 'Terms of service', to: '/terms' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1 space-y-3">
            <Link to="/" className="text-lg font-bold text-emerald-700 dark:text-emerald-500">
              CropsIntel
            </Link>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
              Almond market intelligence for the global trading chain.
            </p>
          </div>
          {COLUMNS.map(({ heading, links }) => (
            <div key={heading} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {heading}
              </h3>
              <ul className="space-y-2">
                {links.map(({ label, to }) => (
                  <li key={to}>
                    <Link
                      to={to}
                      className="text-sm text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-400">
          © {new Date().getFullYear()} CropsIntel. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
