// ═══════════════════════════════════════════════════════════════
// CrediGestor Portal — App Logic (Dashboard, Margens, Pedidos, etc.)
// ═══════════════════════════════════════════════════════════════

let currentPage = 'dashboard';
let realtimeChannel = null;

// ── Navigation ──
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="page-loader"><div class="spinner"></div></div>';
  closeSidebar();

  switch(page) {
    case 'dashboard': renderDashboard(main); break;
    case 'margens': renderMargens(main); break;
    case 'solicitar': renderSolicitar(main); break;
    case 'pedidos': renderPedidos(main); break;
    case 'contratos': renderContratos(main); break;
    case 'notificacoes': renderNotificacoes(main); break;
    default: renderDashboard(main);
  }
}

// ── Sidebar Mobile ──
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ── Toast ──
function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 4000);
}

// ── Modal ──
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
async function renderDashboard(container) {
  if (!clienteData) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🔒</div><h3>Conta não vinculada</h3><p>Seu gestor ainda não ativou seu acesso ao portal. Entre em contato.</p></div>`;
    return;
  }

  // Fetch data in parallel
  const [empRes, solRes, notifRes] = await Promise.all([
    supabase.from('emprestimos').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }),
    supabase.from('solicitacoes_emprestimo').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('notificacoes_cliente').select('*').eq('cliente_id', clienteData.id).eq('lida', false)
  ]);

  const emprestimos = empRes.data || [];
  const solicitacoes = solRes.data || [];
  const notifCount = (notifRes.data || []).length;

  const ativos = emprestimos.filter(e => e.status === 'ativo');
  const totalDevido = ativos.reduce((s, e) => s + (Number(e.valor) || 0), 0);
  const limite = Number(clienteData.limite) || 0;
  const usado = totalDevido;
  const disponivel = Math.max(0, limite - usado);
  const pendentes = solicitacoes.filter(s => s.status === 'pendente' || s.status === 'em_analise').length;

  // Update badges
  if (pendentes > 0) {
    document.getElementById('badge-pedidos').textContent = pendentes;
    document.getElementById('badge-pedidos').classList.remove('hidden');
  }
  if (notifCount > 0) {
    document.getElementById('badge-notif').textContent = notifCount;
    document.getElementById('badge-notif').classList.remove('hidden');
  }

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>Olá, ${(clienteData.nome || 'Cliente').split(' ')[0]}! 👋</h1>
        <p>Acompanhe seus créditos e faça novas solicitações</p>
      </div>
      <div class="stats-grid">
        <div class="stat-card fade-in stagger-1">
          <div class="stat-label">Limite Total</div>
          <div class="stat-value text-money">${formatMoney(limite)}</div>
          <div class="stat-sub">Definido pelo seu gestor</div>
        </div>
        <div class="stat-card fade-in stagger-2">
          <div class="stat-label">Disponível</div>
          <div class="stat-value text-money" style="${disponivel <= 0 ? '-webkit-text-fill-color:#ef4444' : ''}">${formatMoney(disponivel)}</div>
          <div class="stat-sub">${limite > 0 ? Math.round((disponivel/limite)*100) + '% livre' : 'Sem limite definido'}</div>
        </div>
        <div class="stat-card fade-in stagger-3">
          <div class="stat-label">Contratos Ativos</div>
          <div class="stat-value">${ativos.length}</div>
          <div class="stat-sub">${formatMoney(totalDevido)} em aberto</div>
        </div>
        <div class="stat-card fade-in stagger-4">
          <div class="stat-label">Pedidos Pendentes</div>
          <div class="stat-value" style="${pendentes > 0 ? '-webkit-text-fill-color:#f59e0b' : ''}">${pendentes}</div>
          <div class="stat-sub">${pendentes > 0 ? 'Aguardando análise' : 'Nenhum pendente'}</div>
        </div>
      </div>

      <div class="grid-2" style="align-items:start">
        <!-- Quick Actions -->
        <div class="glass-card">
          <h3 style="font-weight:700;margin-bottom:16px;font-size:1rem">⚡ Ações Rápidas</h3>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn-brand" onclick="navigate('solicitar')" style="text-align:left;display:flex;align-items:center;gap:10px">
              <span style="font-size:1.2rem">💰</span> Solicitar Novo Crédito
            </button>
            <button class="btn-ghost" onclick="navigate('contratos')" style="text-align:left;display:flex;align-items:center;gap:10px">
              <span style="font-size:1.2rem">📄</span> Ver Meus Contratos
            </button>
            <button class="btn-ghost" onclick="navigate('margens')" style="text-align:left;display:flex;align-items:center;gap:10px">
              <span style="font-size:1.2rem">📈</span> Consultar Margens
            </button>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="glass-card">
          <h3 style="font-weight:700;margin-bottom:16px;font-size:1rem">📋 Últimas Solicitações</h3>
          ${solicitacoes.length === 0
            ? '<div class="empty-state" style="padding:20px"><p>Nenhuma solicitação ainda</p></div>'
            : solicitacoes.slice(0,4).map(s => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-glass)">
                <div>
                  <div style="font-weight:700;font-size:0.9rem">${formatMoney(s.valor)}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted)">${formatDate(s.created_at)}</div>
                </div>
                <span class="badge badge-${s.status}"><span class="badge-dot"></span>${statusLabel(s.status)}</span>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// MINHAS MARGENS
// ═══════════════════════════════════════════════════════════════
async function renderMargens(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const { data: emprestimos } = await supabase.from('emprestimos').select('valor,tipo,status').eq('cliente_id', clienteData.id).eq('status', 'ativo');
  const ativos = emprestimos || [];

  const limite = Number(clienteData.limite) || 0;
  const limParcelado = clienteData.limite_parcelado != null ? Number(clienteData.limite_parcelado) : limite;
  const limCartao = clienteData.limite_cartao != null ? Number(clienteData.limite_cartao) : limite;
  const limitesTipos = typeof clienteData.limites_tipos === 'string' ? JSON.parse(clienteData.limites_tipos || '{}') : (clienteData.limites_tipos || {});

  const usadoTotal = ativos.reduce((s, e) => s + Number(e.valor), 0);
  const usadoParcelado = ativos.filter(e => e.tipo === 'parcelado').reduce((s, e) => s + Number(e.valor), 0);
  const usadoCartao = ativos.filter(e => e.tipo === 'cartao').reduce((s, e) => s + Number(e.valor), 0);

  function barHTML(label, total, used) {
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
    return `
      <div class="glass-card fade-in" style="margin-bottom:12px">
        <div class="flex justify-between items-center" style="margin-bottom:8px">
          <span style="font-weight:700;font-size:0.9rem">${label}</span>
          <span style="font-size:0.8rem;color:var(--text-muted)">${pct}% usado</span>
        </div>
        <div style="height:10px;background:rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;margin-bottom:12px">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:10px;transition:width 1s ease"></div>
        </div>
        <div class="flex justify-between" style="font-size:0.82rem">
          <span>Limite: <strong>${formatMoney(total)}</strong></span>
          <span>Usado: <strong>${formatMoney(used)}</strong></span>
          <span style="color:${color}">Disponível: <strong>${formatMoney(Math.max(0, total - used))}</strong></span>
        </div>
      </div>
    `;
  }

  let extrasHTML = '';
  Object.keys(limitesTipos).forEach(tipo => {
    const val = Number(limitesTipos[tipo]) || 0;
    if (val > 0) {
      const usado = ativos.filter(e => e.tipo === tipo).reduce((s, e) => s + Number(e.valor), 0);
      extrasHTML += barHTML(tipo.charAt(0).toUpperCase() + tipo.slice(1), val, usado);
    }
  });

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>📈 Minhas Margens</h1>
        <p>Acompanhe seus limites de crédito em tempo real</p>
      </div>
      ${barHTML('Limite Geral', limite, usadoTotal)}
      ${barHTML('Limite Parcelado', limParcelado, usadoParcelado)}
      ${barHTML('Limite Cartão', limCartao, usadoCartao)}
      ${extrasHTML}
      <p style="font-size:0.78rem;color:var(--text-muted);margin-top:16px;text-align:center">
        💡 Os limites são definidos e atualizados pelo seu gestor
      </p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// SOLICITAR CRÉDITO
// ═══════════════════════════════════════════════════════════════
async function renderSolicitar(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const limite = Number(clienteData.limite) || 0;
  const { data: ativos } = await supabase.from('emprestimos').select('valor').eq('cliente_id', clienteData.id).eq('status', 'ativo');
  const usado = (ativos || []).reduce((s, e) => s + Number(e.valor), 0);
  const disponivel = Math.max(0, limite - usado);

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>💰 Solicitar Crédito</h1>
        <p>Preencha os dados abaixo para solicitar um novo empréstimo</p>
      </div>
      <div class="glass-card" style="max-width:560px">
        <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:16px;margin-bottom:24px">
          <div style="font-size:0.75rem;font-weight:700;color:var(--brand-emerald);text-transform:uppercase;margin-bottom:4px">Margem disponível</div>
          <div style="font-size:1.5rem;font-weight:900;color:var(--brand-emerald)" class="text-money">${formatMoney(disponivel)}</div>
        </div>
        <form id="form-solicitar-inline" onsubmit="submitSolicitacao(event)">
          <div style="margin-bottom:16px">
            <label class="input-label">Valor desejado (R$)</label>
            <input type="number" id="sol-valor-i" class="input-field" placeholder="1000.00" min="1" max="${disponivel > 0 ? disponivel : 999999}" step="0.01" required>
          </div>
          <div class="grid-2" style="margin-bottom:16px">
            <div>
              <label class="input-label">Tipo</label>
              <select id="sol-tipo-i" class="input-field">
                <option value="avulso">Avulso</option>
                <option value="parcelado">Parcelado</option>
                <option value="cartao">Cartão</option>
              </select>
            </div>
            <div>
              <label class="input-label">Parcelas</label>
              <select id="sol-parcelas-i" class="input-field">
                ${[1,2,3,4,5,6,8,10,12].map(n => `<option value="${n}">${n}x</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="margin-bottom:24px">
            <label class="input-label">Observação (opcional)</label>
            <textarea id="sol-obs-i" class="input-field" rows="3" placeholder="Motivo ou observação..."></textarea>
          </div>
          <button type="submit" class="btn-brand" style="width:100%;padding:14px" id="btn-submit-sol-i">
            Enviar Solicitação
          </button>
        </form>
      </div>
    </div>
  `;
}

async function submitSolicitacao(e) {
  e.preventDefault();
  if (!clienteData) return showToast('Conta não vinculada', 'error');

  // Support both modal and inline form
  const isInline = document.getElementById('sol-valor-i');
  const valor = parseFloat((isInline || document.getElementById('sol-valor')).value);
  const tipo = (isInline ? document.getElementById('sol-tipo-i') : document.getElementById('sol-tipo')).value;
  const parcelas = parseInt((isInline ? document.getElementById('sol-parcelas-i') : document.getElementById('sol-parcelas')).value);
  const obs = (isInline ? document.getElementById('sol-obs-i') : document.getElementById('sol-obs')).value.trim();

  if (!valor || valor <= 0) return showToast('Informe um valor válido', 'error');

  const btn = isInline ? document.getElementById('btn-submit-sol-i') : document.getElementById('btn-submit-sol');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const { error } = await supabase.from('solicitacoes_emprestimo').insert({
      tenant_id: clienteData.tenant_id,
      cliente_id: clienteData.id,
      valor,
      parcelas,
      tipo,
      observacao: obs,
      status: 'pendente'
    });
    if (error) throw error;
    showToast('Solicitação enviada com sucesso! Aguarde análise do gestor.');
    closeModal('modal-solicitar');
    navigate('pedidos');
  } catch (err) {
    showToast(err.message || 'Erro ao enviar solicitação', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Solicitação';
  }
}

// ═══════════════════════════════════════════════════════════════
// MEUS PEDIDOS (Solicitações)
// ═══════════════════════════════════════════════════════════════
async function renderPedidos(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const { data: solicitacoes } = await supabase
    .from('solicitacoes_emprestimo')
    .select('*')
    .eq('cliente_id', clienteData.id)
    .order('created_at', { ascending: false });

  const items = solicitacoes || [];

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header flex justify-between items-center">
        <div>
          <h1>📋 Meus Pedidos</h1>
          <p>Acompanhe o status das suas solicitações</p>
        </div>
        <button class="btn-brand" onclick="navigate('solicitar')">+ Nova Solicitação</button>
      </div>
      ${items.length === 0
        ? '<div class="empty-state"><div class="icon">📭</div><h3>Nenhum pedido</h3><p>Você ainda não fez nenhuma solicitação de crédito</p></div>'
        : `<div class="table-container"><table class="data-table">
            <thead><tr><th>Data</th><th>Valor</th><th>Tipo</th><th>Parcelas</th><th>Status</th><th>Decisão</th><th>Ação</th></tr></thead>
            <tbody>${items.map(s => `
              <tr>
                <td>${formatDate(s.created_at)}</td>
                <td class="text-money" style="font-weight:700">${formatMoney(s.valor)}</td>
                <td>${s.tipo || 'avulso'}</td>
                <td>${s.parcelas}x</td>
                <td><span class="badge badge-${s.status}"><span class="badge-dot"></span>${statusLabel(s.status)}</span></td>
                <td style="font-size:0.8rem;color:var(--text-muted)">${s.motivo_decisao || '—'}</td>
                <td>${s.status === 'pendente' ? `<button class="btn-ghost" style="font-size:0.75rem;padding:4px 12px" onclick="cancelarSolicitacao('${s.id}')">Cancelar</button>` : '—'}</td>
              </tr>
            `).join('')}</tbody>
          </table></div>`
      }
    </div>
  `;
}

