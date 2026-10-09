import { STRINGS } from '@kikitori/core/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { engineOf } from '@kikitori/core/voices'
import { withEngineVoice } from './audio/voices'
import { AppContext, type App as AppValue, type AppDeps, type Route, type WordPick } from './context'
import { Cards } from './screens/Cards'
import { Import } from './screens/Import'
import { Library } from './screens/Library'
import { Lesson } from './screens/Lesson'
import { Settings } from './screens/Settings'
import { Stats } from './screens/Stats'
import { Study } from './screens/Study'
import { Today } from './screens/Today'
import { writeSettings, type MacSettings } from './settings'
import { Col, Pressable, Row, Text } from './ui/primitives'
import { C } from './ui/theme'
import { WordSheet } from './ui/WordSheet'

/** How often to ask a closed engine again for the chosen voice's character. */
const SPEAKER_RETRY_MS = 30_000

type Tab = 'today' | 'library' | 'cards' | 'stats' | 'settings'

/** The tab a route belongs to (a lesson, its study and Import live under Library). */
const tabOf = (route: Route): Tab => (route.name === 'lesson' || route.name === 'study' || route.name === 'import' ? 'library' : route.name)

function TabBar({ route, navigate, labels }: { route: Route; navigate: (r: Route) => void; labels: [Tab, string][] }) {
  const current = tabOf(route)
  return (
    <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 20, paddingRight: 20, height: 52, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.line }}>
      <Text size={17} ja weight={700} style={{ marginRight: 18 }}>
        聞き取り
      </Text>
      {labels.map(([name, label]) => (
        <Pressable
          key={name}
          testId={`tab-${name}`}
          onPress={() => navigate({ name })}
          style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 7, ...(current === name ? { backgroundColor: C.raised } : {}) }}
          hover={{ backgroundColor: C.hover }}
        >
          <Text color={current === name ? C.text : C.dim} weight={current === name ? 600 : 400}>
            {label}
          </Text>
        </Pressable>
      ))}
    </Row>
  )
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'today':
      return <Today />
    case 'library':
      return <Library />
    case 'import':
      return <Import />
    case 'cards':
      return <Cards />
    case 'stats':
      return <Stats />
    case 'settings':
      return <Settings />
    case 'lesson':
      return <Lesson id={route.id} />
    case 'study':
      return <Study id={route.id} free={route.free} />
  }
}

const routeKey = (route: Route) => (route.name === 'lesson' || route.name === 'study' ? `${route.name}-${route.id}-${'free' in route ? route.free : ''}` : route.name)

export function App({ deps, initialRoute = { name: 'today' } }: { deps: AppDeps; initialRoute?: Route }) {
  const [route, setRoute] = useState<Route>(initialRoute)
  const [word, setWord] = useState<WordPick | null>(null)
  const [settings, setSettings] = useState<MacSettings>(deps.settings)
  const navigate = useCallback((r: Route) => {
    setWord(null)
    setRoute(r)
  }, [])
  const updateSettings = useCallback(
    (patch: Partial<MacSettings>) =>
      setSettings((current) => {
        const next = { ...current, ...patch }
        writeSettings(deps.prefs, next)
        return next
      }),
    [deps.prefs],
  )
  const close = useCallback(() => setWord(null), [])
  // The voice is read at each sentence, so `audio` (and a study round's player) stays the same
  // object when it changes.
  const audio = useMemo(() => withEngineVoice(deps.audio, deps.voices), [deps.audio, deps.voices])
  // The credit names the voice's character (VOICEVOX's terms require it), so an engine voice
  // speaks only once its character is known; until then, the Mac's own.
  const { voiceURI, voiceSpeaker } = settings
  useEffect(() => audio.setVoice(voiceSpeaker ? voiceURI : undefined), [audio, voiceURI, voiceSpeaker])
  // A voice chosen while its engine was closed, or restored from a web backup, comes without its
  // character: ask its engine, again every so often until it answers (without the voice, if it
  // isn't installed there: Settings says so).
  useEffect(() => {
    if (!voiceURI || voiceSpeaker) return
    let live = true
    const ask = () =>
      deps.voices.probe().then(({ voices, up }) => {
        const speaker = voices.find((v) => v.id === voiceURI)?.speaker
        if (live && speaker) updateSettings({ voiceSpeaker: speaker })
        else if (up.includes(engineOf(voiceURI))) clearInterval(timer)
      })
    void ask()
    const timer = setInterval(ask, SPEAKER_RETRY_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [deps.voices, voiceURI, voiceSpeaker, updateSettings])
  const app: AppValue = useMemo(
    () => ({ ...deps, audio, settings, updateSettings, t: STRINGS[settings.lang], route, navigate, showWord: setWord }),
    [deps, audio, settings, updateSettings, route, navigate],
  )
  const { t } = app
  return (
    <AppContext.Provider value={app}>
      <Col style={{ height: '100%', backgroundColor: C.bg }}>
        <TabBar
          route={route}
          navigate={navigate}
          labels={[
            ['today', t.navToday],
            ['library', t.navLibrary],
            ['cards', t.navCards],
            ['stats', t.navStats],
            ['settings', t.navSettings],
          ]}
        />
        {/* One scroll area per screen: the key resets the scroll position on navigation. minHeight 0
            lets it shrink below its content (unlike CSS, the layout engine doesn't imply it). */}
        <Col testId="scroll" key={routeKey(route)} style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflowY: 'scroll' }}>
          <Col style={{ padding: 28, paddingBottom: 60, maxWidth: 860, width: '100%' }}>
            <Screen route={route} />
          </Col>
        </Col>
        {word && <WordSheet pick={word} onClose={close} />}
      </Col>
    </AppContext.Provider>
  )
}
