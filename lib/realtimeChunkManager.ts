/**
 * Realtime Chunk Manager
 * ======================
 * Gestiona suscripciones Supabase Realtime por chunk en lugar de un
 * canal global por workspace. Cada usuario se suscribe solo a su chunk
 * actual + chunks vecinos, reduciendo el fan-out de mensajes ~100x.
 *
 * Ciclo de vida:
 *   1. inicializar(espacioId, userId) — setup inicial
 *   2. actualizarChunk(chunkClave, chunksVecinos) — re-suscribir cuando cambia de chunk
 *   3. broadcast(evento, payload) — enviar a todos los canales suscritos
 *   4. destruir() — cleanup
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type EventoRealtime = 'movement' | 'offer' | 'answer' | 'ice-candidate' | 'reaction' | 'chat' | 'wave' | 'lock_conversation' | 'nudge' | 'invite';

export interface RealtimeChunkConfig {
  espacioId: string;
  userId: string;
  onMessage: (evento: EventoRealtime, payload: Record<string, unknown>) => void;
  onSubscriptionChange?: (canalesActivos: number) => void;
}

interface CanalChunk {
  clave: string;
  canal: RealtimeChannel;
  suscrito: boolean;
}

export class RealtimeChunkManager {
  private config: RealtimeChunkConfig;
  private canales = new Map<string, CanalChunk>();
  private chunkActual: string | null = null;
  private destruido = false;

  constructor(config: RealtimeChunkConfig) {
    this.config = config;
  }

  get canalesActivos(): number {
    let count = 0;
    this.canales.forEach((c) => { if (c.suscrito) count++; });
    return count;
  }

  get chunkKey(): string | null {
    return this.chunkActual;
  }

  /**
   * Actualiza el chunk actual y re-suscribe a los canales necesarios.
   * Canales que ya no son vecinos se eliminan.
   */
  actualizarChunk(chunkClave: string, chunksVecinos: string[]): void {
    if (this.destruido) return;

    const nuevosChunks = new Set([chunkClave, ...chunksVecinos]);
    this.chunkActual = chunkClave;

    // Eliminar canales que ya no son necesarios
    for (const [clave, canalChunk] of this.canales) {
      if (!nuevosChunks.has(clave)) {
        this.removerCanal(clave, canalChunk);
      }
    }

    // Crear canales nuevos que no existen
    for (const clave of nuevosChunks) {
      if (!this.canales.has(clave)) {
        this.crearCanal(clave);
      }
    }

    this.config.onSubscriptionChange?.(this.canalesActivos);
  }

  /**
   * Envía un mensaje broadcast al canal del chunk actual.
   * Solo se envía al chunk propio (los vecinos lo reciben porque están suscritos).
   */
  broadcast(evento: EventoRealtime, payload: Record<string, unknown>): boolean {
    if (!this.chunkActual || this.destruido) return false;

    const canalChunk = this.canales.get(this.chunkActual);
    if (!canalChunk?.suscrito) return false;

    canalChunk.canal.send({
      type: 'broadcast',
      event: evento,
      payload: {
        ...payload,
        _chunk: this.chunkActual,
        _ts: Date.now(),
      },
    });

    return true;
  }

  /**
   * Limpia todos los canales y recursos.
   */
  destruir(): void {
    this.destruido = true;
    for (const [clave, canalChunk] of this.canales) {
      this.removerCanal(clave, canalChunk);
    }
    this.canales.clear();
    this.chunkActual = null;
  }

  // ─── Internos ────────────────────────────────────────────

  private nombreCanal(chunkClave: string): string {
    return `chunk:${this.config.espacioId}:${chunkClave}`;
  }

  private crearCanal(chunkClave: string): void {
    const nombre = this.nombreCanal(chunkClave);
    const canal = supabase.channel(nombre);

    const eventos: EventoRealtime[] = ['movement', 'offer', 'answer', 'ice-candidate', 'reaction', 'chat', 'wave', 'lock_conversation', 'nudge', 'invite'];

    for (const evento of eventos) {
      canal.on('broadcast', { event: evento }, ({ payload }) => {
        if (this.destruido) return;
        // No procesar mensajes propios
        if (payload?.id === this.config.userId || payload?.from === this.config.userId) return;
        this.config.onMessage(evento, payload as Record<string, unknown>);
      });
    }

    canal.subscribe((status) => {
      const entry = this.canales.get(chunkClave);
      if (entry) {
        entry.suscrito = status === 'SUBSCRIBED';
        this.config.onSubscriptionChange?.(this.canalesActivos);
      }
    });

    this.canales.set(chunkClave, { clave: chunkClave, canal, suscrito: false });
  }

  private removerCanal(clave: string, canalChunk: CanalChunk): void {
    try {
      supabase.removeChannel(canalChunk.canal);
    } catch {
      // Canal ya removido
    }
    this.canales.delete(clave);
  }
}

/**
 * Factory para crear un RealtimeChunkManager.
 */
export function crearRealtimeChunkManager(config: RealtimeChunkConfig): RealtimeChunkManager {
  return new RealtimeChunkManager(config);
}
