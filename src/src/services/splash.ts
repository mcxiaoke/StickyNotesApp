// 启动图（splash）时序控制：把"何时隐藏启动图"的决定权收归应用，解决冷启动首页"闪一下"。
//
// 背景（两个默认行为叠加造成的闪屏）：
// 1. expo-splash-screen 在 Android 上的默认退场动画是「全屏 alpha 淡出 400ms」
//    （SplashScreenManager.configureSplashScreen + SplashScreenOptions.duration=400），
//    这层不透明遮罩会盖在已经渲染好的首页上再褪掉 —— 看起来就是首页整体闪一下。
// 2. 应用原本没有 preventAutoHide，隐藏启动图的是 expo-router：它在导航就绪时
//    （global-state/store.js onReady → requestAnimationFrame → internalMaybeHideAsync）
//    调用原生 hide。"导航就绪"和"首页真的有内容"是两件事，慢一点的设备会在遮罩褪掉后
//    看到一段空窗（浅色下白、深色下近黑）。
//
// 做法：模块加载即 preventAutoHideAsync + 退场动画时长置 0，改由调用方在
// 「锁存水合 + 首次便签加载」都完成后同步隐藏；另加一个兜底超时，初始化卡死时也不会永远停在启动图。

import * as SplashScreen from 'expo-splash-screen';

import { logger } from './logger';

/**
 * 兜底超时：接管启动图后若超过这个时间仍没人来隐藏（例如水合异常中断），
 * 无条件隐藏，避免应用看起来卡死在启动图。正常冷启动在 1s 内就会走到隐藏分支。
 */
const READY_TIMEOUT_MS = 5_000;

let hidden = false;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 接管启动图的隐藏时机。必须在模块顶层、任何渲染之前调用
 * （官方要求：否则可能调用得太晚，启动图已经自动隐藏）。
 */
export function initSplashScreen(): void {
  try {
    // 退场动画改为 0：内容就绪时直接切走，不再有那层全屏淡出
    SplashScreen.setOptions({ duration: 0 });
    void SplashScreen.preventAutoHideAsync();
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      logger.warn('splash', `content not ready in ${READY_TIMEOUT_MS}ms, hiding splash anyway`);
      hideSplashScreen();
    }, READY_TIMEOUT_MS);
  } catch (ex) {
    // 启动图只是体验优化，任何失败都不该影响应用启动
    logger.warn('splash', `failed to take over splash screen: ${String(ex)}`);
  }
}

/** 内容已可展示时调用；幂等，可重复调用（崩溃屏等旁路也复用它）。 */
export function hideSplashScreen(): void {
  if (hidden) return;
  hidden = true;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  try {
    SplashScreen.hide();
  } catch (ex) {
    logger.warn('splash', `failed to hide splash screen: ${String(ex)}`);
  }
}