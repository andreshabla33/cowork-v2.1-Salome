'use client';
/**
 * @module components/space3d/InternalComponents
 * Barrel file — re-exports de subcomponentes extraídos (Fase 7 refactoring).
 * 
 * Archivos individuales:
 * - spaceTypes.ts       → statusColors, VirtualSpace3DProps, ICE_SERVERS
 * - Overlays.tsx        → Minimap, StableVideo, AdaptiveFrameloop, ScreenSpaceProfileCard
 * - Avatar3DScene.tsx   → Avatar, AvatarProps, RemoteAvatarInterpolated, RemoteUsers, CameraFollow, AvatarScreenProjector, TeleportEffect
 * - Player3D.tsx        → Player, PlayerProps
 * - Scene3D.tsx         → Scene, SceneProps
 * - VideoHUD.tsx        → VideoHUD, VideoHUDProps
 */

// --- Types & constants ---
export { statusColors, type VirtualSpace3DProps, ICE_SERVERS } from './spaceTypes';

// --- Overlays (DOM) ---
export { Minimap, StableVideo, type StableVideoProps, AdaptiveFrameloop, ScreenSpaceProfileCard } from './Overlays';

// --- Avatar system (3D) ---
export { Avatar, type AvatarProps, RemoteAvatarInterpolated, RemoteUsers, type RemoteUsersProps, CameraFollow, AvatarScreenProjector, TeleportEffect } from './Avatar3DScene';

// --- Player (3D) ---
export { Player, type PlayerProps } from './Player3D';

// --- Scene (3D) ---
export { Scene, type SceneProps } from './Scene3D';

// --- Video HUD (DOM) ---
export { VideoHUD, type VideoHUDProps } from './VideoHUD';

