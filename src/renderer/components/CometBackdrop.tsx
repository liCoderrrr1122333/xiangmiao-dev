import { useEffect, useRef } from 'react';
import type { MotionMode } from '../../shared/types';

interface Props {
  motionMode: MotionMode;
}

interface Comet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  width: number;
  age: number;
  lifetime: number;
}

interface Star {
  x: number;
  y: number;
  alpha: number;
  size: number;
}

function createStars(width: number, height: number) {
  const count = Math.max(18, Math.min(48, Math.round((width * height) / 42000)));
  return Array.from({ length: count }, (_, index): Star => {
    const seed = (index + 1) * 9301 + width * 17 + height * 29;
    const xNoise = Math.abs(Math.sin(seed * 0.0013));
    const yNoise = Math.abs(Math.sin(seed * 0.0027 + 1.7));
    return {
      x: xNoise * width,
      y: yNoise * height,
      alpha: 0.06 + (index % 5) * 0.018,
      size: index % 7 === 0 ? 1.2 : 0.7
    };
  });
}

function createComet(width: number, height: number): Comet {
  const speed = 250 + Math.random() * 150;
  return {
    x: width * (0.72 + Math.random() * 0.36),
    y: height * (-0.08 + Math.random() * 0.34),
    vx: -speed,
    vy: speed * (0.54 + Math.random() * 0.18),
    length: 120 + Math.random() * 130,
    width: 0.8 + Math.random() * 0.8,
    age: 0,
    lifetime: 4.2 + Math.random() * 2.3
  };
}

export function CometBackdrop({ motionMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let comets: Comet[] = [];
    let frame = 0;
    let lastFrameAt = 0;
    let nextSpawnAt = performance.now() + 900;
    let running = false;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const frameInterval = motionMode === 'reduced' ? 50 : 1000 / 30;
    const spawnDelay = () =>
      motionMode === 'reduced'
        ? 14000 + Math.random() * 8000
        : 6000 + Math.random() * 6000;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      stars = createStars(width, height);
    };

    const drawStars = () => {
      for (const star of stars) {
        context.fillStyle = `rgba(191, 207, 229, ${star.alpha})`;
        context.fillRect(star.x, star.y, star.size, star.size);
      }
    };

    const drawComet = (comet: Comet) => {
      const speed = Math.hypot(comet.vx, comet.vy);
      const tailX = comet.x - (comet.vx / speed) * comet.length;
      const tailY = comet.y - (comet.vy / speed) * comet.length;
      const progress = comet.age / comet.lifetime;
      const fade = Math.sin(Math.min(1, progress) * Math.PI);
      const gradient = context.createLinearGradient(tailX, tailY, comet.x, comet.y);
      gradient.addColorStop(0, 'rgba(121, 96, 232, 0)');
      gradient.addColorStop(0.66, `rgba(121, 96, 232, ${0.16 * fade})`);
      gradient.addColorStop(1, `rgba(224, 235, 255, ${0.72 * fade})`);
      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(comet.x, comet.y);
      context.strokeStyle = gradient;
      context.lineWidth = comet.width;
      context.stroke();
    };

    const render = (now: number) => {
      frame = 0;
      if (!running) return;
      if (now - lastFrameAt < frameInterval) {
        frame = requestAnimationFrame(render);
        return;
      }
      const delta = Math.min(0.08, Math.max(0, (now - lastFrameAt) / 1000 || 0));
      lastFrameAt = now;
      context.clearRect(0, 0, width, height);
      drawStars();

      if (motionMode !== 'off' && now >= nextSpawnAt && comets.length < 2) {
        comets.push(createComet(width, height));
        nextSpawnAt = now + spawnDelay();
      }
      for (const comet of comets) {
        comet.age += delta;
        comet.x += comet.vx * delta;
        comet.y += comet.vy * delta;
        drawComet(comet);
      }
      comets = comets.filter(
        (comet) =>
          comet.age < comet.lifetime &&
          comet.x > -comet.length &&
          comet.y < height + comet.length
      );
      frame = requestAnimationFrame(render);
    };

    const syncRunningState = () => {
      const shouldRun =
        motionMode !== 'off' &&
        !reducedMotionQuery.matches &&
        !document.hidden &&
        document.hasFocus();
      if (shouldRun === running) return;
      running = shouldRun;
      if (running) {
        lastFrameAt = performance.now();
        frame = requestAnimationFrame(render);
      } else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    resize();
    context.clearRect(0, 0, width, height);
    drawStars();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener('visibilitychange', syncRunningState);
    window.addEventListener('focus', syncRunningState);
    window.addEventListener('blur', syncRunningState);
    reducedMotionQuery.addEventListener('change', syncRunningState);
    syncRunningState();

    return () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncRunningState);
      window.removeEventListener('focus', syncRunningState);
      window.removeEventListener('blur', syncRunningState);
      reducedMotionQuery.removeEventListener('change', syncRunningState);
    };
  }, [motionMode]);

  return <canvas ref={canvasRef} className="comet-backdrop" aria-hidden="true" />;
}
