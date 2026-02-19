'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useGraph } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils, GLTFLoader } from 'three-stdlib';
import { supabase } from '../lib/supabase';

// ============== TIPOS ==============
interface AnimationConfig {
  id: string;
  nombre: string;
  url: string;
  loop: boolean;
  orden: number;
  strip_root_motion?: boolean;
}

export interface Avatar3DConfig {
  id: string;
  nombre: string;
  modelo_url: string;
  escala: number;
  textura_url?: string | null;
  animaciones?: AnimationConfig[];
}

// Estados de animación disponibles
export type AnimationState = 'idle' | 'walk' | 'run' | 'cheer' | 'dance' | 'sit' | 'wave' | 'jump' | 'victory';

interface GLTFAvatarProps {
  avatarConfig?: Avatar3DConfig | null;
  animationState?: AnimationState;
  direction?: string;
  skinColor?: string;
  clothingColor?: string;
  scale?: number;
}

// URL del modelo por defecto (fallback cuando no hay avatar configurado)
const STORAGE_BASE = 'https://lcryrsdyrzotjqdxcwtp.supabase.co/storage/v1/object/public/avatars';
const DEFAULT_MODEL_URL = `${STORAGE_BASE}/Monica_Idle.glb`;

// Animaciones que hacen loop
const LOOP_ANIMATIONS: AnimationState[] = ['idle', 'walk', 'run', 'dance'];

// Normalizar nombre de hueso: quitar prefijos comunes de Mixamo, Meshy AI, Blender, etc.
function normalizeBoneName(name: string): string {
  let n = name;
  // Quitar prefijo Armature| o Armature/ (Blender/Meshy)
  n = n.replace(/^Armature[|/]/, '');
  // Quitar prefijo mixamorig: (con dos puntos — Meshy AI) o mixamorig (sin separador — Mixamo directo)
  n = n.replace(/^mixamorig[:]?/, '');
  // Quitar prefijo Character_ o Root_ (otros exportadores)
  n = n.replace(/^(Character_|Root_)/, '');
  return n;
}

// Remapeo de tracks: Mixamo/Meshy/Blender → huesos del modelo
// stripRootMotion: elimina position tracks del Hips para evitar saltos al hacer loop (walk/run)
function remapAnimationTracks(clip: THREE.AnimationClip, boneNames: Set<string>, stripRootMotion = false): THREE.AnimationClip {
  const remapped = clip.clone();

  // Pre-calcular mapa normalizado de huesos del modelo para matching rápido
  const normalizedBoneMap = new Map<string, string>();
  for (const bn of boneNames) {
    normalizedBoneMap.set(normalizeBoneName(bn).toLowerCase(), bn);
  }

  remapped.tracks = remapped.tracks.map(track => {
    const dotIdx = track.name.indexOf('.');
    if (dotIdx === -1) return track;
    const boneName = track.name.substring(0, dotIdx);
    const property = track.name.substring(dotIdx);

    // Ya coincide con un hueso del modelo
    if (boneNames.has(boneName)) return track;

    // Normalizar y buscar match
    const normalized = normalizeBoneName(boneName).toLowerCase();
    const matchedBone = normalizedBoneMap.get(normalized);
    if (matchedBone) {
      track.name = matchedBone + property;
      return track;
    }

    // Match parcial: el nombre normalizado del track contiene o es contenido por algún hueso
    for (const bn of boneNames) {
      const bnNorm = normalizeBoneName(bn).toLowerCase();
      if (bnNorm === normalized || (bnNorm.length > 3 && normalized.includes(bnNorm)) || (normalized.length > 3 && bnNorm.includes(normalized))) {
        track.name = bn + property;
        return track;
      }
    }

    return track;
  }).filter(track => {
    const dotIdx = track.name.indexOf('.');
    const boneName = dotIdx !== -1 ? track.name.substring(0, dotIdx) : track.name;
    if (!boneNames.has(boneName)) return false;

    // Strip root motion: eliminar position tracks del Hips (root bone)
    // Esto evita que el avatar "salte atrás" al reiniciar el loop de walk/run
    if (stripRootMotion) {
      const property = track.name.substring(dotIdx);
      const isHips = boneName.toLowerCase().includes('hips');
      if (isHips && property === '.position') return false;
    }
    return true;
  });

  if (remapped.tracks.length === 0 && clip.tracks.length > 0) {
    console.warn(`⚠️ remapAnimationTracks: ${clip.name} — 0/${clip.tracks.length} tracks matched. Posible mismatch de huesos.`);
  }
  return remapped;
}

