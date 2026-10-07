import { STRINGS } from '@kikitori/core/i18n'
import { useCallback, useMemo, useState } from 'react'
import { AppContext, type App as AppValue, type AppDeps, type Route, type WordPick } from './context'
import { Library } from './screens/Library'
import { Lesson } from './screens/Lesson'
import { Study } from './screens/Study'
import { Today } from './screens/Today'
import { Col, Pressable, Row, Text } from './ui/primitives'
import { C } from './ui/theme'
import { WordSheet } from './ui/WordSheet'

function TabBar({ route, navigate, labels }: { route: Route; navigate: (r: Route) => void; labels: [Route['name'], string][] }) {
  const current = route.name === 'lesson' || route.name === 'study' ? 'library' : route.name
  return (
    <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 20, paddingRight: 20, height: 52, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.line }}>
      <Text size={17} ja weight={700} style={{ marginRight: 18 }}>
        聞き取り
      </Text>
      {labels.map(([name, label]) => (
        <Pressable
          key={name}
          testId={`tab-${name}`}
          onPress={() => navigate({ name } as Route)}
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

export function App({ deps, initialRoute = { name: 'today' } }: { deps: AppDeps; initialRoute?: Route }) {
  const [route, setRoute] = useState<Route>(initialRoute)
  const [word, setWord] = useState<WordPick | null>(null)
  const navigate = useCallback((r: Route) => {
    setWord(null)
    setRoute(r)
  }, [])
  const close = useCallback(() => setWord(null), [])
  const app: AppValue = useMemo(() => ({ ...deps, t: STRINGS[deps.settings.lang], route, navigate, showWord: setWord }), [deps, route, navigate])
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
          ]}
        />
        {/* One scroll area per screen: the key resets the scroll position on navigation. minHeight 0
            lets it shrink below its content (unlike CSS, the layout engine doesn't imply it). */}
        <Col testId="scroll" key={route.name === 'lesson' || route.name === 'study' ? `${route.name}-${route.id}-${'free' in route ? route.free : ''}` : route.name} style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflowY: 'scroll' }}>
          <Col style={{ padding: 28, paddingBottom: 60, maxWidth: 860, width: '100%' }}>
            {route.name === 'today' ? <Today /> : route.name === 'library' ? <Library /> : route.name === 'lesson' ? <Lesson id={route.id} /> : <Study id={route.id} free={route.free} />}
          </Col>
        </Col>
        {word && <WordSheet pick={word} onClose={close} />}
      </Col>
    </AppContext.Provider>
  )
}
