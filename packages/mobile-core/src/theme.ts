/** Saheli visual identity: berry and saffron on a warm off-white. */
export const colors = {
  primary: '#7A1F5C',
  primaryPressed: '#5E1747',
  onPrimary: '#FFFFFF',
  accent: '#E8892B',
  background: '#FBF7F9',
  surface: '#FFFFFF',
  text: '#1F1720',
  textMuted: '#6B5E68',
  border: '#E8DDE4',
  danger: '#B42318',
  dangerSurface: '#FDECEA',
  success: '#2E7D32',
  successSurface: '#E8F5E9',
  warningSurface: '#FFF4E5',
  sos: '#C62828',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const type = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, color: colors.text },
  small: { fontSize: 14, color: colors.textMuted },
  mono: { fontSize: 32, fontWeight: '700' as const, letterSpacing: 8, color: colors.text },
};

/** Minimum touch target (Android guidance: 48dp). */
export const TOUCH_TARGET = 48;