// ============== COMPONENTE PRINCIPAL AVATAR GLTF ==============
export const GLTFAvatar: React.FC<GLTFAvatarProps> = ({ 
  avatarConfig,
  animationState = 'idle',
  direction = 'front',
  skinColor,
  clothingColor,
  scale = 1
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const [currentAnimation, setCurrentAnimation] = useState<AnimationState>('idle');
  
  // URL del modelo base
  const modelUrl = avatarConfig?.modelo_url || DEFAULT_MODEL_URL;
  
  // Cargar modelo principal (useGLTF solo para el modelo, no animaciones)
  const { scene, animations: baseAnimations } = useGLTF(modelUrl);
  
  // Clonar la escena correctamente para soportar SkinnedMesh
  const clone = useMemo(() => {
    const clonedScene = SkeletonUtils.clone(scene);
    return clonedScene;
  }, [scene]);

  // Obtener nodos del grafo clonado (necesario para animated components si los hubiera)
  const { nodes } = useGraph(clone);

  // Auto-corrección de escala y posición Y
  const { modelScaleCorrection, modelYOffset } = useMemo(() => {
    const localBox = new THREE.Box3();
    clone.traverse((child: any) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.geometry) {
        child.geometry.computeBoundingBox();
        if (child.geometry.boundingBox) {
          localBox.union(child.geometry.boundingBox);
        }
      }
    });
    const localSize = localBox.getSize(new THREE.Vector3());
    let scaleCorrection = 1;
    if (localSize.y > 0 && localSize.y < 0.5) {
      const TARGET_HEIGHT = 1.5;
      scaleCorrection = TARGET_HEIGHT / localSize.y;
    }
    const worldBox = new THREE.Box3().setFromObject(clone);
    let yOffset = 0;
    if (!worldBox.isEmpty() && worldBox.min.y > 0.5) {
      yOffset = -worldBox.min.y;
    }
    return { modelScaleCorrection: scaleCorrection, modelYOffset: yOffset };
  }, [clone]);

  // Recopilar nombres de huesos del modelo
  const boneNames = useMemo(() => {
    const names = new Set<string>();
    clone.traverse((child: any) => {
      if (child.isBone) names.add(child.name);
    });
    if (names.size > 0) {
      console.log(`🦴 [${avatarConfig?.nombre || 'unknown'}] Huesos del modelo (${names.size}):`, [...names].slice(0, 15).join(', '));
    }
    return names;
  }, [clone]);

  // ============== CARGA DINÁMICA DE TEXTURA (desde BD) ==============
  const [externalTexture, setExternalTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    const texturaUrl = avatarConfig?.textura_url;
    if (!texturaUrl) {
      setExternalTexture(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(texturaUrl, (tex) => {
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      setExternalTexture(tex);
    }, undefined, () => {
      console.warn('⚠️ Error cargando textura:', texturaUrl);
      setExternalTexture(null);
    });
  }, [avatarConfig?.textura_url]);

  // Aplicar textura externa SOLO si existe (no tocar materiales originales del GLB)
  useEffect(() => {
    if (!externalTexture) return;
    clone.traverse((child: any) => {
      if (child.isMesh || child.isSkinnedMesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (!mat) return;
        mat.map = externalTexture;
        mat.metalness = 0;
        mat.roughness = 0.9;
        mat.side = THREE.DoubleSide;
        mat.needsUpdate = true;
      }
    });
  }, [clone, externalTexture]);

  // ============== CARGA DINÁMICA DE ANIMACIONES (desde BD) ==============
  const [loadedAnimClips, setLoadedAnimClips] = useState<Record<string, THREE.AnimationClip>>({});
  const animConfigRef = useRef<string>('');

  // Ref para trackear el avatar actual y evitar re-cargas innecesarias
  const currentAvatarIdRef = useRef<string>('');

  useEffect(() => {
    if (boneNames.size === 0) return;
    let avatarId = avatarConfig?.id;
    if (avatarId === 'default') return;

    // Si ya cargamos para este avatar (o default), no re-cargar
    const cacheKey = avatarId || '_default_';
    if (cacheKey === currentAvatarIdRef.current && Object.keys(loadedAnimClips).length > 0) return;

    // Intentar usar animaciones del config, sino cargar de BD
    const loadAnimations = async () => {
      let animaciones = avatarConfig?.animaciones;

      // Si no hay avatarConfig (avatar remoto), obtener el primer avatar activo de BD
      if (!avatarId) {
        const { data: defaultAvatar } = await supabase
          .from('avatares_3d')
          .select('id')
          .eq('activo', true)
          .order('orden', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!defaultAvatar) return;
        avatarId = defaultAvatar.id;
      }

      // Si el config no trae animaciones, cargarlas directamente de BD
      if (!animaciones || animaciones.length === 0) {
        console.warn('🎬 Config sin animaciones, cargando de BD para', avatarConfig?.nombre || 'avatar remoto');
        const { data: anims } = await supabase
          .from('avatar_animaciones')
          .select('id, nombre, url, loop, orden, strip_root_motion')
          .eq('avatar_id', avatarId)
          .eq('activo', true)
          .order('orden', { ascending: true });

        if (!anims || anims.length === 0) return;
        animaciones = anims.map((a: any) => ({
          id: a.id,
          nombre: a.nombre,
          url: a.url,
          loop: a.loop ?? false,
          orden: a.orden ?? 0,
          strip_root_motion: a.strip_root_motion ?? false,
        }));
      }

      // Evitar re-cargar si la config no cambió
      const configKey = animaciones.map(a => a.url).join('|');
      if (configKey === animConfigRef.current) return;
      animConfigRef.current = configKey;
      currentAvatarIdRef.current = cacheKey;

      const loader = new GLTFLoader();
      console.log('🎬 Cargando', animaciones.length, 'anims:', avatarConfig?.nombre || 'avatar remoto');

      const results = await Promise.all(
        animaciones.map(async (anim) => {
          try {
            const gltf = await loader.loadAsync(anim.url);
            return { nombre: anim.nombre, clips: gltf.animations, strip: anim.strip_root_motion ?? false };
          } catch (err) {
            console.warn(`  ❌ Error loading ${anim.nombre}:`, err);
            return null;
          }
        })
      );

      // Solo aplicar si seguimos en el mismo avatar
      if (currentAvatarIdRef.current !== cacheKey) return;
      const clips: Record<string, THREE.AnimationClip> = {};
      results.forEach((r) => {
        if (r && r.clips.length > 0) {
          const clip = remapAnimationTracks(r.clips[0], boneNames, r.strip);
          clip.name = r.nombre;
          clips[r.nombre] = clip;
        }
      });
      console.log('🎬 Anims OK:', Object.keys(clips).join(','));
      setLoadedAnimClips(clips);
    };

    loadAnimations();
  }, [avatarConfig?.id, avatarConfig?.animaciones, boneNames]);

  // Combinar animaciones: embedded del modelo + cargadas dinámicamente desde BD
  const allAnimations = useMemo(() => {
    const anims: THREE.AnimationClip[] = [];

    // Idle: usar del BD si existe, sino del modelo embedded
    if (loadedAnimClips['idle']) {
      anims.push(loadedAnimClips['idle']);
    } else if (baseAnimations.length > 0) {
      const clip = remapAnimationTracks(baseAnimations[0], boneNames);
      clip.name = 'idle';
      anims.push(clip);
    }

    // Todas las demás animaciones cargadas desde BD
    Object.entries(loadedAnimClips).forEach(([name, clip]) => {
      if (name !== 'idle') anims.push(clip);
    });

    return anims;
  }, [baseAnimations, boneNames, loadedAnimClips]);
  
  // ============== MIXER MANUAL (reemplaza useAnimations de drei para aislamiento total) ==============
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const clipVersionRef = useRef(0);

  // Crear mixer una sola vez cuando el grupo esté montado
  useEffect(() => {
    if (!groupRef.current) return;
    const mixer = new THREE.AnimationMixer(groupRef.current);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      if (groupRef.current) {
        mixer.uncacheRoot(groupRef.current);
      }
      mixerRef.current = null;
    };
  }, []);

  // Reconstruir actions cuando cambian los clips
  useEffect(() => {
    const mixer = mixerRef.current;
    const root = groupRef.current;
    if (!mixer || !root || allAnimations.length === 0) return;

    // Limpiar actions anteriores
    mixer.stopAllAction();
    Object.values(actionsRef.current).forEach(action => {
      mixer.uncacheAction(action.getClip(), root);
    });

    // Crear actions nuevas
    const newActions: Record<string, THREE.AnimationAction> = {};
    allAnimations.forEach(clip => {
      newActions[clip.name] = mixer.clipAction(clip, root);
    });
    actionsRef.current = newActions;
    clipVersionRef.current++;

    // Iniciar idle por defecto
    if (newActions['idle']) {
      newActions['idle'].reset().fadeIn(0.2).play();
    }
    setCurrentAnimation('idle');
  }, [allAnimations]);

  // Avanzar mixer cada frame
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  // Referencia estable a actions para useEffect de transición
  const actions = actionsRef.current;

  // Cambiar animación según estado — transiciones inmediatas al moverse, debounce solo al volver a idle
  const pendingAnimRef = useRef<{ anim: AnimationState; timer: ReturnType<typeof setTimeout> } | null>(null);
  const CROSSFADE_FAST = 0.15;
  const CROSSFADE_SMOOTH = 0.3;
  const IDLE_DEBOUNCE_MS = 100;

  useEffect(() => {
    if (!actions || Object.keys(actions).length === 0) return;
    
    const targetAnim = animationState;
    if (currentAnimation === targetAnim) {
      if (pendingAnimRef.current) {
        clearTimeout(pendingAnimRef.current.timer);
        pendingAnimRef.current = null;
      }
      return;
    }

    const ANIM_FALLBACKS: Record<string, string[]> = {
      cheer: ['wave', 'dance', 'victory', 'idle'],
      wave: ['cheer', 'idle'],
      victory: ['cheer', 'wave', 'idle'],
      jump: ['cheer', 'idle'],
      dance: ['idle'],
      sit: ['idle'],
      walk: ['idle'],
      run: ['walk', 'idle'],
    };

    const resolveAnim = (anim: string): string => {
      if (actions[anim]) return anim;
      const fallbacks = ANIM_FALLBACKS[anim] || ['idle'];
      for (const fb of fallbacks) {
        if (actions[fb]) return fb;
      }
      return currentAnimation;
    };

    const resolvedAnim = resolveAnim(targetAnim) as AnimationState;

    const applyTransition = (fadeDuration: number) => {
      pendingAnimRef.current = null;
      const current = actions[currentAnimation];
      if (current) {
        current.fadeOut(fadeDuration);
      }
      const next = actions[resolvedAnim];
      if (next) {
        next.reset();
        next.setLoop(
          LOOP_ANIMATIONS.includes(resolvedAnim) ? THREE.LoopRepeat : THREE.LoopOnce,
          LOOP_ANIMATIONS.includes(resolvedAnim) ? Infinity : 1
        );
        next.clampWhenFinished = !LOOP_ANIMATIONS.includes(resolvedAnim);
        next.fadeIn(fadeDuration).play();
        setCurrentAnimation(resolvedAnim);
      }
    };

    if (pendingAnimRef.current) {
      clearTimeout(pendingAnimRef.current.timer);
      pendingAnimRef.current = null;
    }

    const isReturningToIdle = targetAnim === 'idle' && (currentAnimation === 'walk' || currentAnimation === 'run');
    
    if (isReturningToIdle) {
      pendingAnimRef.current = {
        anim: targetAnim,
        timer: setTimeout(() => applyTransition(CROSSFADE_SMOOTH), IDLE_DEBOUNCE_MS),
      };
    } else {
      const isStartingMovement = (targetAnim === 'walk' || targetAnim === 'run') && currentAnimation === 'idle';
      applyTransition(isStartingMovement ? CROSSFADE_FAST : CROSSFADE_SMOOTH);
    }

    return () => {
      if (pendingAnimRef.current) {
        clearTimeout(pendingAnimRef.current.timer);
        pendingAnimRef.current = null;
      }
    };
  }, [animationState, currentAnimation, clipVersionRef.current]);

  // Aplicar colores personalizados SOLO si se pasan explícitamente (respetar materiales originales del GLB)
  useEffect(() => {
    if (!clone || (!skinColor && !clothingColor)) return;
    clone.traverse((child: any) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        const meshName = child.name.toLowerCase();
        if (skinColor && (meshName.includes('skin') || meshName.includes('head') || meshName.includes('face'))) {
          mat.color = new THREE.Color(skinColor);
          mat.needsUpdate = true;
        }
        if (clothingColor && (meshName.includes('body') || meshName.includes('cloth') || meshName.includes('shirt'))) {
          mat.color = new THREE.Color(clothingColor);
          mat.needsUpdate = true;
        }
      }
    });
  }, [clone, skinColor, clothingColor]);

  // Rotación según dirección (delta-time based para fluidez independiente del framerate)
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    const rotations: Record<string, number> = {
      left: -Math.PI / 2,
      right: Math.PI / 2,
      up: Math.PI,
      back: Math.PI,
      front: 0,
      down: 0,
      'front-left': -Math.PI / 4,
      'front-right': Math.PI / 4,
      'up-left': -Math.PI * 3 / 4,
      'up-right': Math.PI * 3 / 4,
    };
    
    const targetRotation = rotations[direction] || 0;
    // Factor independiente del framerate: misma velocidad a 30fps o 60fps
    const lerpFactor = 1 - Math.pow(1 - 0.15, delta * 60);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRotation,
      lerpFactor
    );
  });

  const avatarScale = (avatarConfig?.escala || 1) * scale * modelScaleCorrection;

  return (
    <group ref={groupRef}>
      <group scale={[avatarScale, avatarScale, avatarScale]} position={[0, modelYOffset * avatarScale, 0]}>
        <primitive object={clone} />
      </group>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} />
      </mesh>
    </group>
  );
};

