// 通用搜索框：放大镜 + 清除按钮（对齐桌面端 NotesListWindow SearchBox 的入口形态）
import { memo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useShellPalette } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT, TOUCH_TARGET } from '../constants/metrics';

export interface SearchBarProps {
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  /** 键盘搜索键回调（通常用于收起键盘） */
  onSubmit?: () => void;
}

export const SearchBar = memo(function SearchBar({
  value,
  placeholder,
  onChangeText,
  onSubmit,
}: SearchBarProps) {
  const p = useShellPalette();
  const hasText = value.length > 0;

  return (
    <View style={[styles.wrap, { backgroundColor: p.surface, borderColor: p.border }]}>
      <Ionicons name="search-outline" size={18} color={p.secondaryText} />
      <TextInput
        style={[styles.input, { color: p.text }]}
        placeholder={placeholder}
        placeholderTextColor={p.secondaryText}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {hasText ? (
        <Pressable hitSlop={8} onPress={() => onChangeText('')} style={styles.clear}>
          <Ionicons name="close-circle" size={18} color={p.secondaryText} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.lg - 4,
    height: TOUCH_TARGET + 2,
  },
  input: {
    flex: 1,
    paddingVertical: SPACING.sm,
    fontSize: FONT.bodyLg,
    lineHeight: LINE_HEIGHT.bodyLg,
  },
  clear: {
    width: TOUCH_TARGET - 12,
    height: TOUCH_TARGET - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
