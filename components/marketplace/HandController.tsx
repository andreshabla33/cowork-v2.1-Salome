'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════
// MediaPipe Hand Gesture Controller v4.1
// Based on: Meta Quest One-Euro Filter, Google MediaPipe best practices
// Features: One-Euro Filter smoothing, State Machine transitions,
//           confidence scoring, adaptive thresholds
// Adapted from: github.com/andreshabla33/mediapipe3D
// ═══════════════════════════════════════════════════════════════════

export type GestureType = 'pinch_drag' | 'pinch_zoom' | 'open' | 'fist' | 'two_hands' | 'none';

export interface GestureData {
  x: number;
  y: number;
  pinchDistance: number;
  handedness: 'left' | 'right';
  deltaX: number;
  deltaY: number;
}

interface HandControllerProps {
  onGesture: (gesture: GestureType, data: GestureData) => void;
  enabled?: boolean;
}

// ── One-Euro Filter (Meta Quest / Apple Vision Pro standard) ──────
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 0.001);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const adx = this.alpha(this.dCutoff, dt);
    const dxSmooth = adx * dx + (1 - adx) * this.dxPrev;
    this.dxPrev = dxSmooth;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxSmooth);
    const a = this.alpha(cutoff, dt);
    const xSmooth = a * x + (1 - a) * this.xPrev;
    this.xPrev = xSmooth;
    return xSmooth;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

// ── Gesture State Machine ────────────────────────────────────────
type GestureState = 'idle' | 'pinching' | 'dragging' | 'zooming' | 'open_hand' | 'fist_hand' | 'two_hands';

const FRAMES_TO_CONFIRM = 3;
const FRAMES_TO_EXIT = 10;
const PINCH_THRESHOLD = 0.07;
const DRAG_THRESHOLD = 0.008;
const ZOOM_THRESHOLD = 0.012;
const THROTTLE_MS = 50;

