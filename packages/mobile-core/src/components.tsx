import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, space, TOUCH_TARGET, type } from './theme';

export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const content = <View style={[styles.screenInner, padded && styles.padded]}>{children}</View>;
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </KeyboardAvoidingView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityHint,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[variant],
        pressed && variant === 'primary' && { backgroundColor: colors.primaryPressed },
        pressed && variant !== 'primary' && { opacity: 0.75 },
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'danger' ? colors.onPrimary : colors.primary}
        />
      ) : (
        <Text style={[styles.buttonText, buttonTextStyles[variant]]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...props}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info' | 'warning';
  children: ReactNode;
}) {
  const bg = {
    error: colors.dangerSurface,
    success: colors.successSurface,
    info: colors.surface,
    warning: colors.warningSurface,
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      style={[styles.banner, { backgroundColor: bg }]}
    >
      <Text style={type.body}>{children}</Text>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={[type.title, { marginBottom: space.md }]}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={type.small}>{children}</Text>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>
      {children}
    </View>
  );
}

export function Badge({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const bg = {
    neutral: colors.border,
    success: colors.successSurface,
    warning: colors.warningSurface,
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenInner: { flex: 1 },
  padded: { padding: space.lg },
  button: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.xs,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { ...type.small, marginBottom: space.xs, color: colors.text, fontWeight: '600' },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 16,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  fieldError: { color: colors.danger, marginTop: space.xs, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.md,
  },
  banner: { borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
});

const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
});

const buttonTextStyles = StyleSheet.create({
  primary: { color: colors.onPrimary },
  secondary: { color: colors.primary },
  danger: { color: colors.onPrimary },
  ghost: { color: colors.primary },
});
