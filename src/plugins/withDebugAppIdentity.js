// 本地 config plugin：为 debug 构建注入 applicationIdSuffix（.debug）与应用名后缀，
// 使 debug 包与正式包可并存安装、桌面名称可区分。
// android/ 目录由 CNG 生成，禁止手改——本插件在 prebuild 时注入。
const { withAppBuildGradle } = require('expo/config-plugins');

const DEBUG_SUFFIX_INJECTION = [
  '            // StickyNotes debug identity (injected by plugins/withDebugAppIdentity.js)',
  "            applicationIdSuffix '.debug'",
  '            resValue "string", "app_name", "StickyNotes Dev"',
].join('\n');

module.exports = function withDebugAppIdentity(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') return mod;
    let contents = mod.modResults.contents;

    if (contents.includes('applicationIdSuffix')) return mod; // 幂等

    // 只认 buildTypes 内的 debug 块（signingConfigs 里也有 debug {，不能宽松匹配）
    const buildTypesIdx = contents.indexOf('buildTypes');
    const debugIdx = buildTypesIdx >= 0 ? contents.indexOf('debug {', buildTypesIdx) : -1;
    if (debugIdx >= 0) {
      const insertAt = contents.indexOf('\n', debugIdx) + 1;
      contents =
        contents.slice(0, insertAt) + DEBUG_SUFFIX_INJECTION + '\n' + contents.slice(insertAt);
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
