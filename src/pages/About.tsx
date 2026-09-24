import { useSettings } from '../app/useSettings'

// `use` is a key into t.sourceUses, so the descriptions follow the UI language.
const SOURCES: { name: string; use: string; licence: string; href: string }[] = [
  {
    name: 'JMdict',
    use: 'jmdict',
    licence: 'CC BY-SA 4.0',
    href: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
  },
  {
    name: 'jmdict-simplified',
    use: 'jmdictSimplified',
    licence: 'CC BY-SA 4.0',
    href: 'https://github.com/scriptin/jmdict-simplified',
  },
  {
    name: 'kuromoji.js',
    use: 'kuromoji',
    licence: 'Apache 2.0',
    href: 'https://github.com/takuyaa/kuromoji.js',
  },
  {
    name: 'IPADIC (mecab-ipadic)',
    use: 'ipadic',
    licence: 'IPADIC licence',
    href: 'https://github.com/takuyaa/kuromoji.js/blob/master/NOTICE.md',
  },
  { name: 'Whisper (OpenAI)', use: 'whisper', licence: 'MIT', href: 'https://github.com/openai/whisper' },
  { name: 'Transformers.js', use: 'transformers', licence: 'Apache 2.0', href: 'https://github.com/huggingface/transformers.js' },
  { name: 'ts-fsrs', use: 'fsrs', licence: 'MIT', href: 'https://github.com/open-spaced-repetition/ts-fsrs' },
  {
    name: 'Echo Loop',
    use: 'echoLoop',
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
              <div className="muted small">{t.sourceUses[s.use]}</div>
            </div>
            <span className="muted small">{s.licence}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">
          {t.jmdictLicence}
        </a>
      </p>
      <p className="muted small">
        <a href={`${import.meta.env.BASE_URL}licenses/kuromoji-ipadic-NOTICE.txt`} target="_blank" rel="noreferrer">
          {t.ipadicNotice}
        </a>
      </p>
    </div>
  )
}
