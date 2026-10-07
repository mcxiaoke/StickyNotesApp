// 仅限 debug（__DEV__）：deep link 注入测试便签的落地路由。
// 触发：adb shell am start -a android.intent.action.VIEW -d "stickynotes://dev-seed?count=8&clear=1"
// release 包中该路由存在但直接返回 null、不执行任何逻辑。
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { seedNotesAsync } from '../dev/seedNotes';
import { notesStore } from '../stores/notesStore';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function DevSeedScreen() {
  const params = useLocalSearchParams<{ count?: string; clear?: string }>();
  const started = useRef(false);

  useEffect(() => {
    if (!__DEV__ || started.current) return;
    started.current = true;
    void (async () => {
      await seedNotesAsync({
        count: firstParam(params.count) ? Number(firstParam(params.count)) : undefined,
        clear: firstParam(params.clear) === '1' || firstParam(params.clear) === 'true',
      });
      await notesStore.getState().refreshAsync();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    })();
  }, [params.count, params.clear]);

  if (!__DEV__) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>注入测试数据中…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 15,
  },
});
