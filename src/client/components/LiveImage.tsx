// dsh-browser · 客户端组件 — 实时画面图
//
// MJPEG 流优先;流不可用时受控回退到轮询截图(shotSrc 的 v 随状态轮询每 ~3s
// 变化,天然保鲜),并在每个轮询节拍重试流。旧实现 onError 直接改 DOM src,
// React 侧 src 恒为流地址永不重设,回退后画面会永久冻结 —— 本组件修复该问题。
import { createElement, useEffect, useState, type CSSProperties, type MouseEvent } from "react";

interface LiveImageProps {
  /** MJPEG 流地址(/stream);缺省时退化为纯截图轮询 */
  streamSrc?: string;
  /** 轮询截图地址(/screenshot?v=…,v 随状态轮询变化) */
  shotSrc: string;
  alt?: string;
  title?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLImageElement>) => void;
}

export function LiveImage({ streamSrc, shotSrc, alt, title, style, onClick }: LiveImageProps) {
  const [useStream, setUseStream] = useState(true);
  // 重试序号:仅回退态递增,拼进流地址做缓存穿透;流健康时不变,避免无谓断流重连
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    if (useStream) return;
    // 回退态:借 shotSrc 变化(状态轮询节拍)重试流
    setProbe((n) => n + 1);
    setUseStream(true);
  }, [shotSrc, useStream]);

  const src =
    useStream && streamSrc !== undefined
      ? probe > 0
        ? `${streamSrc}${streamSrc.includes("?") ? "&" : "?"}probe=${probe}`
        : streamSrc
      : shotSrc;

  return createElement("img", {
    src,
    onError: () => setUseStream(false),
    alt,
    title,
    onClick,
    style,
  });
}
