import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { SettingSection } from '../components/SettingSection';
import { Language, getCurrentLanguage, subscribeToLanguageChange } from '../../../lib/i18n';
import { ModalInvitarUsuario } from '../../invitaciones/ModalInvitarUsuario';
import { useStore } from '../../../store/useStore';

interface Member {
  id: string;
  usuario_id: string;
  rol: string;
  cargo: string;
  cargo_id: string | null;
  cargo_ref?: { nombre: string } | null;
  aceptado: boolean;
  usuario?: {
    nombre: string;
    email: string;
  };
}

interface InvitacionPendiente {
  id: string;
  email: string;
  rol: string;
  nombre_invitado?: string;
  created_at: string;
  expira_en: string;
}

interface SettingsMembersProps {
  workspaceId: string;
  isAdmin: boolean;
}

export const SettingsMembers: React.FC<SettingsMembersProps> = ({
  workspaceId,
  isAdmin
}) => {
  const { activeWorkspace } = useStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitaciones, setInvitaciones] = useState<InvitacionPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [currentLang, setCurrentLang] = useState<Language>(getCurrentLanguage());

  // Escuchar cambios de idioma
  useEffect(() => {
    const unsubscribe = subscribeToLanguageChange(() => {
      setCurrentLang(getCurrentLanguage());
    });
    return unsubscribe;
  }, []);

  const loadData = async () => {
    if (!workspaceId) return;
    setLoading(true);

    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from('miembros_espacio')
        .select(`
          id,
          usuario_id,
          rol,
          cargo,
          cargo_id,
          aceptado,
          usuario:usuarios(nombre, email),
          cargo_ref:cargos!cargo_id(nombre)
        `)
        .eq('espacio_id', workspaceId),
      supabase
        .from('invitaciones_pendientes')
        .select('id, email, rol, nombre_invitado, created_at, expira_en')
        .eq('espacio_id', workspaceId)
        .eq('usada', false)
        .order('created_at', { ascending: false }),
    ]);

    if (!membersRes.error && membersRes.data) setMembers(membersRes.data as any);
    if (!invitesRes.error && invitesRes.data) setInvitaciones(invitesRes.data as any);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [workspaceId]);

  const cancelarInvitacion = async (id: string) => {
    await supabase.from('invitaciones_pendientes').delete().eq('id', id);
    setInvitaciones(prev => prev.filter(i => i.id !== id));
  };

  const getRoleBadge = (rol: string) => {
    const colors: Record<string, string> = {
      super_admin: 'bg-gradient-to-r from-amber-500 to-orange-500 text-black',
      admin: 'bg-violet-600 text-white',
      member: 'bg-zinc-700 text-zinc-300'
    };
    const labels: Record<string, Record<Language, string>> = {
      super_admin: { es: 'Super Admin', en: 'Super Admin', pt: 'Super Admin' },
      admin: { es: 'Admin', en: 'Admin', pt: 'Admin' },
      member: { es: 'Miembro', en: 'Member', pt: 'Membro' }
    };
    return (
      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${colors[rol] || colors.member}`}>
        {labels[rol]?.[currentLang] || rol}
      </span>
    );
  };

  return (
    <div>
      <div className="mb-8 lg:mb-6">
        <h2 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-2 lg:mb-1">
          {currentLang === 'en' ? 'Manage Members' : currentLang === 'pt' ? 'Gerenciar Membros' : 'Gestionar Miembros'}
        </h2>
        <p className="text-sm text-zinc-400">
          {currentLang === 'en' ? 'Manage workspace members' : currentLang === 'pt' ? 'Gerenciar os membros do espaço de trabalho' : 'Administra los miembros del espacio de trabajo'}
        </p>
      </div>

      <SettingSection title={`${currentLang === 'en' ? 'Members' : currentLang === 'pt' ? 'Membros' : 'Miembros'} (${members.length})`}>
        {loading ? (
          <div className="py-8 text-center">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white font-bold">
                    {(member.usuario?.nombre || 'U')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {member.usuario?.nombre || 'Usuario'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {member.usuario?.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {(member.cargo_ref?.nombre || member.cargo) && (
                    <span className="text-xs text-zinc-400 bg-zinc-800 px-2 py-1 rounded-lg">
                      {(member.cargo_ref as any)?.nombre || member.cargo}
                    </span>
                  )}
                  {getRoleBadge(member.rol)}
                  {!member.aceptado && (
                    <span className="text-xs text-amber-400">{currentLang === 'en' ? 'Pending' : currentLang === 'pt' ? 'Pendente' : 'Pendiente'}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingSection>

      {/* Invitaciones pendientes */}
      {isAdmin && invitaciones.length > 0 && (
        <div className="mt-6">
          <SettingSection title={`${currentLang === 'en' ? 'Pending Invitations' : currentLang === 'pt' ? 'Convites Pendentes' : 'Invitaciones Pendientes'} (${invitaciones.length})`}>
            <div className="divide-y divide-white/[0.05]">
              {invitaciones.map((inv) => {
                const expirada = new Date(inv.expira_en) < new Date();
                return (
                  <div key={inv.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {inv.nombre_invitado || inv.email}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {inv.email} · <span className="capitalize">{inv.rol}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {expirada ? (
                        <span className="text-[10px] text-red-400 font-bold uppercase">
                          {currentLang === 'en' ? 'Expired' : currentLang === 'pt' ? 'Expirado' : 'Expirada'}
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-400 font-bold uppercase">
                          {currentLang === 'en' ? 'Pending' : currentLang === 'pt' ? 'Pendente' : 'Pendiente'}
                        </span>
                      )}
                      <button
                        onClick={() => cancelarInvitacion(inv.id)}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                      >
                        {currentLang === 'en' ? 'Cancel' : currentLang === 'pt' ? 'Cancelar' : 'Cancelar'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </SettingSection>
        </div>
      )}

      {/* Botón invitar */}
      {isAdmin && (
        <div className="mt-6">
          <button
            onClick={() => setShowInviteModal(true)}
            className="w-full py-4 border-2 border-dashed border-white/[0.1] rounded-2xl text-zinc-500 hover:text-violet-400 hover:border-violet-500/30 transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {currentLang === 'en' ? 'Invite new member' : currentLang === 'pt' ? 'Convidar novo membro' : 'Invitar nuevo miembro'}
          </button>
        </div>
      )}

      {/* Modal de invitación */}
      {activeWorkspace && (
        <ModalInvitarUsuario
          espacioId={workspaceId}
          espacioNombre={activeWorkspace.name}
          abierto={showInviteModal}
          onCerrar={() => setShowInviteModal(false)}
          onExito={loadData}
        />
      )}
    </div>
  );
};

export default SettingsMembers;
