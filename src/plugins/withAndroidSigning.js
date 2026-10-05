// 本地 config plugin：为 release 构建注入签名配置（读取项目根目录 key.properties），
// 并加大 Gradle JVM 内存（RN 0.86 新架构原生编译需要更大 Metaspace）。
// android/ 目录由 CNG 生成，禁止手改——以上配置通过本插件在 prebuild 时注入。
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const GRADLE_JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

const PROPS_LOADER = [
  '// StickyNotes release signing (injected by plugins/withAndroidSigning.js)',
  'def keystoreProperties = new Properties()',
  'def keystorePropertiesFile = rootProject.file("../key.properties")',
  'if (keystorePropertiesFile.exists()) {',
  '    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))',
  '}',
  '',
].join('\n');

const RELEASE_SIGNING_CONFIG = [
  '    signingConfigs {',
  '        release {',
  '            if (keystorePropertiesFile.exists()) {',
  "                storeFile file(keystoreProperties['storeFile'])",
  "                storePassword keystoreProperties['storePassword']",
  "                keyAlias keystoreProperties['keyAlias']",
  "                keyPassword keystoreProperties['keyPassword']",
  '            }',
  '        }',
].join('\n');

module.exports = function withAndroidSigning(config) {
  config = withGradleProperties(config, (mod) => {
    const jvmArgs = mod.modResults.find((p) => p.type === 'property' && p.key === 'org.gradle.jvmargs');
    if (jvmArgs) {
      jvmArgs.value = GRADLE_JVM_ARGS;
    } else {
      mod.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: GRADLE_JVM_ARGS });
    }
    return mod;
  });

  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') return mod;
    let contents = mod.modResults.contents;

    if (!contents.includes('keystoreProperties')) {
      contents = PROPS_LOADER + contents;
    }
    if (!contents.includes('signingConfigs.release')) {
      contents = contents.replace('signingConfigs {', RELEASE_SIGNING_CONFIG);
    }
    // 定位 buildTypes 内的 release 块，替换其 signingConfig
    // （signingConfigs 块里也有 release {，不能用宽松正则）
    const buildTypesIdx = contents.indexOf('buildTypes');
    const releaseIdx = buildTypesIdx >= 0 ? contents.indexOf('release {', buildTypesIdx) : -1;
    const target = 'signingConfig signingConfigs.debug';
    const targetIdx = releaseIdx >= 0 ? contents.indexOf(target, releaseIdx) : -1;
    if (targetIdx >= 0) {
      const replacement =
        'signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug';
      contents = contents.slice(0, targetIdx) + replacement + contents.slice(targetIdx + target.length);
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
