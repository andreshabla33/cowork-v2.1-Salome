'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X, HelpCircle } from 'lucide-react';
import { HandController, type GestureType, type GestureData } from './HandController';

// ═══════════════════════════════════════════════════════════════════
// Control por Gestos — Overlay NO-bloqueante
// Al activar: tour onboarding (solo primera vez) → luego solo cámara
// + barra de estado del gesto. El espacio 3D siempre visible.
// ═══════════════════════════════════════════════════════════════════

interface ModalGestosMediaPipeProps {
  abierto: boolean;
  onCerrar: () => void;
  onGesture: (gesture: GestureType, data: GestureData) => void;
  onPointerMove?: (x: number, y: number) => void;
}

const TOUR_STEPS = [
  { icon: '📷', titulo: 'Tu cámara', desc: 'La cámara detecta tus manos en tiempo real. Asegúrate de tener buena iluminación.' },
  { icon: '🤏', titulo: 'Pellizco + Mover = Rotar', desc: 'Junta pulgar e índice y mueve la mano para rotar el espacio virtual.' },
  { icon: '🔍', titulo: 'Pellizco Quieto = Zoom', desc: 'Mantén el pellizco quieto y acerca o aleja los dedos para hacer zoom.' },
  { icon: '�', titulo: 'Pellizco Rápido = Seleccionar', desc: 'Haz un pellizco rápido (sin mover la mano) sobre una zona o terreno para seleccionarlo.' },
  { icon: '�🖐️', titulo: 'Mano Abierta = Soltar', desc: 'Abre la mano para soltar y detener el movimiento.' },
  { icon: '🙌', titulo: 'Dos Manos Abiertas', desc: 'Muestra dos manos abiertas para maximizar la vista.' },
];

const GESTURE_LABELS: Record<GestureType, { emoji: string; text: string; color: string }> = {
  'pinch_drag': { emoji: '🤏', text: 'Rotando', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  'pinch_zoom': { emoji: '🔍', text: 'Zoom', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  'tap': { emoji: '👆', text: 'Seleccionar', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  'open': { emoji: '🖐️', text: 'Soltando', color: 'bg-green-500/20 text-green-300 border-green-500/40' },
  'fist': { emoji: '✊', text: 'Pausa', color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40' },
  'two_hands': { emoji: '🙌', text: 'Fullscreen', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  'none': { emoji: '👤', text: 'Esperando mano...', color: 'bg-zinc-800/80 text-zinc-400 border-zinc-700/50' },
};

export const ModalGestosMediaPipe: React.FC<ModalGestosMediaPipeProps> = ({
  abierto,
  onCerrar,
  onGesture,
  onPointerMove,
}) => {
  const [currentGesture, setCurrentGesture] = useState<GestureType>('none');
  const [mostrarTour, setMostrarTour] = useState(false);
  const [pasoTour, setPasoTour] = useState(0);

  // Auto-start tour on first open (only once)
  useEffect(() => {
    if (abierto) {
      const visto = localStorage.getItem('marketplace-gesture-tour-v1');
      if (!visto) {
        setTimeout(() => setMostrarTour(true), 800);
      }
    } else {
      setMostrarTour(false);
      setPasoTour(0);
    }
  }, [abierto]);

  const handleGesture = useCallback((g: GestureType, data: GestureData) => {
    setCurrentGesture(g);
    onGesture(g, data);
  }, [onGesture]);

  const handleNextTour = useCallback(() => {
    if (pasoTour < TOUR_STEPS.length - 1) {
      setPasoTour(p => p + 1);
    } else {
      localStorage.setItem('marketplace-gesture-tour-v1', 'true');
      setMostrarTour(false);
      setPasoTour(0);
    }
  }, [pasoTour]);

  const handleSkipTour = useCallback(() => {
    localStorage.setItem('marketplace-gesture-tour-v1', 'true');
    setMostrarTour(false);
    setPasoTour(0);
  }, []);

  useEffect(() => {
    if (!mostrarTour) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNextTour();
      if (e.key === 'Escape') handleSkipTour();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mostrarTour, handleNextTour, handleSkipTour]);

  if (!abierto) return null;

  const g = GESTURE_LABELS[currentGesture];

  return (
    <>
      {/* ── Gesture status pill (top center, non-blocking) ── */}
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
        <div className={`flex items-center gap-2.5 px-4 py-2 rounded-2xl border backdrop-blur-xl shadow-lg transition-all duration-300 ${g.color}`}>
          <span className="text-lg">{g.emoji}</span>
          <span className="text-xs font-bold">{g.text}</span>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <span className="text-[9px] text-white/40">🤏 Rotar</span>
          <span className="text-[9px] text-white/40">🔍 Zoom</span>
          <span className="text-[9px] text-white/40">👆 Clic</span>
          <span className="text-[9px] text-white/40">🖐️ Soltar</span>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={() => {
              setPasoTour(0);
              setMostrarTour(true);
              localStorage.removeItem('marketplace-gesture-tour-v1');
            }}
            className="p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition"
            title="Ver tutorial"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCerrar}
            className="p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition"
            title="Desactivar gestos"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── HandController (camera feed widget, bottom-right) ── */}
      <HandController onGesture={handleGesture} onPointerMove={onPointerMove} enabled={true} />

      {/* ── Tour onboarding (solo primera vez, con backdrop) ── */}
      {mostrarTour && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[62]" onClick={handleSkipTour} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[63] w-[380px] max-w-[90vw] bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6">
            {/* Progress dots */}
            <div className="flex items-center gap-1.5 mb-5">
              {TOUR_STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= pasoTour ? 'bg-indigo-500' : 'bg-zinc-700'}`} />
              ))}
              <span className="text-[10px] text-zinc-500 ml-2 font-mono">{pasoTour + 1}/{TOUR_STEPS.length}</span>
            </div>

            {/* Content */}
            <div className="text-center space-y-3">
              <div className="text-6xl">{TOUR_STEPS[pasoTour].icon}</div>
              <h4 className="text-lg font-bold text-white">{TOUR_STEPS[pasoTour].titulo}</h4>
              <p className="text-sm text-zinc-400 leading-relaxed">{TOUR_STEPS[pasoTour].desc}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-6">
              <button onClick={handleSkipTour} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                Saltar
              </button>
              <button
                onClick={handleNextTour}
                className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold rounded-xl transition"
              >
                {pasoTour < TOUR_STEPS.length - 1 ? 'Siguiente →' : '¡Listo, empezar!'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};
