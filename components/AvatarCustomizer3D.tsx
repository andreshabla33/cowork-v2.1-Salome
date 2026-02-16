'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useStore } from '@/store/useStore';
import { GLTFAvatar, useAvatar3D } from './Avatar3DGLTF';
import { UserAvatar } from './UserAvatar';
import { supabase } from '../lib/supabase';

interface AvatarCustomizer3DProps {
  compact?: boolean;
  onClose?: () => void;
}

interface AvatarModel {
  id: string;
  nombre: string;
  descripcion: string | null;
  modelo_url: string;
  thumbnail_url: string | null;
  escala: string;
}

const COLORS = {
  skin: ['#fcd34d', '#fbbf24', '#d97706', '#92400e', '#78350f', '#fef3c7', '#f5d0a9', '#c68642'],
  clothing: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#71717a', '#7c3aed', '#1f2937', '#ffffff'],
};

export const AvatarCustomizer3D: React.FC<AvatarCustomizer3DProps> = ({ compact = false, onClose }) => {
  const { currentUser, updateAvatar, session } = useStore();
  const { avatarConfig, loading: avatarLoading } = useAvatar3D(currentUser?.id);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'modelos' | 'colores'>('profile');
  const [availableAvatars, setAvailableAvatars] = useState<AvatarModel[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>('');
  const [loadingAvatars, setLoadingAvatars] = useState(false);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const [previewConfig, setPreviewConfig] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState(currentUser.profilePhoto || '');
  const [displayName, setDisplayName] = useState(currentUser.name || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [localConfig, setLocalConfig] = useState({
    skinColor: currentUser.avatarConfig?.skinColor || '#fcd34d',
    clothingColor: currentUser.avatarConfig?.clothingColor || '#6366f1',
  });

  // Cargar catálogo de avatares (dato público, no depende de session)
  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      setLoadingAvatars(true);
      try {
        const { data: avatarsData, error: avatarsError } = await supabase
          .from('avatares_3d')
          .select('id, nombre, descripcion, modelo_url, thumbnail_url, escala')
          .eq('activo', true)
          .order('orden', { ascending: true });
        
        if (!cancelled) {
          if (avatarsError) {
            console.error('🎭 Error cargando avatares:', avatarsError);
          } else if (avatarsData) {
            setAvailableAvatars(avatarsData);
            if (!selectedAvatarId && avatarsData.length > 0) {
              setSelectedAvatarId(avatarsData[0].id);
            }
          }
        }
      } catch (error) {
        console.error('🎭 Error inesperado loading avatars:', error);
      } finally {
        if (!cancelled) setLoadingAvatars(false);
      }
    };
    loadCatalog();
    return () => { cancelled = true; };
  }, []);

  // Cargar avatar seleccionado del usuario (depende de session)
  useEffect(() => {
    if (!session?.user?.id) return;
    const loadUserAvatar = async () => {
      try {
        const { data: userData } = await supabase
          .from('usuarios')
          .select('avatar_3d_id')
          .eq('id', session.user.id)
          .maybeSingle();
        
        if (userData?.avatar_3d_id) {
          setSelectedAvatarId(userData.avatar_3d_id);
        }
      } catch (error) {
        console.error('🎭 Error cargando avatar usuario:', error);
      }
    };
    loadUserAvatar();
  }, [session?.user?.id]);

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user?.id) return;

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('La imagen no puede superar 5MB');
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('Solo se permiten archivos de imagen');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${session.user.id}/profile.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      await supabase
        .from('usuarios')
        .update({ avatar_url: photoUrl })
        .eq('id', session.user.id);

      setProfilePhoto(photoUrl);
      useStore.setState((state) => ({
        currentUser: { ...state.currentUser, profilePhoto: photoUrl }
      }));
    } catch (err) {
      console.error('Error uploading photo:', err);
      alert('Error al subir la foto. Intenta de nuevo.');
    }
    setUploading(false);
  };

  const handleRemovePhoto = async () => {
    if (!session?.user?.id) return;
    setUploading(true);
    try {
      await supabase
        .from('usuarios')
        .update({ avatar_url: null })
        .eq('id', session.user.id);

      setProfilePhoto('');
      useStore.setState((state) => ({
        currentUser: { ...state.currentUser, profilePhoto: '' }
      }));
    } catch (err) {
      console.error('Error removing photo:', err);
    }
    setUploading(false);
  };

  const handleSaveName = async () => {
    if (!session?.user?.id || !displayName.trim()) return;
    try {
      await supabase
        .from('usuarios')
        .update({ nombre: displayName.trim() })
        .eq('id', session.user.id);

      useStore.setState((state) => ({
        currentUser: { ...state.currentUser, name: displayName.trim() }
      }));
      setSaved(true);
      setTimeout(() => { setSaved(false); if (onClose) onClose(); }, 1200);
    } catch (err) {
      console.error('Error updating name:', err);
    }
  };

  const handleSaveColors = async () => {
    await updateAvatar(localConfig as any);
    setSaved(true);
    setTimeout(() => { setSaved(false); if (onClose) onClose(); }, 1200);
  };

  const handleAvatarChange = async (avatarId: string) => {
    setSelectedAvatarId(avatarId);
    
    // Actualizar preview local inmediatamente
    const selected = availableAvatars.find(a => a.id === avatarId);
    if (selected) {
      setPreviewConfig({
        id: selected.id,
        nombre: selected.nombre,
        modelo_url: selected.modelo_url,
        escala: parseFloat(selected.escala) || 1,
      });
    }

    if (!session?.user?.id) return;
    try {
      const { error } = await supabase
        .from('usuarios')
        .update({ avatar_3d_id: avatarId })
        .eq('id', session.user.id);
      
      if (error) {
        console.error('Error updating avatar:', error);
      } else {
        // Actualizar store para que el espacio virtual refleje el cambio
        if (selected) {
          useStore.getState().setAvatar3DConfig({
            id: selected.id,
            nombre: selected.nombre,
            modelo_url: selected.modelo_url,
            escala: parseFloat(selected.escala) || 1,
          });
        }
        setAvatarSaved(true);
        setTimeout(() => setAvatarSaved(false), 2000);
      }
    } catch (err) {
      console.error('Error changing avatar:', err);
    }
  };

  return (
    <div className={compact ? "p-4 flex flex-col gap-4" : "p-6 max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 h-full overflow-y-auto"}>
      {/* Vista previa 3D */}
      <div className={`${compact ? 'h-64' : 'lg:flex-1 min-h-[400px]'} bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-3xl border border-white/10 overflow-hidden relative`}>
        <Canvas shadows camera={{ position: [0, 1, 3], fov: 45 }}>
          <Suspense fallback={null}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <directionalLight position={[-5, 3, -5]} intensity={0.3} />
            
            <group position={[0, -0.8, 0]}>
              <GLTFAvatar
                avatarConfig={previewConfig || avatarConfig}
                animationState="idle"
                direction="front"
                skinColor={localConfig.skinColor}
                clothingColor={localConfig.clothingColor}
                scale={1.2}
              />
            </group>
            
            <OrbitControls enablePan={false} enableZoom={true} minDistance={2} maxDistance={5} />
            
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
              <circleGeometry args={[2, 32]} />
              <meshStandardMaterial color="#1f2937" roughness={0.3} />
            </mesh>
          </Suspense>
        </Canvas>
        
        {saved && (
          <div className="absolute top-4 right-4 bg-green-500/90 text-white text-xs font-bold px-3 py-1.5 rounded-full animate-in fade-in">
            ✓ Guardado
          </div>
        )}

        {/* Info del usuario - compacta en la esquina inferior */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-black/50 backdrop-blur-md rounded-xl p-2 pr-3 border border-white/5">
          <UserAvatar name={currentUser.name} profilePhoto={profilePhoto} size="sm" showStatus status={currentUser.status} />
          <div>
            <p className="text-[10px] font-bold text-white/80">{displayName || currentUser.name}</p>
            <p className="text-[8px] text-white/40">{currentUser.cargo || currentUser.departamento || 'Colaborador'}</p>
          </div>
        </div>
        
        <div className="absolute bottom-3 left-3 text-[10px] text-white/40">
          Arrastra para rotar • Scroll para zoom
        </div>
      </div>

      {/* Panel de personalización */}
      <div className={`${compact ? 'flex-1' : 'lg:w-[400px]'} flex flex-col gap-4`}>
        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-800/50 p-1.5 rounded-2xl">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === 'profile' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white'
            }`}
          >
            📷 Perfil
          </button>
          <button
            onClick={() => setActiveTab('modelos')}
            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === 'modelos' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white'
            }`}
          >
            🧍 Modelos
          </button>
          <button
            onClick={() => setActiveTab('colores')}
            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === 'colores' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white'
            }`}
          >
            🎨 Colores
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">
          {/* TAB PERFIL */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Foto de perfil */}
              <section className="flex flex-col items-center gap-4">
                <div className="relative group">
                  <UserAvatar name={currentUser.name} profilePhoto={profilePhoto} size="xl" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    {uploading ? (
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadPhoto}
                    className="hidden"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-[10px] font-bold text-white transition-all"
                  >
                    {profilePhoto ? 'Cambiar foto' : 'Subir foto'}
                  </button>
                  {profilePhoto && (
                    <button
                      onClick={handleRemovePhoto}
                      disabled={uploading}
                      className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-xl text-[10px] font-bold text-red-400 transition-all"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-white/30 text-center">
                  Tu foto aparecerá en chats, perfil y menciones. Max 5MB.
                </p>
              </section>

              {/* Nombre */}
              <section>
                <label className="text-[9px] uppercase font-black tracking-widest text-indigo-400 mb-2 block">Nombre</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                    placeholder="Tu nombre"
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={displayName.trim() === currentUser.name}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-[10px] font-bold text-white transition-all"
                  >
                    Guardar
                  </button>
                </div>
              </section>

              {/* Info del perfil */}
              <section className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <label className="text-[9px] uppercase font-black tracking-widest text-indigo-400 mb-3 block">Vista previa en chat</label>
                <div className="flex items-center gap-3 p-3 bg-black/30 rounded-xl">
                  <UserAvatar name={currentUser.name} profilePhoto={profilePhoto} size="md" showStatus status={currentUser.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{displayName || currentUser.name}</p>
                    <p className="text-[10px] text-white/40">{currentUser.cargo || currentUser.departamento || 'Colaborador'}</p>
                  </div>
                  <span className="text-[9px] text-white/30">12:00</span>
                </div>
                <div className="ml-14 mt-1 p-3 bg-indigo-600/20 rounded-xl rounded-tl-none">
                  <p className="text-xs text-white/80">Hola equipo, ¿cómo va el proyecto?</p>
                </div>
              </section>
            </div>
          )}

          {/* TAB MODELOS */}
          {activeTab === 'modelos' && (
            <div className="space-y-4">
              <p className="text-[10px] text-white/40">Selecciona el modelo base para tu avatar en el mundo virtual.</p>
              
              {loadingAvatars ? (
                <div className="flex items-center justify-center gap-2 text-zinc-500 text-xs py-8">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  Cargando modelos...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {availableAvatars.map((avatar) => (
                    <button
                      key={avatar.id}
                      onClick={() => handleAvatarChange(avatar.id)}
                      className={`relative p-4 rounded-2xl border-2 text-left transition-all ${
                        selectedAvatarId === avatar.id
                          ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/20'
                          : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                          selectedAvatarId === avatar.id ? 'bg-indigo-500/30' : 'bg-white/10'
                        }`}>
                          🧍
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className={`font-bold text-sm ${selectedAvatarId === avatar.id ? 'text-white' : 'text-zinc-300'}`}>
                              {avatar.nombre}
                            </span>
                            {selectedAvatarId === avatar.id && (
                              <span className="text-indigo-400 bg-indigo-500/20 p-1 rounded-full">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-500 line-clamp-2">
                            {avatar.descripcion || 'Modelo 3D optimizado para el entorno virtual.'}
                          </p>
                        </div>
                      </div>
                      {selectedAvatarId === avatar.id && avatarSaved && (
                        <div className="mt-2 text-[9px] text-green-400 font-bold">✓ Modelo seleccionado</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB COLORES */}
          {activeTab === 'colores' && (
            <div className="space-y-5">
              <section>
                <label className="text-[9px] uppercase font-black tracking-widest text-indigo-400 mb-2 block">Tono de Piel</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.skin.map((color) => (
                    <button
                      key={color}
                      onClick={() => setLocalConfig({ ...localConfig, skinColor: color })}
                      className={`w-9 h-9 rounded-full border-2 transition-all ${localConfig.skinColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </section>

              <section>
                <label className="text-[9px] uppercase font-black tracking-widest text-indigo-400 mb-2 block">Color de Ropa</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.clothing.map((color) => (
                    <button
                      key={color}
                      onClick={() => setLocalConfig({ ...localConfig, clothingColor: color })}
                      className={`w-9 h-9 rounded-full border-2 transition-all ${localConfig.clothingColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Botón de guardar - solo para tabs de avatar */}
        {activeTab === 'colores' && (
          <button
            onClick={handleSaveColors}
            className={`w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all ${
              saved ? 'bg-green-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {saved ? '✓ CAMBIOS GUARDADOS' : '💾 GUARDAR AVATAR'}
          </button>
        )}
      </div>
    </div>
  );
};

export default AvatarCustomizer3D;
