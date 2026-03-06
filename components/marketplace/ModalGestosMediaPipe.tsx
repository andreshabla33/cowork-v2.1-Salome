'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X, Hand, HelpCircle, Maximize2, Minimize2 } from 'lucide-react';
import { HandController, type GestureType, type GestureData } from './HandController';

// ═══════════════════════════════════════════════════════════════════
// Modal de Control por Gestos — MediaPipe + Google Hands
// Permite interactuar con el marketplace 3D usando gestos de la mano
// Gestos: pellizco+mover=rotar, pellizco quieto=zoom, mano abierta=soltar
// ═══════════════════════════════════════════════════════════════════

interface ModalGestosMediaPipeProps {
  abierto: boolean;
  onCerrar: () => void;
  onGesture: (gesture: GestureType, data: GestureData) => void;
}

const TOUR_STEPS = [
  { icon: '📷', titulo: 'Tu cámara', desc: 'La cámara detecta tus manos en tiempo real. Asegúrate de tener buena iluminación.' },
  { icon: '🤏', titulo: 'Pellizco + Mover = Rotar', desc: 'Junta pulgar e índice y mueve la mano para rotar el espacio virtual.' },
  { icon: '🔍', titulo: 'Pellizco Quieto = Zoom', desc: 'Mantén el pellizco quieto y acerca o aleja los dedos para hacer zoom.' },
  { icon: '🖐️', titulo: 'Mano Abierta = Soltar', desc: 'Abre la mano para soltar y detener el movimiento.' },
  { icon: '🙌', titulo: 'Dos Manos = Pantalla completa', desc: 'Muestra dos manos abiertas para maximizar la vista.' },
];

export const ModalGestosMediaPipe: React.FC<ModalGestosMediaPipeProps> = ({
  abierto,
  onCerrar,
  onGesture,
}) => {
  const [gestureEnabled, setGestureEnabled] = useState(true);
  const [currentGesture, setCurrentGesture] = useState<GestureType>('none');
  const [mostrarTour, setMostrarTour] = useState(false);
  const [pasoTour, setPasoTour] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Auto-start tour on first open
  useEffect(() => {
    if (abierto) {
      const visto = localStorage.getItem('marketplace-gesture-tour-v1');
      if (!visto) {
        setTimeout(() => setMostrarTour(true), 1500);
      }
    }
  }, [abierto]);

  const handleGesture = useCallback((g: GestureType, data: GestureData) => {
    setCurrentGesture(g);
    onGesture(g, data);

    // Two hands → toggle fullscreen
    if (g === 'two_hands') {
      setIsFullscreen(prev => !prev);
    }
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

  // Keyboard shortcuts for tour
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

  const gestureLabel: Record<GestureType, { emoji: string; text: string; color: string }> = {
    'pinch_drag': { emoji: '🤏', text: 'Rotando', color: 'text-orange-400' },
    'pinch_zoom': { emoji: '🔍', text: 'Zoom', color: 'text-yellow-400' },
    'open': { emoji: '🖐️', text: 'Soltando', color: 'text-green-400' },
    'fist': { emoji: '✊', text: 'Pausa', color: 'text-zinc-400' },
    'two_hands': { emoji: '🙌', text: 'Fullscreen', color: 'text-purple-400' },
    'none': { emoji: '👤', text: 'Sin gesto', color: 'text-zinc-500' },
  };

  const g = gestureLabel[currentGesture];

  return (
    <>
      {/* Overlay oscuro */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
        onClick={onCerrar}
      />

      {/* Modal */}
      <div className={`fixed z-[61] bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 flex flex-col transition-all duration-300 ${
        isFullscreen
          ? 'inset-4 rounded-3xl'
          : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[95vw] rounded-3xl'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
              <Hand className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Control por Gestos</h3>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">MediaPipe + Google Hands AI</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setPasoTour(0);
                setMostrarTour(true);
                localStorage.removeItem('marketplace-gesture-tour-v1');
              }}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition"
              title="Ver tutorial"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(f => !f)}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition"
              title={isFullscreen ? 'Minimizar' : 'Maximizar'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onCerrar}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Gesture status bar */}
        <div className="px-6 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{g.emoji}</span>
            <span className={`text-sm font-bold ${g.color}`}>{g.text}</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span>🤏 Pellizco = Rotar</span>
            <span>🔍 Quieto = Zoom</span>
            <span>🖐️ Abierta = Soltar</span>
          </div>
        </div>

        {/* Content — camera feed is handled by HandController (positioned fixed bottom-right) */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-4">
            <div className="text-6xl animate-bounce">{currentGesture === 'none' ? '👋' : g.emoji}</div>
            <p className="text-zinc-300 text-sm max-w-xs mx-auto">
              {currentGesture === 'none'
                ? 'Muestra tu mano frente a la cámara para empezar a interactuar con el espacio virtual.'
                : `Gesto activo: ${g.text}. El espacio 3D responde a tus movimientos.`
              }
            </p>
            <button
              onClick={() => setGestureEnabled(e => !e)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                gestureEnabled
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {gestureEnabled ? '🎮 Gestos Activos' : '🖱️ Gestos Desactivados'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 text-center">
          <p className="text-[10px] text-zinc-600">
            Powered by Google MediaPipe · One-Euro Filter · State Machine v4.1
          </p>
        </div>
      </div>

      {/* HandController — camera feed overlay */}
      {gestureEnabled && (
        <HandController onGesture={handleGesture} enabled={gestureEnabled} />
      )}

      {/* Tour overlay */}
      {mostrarTour && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[62]" onClick={handleSkipTour} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[63] w-[360px] max-w-[90vw] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-6">
            {/* Progress dots */}
            <div className="flex items-center gap-1.5 mb-4">
              {TOUR_STEPS.map((_, i) => (
                <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= pasoTour ? 'bg-indigo-500' : 'bg-zinc-700'}`} />
              ))}
              <span className="text-[10px] text-zinc-500 ml-2">{pasoTour + 1}/{TOUR_STEPS.length}</span>
            </div>

            {/* Content */}
            <div className="text-center space-y-3">
              <div className="text-5xl">{TOUR_STEPS[pasoTour].icon}</div>
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
                className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold rounded-xl transition"
              >
                {pasoTour < TOUR_STEPS.length - 1 ? 'Siguiente →' : '¡Entendido!'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};
