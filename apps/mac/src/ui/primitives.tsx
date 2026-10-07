import type { StyleDesc } from '@gpuix/react'
import type { ReactNode } from 'react'
import { C, FONT_JA, FONT_UI } from './theme'

type Style = StyleDesc & Record<string, unknown>

interface TextProps {
  children?: ReactNode
  size?: number
  color?: string
  weight?: number
  /** Japanese text: set in a Japanese font. */
  ja?: boolean
  style?: Style
  testId?: string
}

/** Text with a colour and font always set: gpuix doesn't inherit them, and paints none by default. */
export function Text({ children, size = 14, color = C.text, weight, ja, style, testId }: TextProps) {
  return (
    <text testId={testId} style={{ fontSize: size, color, fontFamily: ja ? FONT_JA : FONT_UI, ...(weight ? { fontWeight: weight } : {}), ...style }}>
      {children}
    </text>
  )
}

interface BoxProps {
  children?: ReactNode
  style?: Style
  testId?: string
}

/** Flex boxes: gpuix ignores flexDirection unless display is flex. */
export const Row = ({ children, style, testId }: BoxProps) => (
  <div testId={testId} style={{ display: 'flex', flexDirection: 'row', ...style }}>
    {children}
  </div>
)
export const Col = ({ children, style, testId }: BoxProps) => (
  <div testId={testId} style={{ display: 'flex', flexDirection: 'column', ...style }}>
    {children}
  </div>
)

interface PressableProps extends BoxProps {
  onPress?: () => void
  hover?: Style
  disabled?: boolean
}

/** Something to click (gpuix 0.10 has no Button): a box with a pointer and a hover style. */
export function Pressable({ children, style, testId, onPress, hover, disabled }: PressableProps) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : () => onPress?.()}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', cursor: disabled ? 'default' : 'pointer', ...style, ...(disabled ? { opacity: 0.5 } : { hover: { ...hover } }) }}
    >
      {children}
    </div>
  )
}

type Variant = 'primary' | 'plain' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, [Style, Style, string]> = {
  primary: [{ backgroundColor: C.accent }, { backgroundColor: C.accentHover }, '#ffffff'],
  plain: [{ backgroundColor: C.raised }, { backgroundColor: C.hover }, C.text],
  ghost: [{}, { backgroundColor: C.raised }, C.dim],
  danger: [{ backgroundColor: C.dangerBg }, { backgroundColor: '#4a2a2d' }, C.danger],
}

export function Button({ label, onPress, variant = 'plain', testId, disabled }: { label: string; onPress: () => void; variant?: Variant; testId?: string; disabled?: boolean }) {
  const [base, hover, color] = VARIANTS[variant]
  return (
    <Pressable testId={testId} onPress={onPress} disabled={disabled} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 8, ...base }} hover={hover}>
      <Text color={color} weight={500}>
        {label}
      </Text>
    </Pressable>
  )
}

export function Pill({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', paddingLeft: 7, paddingRight: 7, paddingTop: 1, paddingBottom: 1, borderRadius: 9, backgroundColor: accent ? '#1f3358' : C.raised }}>
      <Text size={11} color={accent ? C.ruby : C.dim} weight={600}>
        {label}
      </Text>
    </div>
  )
}
