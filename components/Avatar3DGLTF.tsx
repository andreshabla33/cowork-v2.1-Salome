'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useGraph } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils, GLTFLoader } from 'three-stdlib';
import { supabase } from '../lib/supabase';

// ============== TIPOS ==============
export interface AnimationConfig {
  id: string;
  nombre: string;
  url: string;
  loop: boolean;
  orden: number;
  strip_root_motion?: boolean;
  es_fallback?: boolean;
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

// Configurar DRACOLoader para soportar GLBs con compresión Draco (gltf-transform)
// Los decoders están en public/draco/ (copiados de three/examples/jsm/libs/draco/)
useGLTF.setDecoderPath('/draco/');

// URL del modelo por defecto (fallback cuando no hay avatar configurado)
const STORAGE_BASE = 'https://lcryrsdyrzotjqdxcwtp.supabase.co/storage/v1/object/public/avatars';
const DEFAULT_MODEL_URL = `${STORAGE_BASE}/Monica_Idle.glb`;

// Animaciones que hacen loop
const LOOP_ANIMATIONS: AnimationState[] = ['idle', 'walk', 'run', 'dance'];

// Mapeo de nombres de animaciones embebidas en GLB → AnimationState
// Permite que GLBs all-in-one (ej: Ren_Final.glb) sean detectados automáticamente
const EMBEDDED_NAME_MAP: Record<string, AnimationState> = {
  'idle': 'idle', 'breathing idle': 'idle', 'happy idle': 'idle',
  'walk': 'walk', 'walking': 'walk', 'walk forward': 'walk',
  'run': 'run', 'running': 'run', 'jog': 'run', 'run forward': 'run',
  'dance': 'dance', 'dancing': 'dance', 'hip hop dancing': 'dance', 'samba dancing': 'dance',
  'cheer': 'cheer', 'cheering': 'cheer', 'cheer with both hands': 'cheer',
  'sit': 'sit', 'sitting': 'sit', 'sitting idle': 'sit',
  'wave': 'wave', 'waving': 'wave', 'wave gesture': 'wave',
  'jump': 'jump', 'jumping': 'jump', 'happy jump': 'jump', 'happy jump f': 'jump',
  'victory': 'victory', 'victory cheer': 'victory',
};

// Tabla de equivalencias entre convenciones de nombres de huesos
// Después de normalizeBoneName (strip prefixes + leading zeros), estos aliases
// cubren convenciones genuinamente distintas (ej: pelvis/hips, chest/spine1)
// Ya NO necesitamos spine01→spine1 porque normalizeBoneName lo resuelve automáticamente.
const BONE_ALIASES: Record<string, string[]> = {
  'hips': ['hips', 'pelvis', 'root'],
  'spine': ['spine'],
  'spine1': ['spine1', 'chest'],
  'spine2': ['spine2', 'upperchest'],
  'neck': ['neck'],
  'head': ['head'],
  'headtop_end': ['headtop_end', 'headtop', 'head_end', 'headfront'],
  'leftshoulder': ['leftshoulder', 'leftcollar', 'l_shoulder', 'shoulder_l'],
  'leftarm': ['leftarm', 'leftuparm', 'l_upperarm', 'upperarm_l'],
  'leftforearm': ['leftforearm', 'leftlowarm', 'l_forearm', 'forearm_l', 'leftlowerarm'],
  'lefthand': ['lefthand', 'l_hand', 'hand_l'],
  'rightshoulder': ['rightshoulder', 'rightcollar', 'r_shoulder', 'shoulder_r'],
  'rightarm': ['rightarm', 'rightuparm', 'r_upperarm', 'upperarm_r'],
  'rightforearm': ['rightforearm', 'rightlowarm', 'r_forearm', 'forearm_r', 'rightlowerarm'],
  'righthand': ['righthand', 'r_hand', 'hand_r'],
  'leftupleg': ['leftupleg', 'leftthigh', 'l_thigh', 'thigh_l', 'leftupperleg'],
  'leftleg': ['leftleg', 'leftcalf', 'l_calf', 'calf_l', 'leftlowerleg', 'leftknee'],
  'leftfoot': ['leftfoot', 'l_foot', 'foot_l'],
  'lefttoebase': ['lefttoebase', 'lefttoe', 'l_toe', 'toe_l'],
  'lefttoe_end': ['lefttoe_end', 'lefttoeend'],
  'rightupleg': ['rightupleg', 'rightthigh', 'r_thigh', 'thigh_r', 'rightupperleg'],
  'rightleg': ['rightleg', 'rightcalf', 'r_calf', 'calf_r', 'rightlowerleg', 'rightknee'],
  'rightfoot': ['rightfoot', 'r_foot', 'foot_r'],
  'righttoebase': ['righttoebase', 'righttoe', 'r_toe', 'toe_r'],
  'righttoe_end': ['righttoe_end', 'righttoeend'],
};

// Normalizar nombre de hueso: quitar prefijos comunes y unificar sufijos numéricos.
// Objetivo: que Mixamo "mixamorigSpine1" y Meshy "Spine01" normalicen igual → "Spine1"
function normalizeBoneName(name: string): string {
  let n = name;
  // Quitar prefijo Armature| o Armature/ (Blender/Meshy)
  n = n.replace(/^Armature[|/]/, '');
  // Quitar prefijo mixamorig: (con dos puntos — Meshy AI) o mixamorig (sin separador — Mixamo directo)
  n = n.replace(/^mixamorig\d*[:]?/, '');
  // Quitar prefijo Character_ o Root_ (otros exportadores)
  n = n.replace(/^(Character_|Root_)/, '');
  // Normalizar sufijos numéricos: Spine01→Spine1, Spine02→Spine2, neck01→neck1
  // Esto unifica Meshy (01,02) con Mixamo (1,2) automáticamente
  n = n.replace(/(\D)0+(\d+)$/, '$1$2');
  return n;
}

// Remapeo de tracks: Mixamo/Meshy/Blender → huesos del modelo
// stripRootMotion: elimina position tracks del Hips para evitar saltos al hacer loop (walk/run)
function remapAnimationTracks(
  clip: THREE.AnimationClip,
  boneNames: Set<string>,
  stripRootMotion = false,
  spineOverrides?: Map<string, string>,
  stripPositions = false,
  stripScale = false,
): THREE.AnimationClip {
  const remapped = clip.clone();

  // Pre-calcular mapa normalizado de huesos del modelo para matching rápido
  const normalizedBoneMap = new Map<string, string>();
  for (const bn of boneNames) {
    normalizedBoneMap.set(normalizeBoneName(bn).toLowerCase(), bn);
  }

  // Aplicar overrides de jerarquía spine (resuelve Meshy reversed: Spine02→Spine01→Spine)
  if (spineOverrides) {
    for (const [normalizedKey, actualBone] of spineOverrides) {
      normalizedBoneMap.set(normalizedKey, actualBone);
    }
  }

  // Pre-calcular mapa inverso de aliases: para cada alias → nombre real del hueso del modelo
  const aliasToModelBone = new Map<string, string>();
  for (const bn of boneNames) {
    const normalizedLower = normalizeBoneName(bn).toLowerCase();
    // Buscar en qué grupo de aliases cae este hueso del modelo
    for (const [, aliases] of Object.entries(BONE_ALIASES)) {
      if (aliases.includes(normalizedLower)) {
        // Registrar TODOS los aliases de este grupo apuntando al hueso real del modelo
        for (const alias of aliases) {
          if (!aliasToModelBone.has(alias)) {
            aliasToModelBone.set(alias, bn);
          }
        }
        break;
      }
    }
  }

  remapped.tracks = remapped.tracks.map(track => {
    const dotIdx = track.name.indexOf('.');
    if (dotIdx === -1) return track;
    const boneName = track.name.substring(0, dotIdx);
    const property = track.name.substring(dotIdx);

    // Ya coincide con un hueso del modelo
    if (boneNames.has(boneName)) return track;

    // Normalizar y buscar match directo
    const normalized = normalizeBoneName(boneName).toLowerCase();
    const matchedBone = normalizedBoneMap.get(normalized);
    if (matchedBone) {
      track.name = matchedBone + property;
      return track;
    }

    // Buscar match por aliases (ej: Mixamo "Spine1" → modelo "Spine02")
    const aliasMatch = aliasToModelBone.get(normalized);
    if (aliasMatch) {
      track.name = aliasMatch + property;
      return track;
    }

    return track;
  }).filter(track => {
    const dotIdx = track.name.indexOf('.');
    const boneName = dotIdx !== -1 ? track.name.substring(0, dotIdx) : track.name;
    if (!boneNames.has(boneName)) return false;

    const property = track.name.substring(dotIdx);
    const isHips = boneName.toLowerCase().includes('hips');

    // En animaciones fallback (cross-skeleton):
    // 1. Eliminar tracks de escala (evita cabezas gigantes si se hereda de un chibi)
    // 2. Mantener posiciones de huesos, ya que Mixamo a menudo define la longitud 
    //    de los huesos en el track de posición. Si los borramos, el esqueleto colapsa al piso.
    // Strip scale tracks de animaciones embebidas del pipeline Blender:
    // el factor 0.01 (FBX cm→m) puede quedar bakeado en los tracks, encogiendo el avatar.
    if (stripScale && property === '.scale') return false;

    if (stripPositions) {
      if (property === '.scale') return false;
      // Cross-skeleton: eliminar TODAS las posiciones (no solo Hips).
      // Los tracks .position de cada hueso codifican las proporciones del personaje fuente
      // (longitud de huesos, offsets). Si los mantenemos, sobreescriben las proporciones
      // del avatar destino → estiramiento en idle, pies bajo el suelo al caminar.
      // Solo se conservan rotaciones (quaternion), que son transferibles entre esqueletos.
      if (property === '.position') return false;
    }

    // Strip root motion: eliminar position tracks del Hips (root bone) para walk/run
    // Esto evita que el avatar "salte atrás" al reiniciar el loop
    if (stripRootMotion && isHips && property === '.position') {
      return false;
    }
    
    return true;
  });

  const matchRate = clip.tracks.length > 0 ? remapped.tracks.length / clip.tracks.length : 0;
  // Diagnóstico: mostrar huesos no mapeados
  const unmatchedBones = new Set<string>();
  clip.tracks.forEach(track => {
    const dotIdx = track.name.indexOf('.');
    const boneName = dotIdx !== -1 ? track.name.substring(0, dotIdx) : track.name;
    // Verificar si este bone terminó en remapped.tracks
    const found = remapped.tracks.some(rt => {
      const rd = rt.name.indexOf('.');
      return rd !== -1 ? rt.name.substring(0, rd) === boneName || rt.name.substring(0, rd) === (normalizedBoneMap.get(normalizeBoneName(boneName).toLowerCase()) || '') : false;
    });
    if (!boneNames.has(boneName) && !normalizedBoneMap.has(normalizeBoneName(boneName).toLowerCase()) && !aliasToModelBone.has(normalizeBoneName(boneName).toLowerCase())) {
      unmatchedBones.add(boneName);
    }
  });
  if (unmatchedBones.size > 0) {
    console.warn(`❌ remap ${clip.name}: huesos sin match:`, [...unmatchedBones].join(', '));
  }
  console.log(`📊 remap ${clip.name}: ${remapped.tracks.length}/${clip.tracks.length} tracks (${Math.round(matchRate * 100)}%)`);
  if (remapped.tracks.length === 0 && clip.tracks.length > 0) {
    console.warn(`⚠️ remapAnimationTracks: ${clip.name} — 0/${clip.tracks.length} tracks matched. Esqueleto incompatible.`);
  }
  // Marcar el clip con el ratio de match para que el caller pueda decidir si usarlo
  (remapped as any)._matchRate = matchRate;
  return remapped;
}

// ============== COMPONENTE PRINCIPAL AVATAR GLTF ==============
const GLTFAvatarInner: React.FC<GLTFAvatarProps> = ({ 
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
  
  // Cargar modelo principal + animaciones embebidas del GLB
  const { scene, animations: baseAnimations } = useGLTF(modelUrl);
  
  // Clonar la escena — usar SkeletonUtils.clone solo si tiene SkinnedMesh (esqueleto)
  const clone = useMemo(() => {
    // Detectar si el modelo tiene SkinnedMesh (necesita SkeletonUtils.clone)
    let hasSkinnedMesh = false;
    scene.traverse((child: any) => {
      if (child.isSkinnedMesh) hasSkinnedMesh = true;
    });

    // SkeletonUtils.clone para modelos con esqueleto, .clone() normal para estáticos
    const clonedScene = hasSkinnedMesh ? SkeletonUtils.clone(scene) : scene.clone(true);

    // Asegurar que texturas y materiales embebidos del GLB se rendericen correctamente
    clonedScene.traverse((child: any) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.material) {
        // Clonar material para no afectar el original compartido
        if (!hasSkinnedMesh) {
          child.material = child.material.clone();
        }
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat: any) => {
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
            mat.map.needsUpdate = true;
            // Forzar PBR web-compatible para avatares del pipeline FBX→Blender→GLB.
            // Sin esto, el metalness alto del exportador hace que el avatar se vea morado/azul
            // al reflejar el entorno (que es azul oscuro en el espacio virtual).
            mat.metalness = 0;
            mat.roughness = 0.9;
            mat.side = THREE.DoubleSide;
          }
          mat.needsUpdate = true;
        });
      }
    });
    console.log(`🎨 ${avatarConfig?.nombre || 'avatar'}: clone OK (skinned: ${hasSkinnedMesh})`);
    return clonedScene;
  }, [scene]);

  // Obtener nodos del grafo clonado (necesario para animated components si los hubiera)
  const { nodes } = useGraph(clone);

  // Escala 100% desde la BD (avatarConfig.escala). 
  // No auto-escalar, ya que Box3/vertices fallan consistentemente con SkinnedMesh variados.
  const { modelScaleCorrection, modelYOffset } = useMemo(() => {
    console.log(`📐 ${avatarConfig?.nombre || 'avatar'}: escala BD=${avatarConfig?.escala || 1} (fija, sin auto-scale)`);
    return { modelScaleCorrection: 1, modelYOffset: 0 };
  }, [avatarConfig?.escala, avatarConfig?.nombre]);

  // Recopilar nombres de huesos del modelo + detectar cadena spine por jerarquía
  const { boneNames, spineChainMap } = useMemo(() => {
    const names = new Set<string>();
    let hipsNode: any = null;
    clone.traverse((child: any) => {
      if (child.isBone) {
        names.add(child.name);
        if (!hipsNode && normalizeBoneName(child.name).toLowerCase() === 'hips') {
          hipsNode = child;
        }
      }
    });
    console.log(`🦴 ${avatarConfig?.nombre || 'avatar'}: ${names.size} huesos —`, [...names].join(', '));

    // Recorrer jerarquía spine desde Hips → primer hijo spine → siguiente → ...
    // Esto detecta automáticamente el orden real sin importar la convención de nombres
    const chainMap = new Map<string, string>();
    if (hipsNode) {
      const chain: string[] = [];
      let current = hipsNode;
      while (current) {
        const spineChild = current.children.find((c: any) => {
          if (!c.isBone) return false;
          const n = normalizeBoneName(c.name).toLowerCase();
          return n.includes('spine') || n === 'chest' || n === 'upperchest';
        });
        if (!spineChild) break;
        chain.push(spineChild.name);
        current = spineChild;
      }
      // Mapear posiciones de la cadena a nombres Mixamo normalizados
      const mixamoSpineKeys = ['spine', 'spine1', 'spine2'];
      for (let i = 0; i < Math.min(chain.length, mixamoSpineKeys.length); i++) {
        chainMap.set(mixamoSpineKeys[i], chain[i]);
      }
      if (chain.length > 0) {
        console.log(`🔗 ${avatarConfig?.nombre || 'avatar'}: spine chain [${chain.join(' → ')}]`);
      }
    }

    return { boneNames: names, spineChainMap: chainMap };
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
  // Patrón v3.8: Record<string, Clip> + cache por URL string
  const [loadedAnimClips, setLoadedAnimClips] = useState<Record<string, THREE.AnimationClip>>({});
  const animConfigRef = useRef<string>('');
  const currentAvatarIdRef = useRef<string>('');

  // Reset cache cuando cambia el avatar (fix T-pose al cambiar sin reload)
  useEffect(() => {
    const newId = avatarConfig?.id || '_default_';
    if (newId !== currentAvatarIdRef.current) {
      currentAvatarIdRef.current = '';
      animConfigRef.current = '';
      setLoadedAnimClips({});
    }
  }, [avatarConfig?.id]);

  useEffect(() => {
    if (boneNames.size === 0) return;
    let avatarId = avatarConfig?.id;
    if (avatarId === 'default') return;

    // Si ya cargamos (o decidimos skip BD) para este avatar, no re-cargar.
    const cacheKey = avatarId || '_default_';
    if (cacheKey === currentAvatarIdRef.current) return;

    // Esperar a que el modelo base esté cargado para saber cuántas animaciones embebidas tiene.
    // Si todavía no hay animaciones base pero el modelo se supone que las tiene, podríamos estar en un render intermedio.
    // Como las animaciones embebidas vienen junto con scene y nodes, si clone ya existe, baseAnimations es el definitivo.
    
    // GLB all-in-one: si el modelo tiene 2+ animaciones embebidas, NO cargar de BD.
    if (baseAnimations.length > 1) {
      currentAvatarIdRef.current = cacheKey;
      console.log(`🎬 ${avatarConfig?.nombre || 'avatar'}: GLB all-in-one (${baseAnimations.length} anims embebidas) — skip BD`);
      // IMPORTANTE: Aseguramos que loadedAnimClips esté vacío para que allAnimations use el Branch A
      setLoadedAnimClips({});
      return;
    }

    // Intentar usar animaciones del config, sino cargar de BD
    const loadAnimations = async () => {
      let animaciones = avatarConfig?.animaciones;
      let isCrossSkeleton = false;

      // Si el config no trae animaciones, cargarlas de BD
      if (!animaciones || animaciones.length === 0) {
        let anims: any[] | null = null;

        // 1) Buscar animaciones propias del avatar
        if (avatarId) {
          const { data } = await supabase
            .from('avatar_animaciones')
            .select('id, nombre, url, loop, orden, strip_root_motion')
            .eq('avatar_id', avatarId)
            .eq('activo', true)
            .order('orden', { ascending: true });
          anims = data;
        }

        // 2) Fallback: buscar animaciones universales (es_universal = true, compartidas por todos los avatares Mixamo)
        if (!anims || anims.length === 0) {
          console.log(`⚠️ ${avatarConfig?.nombre || 'avatar'}: sin anims propias, buscando universales...`);
          const { data: universalAnims } = await supabase
            .from('avatar_animaciones')
            .select('id, nombre, url, loop, orden, strip_root_motion')
            .eq('es_universal', true)
            .eq('activo', true)
            .order('orden', { ascending: true });
          if (universalAnims && universalAnims.length > 0) {
            anims = universalAnims;
            isCrossSkeleton = true;
            console.log(`✅ Universales: usando ${anims.length} anims compartidas`);
          }
        }

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

      // Evitar re-cargar si la config no cambió (comparación por URLs)
      const configKey = animaciones.map(a => a.url).join('|');
      if (configKey === animConfigRef.current) return;
      animConfigRef.current = configKey;
      currentAvatarIdRef.current = cacheKey;

      const loader = new GLTFLoader();
      console.log(`🎬 Cargando ${animaciones.length} anims: ${avatarConfig?.nombre || 'avatar'}`);

      const results = await Promise.all(
        animaciones.map(async (anim) => {
          try {
            const gltf = await loader.loadAsync(anim.url);
            return { nombre: anim.nombre, clips: gltf.animations, strip: anim.strip_root_motion ?? false, isUniversal: isCrossSkeleton };
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
          // Cross-skeleton (universales): stripPositions=true elimina Hips .position + .scale
          // Esto evita estiramiento y pies bajo el suelo por proporciones distintas
          const clip = remapAnimationTracks(r.clips[0], boneNames, r.strip, spineChainMap, r.isUniversal, r.isUniversal);
          const matchRate = (clip as any)._matchRate ?? 0;
          // Solo usar la animación si al menos 30% de los tracks coinciden con el esqueleto
          if (matchRate < 0.3 && r.clips[0].tracks.length > 0) {
            console.warn(`⚠️ ${r.nombre}: solo ${Math.round(matchRate * 100)}% tracks matched — descartada`);
            return;
          }
          clip.name = r.nombre;
          clips[r.nombre] = clip;
        }
      });
      console.log(`🎬 Anims OK:`, Object.keys(clips).join(', '));
      setLoadedAnimClips(clips);
    };

    loadAnimations();
  }, [avatarConfig?.id, avatarConfig?.animaciones, boneNames, baseAnimations]);

  // ============== ANIMACIONES (MERGE: embebidas GLB + BD) — Patrón v4.0 ==============
  const allAnimations = useMemo(() => {
    const anims: THREE.AnimationClip[] = [];

    // Branch A: GLB all-in-one — usar TODAS las animaciones embebidas, sin BD
    // Se activa cuando el GLB tiene 2+ anims Y la BD no tiene nada cargado
    if (baseAnimations.length > 1 && Object.keys(loadedAnimClips).length === 0) {
      const used = new Set<AnimationState>();
      baseAnimations.forEach((clip, idx) => {
        const lower = clip.name.toLowerCase().trim();
        let state: AnimationState | undefined = EMBEDDED_NAME_MAP[lower];
        if (!state) {
          for (const [key, val] of Object.entries(EMBEDDED_NAME_MAP)) {
            if (lower.includes(key)) { state = val as AnimationState; break; }
          }
        }
        if (!state && idx === 0) state = 'idle';
        if (!state || used.has(state)) return;
        used.add(state);
        const stripRM = state === 'walk' || state === 'run';
        // stripScale=true: elimina tracks .scale del pipeline Blender (factor 0.01 bakeado)
        const remapped = remapAnimationTracks(clip, boneNames, stripRM, spineChainMap, false, true);
        remapped.name = state;
        anims.push(remapped);
        console.log(`🎬 embedded: ${clip.name} → ${state}`);
      });
      return anims;
    }

    // Branch B: BD tiene prioridad para idle; embebidas como fallback
    if (loadedAnimClips['idle']) {
      anims.push(loadedAnimClips['idle']);
    } else if (baseAnimations.length > 0) {
      const clip = remapAnimationTracks(baseAnimations[0], boneNames, false, spineChainMap);
      clip.name = 'idle';
      anims.push(clip);
    }

    // Todas las demás animaciones cargadas desde BD
    Object.entries(loadedAnimClips).forEach(([name, clip]) => {
      if (name !== 'idle') anims.push(clip);
    });

    return anims;
  }, [baseAnimations, boneNames, loadedAnimClips, spineChainMap]);
  
  // ============== MIXER + ACTIONS — Patrón v3.8 (probado y estable) ==============
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const clipVersionRef = useRef(0);

  // Mixer: crear UNA SOLA VEZ cuando el grupo esté montado.
  // key={modelUrl} en el wrapper fuerza remount completo al cambiar modelo,
  // así que este effect corre fresco para cada modelo.
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

  // Actions: reconstruir cuando cambian los clips
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

// ============== ERROR BOUNDARY PARA AVATAR (GLB roto/404/400) ==============
interface AvatarErrorBoundaryProps {
  fallbackConfig: Avatar3DConfig;
  children: React.ReactNode;
  avatarProps: GLTFAvatarProps;
}
interface AvatarErrorBoundaryState {
  hasError: boolean;
}
class AvatarErrorBoundary extends React.Component<AvatarErrorBoundaryProps, AvatarErrorBoundaryState> {
  constructor(props: AvatarErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any) {
    console.error('🚨 GLTFAvatar crash (GLB roto/inaccesible). Usando avatar fallback.', error?.message || error);
  }
  render() {
    if (this.state.hasError) {
      const { avatarProps, fallbackConfig } = this.props;
      return <GLTFAvatarInner {...avatarProps} avatarConfig={fallbackConfig} />;
    }
    return this.props.children;
  }
}

// ============== WRAPPER SEGURO (captura GLB 400/404) ==============
export const GLTFAvatar: React.FC<GLTFAvatarProps> = (props) => {
  const fallbackConfig: Avatar3DConfig = {
    id: 'default',
    nombre: 'Default',
    modelo_url: DEFAULT_MODEL_URL,
    escala: 1,
  };
  return (
    <AvatarErrorBoundary fallbackConfig={fallbackConfig} avatarProps={props}>
      <GLTFAvatarInner key={props.avatarConfig?.modelo_url || 'default'} {...props} />
    </AvatarErrorBoundary>
  );
};

// ============== HOOK PARA CARGAR AVATAR ==============
export const useAvatar3D = (userId?: string) => {
  const [avatarConfig, setAvatarConfig] = useState<Avatar3DConfig | null>(null);
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
        let { data: avatar } = await supabase
          .from('avatares_3d')
          .select('*')
          .eq('id', avatarId)
          .maybeSingle();

        // Si el avatar asignado fue eliminado, fallback al primer avatar activo
        if (!avatar) {
          console.warn('⚠️ Avatar asignado no existe en BD (eliminado). Buscando fallback...');
          const { data: fallbackAvatar } = await supabase
            .from('avatares_3d')
            .select('*')
            .eq('activo', true)
            .order('orden', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (fallbackAvatar) {
            avatar = fallbackAvatar;
            avatarId = fallbackAvatar.id;
            // Corregir avatar_3d_id del usuario para que no vuelva a pasar
            if (targetUserId) {
              await supabase
                .from('usuarios')
                .update({ avatar_3d_id: fallbackAvatar.id })
                .eq('id', targetUserId);
              console.log('✅ Avatar reseteado a fallback:', fallbackAvatar.nombre);
            }
          } else {
            // No hay avatares en BD
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

        if (avatar) {
          // Cargar animaciones desde avatar_animaciones
          let { data: anims } = await supabase
            .from('avatar_animaciones')
            .select('id, nombre, url, loop, orden, strip_root_motion, avatar_id')
            .eq('avatar_id', avatarId)
            .eq('activo', true)
            .order('orden', { ascending: true });

          // Fallback: buscar animaciones universales (es_universal = true)
          let isFallback = false;
          if (!anims || anims.length === 0) {
            console.log(`⚠️ ${avatar.nombre}: sin anims propias, buscando universales...`);
            const { data: universalAnims } = await supabase
              .from('avatar_animaciones')
              .select('id, nombre, url, loop, orden, strip_root_motion, avatar_id')
              .eq('es_universal', true)
              .eq('activo', true)
              .order('orden', { ascending: true });
            if (universalAnims && universalAnims.length > 0) {
              anims = universalAnims;
              isFallback = true;
              console.log(`✅ Universales: usando ${universalAnims.length} anims compartidas`);
            }
          }

          const config: Avatar3DConfig = {
            id: avatar.id,
            nombre: avatar.nombre,
            modelo_url: avatar.modelo_url || DEFAULT_MODEL_URL,
            escala: avatar.escala || 1,
            textura_url: avatar.textura_url || null,
            animaciones: anims?.map((a: any) => ({
              id: a.id,
              nombre: a.nombre,
              url: a.url,
              loop: a.loop ?? false,
              orden: a.orden ?? 0,
              strip_root_motion: a.strip_root_motion ?? false,
              es_fallback: isFallback,
            })) || [],
          };
          setAvatarConfig(config);
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

  return { avatarConfig, loading, error };
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
