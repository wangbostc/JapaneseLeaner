import { formRange, tatoebaUrl } from '@kikitori/core/examples'
import { useAnalyzer } from '../app/useAnalyzer'
import { useDictionary, useExamples } from '../app/useDictionary'
import { useSettings } from '../app/useSettings'
import { speak } from '../lib/speech'
import { Icon } from './Icon'
import { JapaneseText } from './JapaneseText'

/**
 * Example sentences for a word (from JMdict, which takes them from Tatoeba), each with its word
 * marked, its translation and a link to its Tatoeba page. Nothing for a word without any.
 */
export function ExampleSentences({ word, reading }: { word: string; reading?: string }) {
  const { t, settings } = useSettings()
  const dict = useDictionary()
  const examples = useExamples()
  const analyzer = useAnalyzer()
  const entry = dict?.lookup(word, reading)[0]
  const found = entry && examples ? examples.of(entry) : []
  if (!found.length) return null
  return (
    <div className="examples" data-testid="examples">
      <h3>{t.examples}</h3>
      <ul>
        {found.map((e) => (
          <li key={e.tatoebaId} data-testid="example">
            <div className="example-ja">
              <JapaneseText text={e.ja} analyzer={analyzer.status === 'ready' ? analyzer.analyzer : null} furigana={settings.furigana} mark={formRange(e)} />
              <button type="button" className="btn ghost icon-only" aria-label={t.playExample} onClick={() => speak(e.ja, settings.rate, settings.voiceURI)}>
                <Icon name="play" />
              </button>
            </div>
            <p className="translation">{e.en}</p>
            <a className="example-source" href={tatoebaUrl(e.tatoebaId)} target="_blank" rel="noreferrer">
              {t.exampleSource(e.tatoebaId)}
            </a>
          </li>
        ))}
      </ul>
      <p className="meanings-note">{t.examplesNote}</p>
    </div>
  )
}