export function HandController({ onGesture, enabled = true }: HandControllerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const handsRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const initedRef = useRef(false);

  const filterXRef = useRef(new OneEuroFilter(0.4, 0.5, 1.0));
  const filterYRef = useRef(new OneEuroFilter(0.4, 0.5, 1.0));
  const filterDistRef = useRef(new OneEuroFilter(1.5, 0.001, 1.0));

  const stateRef = useRef<GestureState>('idle');
  const candidateRef = useRef<{ state: GestureState; frames: number }>({ state: 'idle', frames: 0 });
  const lastEmitRef = useRef<number>(0);
  const lastGestureRef = useRef<GestureType>('none');

  const prevPosRef = useRef<{ x: number; y: number } | null>(null);
  const prevDistRef = useRef<number>(0);
  const accumZoomRef = useRef<number>(0);
  const accumMoveRef = useRef<number>(0);

  const [handDetected, setHandDetected] = useState(false);
  const [activeGesture, setActiveGesture] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('Iniciando...');

  const onGestureRef = useRef(onGesture);
  onGestureRef.current = onGesture;

  const transitionTo = useCallback((target: GestureState): boolean => {
    if (stateRef.current === target) {
      candidateRef.current = { state: target, frames: 0 };
      return true;
    }
    const isSticky = stateRef.current === 'dragging' || stateRef.current === 'zooming';
    const required = isSticky ? FRAMES_TO_EXIT : FRAMES_TO_CONFIRM;
    if (candidateRef.current.state === target) {
      candidateRef.current.frames++;
      if (candidateRef.current.frames >= required) {
        stateRef.current = target;
        candidateRef.current = { state: target, frames: 0 };
        return true;
      }
      return false;
    }
    candidateRef.current = { state: target, frames: 1 };
    return false;
  }, []);

  const emitGesture = useCallback((gesture: GestureType, data: GestureData) => {
    const now = Date.now();
    if (gesture === lastGestureRef.current && now - lastEmitRef.current < THROTTLE_MS) return;
    lastEmitRef.current = now;
    lastGestureRef.current = gesture;
    onGestureRef.current(gesture, data);
  }, []);

  const resetFilters = useCallback(() => {
    filterXRef.current.reset();
    filterYRef.current.reset();
    filterDistRef.current.reset();
    prevPosRef.current = null;
    prevDistRef.current = 0;
    accumZoomRef.current = 0;
    accumMoveRef.current = 0;
  }, []);

  const drawHand = useCallback((
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number,
    state: GestureState
  ) => {
    const color = state === 'dragging' ? '#FF6B35'
      : state === 'zooming' ? '#FFD700'
      : state === 'pinching' ? '#FF9500'
      : '#00FF88';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const connections = [
      [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]
    ];
    for (const [i, j] of connections) {
      ctx.beginPath();
      ctx.moveTo(landmarks[i].x * width, landmarks[i].y * height);
      ctx.lineTo(landmarks[j].x * width, landmarks[j].y * height);
      ctx.stroke();
    }
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 4, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (state === 'dragging' || state === 'zooming' || state === 'pinching') {
      for (const idx of [4, 8]) {
        ctx.beginPath();
        ctx.arc(landmarks[idx].x * width, landmarks[idx].y * height, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = state === 'dragging' ? '#FF3333' : '#FFD700';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    if (!enabled || initedRef.current) return;
    initedRef.current = true;
    let mounted = true;

    const init = async () => {
      try {
        setStatus('Cargando modelo de manos...');
        const { Hands } = await import('@mediapipe/hands');
        if (!mounted) return;

        const hands = new Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5,
        });

        hands.onResults((results: any) => {
          if (!mounted) return;
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas || !video) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            setHandDetected(false);
            setActiveGesture('');
            if (stateRef.current !== 'idle') {
              stateRef.current = 'idle';
              resetFilters();
            }
            if (lastGestureRef.current !== 'none') {
              emitGesture('none', { x: 0.5, y: 0.5, pinchDistance: 0, handedness: 'right', deltaX: 0, deltaY: 0 });
            }
            return;
          }

          setHandDetected(true);
          const t = performance.now() / 1000;

          // Two hands check
          if (results.multiHandLandmarks.length >= 2) {
            const h1 = results.multiHandLandmarks[0];
            const h2 = results.multiHandLandmarks[1];
            const open1 = [8, 12, 16, 20].every((i: number) => h1[i].y < h1[i - 2].y);
            const open2 = [8, 12, 16, 20].every((i: number) => h2[i].y < h2[i - 2].y);
            if (open1 && open2) {
              if (transitionTo('two_hands')) {
                setActiveGesture('Pantalla completa');
                emitGesture('two_hands', { x: 0.5, y: 0.5, pinchDistance: 0, handedness: 'right', deltaX: 0, deltaY: 0 });
              }
              return;
            }
          }

          // Single hand processing
          const lm = results.multiHandLandmarks[0];
          const palmCenter = lm[9];
          const pinchDistRaw = Math.sqrt(
            (lm[8].x - lm[4].x) ** 2 + (lm[8].y - lm[4].y) ** 2
          );
          const fingersUp = [
            lm[8].y < lm[6].y, lm[12].y < lm[10].y,
            lm[16].y < lm[14].y, lm[20].y < lm[18].y
          ];
          const openCount = fingersUp.filter(Boolean).length;

          const sx = filterXRef.current.filter(palmCenter.x, t);
          const sy = filterYRef.current.filter(palmCenter.y, t);
          const sd = filterDistRef.current.filter(pinchDistRaw, t);

          const isPinching = sd < PINCH_THRESHOLD;

          drawHand(ctx, lm, canvas.width, canvas.height, stateRef.current);

          if (isPinching) {
            if (stateRef.current !== 'pinching' && stateRef.current !== 'dragging' && stateRef.current !== 'zooming') {
              if (transitionTo('pinching')) {
                prevPosRef.current = { x: sx, y: sy };
                prevDistRef.current = sd;
                accumZoomRef.current = 0;
                setActiveGesture('Pellizco');
              }
            } else if (prevPosRef.current) {
              const dx = sx - prevPosRef.current.x;
              const dy = sy - prevPosRef.current.y;
              const movement = Math.sqrt(dx * dx + dy * dy);
              accumMoveRef.current += movement;
              accumZoomRef.current += sd - prevDistRef.current;

              if (stateRef.current === 'dragging') {
                setActiveGesture('Rotando');
                emitGesture('pinch_drag', {
                  x: sx, y: sy, pinchDistance: sd, handedness: 'right',
                  deltaX: dx, deltaY: dy
                });
                accumZoomRef.current = 0;
                accumMoveRef.current = 0;
              } else if (stateRef.current === 'zooming') {
                setActiveGesture('Zoom');
                emitGesture('pinch_zoom', {
                  x: sx, y: sy, pinchDistance: sd, handedness: 'right',
                  deltaX: 0, deltaY: accumZoomRef.current
                });
                accumZoomRef.current = 0;
                accumMoveRef.current = 0;
              } else {
                const movementReady = accumMoveRef.current > DRAG_THRESHOLD;
                const zoomReady = Math.abs(accumZoomRef.current) > ZOOM_THRESHOLD;

                if (movementReady && (!zoomReady || accumMoveRef.current / DRAG_THRESHOLD > Math.abs(accumZoomRef.current) / ZOOM_THRESHOLD)) {
                  if (transitionTo('dragging')) {
                    setActiveGesture('Rotando');
                    emitGesture('pinch_drag', {
                      x: sx, y: sy, pinchDistance: sd, handedness: 'right',
                      deltaX: dx, deltaY: dy
                    });
                    accumZoomRef.current = 0;
                    accumMoveRef.current = 0;
                  }
                } else if (zoomReady) {
                  if (transitionTo('zooming')) {
                    setActiveGesture('Zoom');
                    emitGesture('pinch_zoom', {
                      x: sx, y: sy, pinchDistance: sd, handedness: 'right',
                      deltaX: 0, deltaY: accumZoomRef.current
                    });
                    accumZoomRef.current = 0;
                    accumMoveRef.current = 0;
                  }
                }
              }

              prevPosRef.current = { x: sx, y: sy };
              prevDistRef.current = sd;
            }
          } else if (stateRef.current === 'dragging' || stateRef.current === 'zooming') {
            const exitTarget = openCount >= 4 ? 'open_hand' as GestureState : 'fist_hand' as GestureState;
            if (!transitionTo(exitTarget)) {
              if (stateRef.current === 'dragging') {
                emitGesture('pinch_drag', {
                  x: sx, y: sy, pinchDistance: sd, handedness: 'right',
                  deltaX: 0, deltaY: 0
                });
              }
            } else {
              resetFilters();
              setActiveGesture(exitTarget === 'open_hand' ? 'Soltar' : 'Pausa');
              emitGesture(exitTarget === 'open_hand' ? 'open' : 'fist', {
                x: palmCenter.x, y: palmCenter.y, pinchDistance: pinchDistRaw,
                handedness: 'right', deltaX: 0, deltaY: 0
              });
            }
          } else if (openCount >= 4) {
            if (transitionTo('open_hand')) {
              resetFilters();
              setActiveGesture('Soltar');
              emitGesture('open', {
                x: palmCenter.x, y: palmCenter.y, pinchDistance: pinchDistRaw,
                handedness: 'right', deltaX: 0, deltaY: 0
              });
            }
          } else {
            if (transitionTo('fist_hand')) {
              resetFilters();
              setActiveGesture('Pausa');
              emitGesture('fist', {
                x: palmCenter.x, y: palmCenter.y, pinchDistance: pinchDistRaw,
                handedness: 'right', deltaX: 0, deltaY: 0
              });
            }
          }
        });

        handsRef.current = hands;

        setStatus('Accediendo a cámara...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatus('');

          const loop = async () => {
            if (!mounted || !videoRef.current || !handsRef.current) return;
            try { await handsRef.current.send({ image: videoRef.current }); }
            catch (_) { /* skip frame */ }
            animationRef.current = requestAnimationFrame(loop);
          };
          loop();
        }
      } catch (err: any) {
        setError(err.message || 'Error al inicializar la cámara');
      }
    };

    init();

    return () => {
      mounted = false;
      initedRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      handsRef.current = null;
    };
  }, [enabled, emitGesture, drawHand, transitionTo, resetFilters]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
      <div className="relative w-64 h-48 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl shadow-black/50 bg-black">
        <canvas
          ref={canvasRef}
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        <div className={`absolute bottom-0 left-0 right-0 px-3 py-1.5 text-center text-xs font-bold backdrop-blur-sm ${
          error ? 'bg-red-500/80 text-white' :
          handDetected ? 'bg-green-500/80 text-white' :
          status ? 'bg-yellow-500/80 text-black' :
          'bg-zinc-900/80 text-zinc-400'
        }`}>
          {error
            ? `⚠️ ${error}`
            : status
              ? `⏳ ${status}`
              : handDetected
                ? `✋ ${activeGesture || 'Mano detectada'}`
                : '👤 Esperando mano...'}
        </div>
      </div>
    </div>
  );
}
