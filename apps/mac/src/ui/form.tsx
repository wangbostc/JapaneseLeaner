import type { ReactNode } from 'react'
import { Col, Pressable, Row, Text } from './primitives'
import { C, FONT_JA } from './theme'

/** A labelled field, with an optional hint under it. */
export function Field({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <Col style={{ gap: 6 }}>
      <Text weight={600}>{label}</Text>
      {children}
      {hint && (
        <Text size={12} color={C.dim}>
          {hint}
        </Text>
      )}
    </Col>
  )
}

const boxStyle = { fontSize: 15, fontFamily: FONT_JA, color: C.text, padding: 10, borderRadius: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line }

/** A one-line text box; `readOnly` shows its value dimmed, unchangeable. */
export function TextField({ value, onChange, placeholder, testId, readOnly }: { value: string; onChange: (v: string) => void; placeholder?: string; testId?: string; readOnly?: boolean }) {
  return (
    <input
      testId={testId}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => !readOnly && onChange(e.value ?? '')}
      theme={{ caret: C.accent }}
      style={readOnly ? { ...boxStyle, color: C.dim } : boxStyle}
    />
  )
}

export function TextArea({ value, onChange, rows = 6, testId }: { value: string; onChange: (v: string) => void; rows?: number; testId?: string }) {
  return <textarea testId={testId} value={value} minRows={rows} maxRows={rows * 3} onChange={(e) => onChange(e.value ?? '')} theme={{ caret: C.accent }} style={boxStyle} />
}

/** A switch with its label. */
export function Toggle({ label, on, onChange, testId }: { label: string; on: boolean; onChange: (on: boolean) => void; testId?: string }) {
  return (
    <Pressable testId={testId} onPress={() => onChange(!on)} style={{ gap: 12, paddingTop: 4, paddingBottom: 4 }}>
      <Row style={{ width: 38, height: 22, borderRadius: 11, padding: 2, backgroundColor: on ? C.accent : C.line, justifyContent: on ? 'flex-end' : 'flex-start' }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#ffffff' }} />
      </Row>
      <Text>{label}</Text>
    </Pressable>
  )
}

/** One choice of a few, as joined buttons. */
export function Choice<T extends string | number>({ options, value, onChange, testId }: { options: [T, string][]; value: T; onChange: (v: T) => void; testId?: string }) {
  return (
    <Row testId={testId} style={{ gap: 2, padding: 2, borderRadius: 9, backgroundColor: C.panel, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {options.map(([v, label]) => (
        <Pressable
          key={String(v)}
          testId={testId && `${testId}-${v}`}
          onPress={() => onChange(v)}
          style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 7, ...(v === value ? { backgroundColor: C.raised } : {}) }}
          hover={{ backgroundColor: C.hover }}
        >
          <Text color={v === value ? C.text : C.dim} weight={v === value ? 600 : 400}>
            {label}
          </Text>
        </Pressable>
      ))}
    </Row>
  )
}
