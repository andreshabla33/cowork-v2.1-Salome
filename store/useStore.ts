
import { create } from 'zustand';
import { User, Role, Task, TaskStatus, ChatMessage, ThemeType, Workspace, SpaceItem, AvatarConfig, Departamento, PresenceStatus } from '../types';
import type { Avatar3DConfig } from '../components/Avatar3DGLTF';
import { supabase } from '../lib/supabase';
import { getSettingsSection } from '../lib/userSettings';

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'mention' | 'entry';
  timestamp: number;
}

interface AppState {
  theme: ThemeType;
  view: 'dashboard' | 'workspace' | 'invitation' | 'loading' | 'onboarding' | 'onboarding_creador';
  activeSubTab: 'space' | 'tasks' | 'miembros' | 'settings' | 'builder' | 'chat' | 'avatar' | 'calendar' | 'grabaciones' | 'metricas';
  currentUser: User;
  users: User[];
  onlineUsers: User[];
  tasks: Task[];
  messages: ChatMessage[];
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  userRoleInActiveWorkspace: Role | null;
  session: any | null;
  authFeedback: { type: 'success' | 'error', message: string } | null;
  initialized: boolean;
  isInitializing: boolean;
  notifications: Notification[];
  unreadChatCount: number;
  activeChatGroupId: string | null;
  empresasAutorizadas: string[];
  setOnlineUsers: (users: User[]) => void;
  incrementUnreadChat: () => void;
  clearUnreadChat: () => void;
  setActiveChatGroupId: (id: string | null) => void;
  setEmpresasAutorizadas: (empresas: string[]) => void;
  
  setSession: (session: any) => void;
  setTheme: (theme: ThemeType) => void;
  setView: (view: AppState['view']) => void;
  setActiveSubTab: (tab: AppState['activeSubTab']) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  fetchWorkspaces: () => Promise<Workspace[]>;
  setActiveWorkspace: (workspace: Workspace | null, role?: Role) => void;
  setAuthFeedback: (feedback: { type: 'success' | 'error', message: string } | null) => void;
  
  setPosition: (x: number, y: number, direction?: User['direction'], isSitting?: boolean, isMoving?: boolean) => void;
  setEmpresaId: (empresaId: string | null) => void;
  setDepartamentoId: (departamentoId: string | null) => void;
  updateAvatar: (config: AvatarConfig) => Promise<void>;
  updateStatus: (status: PresenceStatus, statusText?: string) => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: (val?: boolean) => void;
  setPrivacy: (isPrivate: boolean) => void;
  togglePrivacy: () => void;
  
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  
  addSpaceItem: (item: SpaceItem) => void;
  updateSpaceItem: (id: string, updates: Partial<SpaceItem>) => void;
  removeSpaceItem: (id: string) => void;
  
  addTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  addMessage: (msg: ChatMessage) => void;
  addNotification: (message: string, type?: Notification['type']) => void;
  clearNotifications: () => void;
  avatar3DConfig: Avatar3DConfig | null;
  setAvatar3DConfig: (config: Avatar3DConfig | null) => void;
  isMiniMode: boolean;
  setMiniMode: (val: boolean) => void;
  toggleMiniMode: () => void;
}

const initialAvatar: AvatarConfig = {
  skinColor: '#fcd34d',
  clothingColor: '#6366f1',
  hairColor: '#4b2c20',
  accessory: 'headphones'
};

const STORAGE_WS_KEY = 'cowork_active_workspace_id';

