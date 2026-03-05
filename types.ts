
export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MODERADOR = 'moderador',
  MIEMBRO = 'miembro',
  INVITADO = 'invitado'
}

export enum PresenceStatus {
  AVAILABLE = 'available',
  BUSY = 'busy',
  AWAY = 'away',
  DND = 'dnd'
}

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE'
}

export type ThemeType = 'dark' | 'light' | 'space' | 'arcade';

export interface AvatarConfig {
  skinColor: string;
  clothingColor: string;
  hairColor: string;
  hairStyle?: 'default' | 'spiky' | 'long' | 'ponytail';
  eyeColor?: string;
  accessory?: 'none' | 'glasses' | 'hat' | 'headphones';
  modelUrl?: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  avatar: string;
  avatarConfig?: AvatarConfig;
  profilePhoto?: string;
  empresa_id?: string;
  departamento_id?: string;
  esFantasma?: boolean;
  x: number;
  y: number;
  direction: 'front' | 'left' | 'right' | 'back';
  isMoving?: boolean;
  isRunning?: boolean;
  isSitting?: boolean;
  isOnline: boolean;
  isPrivate?: boolean;
  isMicOn?: boolean;
  isCameraOn?: boolean;
  isScreenSharing?: boolean;
  speechBubble?: { text: string; timestamp: number };
  cargo?: string;
  departamento?: string;
  status: PresenceStatus;
  statusText?: string;
  avatar3DConfig?: { id: string; nombre: string; modelo_url: string; escala: number; textura_url?: string | null; animaciones?: { id: string; nombre: string; url: string; loop: boolean; orden: number; strip_root_motion?: boolean }[] } | null;
}

export interface Departamento {
  id: string;
  nombre: string;
  descripcion?: string;
  color: string;
  icono: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug?: string;
  width: number;
  height: number;
  items: SpaceItem[];
  descripcion?: string;
  userRole?: Role; 
}

export interface SpaceItem {
  id: string;
  type: 'table' | 'chair' | 'plant' | 'sofa' | 'gamer_chair' | 'office_desk' | 'pc_setup' | 'vending_machine' | 'whiteboard' | 'water_cooler' | 'tv' | 'rug' | 'lamp' | 'bookshelf';
  x: number;
  y: number;
  rotation?: number;
}

export interface ZonaEmpresa {
  id: string;
  empresa_id?: string | null;
  espacio_id: string;
  nombre_zona?: string | null;
  posicion_x: number;
  posicion_y: number;
  ancho: number;
  alto: number;
  color?: string | null;
  estado: string;
  es_comun?: boolean;
  spawn_x?: number;
  spawn_y?: number;
  modelo_url?: string | null;
  empresa?: {
    nombre?: string | null;
    logo_url?: string | null;
  } | null;
}

export interface TerrenoMarketplace {
  id: string;
  espacio_id: string;
  nombre: string;
  descripcion?: string | null;
  posicion_x: number;
  posicion_y: number;
  ancho: number;
  alto: number;
  tier: 'starter' | 'professional' | 'enterprise';
  precio_mensual: number;
  precio_anual: number;
  moneda: string;
  estado: 'disponible' | 'reservado' | 'vendido' | 'bloqueado';
  reservado_por?: string | null;
  reservado_hasta?: string | null;
  comprado_por_empresa?: string | null;
  color_preview: string;
  destacado: boolean;
  orden_visual: number;
  features: {
    max_miembros: number;
    salas_reunion: number;
    personalizacion: string;
    showroom: boolean;
    soporte: string;
  };
  created_at: string;
  updated_at: string;
}

export interface AutorizacionEmpresa {
  id: string;
  empresa_origen_id: string;
  empresa_destino_id: string;
  espacio_id: string;
  estado: string;
  canal_compartido_id?: string | null;
  solicitada_por?: string | null;
  aprobada_por?: string | null;
  creada_en: string;
  actualizada_en: string;
  expira_en?: string | null;
}

export interface Attachment {
  name: string;
  url: string;
  type: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId?: string;
  startDate?: string;
  dueDate?: string;
  attachments?: Attachment[];
}

export interface ChatGroup {
  id: string;
  espacio_id: string;
  nombre: string;
  descripcion?: string;
  tipo: 'publico' | 'privado' | 'directo';
  icono: string;
  color?: string;
  creado_por: string;
}

export interface ChatMessage {
  id: string;
  grupo_id: string;
  usuario_id: string;
  contenido: string;
  tipo: 'texto' | 'imagen' | 'archivo' | 'sistema';
  creado_en: string;
  usuario?: {
    id: string;
    nombre: string;
    avatar_url?: string;
  };
}

export interface ScheduledMeeting {
  id: string;
  espacio_id: string;
  sala_id?: string;
  titulo: string;
  descripcion?: string;
  fecha_inicio: string;
  fecha_fin: string;
  creado_por: string;
  es_recurrente: boolean;
  recurrencia_regla?: string;
  recordatorio_minutos: number;
  creado_en: string;
  google_event_id?: string;
  meeting_link?: string;
  tipo_reunion?: string;
  creador?: { id: string; nombre: string };
  sala?: { id: string; nombre: string };
  participantes?: MeetingParticipant[];
}

export interface MeetingParticipant {
  id: string;
  reunion_id: string;
  usuario_id: string;
  estado: 'pendiente' | 'aceptado' | 'rechazado' | 'tentativo';
  notificado: boolean;
  usuario?: { id: string; nombre: string };
}
