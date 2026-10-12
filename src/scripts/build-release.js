#!/usr/bin/env node

/**
 * Release APK 打包与归档脚本
 * 
 * 作用：
 * 1. 验证原生 Android 环境与签名配置 (key.properties)
 * 2. 支持架构过滤与 ABI 分包 (--arch arm64-v8a / armeabi-v7a / x86_64 / universal)
 * 3. 调用 Gradle Wrapper 构建 release APK（跳过非必要的 lint/test 加速构建）
 * 4. 自动归档并复制到项目根目录下的 release/ 目录
 * 5. 自动提取应用版本号并规范重命名（StickyNotes-v{version}[-{arch}].apk），输出文件大小与 SHA-256
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

// 路径解析（兼容在项目根目录或 src/ 目录下执行）
const scriptDir = __dirname;
const srcDir = path.resolve(scriptDir, '..');
const rootDir = path.resolve(srcDir, '..');
const androidDir = path.join(srcDir, 'android');
const keyPropsFile = path.join(srcDir, 'key.properties');
const releaseDir = path.join(rootDir, 'release');

function getAppVersion() {
  try {
    const appJsonPath = path.join(srcDir, 'app.json');
    if (fs.existsSync(appJsonPath)) {
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      if (appJson.expo && appJson.expo.version) {
        return appJson.expo.version;
      }
    }
  } catch (err) {
    // ignore
  }

  try {
    const pkgJsonPath = path.join(srcDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.version) return pkg.version;
    }
  } catch (err) {
    // ignore
  }

  return '1.0.0';
}

function calculateSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function parseArgs() {
  const userArgs = process.argv.slice(2);
  const wantsClean = userArgs.includes('--clean');

  let targetArch = null;
  const filteredArgs = [];

  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    if (arg === '--clean') {
      continue;
    } else if (arg === '--arch' && i + 1 < userArgs.length) {
      targetArch = userArgs[++i];
    } else if (arg.startsWith('--arch=')) {
      targetArch = arg.split('=')[1];
    } else {
      filteredArgs.push(arg);
    }
  }

  return { wantsClean, targetArch, extraArgs: filteredArgs };
}

function main() {
  const startTime = Date.now();
  const version = getAppVersion();
  const { wantsClean, targetArch, extraArgs } = parseArgs();

  console.log('====================================================');
  console.log(
    `  StickyNotes Release APK 构建 (v${version}${targetArch ? ` | ABI: ${targetArch}` : ' | 全部架构'})`
  );
  console.log('====================================================');

  // 1. 环境前置检查
  if (!fs.existsSync(androidDir)) {
    console.error(`\n❌ 未找到 Android 原生目录: ${androidDir}`);
    console.error('请先在 src/ 目录下执行: npx expo prebuild -p android\n');
    process.exit(1);
  }

  const isWin = process.platform === 'win32';
  const gradlewName = isWin ? 'gradlew.bat' : 'gradlew';
  const gradlewPath = path.join(androidDir, gradlewName);

  if (!fs.existsSync(gradlewPath)) {
    console.error(`\n❌ 未找到 Gradle Wrapper: ${gradlewPath}\n`);
    process.exit(1);
  }

  if (!isWin) {
    try {
      fs.chmodSync(gradlewPath, '755');
    } catch (_) {}
  }

  // 签名配置预检
  if (fs.existsSync(keyPropsFile)) {
    console.log('✓ 已检测到 release 签名配置 (src/key.properties)');
  } else {
    console.warn('⚠️ 未检测到 src/key.properties，Gradle 将使用 debug 签名作为兜底！');
  }

  // 2. 构造 Gradle 命令与参数
  const gradleTasks = [];
  if (wantsClean) {
    gradleTasks.push('clean');
  }

  gradleTasks.push(
    'app:assembleRelease',
    '-x',
    'lint',
    '-x',
    'test',
    '--configure-on-demand',
    '--build-cache',
    '-PreactNativeDevServerPort=8081'
  );

  // 若指定了目标 ABI，透传 reactNativeArchitectures 参数控制编译与打包
  if (targetArch && targetArch !== 'all' && targetArch !== 'universal') {
    gradleTasks.push(`-PreactNativeArchitectures=${targetArch}`);
    console.log(`✓ 已启用单架构构建: reactNativeArchitectures=${targetArch}`);
  }

  if (extraArgs.length > 0) {
    gradleTasks.push(...extraArgs);
  }

  console.log(`\n▶ 执行 Gradle 命令: ${gradlewName} ${gradleTasks.join(' ')}`);
  console.log(`工作目录: ${androidDir}\n`);

  const executable = isWin ? process.env.ComSpec || 'cmd.exe' : gradlewPath;
  const executionArgs = isWin ? ['/c', gradlewPath, ...gradleTasks] : gradleTasks;

  const buildResult = spawnSync(executable, executionArgs, {
    cwd: androidDir,
    stdio: 'inherit',
  });

  if (buildResult.status !== 0) {
    console.error(`\n❌ Gradle 构建失败，退出码: ${buildResult.status}`);
    process.exit(buildResult.status || 1);
  }

  // 3. 产物定位与归档到 release/ 目录
  const apkSourceDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
  if (!fs.existsSync(apkSourceDir)) {
    console.error(`\n❌ 未找到输出目录: ${apkSourceDir}`);
    process.exit(1);
  }

  const generatedApks = fs
    .readdirSync(apkSourceDir)
    .filter((file) => file.endsWith('.apk') && !file.includes('-unsigned'));

  if (generatedApks.length === 0) {
    console.error(`\n❌ 构建已结束，但未在输出目录找到 APK 产物: ${apkSourceDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  // 复制元数据（如果存在）
  const metadataSource = path.join(apkSourceDir, 'output-metadata.json');
  if (fs.existsSync(metadataSource)) {
    fs.copyFileSync(metadataSource, path.join(releaseDir, 'output-metadata.json'));
  }

  console.log('\n====================================================');
  console.log('  🎉 Release APK 打包并归档成功！');
  console.log('====================================================');
  console.log(`产物目录: ${releaseDir}`);

  // 遍历并复制归档所有生成的 APK
  for (const apkName of generatedApks) {
    const srcApkPath = path.join(apkSourceDir, apkName);

    // 解析命名前缀
    // 例如 app-release.apk, app-arm64-v8a-release.apk, app-universal-release.apk
    let targetName = `StickyNotes-v${version}.apk`;
    if (targetArch && targetArch !== 'all' && targetArch !== 'universal') {
      targetName = `StickyNotes-v${version}-${targetArch}.apk`;
    } else {
      const match = apkName.match(/^app-(.+)-release\.apk$/);
      if (match && match[1]) {
        targetName = `StickyNotes-v${version}-${match[1]}.apk`;
      }
    }

    const destNamedApk = path.join(releaseDir, targetName);
    const destStandardApk = path.join(releaseDir, apkName);

    fs.copyFileSync(srcApkPath, destNamedApk);
    fs.copyFileSync(srcApkPath, destStandardApk);

    const stat = fs.statSync(destNamedApk);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
    const sha256 = calculateSha256(destNamedApk);

    console.log(`\n  📦 ${targetName} (${sizeMB} MB)`);
    console.log(`     原包名称: ${apkName}`);
    console.log(`     SHA-256:  ${sha256}`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n总耗时: ${durationSec}s`);
  console.log('====================================================\n');
}

main();
