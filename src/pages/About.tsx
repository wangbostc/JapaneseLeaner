import { useSettings } from '../app/useSettings'

const SOURCES: { name: string; use: string; licence: string; href: string }[] = [
  {
    name: 'JMdict',
    use: 'Word meanings. © Electronic Dictionary Research and Development Group.',
    licence: 'CC BY-SA 4.0',
    href: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
  },
  {
    name: 'jmdict-simplified',
    use: 'JMdict in JSON form.',
    licence: 'CC BY-SA 4.0',
    href: 'https://github.com/scriptin/jmdict-simplified',
  },
  {
    name: 'kuromoji.js',
    use: 'Japanese tokenizer (readings, dictionary forms, furigana).',
    licence: 'Apache 2.0',
    href: 'https://github.com/takuyaa/kuromoji.js',
  },
  {
    name: 'IPADIC (mecab-ipadic)',
    use: "Tokenizer dictionary bundled with kuromoji. © NAIST.",
    licence: 'IPADIC licence',
    href: 'https://github.com/takuyaa/kuromoji.js/blob/master/NOTICE.md',
  },
  { name: 'ts-fsrs', use: 'Flashcard scheduling (FSRS).', licence: 'MIT', href: 'https://github.com/open-spaced-repetition/ts-fsrs' },
  {
    name: 'Echo Loop',
    use: 'Inspiration for the training method. No code or assets are used.',
    licence: 'AGPL-3.0 (not incorporated)',
    href: 'https://github.com/echo-loop/Echo-Loop',
  },
]

export function About() {
  const { t } = useSettings()
  return (
    <div className="page">
      <h1>{t.about}</h1>
      <p>{t.aboutBody}</p>
      <h2 className="section-label">{t.sourcesTitle}</h2>
      <ul className="support sources">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <div>
              <a href={s.href} target="_blank" rel="noreferrer">
                {s.name}
              </a>
              <div className="muted small">{s.use}</div>
            </div>
            <span className="muted small">{s.licence}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        JMdict data is used under the{' '}
        <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">
          EDRDG licence
        </a>{' '}
        (CC BY-SA 4.0).
      </p>
    </div>
  )
}
