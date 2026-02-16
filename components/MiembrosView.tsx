
import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import { Role } from '../types';
import { ModalInvitarUsuario } from './invitaciones/ModalInvitarUsuario';
import { UserAvatar } from './UserAvatar';

export const MiembrosView: React.FC = () => {
  const { activeWorkspace, userRoleInActiveWorkspace, theme, session } = useStore();
  const [miembros, setMiembros] = useState<any[]>([]);
  const [invitaciones, setInvitaciones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [cargoUsuario, setCargoUsuario] = useState<string | null>(null);
  const [conexiones, setConexiones] = useState<Record<string, { hoy: number; semana: number; conectado: boolean }>>({});
  const [filtroTiempo, setFiltroTiempo] = useState<'hoy' | 'semana'>('hoy');

  const isAdmin = userRoleInActiveWorkspace === Role.ADMIN || userRoleInActiveWorkspace === Role.SUPER_ADMIN;
  const isArcade = theme === 'arcade';
  const esCeoCoo = cargoUsuario === 'ceo' || cargoUsuario === 'coo';

  const fetchData = async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const { data: mData } = await supabase
        .from('miembros_espacio')
        .select('*, usuario:usuarios(*), departamento:departamentos(*), cargo_ref:cargos!cargo_id(nombre, clave)')
        .eq('espacio_id', activeWorkspace.id)
        .eq('aceptado', true);
      
      const { data: iData } = await supabase
        .from('invitaciones_pendientes')
        .select('*')
        .eq('espacio_id', activeWorkspace.id)
        .eq('usada', false);

      setMiembros(mData || []);
      setInvitaciones(iData || []);

      // Obtener cargo del usuario actual
      if (session?.user?.id) {
        const miMiembro = mData?.find((m: any) => m.usuario_id === session.user.id);
        const clave = miMiembro?.cargo_ref?.clave || miMiembro?.cargo;
        setCargoUsuario(clave || null);
      }
    } finally {
      setLoading(false);
    }
  };

  // Cargar datos de conexión (solo si es CEO/COO)
  const fetchConexiones = async () => {
    if (!activeWorkspace || !esCeoCoo) return;
    const ahora = new Date();
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString();
    const inicioSemana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('registro_conexiones')
      .select('usuario_id, conectado_en, desconectado_en, duracion_minutos')
      .eq('espacio_id', activeWorkspace.id)
      .gte('conectado_en', inicioSemana);

    if (data) {
      const map: Record<string, { hoy: number; semana: number; conectado: boolean }> = {};
      data.forEach((r: any) => {
        if (!map[r.usuario_id]) map[r.usuario_id] = { hoy: 0, semana: 0, conectado: false };
        const mins = r.duracion_minutos || (r.desconectado_en ? 0 : Math.floor((ahora.getTime() - new Date(r.conectado_en).getTime()) / 60000));
        if (new Date(r.conectado_en) >= new Date(inicioHoy)) map[r.usuario_id].hoy += mins;
        map[r.usuario_id].semana += mins;
        if (!r.desconectado_en) map[r.usuario_id].conectado = true;
      });
      setConexiones(map);
    }
  };

  useEffect(() => { fetchData(); }, [activeWorkspace]);
  useEffect(() => { fetchConexiones(); }, [activeWorkspace, esCeoCoo]);

  const getRolColor = (rol: string) => {
    const map: any = { 
      super_admin: isArcade ? 'bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]' : 'bg-purple-500', 
      admin: isArcade ? 'bg-red-500/20 text-red-500 border border-red-500' : 'bg-red-500', 
      moderador: 'bg-orange-500', 
      miembro: isArcade ? 'bg-[#00ff41]/10 text-[#00ff41]/80 border border-[#00ff41]/30' : 'bg-blue-500', 
      invitado: 'bg-zinc-500' 
    };
    return map[rol] || 'bg-zinc-500';
  };

  const formatMinutos = (mins: number) => {
    if (mins < 1) return '< 1m';
    if (mins < 60) return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="p-12 max-w-6xl mx-auto h-full overflow-y-auto custom-scrollbar">
      <div className="flex justify-between items-end mb-12">
        <div>
           <h2 className={`text-4xl font-black uppercase italic tracking-tighter ${isArcade ? 'text-[#00ff41] neon-text' : ''}`}>Miembros del Equipo</h2>
           <p className={`text-[10px] font-black uppercase tracking-[0.3em] mt-2 ${isArcade ? 'text-[#00ff41]/60' : 'text-zinc-500'}`}>Gestiona el acceso de tu organización</p>
        </div>
        <div className="flex items-center gap-3">
          {esCeoCoo && (
            <div className={`flex rounded-xl overflow-hidden border ${isArcade ? 'border-[#00ff41]/30' : 'border-white/10'}`}>
              <button onClick={() => setFiltroTiempo('hoy')} className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${filtroTiempo === 'hoy' ? (isArcade ? 'bg-[#00ff41] text-black' : 'bg-indigo-600 text-white') : 'bg-transparent opacity-50 hover:opacity-100'}`}>Hoy</button>
              <button onClick={() => setFiltroTiempo('semana')} className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${filtroTiempo === 'semana' ? (isArcade ? 'bg-[#00ff41] text-black' : 'bg-indigo-600 text-white') : 'bg-transparent opacity-50 hover:opacity-100'}`}>7 días</button>
            </div>
          )}
          {isAdmin && (
            <button 
              onClick={() => setShowInvite(true)} 
              className={`px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-2xl transition-all active:scale-95 ${
                isArcade ? 'bg-[#00ff41] text-black shadow-[#00ff41]/30' : 'bg-indigo-600 text-white shadow-indigo-600/20'
              }`}
            >
              Invitar Usuario
            </button>
          )}
        </div>
      </div>

      <div className="space-y-12">
        <section>
          <div className={`overflow-hidden rounded-[32px] border ${isArcade ? 'border-[#00ff41]/30 bg-black' : 'border-white/5 bg-zinc-950/40'} shadow-2xl`}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`${isArcade ? 'bg-[#00ff41]/5' : 'bg-black/40'}`}>
                  <th className={`p-6 text-[10px] font-black uppercase tracking-[0.2em] ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>Usuario</th>
                  <th className={`p-6 text-[10px] font-black uppercase tracking-[0.2em] ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>Rol</th>
                  <th className={`p-6 text-[10px] font-black uppercase tracking-[0.2em] ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>Departamento</th>
                  {esCeoCoo && (
                    <th className={`p-6 text-[10px] font-black uppercase tracking-[0.2em] ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>
                      Tiempo Conectado
                    </th>
                  )}
                  <th className={`p-6 text-[10px] font-black uppercase tracking-[0.2em] ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>Acciones</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isArcade ? 'divide-[#00ff41]/10' : 'divide-white/5'}`}>
                {miembros.map(m => {
                  const conn = conexiones[m.usuario_id];
                  const tiempoMins = conn ? (filtroTiempo === 'hoy' ? conn.hoy : conn.semana) : 0;
                  return (
                  <tr key={m.id} className={`${isArcade ? 'hover:bg-[#00ff41]/5' : 'hover:bg-white/[0.02]'} transition-colors`}>
                    <td className="p-6">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <UserAvatar
                            name={m.usuario?.nombre || ''}
                            profilePhoto={m.usuario?.avatar_url}
                            size="md"
                          />
                          {esCeoCoo && conn?.conectado && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-black animate-pulse" title="Conectado ahora" />
                          )}
                        </div>
                        <div>
                          <p className={`text-sm font-black uppercase tracking-widest ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>{m.usuario?.nombre}</p>
                          <p className={`text-[10px] font-bold ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>{m.usuario?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-6">
                       <span className={`px-3 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest ${getRolColor(m.rol)}`}>
                         {m.rol.replace('_', ' ')}
                       </span>
                    </td>
                    <td className="p-6">
                       <p className={`text-[10px] font-black uppercase tracking-widest ${isArcade ? 'text-[#00ff41]/60' : 'text-zinc-400'}`}>
                         {m.departamento?.nombre || 'General'}
                       </p>
                    </td>
                    {esCeoCoo && (
                      <td className="p-6">
                        <div className="flex items-center gap-2">
                          <div className={`w-20 h-2 rounded-full overflow-hidden ${isArcade ? 'bg-[#00ff41]/10' : 'bg-white/5'}`}>
                            <div 
                              className={`h-full rounded-full transition-all ${
                                tiempoMins > 360 ? (isArcade ? 'bg-[#00ff41]' : 'bg-green-500') :
                                tiempoMins > 120 ? (isArcade ? 'bg-[#00ff41]/70' : 'bg-indigo-500') :
                                tiempoMins > 0 ? (isArcade ? 'bg-[#00ff41]/40' : 'bg-amber-500') :
                                'bg-transparent'
                              }`}
                              style={{ width: `${Math.min(100, (tiempoMins / (filtroTiempo === 'hoy' ? 480 : 2400)) * 100)}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-black ${
                            tiempoMins > 0 ? (isArcade ? 'text-[#00ff41]' : 'text-white') : 'text-zinc-600'
                          }`}>
                            {tiempoMins > 0 ? formatMinutos(tiempoMins) : 'Sin datos'}
                          </span>
                        </div>
                      </td>
                    )}
                    <td className="p-6">
                       {isAdmin && m.rol !== 'super_admin' && (
                         <button className="text-red-500 text-[10px] font-black uppercase tracking-widest hover:text-red-400 hover:underline underline-offset-4">Eliminar</button>
                       )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {isAdmin && invitaciones.length > 0 && (
          <section>
            <h3 className={`text-[10px] font-black uppercase tracking-[0.3em] mb-6 ${isArcade ? 'text-[#00ff41]/60' : 'text-zinc-600'}`}>Invitaciones Pendientes</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {invitaciones.map(inv => (
                 <div key={inv.id} className={`p-8 rounded-[40px] border shadow-2xl transition-all hover:scale-[1.02] ${isArcade ? 'bg-black border-[#00ff41]/20' : 'bg-zinc-900/40 border-white/5'}`}>
                    <div className="flex justify-between items-start mb-4">
                       <div className={`p-3 rounded-2xl ${isArcade ? 'bg-[#00ff41]/10 text-[#00ff41]' : 'bg-indigo-600/10 text-indigo-400'}`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                       </div>
                       <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${isArcade ? 'bg-[#00ff41]/5 text-[#00ff41]/40' : 'bg-black/40 text-zinc-600'}`}>
                         Pendiente
                       </span>
                    </div>
                    <p className={`text-xs font-black uppercase tracking-widest mb-1 truncate ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>{inv.email}</p>
                    <p className={`text-[9px] font-bold uppercase tracking-widest mb-6 ${isArcade ? 'text-[#00ff41]/40' : 'text-zinc-500'}`}>{inv.rol}</p>
                    <button className="text-red-500 text-[10px] font-black uppercase tracking-widest hover:text-red-400 hover:underline underline-offset-4">Cancelar</button>
                 </div>
               ))}
            </div>
          </section>
        )}
      </div>

      {activeWorkspace && (
        <ModalInvitarUsuario
          espacioId={activeWorkspace.id}
          espacioNombre={activeWorkspace.name}
          abierto={showInvite}
          onCerrar={() => setShowInvite(false)}
          onExito={fetchData}
        />
      )}
    </div>
  );
};