// ============== HOOK PARA CARGAR AVATAR Y ANIMACIONES ==============
export const useAvatar3D = (userId?: string) => {
  const [avatarConfig, setAvatarConfig] = useState<Avatar3DConfig | null>(null);
  const [animaciones, setAnimaciones] = useState<AnimationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAvatar = async () => {
      try {
        setLoading(true);
        setError(null);

        // Obtener el usuario actual si no se proporcionó userId
        let targetUserId = userId;
        if (!targetUserId) {
          const { data: { user } } = await supabase.auth.getUser();
          targetUserId = user?.id;
        }

        if (!targetUserId) {
          setAvatarConfig(null);
          setLoading(false);
          return;
        }

        // Buscar avatar asignado al usuario (avatar_3d_id está en tabla usuarios)
        const { data: usuario } = await supabase
          .from('usuarios')
          .select('avatar_3d_id')
          .eq('id', targetUserId)
          .maybeSingle();

        let avatarId = usuario?.avatar_3d_id;

        if (!avatarId) {
          // Sin avatar asignado → buscar primer avatar activo como default
          const { data: defaultAvatar } = await supabase
            .from('avatares_3d')
            .select('id')
            .eq('activo', true)
            .order('orden', { ascending: true })
            .limit(1)
            .maybeSingle();
          
          if (defaultAvatar) {
            avatarId = defaultAvatar.id;
          } else {
            // No hay avatares en BD, usar fallback estático
            setAvatarConfig({
              id: 'default',
              nombre: 'Default',
              modelo_url: DEFAULT_MODEL_URL,
              escala: 1,
            });
            setLoading(false);
            return;
          }
        }

        // Cargar config del avatar
        const { data: avatar, error: avatarError } = await supabase
          .from('avatares_3d')
          .select('*')
          .eq('id', avatarId)
          .single();

        if (avatarError) {
          console.warn('⚠️ Error cargando avatar:', avatarError.message);
          setAvatarConfig({
            id: 'default',
            nombre: 'Default',
            modelo_url: DEFAULT_MODEL_URL,
            escala: 1,
          });
        } else if (avatar) {
          // Config base del avatar
          const config: Avatar3DConfig = {
            id: avatar.id,
            nombre: avatar.nombre,
            modelo_url: avatar.modelo_url || DEFAULT_MODEL_URL,
            escala: avatar.escala || 1,
            textura_url: avatar.textura_url || null,
          };
          setAvatarConfig(config);
        }

        // Cargar animaciones desde avatar_animaciones (100% dinámico desde BD)
        const { data: anims } = await supabase
          .from('avatar_animaciones')
          .select('*')
          .eq('avatar_id', avatarId)
          .eq('activo', true)
          .order('orden', { ascending: true });

        if (anims && anims.length > 0) {
          const animConfigs = anims.map((a: any) => ({
            id: a.id,
            nombre: a.nombre,
            url: a.url,
            loop: a.loop ?? false,
            orden: a.orden ?? 0,
            strip_root_motion: a.strip_root_motion ?? false,
          }));
          setAnimaciones(animConfigs);
          // Inyectar animaciones en el avatarConfig para que GLTFAvatar las cargue
          setAvatarConfig(prev => prev ? { ...prev, animaciones: animConfigs } : prev);
        }
      } catch (err: any) {
        console.error('❌ Error en useAvatar3D:', err);
        setError(err.message || 'Error desconocido');
        setAvatarConfig({
          id: 'default',
          nombre: 'Default',
          modelo_url: DEFAULT_MODEL_URL,
          escala: 1,
        });
      } finally {
        setLoading(false);
      }
    };

    loadAvatar();
  }, [userId]);

  return { avatarConfig, animaciones, loading, error };
};

