import { useEffect } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useSettings } from './app/useSettings'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Icon, type IconName } from './components/Icon'
import { seedOnce } from './lib/seed'
import { store } from './lib/store'
import { Cards } from './pages/Cards'
import { Import } from './pages/Import'
import { LessonPage } from './pages/LessonPage'
import { Library } from './pages/Library'
import { SettingsPage } from './pages/SettingsPage'
import { Stats } from './pages/Stats'
import { Study } from './pages/Study'
import { Today } from './pages/Today'

function Shell() {
  const { t } = useSettings()
  const { pathname } = useLocation()
  const studying = pathname.endsWith('/study')
  const tabs: [string, IconName, string][] = [
    ['/', 'home', t.navToday],
    ['/library', 'book', t.navLibrary],
    ['/cards', 'cards', t.navCards],
    ['/stats', 'chart', t.navStats],
    ['/settings', 'gear', t.navSettings],
  ]
  return (
    <div className={`shell ${studying ? 'studying' : ''}`}>
      {!studying && (
        <nav className="tabs">
          <span className="brand" lang="ja">
            聞き取り<small>{t.appName}</small>
          </span>
          {tabs.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className="tab">
              <Icon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      <main>
        <ErrorBoundary key={pathname} t={t}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/library" element={<Library />} />
          <Route path="/import" element={<Import />} />
          <Route path="/lesson/:id" element={<LessonPage />} />
          <Route path="/lesson/:id/study" element={<Study />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  )
}

export function App() {
  useEffect(() => {
    seedOnce(store)
    // Ask the browser not to evict our IndexedDB under storage pressure;
    // everything the learner has done lives only there.
    navigator.storage?.persist?.().catch(() => {})
  }, [])
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
