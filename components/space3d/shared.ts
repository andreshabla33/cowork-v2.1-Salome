'use client';
/**
 * @module components/space3d/shared
 * Tipos, constantes, sonidos e iconos compartidos por los subcomponentes de Space3D.
 */

import React from 'react';
import type { User, PresenceStatus } from '@/types';

// ========== Types ==========
export type AvatarLodLevel = 'high' | 'mid' | 'low';
export type DireccionAvatar = User['direction'] | 'up' | 'down' | 'front-left' | 'front-right' | 'up-left' | 'up-right';

// ========== Constants ==========
export const MOVE_SPEED = 4;
export const RUN_SPEED = 8;
export const WORLD_SIZE = 100;
export const PROXIMITY_RADIUS = 180;
export const AUDIO_SPATIAL_RADIUS_FACTOR = 2;
export const TELEPORT_DISTANCE = 15;
export const CHAIR_SIT_RADIUS = 1.5;
export const CHAIR_POSITIONS_3D = [[8, 8], [12, 8], [8, 12], [12, 12], [8, 10], [12, 10]];
export const ZONA_SOLICITUD_RADIO = 140;
export const LOD_NEAR_DISTANCE = 25;
export const LOD_MID_DISTANCE = 60;
export const MOVEMENT_BROADCAST_MS = 100;
export const USAR_LIVEKIT = true;
export const PROXIMITY_COORD_THRESHOLD = 12;

export const statusColors: Record<string, string> = {
  available: '#22c55e',
  busy: '#ef4444',
  away: '#eab308',
  dnd: '#a855f7',
};

export const themeColors: Record<string, string> = {
  dark: '#000000',
  midnight: '#0a0a1a',
  forest: '#0a1a0a',
  sunset: '#1a0a0a',
  ocean: '#0a1a2a',
  cyberpunk: '#1a0a2a',
  retro: '#1a1a0a',
  minimal: '#fafafa',
  neon: '#000011',
  pastel: '#f0e8f8',
  lava: '#1a0500',
  ice: '#e8f4ff',
  arcade: '#001100',
};

// ========== AudioContext compartido ==========
let _sharedAudioCtx: AudioContext | null = null;
let _audioResumed = false;
export const getAudioCtx = (): AudioContext => {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new AudioContext();
  }
  if (_sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume();
  }
  return _sharedAudioCtx;
};
if (typeof window !== 'undefined') {
  const resumeAudio = () => {
    if (_audioResumed) return;
    _audioResumed = true;
    if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
      _sharedAudioCtx.resume();
    } else if (!_sharedAudioCtx) {
      _sharedAudioCtx = new AudioContext();
    }
    window.removeEventListener('click', resumeAudio, true);
    window.removeEventListener('keydown', resumeAudio, true);
    window.removeEventListener('touchstart', resumeAudio, true);
  };
  window.addEventListener('click', resumeAudio, true);
  window.addEventListener('keydown', resumeAudio, true);
  window.addEventListener('touchstart', resumeAudio, true);
}

// ========== Sonidos ==========
export const playTeleportSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(400, now);
    osc1.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.1);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);
    const osc1b = ctx.createOscillator();
    const gain1b = ctx.createGain();
    osc1b.type = 'sine';
    osc1b.frequency.setValueAtTime(800, now);
    osc1b.frequency.exponentialRampToValueAtTime(2400, now + 0.25);
    gain1b.gain.setValueAtTime(0.08, now);
    gain1b.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1b.connect(gain1b).connect(ctx.destination);
    osc1b.start(now);
    osc1b.stop(now + 0.3);
    const bufferSize = ctx.sampleRate * 0.5;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.1;
    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(2000, now);
    noiseFilter.Q.setValueAtTime(1.5, now);
    noise.buffer = noiseBuffer;
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noise.start(now + 0.05);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1500, now + 0.3);
    osc2.frequency.exponentialRampToValueAtTime(500, now + 0.55);
    gain2.gain.setValueAtTime(0.01, now + 0.3);
    gain2.gain.linearRampToValueAtTime(0.2, now + 0.35);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.3);
    osc2.stop(now + 0.6);
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(250, now + 0.5);
    osc3.frequency.exponentialRampToValueAtTime(150, now + 0.7);
    gain3.gain.setValueAtTime(0.15, now + 0.5);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.75);
    osc3.connect(gain3).connect(ctx.destination);
    osc3.start(now + 0.5);
    osc3.stop(now + 0.75);
  } catch (e) { /* Audio no disponible */ }
};

export const playWaveSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(740, now);
    osc1.frequency.exponentialRampToValueAtTime(680, now + 0.12);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(830, now + 0.27);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.12, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.3);
  } catch (e) { /* Audio no disponible */ }
};

export const playNudgeSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046, now);
    osc.frequency.exponentialRampToValueAtTime(988, now + 0.25);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(523, now);
    subGain.gain.setValueAtTime(0.06, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.2);
  } catch (e) { /* Audio no disponible */ }
};

export const playInviteSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const notes = [
      { freq: 659, start: 0, dur: 0.18, vol: 0.1 },
      { freq: 784, start: 0.1, dur: 0.18, vol: 0.12 },
      { freq: 1047, start: 0.2, dur: 0.25, vol: 0.14 },
    ];
    notes.forEach(({ freq, start, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    });
  } catch (e) { /* Audio no disponible */ }
};

// ========== Iconos ==========
export const IconPrivacy = ({ on }: { on: boolean }) =>
  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2.5', d: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' }),
    on ? React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2.5', d: 'M12 11v4' }) : null
  );

export const IconExpand = ({ on }: { on: boolean }) =>
  React.createElement('svg', { className: 'w-4 h-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
    on
      ? React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2.5', d: 'M6 18L18 6M6 6l12 12' })
      : React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2.5', d: 'M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4' })
  );