// ============== HOOK PARA CONTROLES DE TECLADO ==============
export const useAvatarControls = () => {
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const [direction, setDirection] = useState<string>('front');
  const [isMoving, setIsMoving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const keysPressed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable);
      if (isTyping) return;
      
      keysPressed.current.add(e.code);
      
      // Shift para correr
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsRunning(true);
      }
      
      // Teclas de acción especiales (dance/cheer manuales, sit es contextual)
      if (e.code === 'KeyE') setAnimationState('cheer');
      if (e.code === 'KeyQ') setAnimationState('dance');
      
      // Flechas y WASD para movimiento
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.code);
      
      // Soltar shift
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsRunning(false);
      }
      
      // Volver a idle cuando se sueltan teclas de acción
      if (['KeyE', 'KeyQ'].includes(e.code)) {
        setAnimationState('idle');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Actualizar estado de movimiento
  const updateMovement = (dx: number, dy: number) => {
    const moving = dx !== 0 || dy !== 0;
    setIsMoving(moving);
    
    if (moving) {
      // Determinar dirección
      if (Math.abs(dx) > Math.abs(dy)) {
        setDirection(dx > 0 ? 'right' : 'left');
      } else {
        setDirection(dy > 0 ? 'up' : 'front');
      }
      
      // Cambiar animación según si corre o camina
      setAnimationState(isRunning ? 'run' : 'walk');
    } else if (animationState === 'walk' || animationState === 'run') {
      setAnimationState('idle');
    }
  };

  return {
    animationState,
    setAnimationState,
    direction,
    setDirection,
    isMoving,
    isRunning,
    keysPressed,
    updateMovement
  };
};

