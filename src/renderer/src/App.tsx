import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import ResourcesPage from './pages/ResourcesPage'
import ChatPage from './pages/ChatPage'
import StagentPage from './pages/StagentPage'
import TabBar from './components/TabBar'
import type { SiteWithStatus } from '../../preload/index.d'

export type Page = '/resources' | '/chat' | '/stagent'

// ─── Navigation Context ───────────────────────────────────────────────────────

interface NavigationContextValue {
  go: (page: Page) => void
}

export const NavigationContext = createContext<NavigationContextValue>({
  go: () => {},
})

/** Hook for child components to navigate between pages. */
export function useNavigation(): NavigationContextValue {
  return useContext(NavigationContext)
}

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page | null>(null) // null = determining
  // Incrementing this key forces ResourcesPage to remount (clearing any
  // in-progress login state) whenever the user clicks the ⚙ button.
  const [resourcesKey, setResourcesKey] = useState(0)
  // M9/M10: site list and active site ID lifted to App level so TabBar can
  // read them without duplicating IPC calls.
  const [sites, setSites] = useState<SiteWithStatus[]>([])
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null)

  const navValue: NavigationContextValue = { go: setPage as (p: Page) => void }

  // ── Refresh sites list ───────────────────────────────────────────────
  // Only auto-switches activeSiteId when it is null (initial load) or when
  // the previously-active site has been fully removed from the store.
  // Deliberately does NOT auto-switch on quota-exhausted so the user sees
  // the exhaustion notice and can choose which account to switch to.
  const loadSites = useCallback(() => {
    window.autoAI.site.list().then((list) => {
      setSites(list)
      setActiveSiteId((prev) => {
        if (prev === null) {
          return list.filter((s) => s.status === 'connected')[0]?.siteId ?? null
        }
        if (list.find((s) => s.siteId === prev)) return prev
        return list.filter((s) => s.status === 'connected')[0]?.siteId ?? null
      })
    }).catch(() => {})
  }, [])

  // ── Determine initial page + first site load ─────────────────────────
  useEffect(() => {
    window.autoAI.site.list().then((list) => {
      setSites(list)
      setActiveSiteId(list.filter((s) => s.status === 'connected')[0]?.siteId ?? null)
      setPage(list.length > 0 ? '/chat' : '/resources')
    }).catch(() => setPage('/resources'))
  }, [])

  // ── Keep site list fresh on any status change ────────────────────────
  useEffect(() => {
    return window.autoAI.site.onStatusChanged(() => loadSites())
  }, [loadSites])

  // ── Remove a site tab — calls IPC then refreshes ─────────────────────
  const handleRemoveSite = useCallback(async (siteId: string) => {
    await window.autoAI.site.remove(siteId)
    loadSites()
  }, [loadSites])

  // ── Navigate to settings ─────────────────────────────────────────────
  const goSettings = useCallback(async () => {
    await window.autoAI.site.closeAllLogins().catch(() => {})
    setResourcesKey((k) => k + 1)
    setPage('/resources')
  }, [])

  if (page === null) return <div className="h-screen bg-white" />

  return (
    <NavigationContext.Provider value={navValue}>
      <div className="flex flex-col h-screen bg-white">
        {/* Title bar — TabBar on /chat, Stagent header on /stagent, gear header on /resources */}
        {page === '/chat' ? (
          <TabBar
            sites={sites}
            activeSiteId={activeSiteId}
            onActiveSiteIdChange={setActiveSiteId}
            onAddSite={() => setPage('/resources')}
            onRemoveSite={handleRemoveSite}
            onSettings={goSettings}
            onOpenStagent={() => setPage('/stagent')}
          />
        ) : page === '/stagent' ? (
          <div className="drag-region h-10 flex items-center shrink-0 bg-white border-b border-gray-100">
            <div className="w-20 shrink-0" />
            <span className="text-sm font-semibold text-gray-700 select-none">Stagent 工作流</span>
            <div className="flex-1" />
            <button
              className="no-drag h-7 px-2 rounded-md mr-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              onClick={() => setPage('/chat')}
            >
              聊天
            </button>
            <button
              className="no-drag flex items-center justify-center w-7 h-7 rounded-md mr-3 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0"
              onClick={goSettings}
              title="AI 资源设置"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.929 2.929l.99.99M10.081 10.081l.99.99M10.081 3.919l-.99.99M3.919 10.081l-.99.99"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ) : (
          <div className="drag-region h-10 flex items-center justify-between shrink-0 bg-white border-b border-gray-100">
            {/* Spacer for traffic lights */}
            <div className="w-20 shrink-0" />
            {/* Cancel button — visible above the WebContentsView when a login
                overlay is on-screen (loginVisible=true → status='loading').
                This is the only React element the user can click in that state. */}
            {sites.some((s) => s.status === 'loading') && (
              <button
                className="no-drag text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2 transition-colors"
                onClick={goSettings}
              >
                取消登录
              </button>
            )}
            <button
              className="no-drag h-7 px-2 rounded-md mr-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              onClick={() => setPage('/stagent')}
            >
              工作流
            </button>
            <button
              className="no-drag flex items-center justify-center w-7 h-7 rounded-md mr-3 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0"
              onClick={goSettings}
              title="AI 资源设置"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.929 2.929l.99.99M10.081 10.081l.99.99M10.081 3.919l-.99.99M3.919 10.081l-.99.99"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {page === '/chat' ? (
            <ChatPage
              activeSiteId={activeSiteId}
              onActiveSiteIdChange={setActiveSiteId}
            />
          ) : page === '/stagent' ? (
            <StagentPage />
          ) : (
            <ResourcesPage key={resourcesKey} />
          )}
        </div>
      </div>
    </NavigationContext.Provider>
  )
}