export const useStore = create<AppState>((set, get) => ({
  theme: 'dark',
  view: 'loading',
  activeSubTab: 'space',
  session: null,
  authFeedback: null,
  workspaces: [],
  activeWorkspace: null,
  userRoleInActiveWorkspace: null,
  departamentos: [],
  initialized: false,
  isMiniMode: false,
  isInitializing: false,
  notifications: [],
  avatar3DConfig: null,
  currentUser: {
    id: 'guest',
    name: 'Invitado',
    role: Role.INVITADO,
    avatar: '',
    avatarConfig: initialAvatar,
    x: 500,
    y: 500,
    direction: 'front',
    isSitting: false,
    isOnline: true,
    isPrivate: false,
    isMicOn: false,
    isCameraOn: false,
    isScreenSharing: false,
    status: PresenceStatus.AVAILABLE,
  },
  users: [],
  onlineUsers: [],
  tasks: [],
  messages: [],
  unreadChatCount: 0,
  activeChatGroupId: null,
  empresasAutorizadas: [],
  
  setOnlineUsers: (users) => set({ onlineUsers: users }),
  incrementUnreadChat: () => set((state) => ({ unreadChatCount: state.unreadChatCount + 1 })),
  clearUnreadChat: () => set({ unreadChatCount: 0 }),
  setActiveChatGroupId: (id) => set({ activeChatGroupId: id }),
  setEmpresasAutorizadas: (empresas) => set({ empresasAutorizadas: empresas }),

  initialize: async () => {
    if (get().isInitializing) {
      console.log("initialize: Already initializing, skipping");
      return;
    }
    set({ isInitializing: true });
    console.log("initialize: Starting...");
    
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error("initialize: Session error", sessionError);
        set({ session: null, view: 'dashboard', initialized: true, isInitializing: false });
        return;
      }
      
      if (session) {
        console.log("initialize: Session found for", session.user.email);
        set({ session });
        const { user } = session;

        // Safety net: garantizar registro en public.usuarios (por si trigger falló)
        try {
          await supabase.from('usuarios').upsert({
            id: user.id,
            email: user.email,
            nombre: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario',
            estado_disponibilidad: 'available'
          }, { onConflict: 'id', ignoreDuplicates: false });
        } catch (e) {
          console.warn("initialize: Upsert usuarios safety net failed", e);
        }

        // Cargar datos opcionales (no bloquear si fallan)
        let avatarConfig = initialAvatar;
        let statusData = { estado_disponibilidad: PresenceStatus.AVAILABLE, estado_personalizado: '' };
        
        try {
          const { data: avatarConfigData } = await supabase
            .from('avatar_configuracion')
            .select('configuracion')
            .eq('usuario_id', user.id)
            .maybeSingle();
          if (avatarConfigData?.configuracion) avatarConfig = avatarConfigData.configuracion;
        } catch (e) {
          console.warn("initialize: Could not load avatar config", e);
        }

        // Cargar avatar 3D seleccionado
        let avatar3DConfig: Avatar3DConfig | null = null;
        try {
          const { data: usuarioAvatar } = await supabase
            .from('usuarios')
            .select('avatar_3d_id')
            .eq('id', user.id)
            .maybeSingle();
          
          let avatarId = usuarioAvatar?.avatar_3d_id || null;
          
          // Si no tiene avatar asignado, obtener el primero activo
          if (!avatarId) {
            const { data: defaultAvatar } = await supabase
              .from('avatares_3d')
              .select('id')
              .eq('activo', true)
              .order('orden', { ascending: true })
              .limit(1)
              .maybeSingle();
            avatarId = defaultAvatar?.id || null;
          }
          
          if (avatarId) {
            const { data: avatar3D } = await supabase
              .from('avatares_3d')
              .select('id, nombre, modelo_url, escala, textura_url')
              .eq('id', avatarId)
              .maybeSingle();
            
            if (avatar3D) {
              // Cargar animaciones desde avatar_animaciones
              const { data: anims } = await supabase
                .from('avatar_animaciones')
                .select('id, nombre, url, loop, orden, strip_root_motion')
                .eq('avatar_id', avatarId)
                .eq('activo', true)
                .order('orden', { ascending: true });

              avatar3DConfig = {
                ...avatar3D,
                textura_url: avatar3D.textura_url || null,
                animaciones: anims?.map((a: any) => ({
                  id: a.id,
                  nombre: a.nombre,
                  url: a.url,
                  loop: a.loop ?? false,
                  orden: a.orden ?? 0,
                  strip_root_motion: a.strip_root_motion ?? false,
                })) || [],
              } as Avatar3DConfig;
            }
          }
        } catch (e) {
          console.warn("initialize: Could not load avatar 3D config", e);
        }

        let profilePhoto = '';
        try {
          const { data: usuarioData } = await supabase
            .from('usuarios')
            .select('estado_disponibilidad, estado_personalizado, avatar_url')
            .eq('id', user.id)
            .maybeSingle();
          if (usuarioData) {
            statusData = usuarioData as any;
            profilePhoto = usuarioData.avatar_url || '';
          }
        } catch (e) {
          console.warn("initialize: Could not load user status", e);
        }

        set({ 
          currentUser: {
            ...get().currentUser,
            id: user.id,
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario',
            avatarConfig,
            profilePhoto,
            status: statusData.estado_disponibilidad || PresenceStatus.AVAILABLE,
            statusText: statusData.estado_personalizado || ''
          },
          avatar3DConfig
        });

        const workspaces = await get().fetchWorkspaces();
        console.log("initialize: Workspaces loaded:", workspaces.length);
        
        const savedId = localStorage.getItem(STORAGE_WS_KEY);
        
        // Verificar si hay token de invitación en la URL
        const urlParams = new URLSearchParams(window.location.search);
        const invitationToken = urlParams.get('token');
        
        if (invitationToken) {
          console.log("initialize: Invitation token found, going to invitation view");
          set({ view: 'invitation' });
          // No limpiar URL aquí - InvitationProcessor necesita el token para verificar
        } else if (workspaces.length === 0) {
          console.log("initialize: No workspaces, going to onboarding_creador");
          set({ view: 'onboarding_creador' });
        } else if (savedId) {
          const found = workspaces.find(w => w.id === savedId);
          if (found) {
            console.log("initialize: Restoring workspace", found.name);
            get().setActiveWorkspace(found, (found as any).userRole);
            set({ view: 'workspace' });
          } else {
            console.log("initialize: Saved workspace not found, going to dashboard");
            set({ view: 'dashboard' });
          }
        } else {
          // Si skipWelcomeScreen está activado y hay workspaces, ir directo al primero
          const generalSettings = getSettingsSection('general');
          if (generalSettings.skipWelcomeScreen && workspaces.length > 0) {
            console.log("initialize: Skipping welcome, going to first workspace");
            get().setActiveWorkspace(workspaces[0], (workspaces[0] as any).userRole);
            set({ view: 'workspace' });
          } else {
            console.log("initialize: Going to dashboard");
            set({ view: 'dashboard' });
          }
        }
      } else {
        console.log("initialize: No session, going to dashboard");
        set({ session: null, view: 'dashboard' });
      }
    } catch (error) {
      console.error("Initialization failed:", error);
      // En caso de error, ir al dashboard para no quedarse cargando
      set({ view: 'dashboard' });
    } finally {
      set({ initialized: true, isInitializing: false });
      console.log("initialize: Complete");
    }
  },

  setSession: (session) => {
    if (session) {
      const { user } = session;
      set({ 
        session,
        currentUser: {
          ...get().currentUser,
          id: user.id,
          name: user.user_metadata?.full_name || user.email.split('@')[0],
        }
      });
      if (get().workspaces.length === 0) {
        get().fetchWorkspaces();
      }
    } else {
      set({ session: null });
    }
  },

  setTheme: (theme) => set({ theme }),
  setView: (view) => set({ view }),
  setActiveSubTab: (activeSubTab) => set({ activeSubTab }),
  setWorkspaces: (workspaces) => set({ workspaces }),

  fetchWorkspaces: async () => {
    const { session } = get();
    const userId = session?.user?.id;
    if (!userId) {
      console.log("fetchWorkspaces: No userId, returning empty");
      return [];
    }
    
    try {
      console.log("fetchWorkspaces: Fetching for user", userId);
      const { data, error } = await supabase
        .from('espacios_trabajo')
        .select(`id, nombre, descripcion, slug, miembros_espacio!inner (rol, aceptado)`)
        .eq('miembros_espacio.usuario_id', userId)
        .eq('miembros_espacio.aceptado', true);
      
      if (error) {
        console.error("fetchWorkspaces Supabase Error:", error.message, error.code, error.details);
        throw error;
      }

      console.log("fetchWorkspaces: Found", data?.length || 0, "workspaces");
      const workspaces = (data || []).map((ws: any) => ({
        id: ws.id,
        name: ws.nombre,
        descripcion: ws.descripcion,
        slug: ws.slug,
        width: 2000,
        height: 2000,
        items: [],
        userRole: ws.miembros_espacio[0]?.rol as Role
      }));
      
      set({ workspaces, authFeedback: null });
      return workspaces;
    } catch (err: any) {
      console.error("Fetch Workspaces Error:", err?.message || err);
      return [];
    }
  },
  
  setActiveWorkspace: (workspace, role) => {
    if (workspace) {
      localStorage.setItem(STORAGE_WS_KEY, workspace.id);
      set({ 
        activeWorkspace: workspace, 
        userRoleInActiveWorkspace: role || (workspace as any).userRole || null,
        view: 'workspace',
        activeSubTab: 'space'
      });
    } else {
      localStorage.removeItem(STORAGE_WS_KEY);
      set({ activeWorkspace: null, userRoleInActiveWorkspace: null, view: 'dashboard' });
    }
  },

  setAuthFeedback: (authFeedback) => set({ authFeedback }),

  signOut: async () => {
    localStorage.removeItem(STORAGE_WS_KEY);
    await supabase.auth.signOut();
    set({ session: null, view: 'dashboard', activeWorkspace: null, workspaces: [], initialized: true, isInitializing: false });
  },

  setPosition: (x, y, direction, isSitting, isMoving) => set((state) => ({ 
    currentUser: { 
      ...state.currentUser, 
      x, y, 
      direction: direction || state.currentUser.direction,
      isSitting: isSitting !== undefined ? isSitting : state.currentUser.isSitting,
      isMoving: isMoving !== undefined ? isMoving : state.currentUser.isMoving
    } 
  })),

  setEmpresaId: (empresaId) => set((state) => ({
    currentUser: {
      ...state.currentUser,
      empresa_id: empresaId ?? undefined
    }
  })),
  setDepartamentoId: (departamentoId) => set((state) => ({
    currentUser: {
      ...state.currentUser,
      departamento_id: departamentoId ?? undefined
    }
  })),

  updateAvatar: async (config) => {
    const { session } = get();
    if (session?.user?.id) {
      await supabase.from('avatar_configuracion').upsert({
        usuario_id: session.user.id,
        configuracion: config,
        actualizado_en: new Date().toISOString()
      }, { onConflict: 'usuario_id' });
    }
    set((state) => ({ currentUser: { ...state.currentUser, avatarConfig: config } }));
  },

  updateStatus: async (status, statusText) => {
    const { session } = get();
    // Actualizar UI inmediatamente (optimistic update)
    set((state) => ({
      currentUser: { ...state.currentUser, status, statusText: statusText !== undefined ? statusText : state.currentUser.statusText }
    }));
    if (session?.user?.id) {
      const { error } = await supabase.from('usuarios').update({
        estado_disponibilidad: status,
        estado_personalizado: statusText || null,
        estado_actualizado_en: new Date().toISOString()
      }).eq('id', session.user.id);
      if (error) {
        console.error('❌ Error actualizando estado de disponibilidad:', error);
      } else {
        console.log('✅ Estado actualizado:', status);
      }
    }
  },

  toggleMic: () => set((state) => ({
    currentUser: { ...state.currentUser, isMicOn: !state.currentUser.isMicOn }
  })),

  toggleCamera: () => set((state) => ({
    currentUser: { ...state.currentUser, isCameraOn: !state.currentUser.isCameraOn }
  })),

  toggleScreenShare: (val) => set((state) => ({
    currentUser: { ...state.currentUser, isScreenSharing: val !== undefined ? val : !state.currentUser.isScreenSharing }
  })),

  setPrivacy: (isPrivate) => set((state) => ({
    currentUser: { ...state.currentUser, isPrivate }
  })),

  togglePrivacy: () => set((state) => ({
    currentUser: { ...state.currentUser, isPrivate: !state.currentUser.isPrivate }
  })),

  addSpaceItem: (item) => set((state) => {
    if (!state.activeWorkspace) return state;
    return { activeWorkspace: { ...state.activeWorkspace, items: [...state.activeWorkspace.items, item] } };
  }),

  updateSpaceItem: (id, updates) => set((state) => {
    if (!state.activeWorkspace) return state;
    return { activeWorkspace: { ...state.activeWorkspace, items: state.activeWorkspace.items.map(i => i.id === id ? { ...i, ...updates } : i) } };
  }),

  removeSpaceItem: (id) => set((state) => {
    if (!state.activeWorkspace) return state;
    return { activeWorkspace: { ...state.activeWorkspace, items: state.activeWorkspace.items.filter(i => i.id !== id) } };
  }),

  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTaskStatus: (id, status) => set((state) => ({ tasks: state.tasks.map(t => t.id === id ? { ...t, status } : t) })),
  addMessage: (msg) => {
    const { currentUser } = get();
    if (msg.contenido?.includes(`@${currentUser.name}`)) {
      get().addNotification(`Fuiste mencionado por ${msg.usuario?.nombre || 'alguien'}`, 'mention');
    }
    set((state) => ({ messages: [...state.messages, msg] }));
  },
  addNotification: (message, type = 'info') => set((state) => ({
    notifications: [{ id: Math.random().toString(), message, type, timestamp: Date.now() }, ...state.notifications].slice(0, 5)
  })),
  clearNotifications: () => set({ notifications: [] }),
  setAvatar3DConfig: (config) => set({ avatar3DConfig: config }),
  setMiniMode: (val) => set({ isMiniMode: val }),
  toggleMiniMode: () => set((state) => ({ isMiniMode: !state.isMiniMode })),
}));