// Precargar modelo por defecto
useGLTF.preload(DEFAULT_MODEL_URL);

// ============== AVATAR PROCEDURAL CHIBI (FALLBACK) ==============
interface ProceduralAvatarProps {
  config: {
    skinColor?: string;
    clothingColor?: string;
    hairColor?: string;
    hairStyle?: string;
    accessory?: string;
    eyeColor?: string;
  };
  isMoving?: boolean;
  direction?: string;
}

export const ProceduralChibiAvatar: React.FC<ProceduralAvatarProps> = ({ 
  config, 
  isMoving = false, 
  direction = 'front' 
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const time = useRef(0);

  const { 
    skinColor = '#fcd34d', 
    clothingColor = '#6366f1', 
    hairColor = '#4b2c20', 
    hairStyle = 'default', 
    accessory = 'none', 
    eyeColor = '#3b82f6' 
  } = config || {};

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    time.current += delta;
    
    // Animación de bounce
    const bounceSpeed = isMoving ? 12 : 2;
    const bounceHeight = isMoving ? 0.15 : 0.05;
    groupRef.current.position.y = Math.sin(time.current * bounceSpeed) * bounceHeight;
    
    // Rotación según dirección (invertido para vista isométrica)
    const rotations: Record<string, number> = {
      left: -Math.PI / 2,
      right: Math.PI / 2,
      up: Math.PI,
      front: 0,
      down: 0,
    };
    groupRef.current.rotation.y = rotations[direction] || 0;
  });

  return (
    <group ref={groupRef}>
      {/* === CUERPO === */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.35, 12, 24]} />
        <meshStandardMaterial color={clothingColor} roughness={0.6} />
      </mesh>
      
      {/* Detalle de ropa - cuello */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 0.1, 16]} />
        <meshStandardMaterial color={clothingColor} roughness={0.6} />
      </mesh>

      {/* === CABEZA === */}
      <group position={[0, 1.05, 0]}>
        {/* Cabeza base */}
        <mesh castShadow>
          <sphereGeometry args={[0.38, 24, 24]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>
        
        {/* Orejas */}
        <mesh position={[-0.35, 0, 0]} castShadow>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>
        <mesh position={[0.35, 0, 0]} castShadow>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>

        {/* === CABELLO === */}
        {hairStyle === 'default' && (
          <>
            <mesh position={[0, 0.15, 0]} castShadow>
              <sphereGeometry args={[0.36, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.1, 0.25]} castShadow>
              <boxGeometry args={[0.5, 0.15, 0.15]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
          </>
        )}
        
        {hairStyle === 'spiky' && (
          <>
            <mesh position={[0, 0.25, 0]} castShadow>
              <coneGeometry args={[0.25, 0.4, 8]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
            <mesh position={[0.15, 0.2, 0]} rotation={[0, 0, -0.4]} castShadow>
              <coneGeometry args={[0.12, 0.25, 6]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
            <mesh position={[-0.15, 0.2, 0]} rotation={[0, 0, 0.4]} castShadow>
              <coneGeometry args={[0.12, 0.25, 6]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
          </>
        )}
        
        {hairStyle === 'long' && (
          <>
            <mesh position={[0, 0.1, 0]} castShadow>
              <sphereGeometry args={[0.4, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, -0.2, -0.15]} castShadow>
              <capsuleGeometry args={[0.25, 0.5, 8, 16]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
          </>
        )}
        
        {hairStyle === 'ponytail' && (
          <>
            <mesh position={[0, 0.15, 0]} castShadow>
              <sphereGeometry args={[0.36, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.1, -0.35]} rotation={[0.5, 0, 0]} castShadow>
              <capsuleGeometry args={[0.1, 0.4, 8, 12]} />
              <meshStandardMaterial color={hairColor} roughness={0.8} />
            </mesh>
          </>
        )}

        {/* === CARA === */}
        <group position={[0, 0, 0.32]}>
          {/* Ojo izquierdo */}
          <mesh position={[-0.12, 0, 0]}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[-0.12, 0, 0.05]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color={eyeColor} />
          </mesh>
          <mesh position={[-0.12, 0, 0.08]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
          
          {/* Ojo derecho */}
          <mesh position={[0.12, 0, 0]}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.12, 0, 0.05]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color={eyeColor} />
          </mesh>
          <mesh position={[0.12, 0, 0.08]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
        </group>
        
        {/* Cejas */}
        <mesh position={[-0.12, 0.12, 0.33]} rotation={[0, 0, 0.1]}>
          <boxGeometry args={[0.1, 0.02, 0.02]} />
          <meshBasicMaterial color={hairColor} />
        </mesh>
        <mesh position={[0.12, 0.12, 0.33]} rotation={[0, 0, -0.1]}>
          <boxGeometry args={[0.1, 0.02, 0.02]} />
          <meshBasicMaterial color={hairColor} />
        </mesh>
        
        {/* Boca */}
        <mesh position={[0, -0.12, 0.34]}>
          <torusGeometry args={[0.06, 0.015, 8, 16, Math.PI]} />
          <meshBasicMaterial color="#d97706" />
        </mesh>
        
        {/* Mejillas */}
        <mesh position={[-0.22, -0.05, 0.28]}>
          <circleGeometry args={[0.05, 16]} />
          <meshBasicMaterial color="#fca5a5" transparent opacity={0.5} />
        </mesh>
        <mesh position={[0.22, -0.05, 0.28]}>
          <circleGeometry args={[0.05, 16]} />
          <meshBasicMaterial color="#fca5a5" transparent opacity={0.5} />
        </mesh>
      </group>

      {/* === BRAZOS === */}
      <mesh position={[-0.42, 0.5, 0]} rotation={[0, 0, 0.4]} castShadow>
        <capsuleGeometry args={[0.08, 0.25, 8, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>
      <mesh position={[0.42, 0.5, 0]} rotation={[0, 0, -0.4]} castShadow>
        <capsuleGeometry args={[0.08, 0.25, 8, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>
      
      {/* Manos */}
      <mesh position={[-0.52, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>
      <mesh position={[0.52, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>

      {/* === PIERNAS === */}
      <mesh position={[-0.12, 0, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.2, 8, 12]} />
        <meshStandardMaterial color={clothingColor} roughness={0.6} />
      </mesh>
      <mesh position={[0.12, 0, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.2, 8, 12]} />
        <meshStandardMaterial color={clothingColor} roughness={0.6} />
      </mesh>
      
      {/* Zapatos */}
      <mesh position={[-0.12, -0.18, 0.05]} castShadow>
        <boxGeometry args={[0.12, 0.08, 0.18]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} />
      </mesh>
      <mesh position={[0.12, -0.18, 0.05]} castShadow>
        <boxGeometry args={[0.12, 0.08, 0.18]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} />
      </mesh>

      {/* === ACCESORIOS === */}
      {accessory === 'glasses' && (
        <group position={[0, 1.05, 0.35]}>
          <mesh position={[-0.12, 0, 0]}>
            <torusGeometry args={[0.08, 0.015, 8, 16]} />
            <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0.12, 0, 0]}>
            <torusGeometry args={[0.08, 0.015, 8, 16]} />
            <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.08, 0.015, 0.015]} />
            <meshStandardMaterial color="#1f2937" metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      )}
      
      {accessory === 'hat' && (
        <group position={[0, 1.45, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.35, 0.35, 0.05, 24]} />
            <meshStandardMaterial color="#7c3aed" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.15, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.25, 0.25, 24]} />
            <meshStandardMaterial color="#7c3aed" roughness={0.7} />
          </mesh>
        </group>
      )}
      
      {accessory === 'headphones' && (
        <group position={[0, 1.15, 0]}>
          <mesh position={[0, 0.25, 0]}>
            <torusGeometry args={[0.32, 0.03, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[-0.35, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.08, 16]} />
            <meshStandardMaterial color="#ef4444" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0.35, 0, 0]} rotation={[0, -Math.PI / 2, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 0.08, 16]} />
            <meshStandardMaterial color="#ef4444" metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      )}

      {/* Sombra */}
      <mesh position={[0, -0.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} />
      </mesh>
    </group>
  );
};

export default ProceduralChibiAvatar;
