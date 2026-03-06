'use client';
/**
 * @module components/space3d/spaceTypes
 * Tipos, constantes e interfaces compartidas entre subcomponentes de Space3D
 */

import { PresenceStatus } from '@/types';

// Colores de estado
export const statusColors: Record<PresenceStatus, string> = {
  [PresenceStatus.AVAILABLE]: '#22c55e',
  [PresenceStatus.BUSY]: '#ef4444',
  [PresenceStatus.AWAY]: '#eab308',
  [PresenceStatus.DND]: '#a855f7',
};

// Labels de estado para mostrar al hacer clic
export const STATUS_LABELS: Record<PresenceStatus, string> = {
  [PresenceStatus.AVAILABLE]: 'Disponible',
  [PresenceStatus.BUSY]: 'Ocupado',
  [PresenceStatus.AWAY]: 'Ausente',
  [PresenceStatus.DND]: 'No molestar',
};

export interface VirtualSpace3DProps {
  theme?: string;
  isGameHubOpen?: boolean;
  isPlayingGame?: boolean;
  showroomMode?: boolean;
  showroomDuracionMin?: number;
  showroomNombreVisitante?: string;
}

// ICE Servers para WebRTC - Servidores STUN/TURN actualizados
export const ICE_SERVERS = [
  // STUN servers (gratuitos, solo para descubrir IP pública)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // TURN servers de Metered (gratuitos con límite)
  { 
    urls: 'turn:a.relay.metered.ca:80', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
  { 
    urls: 'turn:a.relay.metered.ca:80?transport=tcp', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
  { 
    urls: 'turn:a.relay.metered.ca:443', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
  { 
    urls: 'turns:a.relay.metered.ca:443?transport=tcp', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
];