async function cancelarSolicitacao(id) {
  if (!confirm('Deseja cancelar esta solicitação?')) return;
  const { error } = await supabase.from('solicitacoes_emprestimo')
    .update({ status: 'cancelado' })
    .eq('id', id);
  if (error) return showToast('Erro ao cancelar: ' + error.message, 'error');
  showToast('Solicitação cancelada');
  navigate('pedidos');
}

// ═══════════════════════════════════════════════════════════════
// MEUS CONTRATOS
// ═══════════════════════════════════════════════════════════════
async function renderContratos(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const { data: emprestimos } = await supabase
    .from('emprestimos')
    .select('*')
    .eq('cliente_id', clienteData.id)
    .order('created_at', { ascending: false });

  const items = emprestimos || [];

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>📄 Meus Contratos</h1>
        <p>Contratos de empréstimo ativos e finalizados</p>
      </div>
      ${items.length === 0
        ? '<div class="empty-state"><div class="icon">📑</div><h3>Nenhum contrato</h3><p>Você ainda não possui contratos</p></div>'
        : items.map(e => {
          const parcPagas = e.parcelas_pagas || 0;
          const parcTotal = e.parcelas || 1;
          const pct = Math.round((parcPagas / parcTotal) * 100);
          return `
            <div class="glass-card fade-in" style="margin-bottom:12px">
              <div class="flex justify-between items-center" style="margin-bottom:12px">
                <div>
                  <span style="font-size:1.2rem;font-weight:900">${formatMoney(e.valor)}</span>
                  <span class="badge badge-${e.status}" style="margin-left:8px">${statusLabel(e.status)}</span>
                </div>
                <span style="font-size:0.8rem;color:var(--text-muted)">${e.tipo || 'avulso'}</span>
              </div>
              <div class="grid-2" style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px">
                <div>Início: <strong>${formatDate(e.data_inicio)}</strong></div>
                <div>Vencimento: <strong>${formatDate(e.data_vencimento)}</strong></div>
                <div>Taxa: <strong>${e.taxa || 0}%</strong></div>
                <div>Parcela: <strong>${formatMoney(e.valor_parcela)}</strong></div>
              </div>
              <div style="margin-bottom:4px;font-size:0.78rem;color:var(--text-muted)">Progresso: ${parcPagas}/${parcTotal} parcelas (${pct}%)</div>
              <div style="height:8px;background:rgba(255,255,255,0.05);border-radius:8px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--gradient-brand);border-radius:8px;transition:width 1s"></div>
              </div>
              ${e.obs ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--text-muted)">Obs: ${e.obs}</div>` : ''}
            </div>
          `;
        }).join('')
      }
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICAÇÕES
// ═══════════════════════════════════════════════════════════════
async function renderNotificacoes(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const { data: notifs } = await supabase
    .from('notificacoes_cliente')
    .select('*')
    .eq('cliente_id', clienteData.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const items = notifs || [];

  // Mark all as read
  const unread = items.filter(n => !n.lida).map(n => n.id);
  if (unread.length > 0) {
    await supabase.from('notificacoes_cliente').update({ lida: true }).in('id', unread);
    document.getElementById('badge-notif').classList.add('hidden');
  }

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>🔔 Notificações</h1>
        <p>Avisos e atualizações do seu gestor</p>
      </div>
      ${items.length === 0
        ? '<div class="empty-state"><div class="icon">🔕</div><h3>Nenhuma notificação</h3><p>Você será notificado sobre atualizações dos seus pedidos</p></div>'
        : items.map(n => `
          <div class="glass-card fade-in" style="margin-bottom:8px;${!n.lida ? 'border-left:3px solid var(--brand-emerald)' : ''}">
            <div class="flex justify-between items-center">
              <div>
                <div style="font-weight:700;font-size:0.95rem">${n.titulo}</div>
                <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">${n.mensagem}</div>
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;margin-left:16px">${formatDateTime(n.created_at)}</div>
            </div>
          </div>
        `).join('')
      }
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// REALTIME SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════
function initRealtimeSubscriptions() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  if (!clienteData) return;

  realtimeChannel = supabase
    .channel('portal-updates')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'solicitacoes_emprestimo',
      filter: `cliente_id=eq.${clienteData.id}`
    }, payload => {
      if (payload.eventType === 'UPDATE' && payload.new.status !== payload.old?.status) {
        const s = payload.new;
        showToast(`Pedido de ${formatMoney(s.valor)} → ${statusLabel(s.status)}`, s.status === 'aprovado' ? 'success' : 'error');
        if (currentPage === 'pedidos') navigate('pedidos');
        if (currentPage === 'dashboard') navigate('dashboard');
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'clientes',
      filter: `id=eq.${clienteData.id}`
    }, payload => {
      if (payload.eventType === 'UPDATE') {
        clienteData = { ...clienteData, ...payload.new };
        showToast('Seus limites foram atualizados!', 'success');
        if (currentPage === 'margens') navigate('margens');
        if (currentPage === 'dashboard') navigate('dashboard');
      }
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notificacoes_cliente',
      filter: `cliente_id=eq.${clienteData.id}`
    }, payload => {
      showToast(`🔔 ${payload.new.titulo}`, 'success');
      const badge = document.getElementById('badge-notif');
      badge.classList.remove('hidden');
      badge.textContent = parseInt(badge.textContent || 0) + 1;
    })
    .subscribe();
}

// ── Helpers ──
function noDataMsg() {
  return '<div class="empty-state"><div class="icon">🔒</div><h3>Conta não vinculada</h3><p>Seu gestor precisa ativar seu acesso ao portal.</p></div>';
}
