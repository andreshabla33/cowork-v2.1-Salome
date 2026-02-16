import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_REUNIONES');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Destinatario {
  email: string;
  nombre: string;
  link_personalizado?: string; // Link único por invitado (sin login)
}

interface DatosReunion {
  titulo: string;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  meeting_link: string; // Fallback
  organizador_nombre: string;
  tipo_reunion: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { destinatarios, reunion }: { destinatarios: Destinatario[]; reunion: DatosReunion } = await req.json();

    if (!destinatarios || destinatarios.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No hay destinatarios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_REUNIONES no configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fechaInicio = new Date(reunion.fecha_inicio);
    const fechaFin = new Date(reunion.fecha_fin);
    const fechaFormateada = fechaInicio.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const horaInicio = fechaInicio.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const horaFin = fechaFin.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const resultados = [];

    for (const dest of destinatarios) {
      // Usar link personalizado si existe, sino el link general
      const linkReunion = dest.link_personalizado || reunion.meeting_link;
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fff; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
            .header { padding: 24px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); text-align: center; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
            .content { padding: 24px; }
            .info-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .info-row:last-child { border-bottom: none; }
            .icon { width: 32px; height: 32px; background: rgba(99, 102, 241, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
            .label { font-size: 11px; text-transform: uppercase; opacity: 0.6; font-weight: 600; }
            .value { font-size: 14px; font-weight: 500; }
            .btn { display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 14px; margin-top: 16px; }
            .footer { padding: 16px 24px; background: rgba(0,0,0,0.3); text-align: center; font-size: 12px; opacity: 0.6; }
            .note { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 12px; margin-top: 16px; font-size: 12px; color: #22c55e; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📅 Invitación a Reunión</h1>
            </div>
            <div class="content">
              <p style="margin: 0 0 20px 0; opacity: 0.9;">Hola <strong>${dest.nombre}</strong>,</p>
              <p style="margin: 0 0 20px 0; opacity: 0.8;">${reunion.organizador_nombre} te ha invitado a una reunión:</p>
              
              <div class="info-row">
                <div class="icon">📋</div>
                <div>
                  <div class="label">Reunión</div>
                  <div class="value">${reunion.titulo}</div>
                </div>
              </div>
              
              <div class="info-row">
                <div class="icon">📆</div>
                <div>
                  <div class="label">Fecha</div>
                  <div class="value">${fechaFormateada}</div>
                </div>
              </div>
              
              <div class="info-row">
                <div class="icon">🕐</div>
                <div>
                  <div class="label">Hora</div>
                  <div class="value">${horaInicio} - ${horaFin}</div>
                </div>
              </div>
              
              ${reunion.descripcion ? `
              <div class="info-row">
                <div class="icon">📝</div>
                <div>
                  <div class="label">Descripción</div>
                  <div class="value">${reunion.descripcion}</div>
                </div>
              </div>
              ` : ''}
              
              <div style="text-align: center; margin-top: 24px;">
                <a href="${linkReunion}" class="btn">Unirse a la Reunión</a>
              </div>
              
              ${dest.link_personalizado ? `
              <div class="note">
                ✅ Este link es personal y no requiere crear cuenta. Solo haz clic para unirte.
              </div>
              ` : ''}
            </div>
            <div class="footer">
              Enviado desde Cowork Virtual
            </div>
          </div>
        </body>
        </html>
      `;

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Cowork Virtual <noreply@urpeailab.com>',
            to: [dest.email],
            subject: `📅 Invitación: ${reunion.titulo}`,
            html: emailHtml,
          }),
        });

        const resData = await res.json();
        resultados.push({
          email: dest.email,
          success: res.ok,
          status: res.status,
          resend_response: resData,
        });
      } catch (emailError) {
        resultados.push({
          email: dest.email,
          success: false,
          error: String(emailError),
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, resultados }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
