import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';

interface MeetingRoom {
  id: string;
  nombre: string;
  descripcion?: string;
  creador_id: string;
  es_privada: boolean;
  password_hash?: string | null;
  max_participantes: number;
  activa: boolean;
  creado_en: string;
  participantes?: { usuario_id: string | null; usuario?: { nombre: string } | null; nombre_invitado?: string | null }[];
  creador?: { nombre: string };
}

export const MeetingRooms: React.FC<{ onJoinRoom?: (roomId: string) => void }> = ({ onJoinRoom }) => {
  const { currentUser, activeWorkspace } = useStore();
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [newRoom, setNewRoom] = useState({ nombre: '', descripcion: '', es_privada: false, password: '', max_participantes: 10 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    loadRooms();

    const channel = supabase.channel(`rooms_${activeWorkspace.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salas_reunion', filter: `espacio_id=eq.${activeWorkspace.id}` }, () => loadRooms())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participantes_sala' }, () => loadRooms())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeWorkspace?.id]);

  const loadRooms = async () => {
    if (!activeWorkspace?.id) return;
    const { data, error } = await supabase
      .from('salas_reunion')
      .select(`*, creador:usuarios!salas_reunion_creador_id_fkey(nombre), participantes:participantes_sala(usuario_id, nombre_invitado, usuario:usuarios!participantes_sala_usuario_id_fkey(nombre))`)
      .eq('espacio_id', activeWorkspace.id)
      .eq('activa', true)
      .order('creado_en', { ascending: false });
    
    if (error) {
      console.error('Error loading rooms:', error);
      return;
    }
    if (data) {
      console.log('Rooms loaded:', data.length, data);
      setRooms(data);
    }
  };

  const createRoom = async () => {
    if (!newRoom.nombre.trim() || !activeWorkspace?.id) return;
    setLoading(true);
    
    const { data, error } = await supabase.from('salas_reunion').insert({
      espacio_id: activeWorkspace.id,
      nombre: newRoom.nombre.trim(),
      descripcion: newRoom.descripcion.trim() || null,
      creador_id: currentUser.id,
      es_privada: newRoom.es_privada,
      password_hash: newRoom.es_privada && newRoom.password ? newRoom.password : null,
      max_participantes: newRoom.max_participantes
    }).select('id').single();

    if (error) {
      console.error('Error creating room:', error);
      alert('Error al crear sala: ' + error.message);
    } else if (data) {
      console.log('Room created:', data.id);
      // Auto-unir al creador como host
      const { error: joinError } = await supabase.from('participantes_sala').insert({
        sala_id: data.id,
        usuario_id: currentUser.id,
        mic_activo: true,
        cam_activa: false,
        ultima_actividad: new Date().toISOString()
      });
      if (joinError) console.error('Error auto-joining room:', joinError);
      
      setShowCreateModal(false);
      setNewRoom({ nombre: '', descripcion: '', es_privada: false, password: '', max_participantes: 10 });
      onJoinRoom?.(data.id);
      loadRooms();
    }
    setLoading(false);
  };

  const joinRoom = async (roomId: string, roomPassword?: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    if (room.es_privada && room.password_hash && room.password_hash !== roomPassword) {
      alert('Contraseña incorrecta');
      return;
    }

    console.log('Joining room:', roomId, 'user:', currentUser.id);
    const { error } = await supabase.from('participantes_sala').upsert({
      sala_id: roomId,
      usuario_id: currentUser.id,
      mic_activo: true,
      cam_activa: false,
      ultima_actividad: new Date().toISOString()
    }, { onConflict: 'sala_id,usuario_id' });

    if (error) {
      console.error('Error joining room:', error);
      alert('Error al unirse: ' + error.message);
    } else {
      console.log('Joined room successfully');
      setShowJoinModal(null);
      setPassword('');
      onJoinRoom?.(roomId);
      loadRooms();
    }
  };

  const leaveRoom = async (roomId: string) => {
    console.log('Leaving room:', roomId, 'user:', currentUser.id);
    const { error } = await supabase.from('participantes_sala').delete().eq('sala_id', roomId).eq('usuario_id', currentUser.id);
    if (error) {
      console.error('Error leaving room:', error);
      alert('Error al salir: ' + error.message);
    } else {
      console.log('Left room successfully');
      loadRooms();
    }
  };

  const endRoom = async (roomId: string) => {
    console.log('Ending room:', roomId);
    const { error } = await supabase.from('salas_reunion').update({ activa: false, finalizado_en: new Date().toISOString() }).eq('id', roomId);
    if (error) {
      console.error('Error ending room:', error);
      alert('Error al terminar: ' + error.message);
    } else {
      console.log('Room ended successfully');
      loadRooms();
    }
  };

  const isInRoom = (room: MeetingRoom) => room.participantes?.some(p => p.usuario_id === currentUser.id);
  const isCreator = (room: MeetingRoom) => room.creador_id === currentUser.id;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[11px] font-black uppercase tracking-widest opacity-60">Salas de Reunión</h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-[10px] font-bold transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Nueva Sala
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-8 opacity-40">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="text-[11px] font-medium">No hay salas activas</p>
          <p className="text-[9px] mt-1">Crea una sala para comenzar una reunión</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rooms.map(room => (
            <div
              key={room.id}
              className={`p-3 rounded-xl border transition-all ${
                isInRoom(room) 
                  ? 'bg-indigo-500/20 border-indigo-500/50' 
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold truncate">{room.nombre}</span>
                    {room.es_privada && (
                      <svg className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 1a5 5 0 00-5 5v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm3 7H9V6a3 3 0 116 0v2z" />
                      </svg>
                    )}
                  </div>
                  {room.descripcion && (
                    <p className="text-[10px] opacity-50 truncate mt-0.5">{room.descripcion}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[9px] opacity-40">
                      {room.participantes?.length || 0}/{room.max_participantes} participantes
                    </span>
                    <span className="text-[9px] opacity-40">
                      por {room.creador?.nombre || 'Usuario'}
                    </span>
                  </div>
                  
                  {room.participantes && room.participantes.length > 0 && (
                    <div className="flex items-center gap-1 mt-2">
                      {room.participantes.slice(0, 5).map((p, i) => (
                        <div
                          key={p.usuario_id}
                          className="w-6 h-6 rounded-full bg-indigo-500/30 flex items-center justify-center text-[8px] font-bold border border-white/20"
                          style={{ marginLeft: i > 0 ? '-8px' : 0 }}
                          title={p.usuario?.nombre}
                        >
                          {p.usuario?.nombre?.charAt(0) || '?'}
                        </div>
                      ))}
                      {room.participantes.length > 5 && (
                        <span className="text-[9px] opacity-50 ml-1">+{room.participantes.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isInRoom(room) ? (
                    <>
                      <button
                        onClick={() => leaveRoom(room.id)}
                        className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-[9px] font-bold transition-colors"
                      >
                        Salir
                      </button>
                      {isCreator(room) && (
                        <button
                          onClick={() => endRoom(room.id)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-[9px] font-bold transition-colors"
                        >
                          Terminar
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => room.es_privada ? setShowJoinModal(room.id) : joinRoom(room.id)}
                      disabled={(room.participantes?.length || 0) >= room.max_participantes}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-[9px] font-bold transition-colors"
                    >
                      Unirse
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Crear Sala */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#1a1a2e] rounded-2xl w-full max-w-md p-6 border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Nueva Sala de Reunión</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Nombre *</label>
                <input
                  type="text"
                  value={newRoom.nombre}
                  onChange={e => setNewRoom({ ...newRoom, nombre: e.target.value })}
                  placeholder="Ej: Daily Standup"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Descripción</label>
                <input
                  type="text"
                  value={newRoom.descripcion}
                  onChange={e => setNewRoom({ ...newRoom, descripcion: e.target.value })}
                  placeholder="Opcional"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Máx. Participantes</label>
                <select
                  value={newRoom.max_participantes}
                  onChange={e => setNewRoom({ ...newRoom, max_participantes: parseInt(e.target.value) })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:border-indigo-500/50"
                >
                  {[2, 5, 10, 15, 20, 50].map(n => (
                    <option key={n} value={n}>{n} personas</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNewRoom({ ...newRoom, es_privada: !newRoom.es_privada })}
                  className={`w-10 h-6 rounded-full transition-colors ${newRoom.es_privada ? 'bg-indigo-600' : 'bg-white/20'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${newRoom.es_privada ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
                <span className="text-[12px]">Sala privada (con contraseña)</span>
              </div>

              {newRoom.es_privada && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Contraseña</label>
                  <input
                    type="password"
                    value={newRoom.password}
                    onChange={e => setNewRoom({ ...newRoom, password: e.target.value })}
                    placeholder="Contraseña de la sala"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-[12px] font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={createRoom}
                disabled={!newRoom.nombre.trim() || loading}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-xl text-[12px] font-bold transition-colors"
              >
                {loading ? 'Creando...' : 'Crear Sala'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Unirse a Sala Privada */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowJoinModal(null)}>
          <div className="bg-[#1a1a2e] rounded-2xl w-full max-w-sm p-6 border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <svg className="w-6 h-6 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1a5 5 0 00-5 5v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm3 7H9V6a3 3 0 116 0v2z" />
              </svg>
              <h3 className="text-lg font-bold">Sala Privada</h3>
            </div>
            
            <p className="text-[12px] opacity-60 mb-4">Esta sala requiere contraseña para unirse.</p>
            
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Ingresa la contraseña"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:border-indigo-500/50 mb-4"
              autoFocus
            />

            <div className="flex gap-3">
              <button
                onClick={() => { setShowJoinModal(null); setPassword(''); }}
                className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-[12px] font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => joinRoom(showJoinModal, password)}
                disabled={!password}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-xl text-[12px] font-bold transition-colors"
              >
                Unirse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingRooms;
