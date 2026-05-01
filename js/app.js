// ═══════════════════════════════════════════════════════════════
// CrediGestor Portal — App Logic (Dashboard, Margens, Pedidos, etc.)
// ═══════════════════════════════════════════════════════════════

let currentPage = 'dashboard';
let realtimeChannel = null;

// ── Navigation ──
const PAGE_RENDERERS = {
  dashboard: () => renderDashboard,
  margens: () => renderMargens,
  solicitar: () => renderSolicitar,
  pedidos: () => renderPedidos,
  contratos: () => renderContratos,
  notificacoes: () => renderNotificacoes,
};

function renderNavError(container, page, err) {
  console.error(`[portal] Erro ao renderizar página "${page}":`, err);
  const msg = (err && err.message) ? err.message : 'Erro desconhecido';
  container.innerHTML = `
    <div class="empty-state" style="padding:40px 20px">
      <div class="icon">⚠️</div>
      <h3>Não foi possível carregar esta página</h3>
      <p style="margin-bottom:16px">${escapeHtml(msg)}</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn-brand" onclick="navigate('${page}')">Tentar novamente</button>
        <button class="btn-ghost" onclick="navigate('dashboard')">Voltar ao Dashboard</button>
      </div>
      <p style="font-size:0.72rem;color:var(--text-muted);margin-top:16px">Detalhes técnicos no console (F12)</p>
    </div>
  `;
}

async function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="page-loader"><div class="spinner"></div></div>';
  closeSidebar();

  const rendererFactory = PAGE_RENDERERS[page] || PAGE_RENDERERS.dashboard;
  const renderer = rendererFactory();
  try {
    await renderer(main);
  } catch (err) {
    renderNavError(main, page, err);
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
  const safeType = type === 'error' ? 'error' : 'success';
  const t = document.createElement('div');
  t.className = `toast toast-${safeType}`;
  const icon = document.createElement('span');
  icon.textContent = safeType === 'success' ? '✅' : '❌';
  t.appendChild(icon);
  t.appendChild(document.createTextNode(` ${String(msg ?? '')}`));
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 4000);
}

document.addEventListener('click', (event) => {
  const cancelButton = event.target.closest('[data-cancel-solicitacao]');
  if (cancelButton) {
    cancelarSolicitacao(cancelButton.dataset.cancelSolicitacao);
  }
});

// ── Modal ──
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function isPortalVisibleEmprestimo(emprestimo) {
  const aprovacao = emprestimo?.aprovacao || 'aprovado';
  return aprovacao === 'aprovado' || aprovacao === 'arquivado';
}

// Label inteligente para tipos: 1-4 chars vira UPPERCASE (PIS, INSS, FGTS),
// demais viram Title Case ("consignado" → "Consignado").
function smartLabel(key) {
  const s = String(key || 'Tipo').trim();
  if (!s) return 'Tipo';
  if (s.length <= 4) return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Retorna todos os tipos de crédito do cliente com seus limites, uso e disponível.
// Inclui os 3 fixos (avulso/parcelado/cartao) + extras de limites_tipos (PIS, INSS, etc).
// `ativos` = lista de empréstimos ativos visíveis.
function getTiposComLimites(cliData, ativos) {
  const limiteBase = Number(cliData.limite) || 0;
  const limPar = cliData.limite_parcelado != null ? Number(cliData.limite_parcelado) : limiteBase;
  const limCar = cliData.limite_cartao != null ? Number(cliData.limite_cartao) : limiteBase;
  const limitesTipos = parseJsonObject(cliData.limites_tipos);

  const tipos = [
    { key: 'avulso', label: 'Avulso', limite: limiteBase },
    { key: 'parcelado', label: 'Parcelado', limite: limPar },
    { key: 'cartao', label: 'Cartão', limite: limCar },
  ];
  const RESERVED = new Set(['avulso', 'parcelado', 'cartao']);
  Object.keys(limitesTipos)
    .filter(k => !RESERVED.has(String(k).toLowerCase()))
    .sort()
    .forEach(k => {
      const v = Number(limitesTipos[k]) || 0;
      if (v > 0) tipos.push({ key: String(k).toLowerCase(), label: smartLabel(k), limite: v });
    });

  // Calcula uso por tipo (case-insensitive)
  tipos.forEach(t => {
    t.usado = (ativos || [])
      .filter(e => String(e.tipo || '').toLowerCase() === t.key)
      .reduce((s, e) => s + (Number(e.valor) || 0), 0);
    t.disponivel = Math.max(0, t.limite - t.usado);
  });

  return tipos;
}

// Wrapper com timeout para queries do supabase. Se passar de N segundos sem
// resposta, rejeita a Promise — evita spinner travado para sempre.
function withTimeout(promise, ms = 10000, label = 'query') {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Tempo esgotado em "${label}". Verifique sua conexão.`)), ms))
  ]);
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
async function renderDashboard(container) {
  if (!clienteData) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🔒</div><h3>Conta não vinculada</h3><p>Seu gestor ainda não ativou seu acesso ao portal. Entre em contato.</p></div>`;
    return;
  }

  // Fetch data in parallel (com timeout — evita spinner eterno se rede falhar)
  const [empRes, solRes, notifRes] = await withTimeout(Promise.all([
    supabase.from('emprestimos').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }),
    supabase.from('solicitacoes_emprestimo').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('notificacoes_cliente').select('*').eq('cliente_id', clienteData.id).eq('lida', false)
  ]), 10000, 'dashboard');

  const emprestimos = empRes.data || [];
  const solicitacoes = solRes.data || [];
  const notifCount = (notifRes.data || []).length;

  const ativos = emprestimos.filter(e => e.status === 'ativo' && isPortalVisibleEmprestimo(e));
  // Limite TOTAL = soma de TODOS os tipos (avulso + parcelado + cartao + extras)
  // — alinhado com o gestor: "Uso total (N tipos): X / Y"
  const tiposLimites = getTiposComLimites(clienteData, ativos);
  const limite = tiposLimites.reduce((s, t) => s + t.limite, 0);
  const usado = tiposLimites.reduce((s, t) => s + t.usado, 0);
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
        <h1>Olá, ${escapeHtml((clienteData.nome || 'Cliente').split(' ')[0])}! 👋</h1>
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
                <span class="badge badge-${cssToken(s.status)}"><span class="badge-dot"></span>${escapeHtml(statusLabel(s.status))}</span>
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

  const { data: emprestimos } = await withTimeout(
    supabase.from('emprestimos').select('valor,tipo,status,aprovacao').eq('cliente_id', clienteData.id).eq('status', 'ativo'),
    10000, 'margens'
  );
  const ativos = (emprestimos || []).filter(isPortalVisibleEmprestimo);
  const tipos = getTiposComLimites(clienteData, ativos);
  const totalLimite = tipos.reduce((s, t) => s + t.limite, 0);
  const totalUsado = tipos.reduce((s, t) => s + t.usado, 0);

  function barHTML(label, total, used) {
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
    return `
      <div class="glass-card fade-in" style="margin-bottom:12px">
        <div class="flex justify-between items-center" style="margin-bottom:8px">
          <span style="font-weight:700;font-size:0.9rem">${escapeHtml(label)}</span>
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

  const tiposHTML = tipos.filter(t => t.limite > 0).map(t => barHTML(t.label, t.limite, t.usado)).join('');

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>📈 Minhas Margens</h1>
        <p>Acompanhe seus limites de crédito em tempo real</p>
      </div>
      ${barHTML('Limite Total Geral', totalLimite, totalUsado)}
      ${tiposHTML}
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

  const { data: ativos } = await withTimeout(
    supabase.from('emprestimos').select('valor,tipo,aprovacao').eq('cliente_id', clienteData.id).eq('status', 'ativo'),
    10000, 'solicitar'
  );
  const ativosFiltered = (ativos || []).filter(isPortalVisibleEmprestimo);
  const tipos = getTiposComLimites(clienteData, ativosFiltered).filter(t => t.limite > 0);

  // Stash em window pra o onchange do <select> ler sem refetch
  window.__solTiposCache = tipos;

  // Tabela resumo dos limites por tipo (cliente vê tudo de uma vez)
  const tiposTableHTML = tipos.map(t => {
    const pct = t.limite > 0 ? Math.min(100, Math.round((t.usado / t.limite) * 100)) : 0;
    const cor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border-glass);font-size:0.85rem">
        <span style="font-weight:600">${escapeHtml(t.label)}</span>
        <span style="color:var(--text-muted);font-size:0.78rem">Usado ${formatMoney(t.usado)}</span>
        <span style="color:${cor};font-weight:700">${formatMoney(t.disponivel)}</span>
      </div>
    `;
  }).join('');

  // O 1º tipo com disponibilidade > 0 vira default selecionado
  const tipoDefault = tipos.find(t => t.disponivel > 0) || tipos[0] || { key: 'avulso', label: 'Avulso', disponivel: 0 };

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>💰 Solicitar Crédito</h1>
        <p>Escolha o tipo de crédito e o valor desejado</p>
      </div>
      <div class="glass-card" style="max-width:640px">
        <div style="background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:12px 0;margin-bottom:20px">
          <div style="padding:0 14px 8px;font-size:0.72rem;font-weight:700;color:var(--brand-emerald);text-transform:uppercase">Seus limites disponíveis</div>
          ${tiposTableHTML || '<div style="padding:14px;text-align:center;color:var(--text-muted)">Nenhum limite definido</div>'}
        </div>

        <form id="form-solicitar-inline" onsubmit="submitSolicitacao(event)">
          <div class="grid-2" style="margin-bottom:16px">
            <div>
              <label class="input-label">Tipo de crédito</label>
              <select id="sol-tipo-i" class="input-field" onchange="atualizarMargemSolicitar()">
                ${tipos.map(t => `<option value="${escapeHtml(t.key)}" ${t.key === tipoDefault.key ? 'selected' : ''}>${escapeHtml(t.label)} — ${formatMoney(t.disponivel)} disponível</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="input-label">Parcelas</label>
              <select id="sol-parcelas-i" class="input-field">
                ${[1,2,3,4,5,6,8,10,12].map(n => `<option value="${n}">${n}x</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="margin-bottom:16px">
            <label class="input-label">Valor desejado (R$) <span id="sol-margem-hint" style="font-weight:400;font-size:0.78rem;color:var(--brand-emerald)">— máx ${formatMoney(tipoDefault.disponivel)}</span></label>
            <input type="number" id="sol-valor-i" class="input-field" placeholder="0,00" min="1" max="${tipoDefault.disponivel || 999999}" step="0.01" required>
          </div>

          <div style="margin-bottom:24px">
            <label class="input-label">Observação (opcional)</label>
            <textarea id="sol-obs-i" class="input-field" rows="3" placeholder="Motivo ou observação..."></textarea>
          </div>
          <button type="submit" class="btn-brand" style="width:100%;padding:14px" id="btn-submit-sol-i" ${tipoDefault.disponivel <= 0 ? 'disabled' : ''}>
            ${tipoDefault.disponivel <= 0 ? 'Sem limite disponível' : 'Enviar Solicitação'}
          </button>
        </form>
      </div>
    </div>
  `;
}

// Chamada no onchange do <select> de tipo — atualiza max do input + hint
function atualizarMargemSolicitar() {
  const tipos = window.__solTiposCache || [];
  const sel = document.getElementById('sol-tipo-i');
  const inp = document.getElementById('sol-valor-i');
  const hint = document.getElementById('sol-margem-hint');
  const btn = document.getElementById('btn-submit-sol-i');
  if (!sel || !inp) return;
  const t = tipos.find(x => x.key === sel.value);
  if (!t) return;
  inp.max = t.disponivel || 999999;
  if (Number(inp.value) > t.disponivel) inp.value = '';
  if (hint) hint.textContent = `— máx ${formatMoney(t.disponivel)}`;
  if (btn) {
    btn.disabled = t.disponivel <= 0;
    btn.textContent = t.disponivel <= 0 ? 'Sem limite disponível' : 'Enviar Solicitação';
  }
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

  const { data: solicitacoes } = await withTimeout(
    supabase.from('solicitacoes_emprestimo').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }),
    10000, 'pedidos'
  );

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
                <td>${escapeHtml(s.tipo || 'avulso')}</td>
                <td>${Number(s.parcelas) || 1}x</td>
                <td><span class="badge badge-${cssToken(s.status)}"><span class="badge-dot"></span>${escapeHtml(statusLabel(s.status))}</span></td>
                <td style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(s.motivo_decisao || '—')}</td>
                <td>${s.status === 'pendente' ? `<button class="btn-ghost" style="font-size:0.75rem;padding:4px 12px" data-cancel-solicitacao="${escapeHtml(s.id)}">Cancelar</button>` : '—'}</td>
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

  const { data: emprestimos } = await withTimeout(
    supabase.from('emprestimos').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }),
    10000, 'contratos'
  );

  const items = (emprestimos || []).filter(isPortalVisibleEmprestimo);

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>📄 Meus Contratos</h1>
        <p>Contratos de empréstimo ativos e finalizados</p>
      </div>
      ${items.length === 0
        ? '<div class="empty-state"><div class="icon">📑</div><h3>Nenhum contrato</h3><p>Você ainda não possui contratos</p></div>'
        : items.map(e => {
          const parcPagas = Math.max(0, Number(e.parcelas_pagas) || 0);
          const parcTotal = Math.max(1, Number(e.parcelas) || 1);
          const pct = Math.min(100, Math.round((parcPagas / parcTotal) * 100));
          return `
            <div class="glass-card fade-in" style="margin-bottom:12px">
              <div class="flex justify-between items-center" style="margin-bottom:12px">
                <div>
                  <span style="font-size:1.2rem;font-weight:900">${formatMoney(e.valor)}</span>
                  <span class="badge badge-${cssToken(e.status)}" style="margin-left:8px">${escapeHtml(statusLabel(e.status))}</span>
                </div>
                <span style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(e.tipo || 'avulso')}</span>
              </div>
              <div class="grid-2" style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px">
                <div>Início: <strong>${formatDate(e.data_inicio)}</strong></div>
                <div>Vencimento: <strong>${formatDate(e.data_vencimento)}</strong></div>
                <div>Taxa: <strong>${Number(e.taxa) || 0}%</strong></div>
                <div>Parcela: <strong>${formatMoney(e.valor_parcela)}</strong></div>
              </div>
              <div style="margin-bottom:4px;font-size:0.78rem;color:var(--text-muted)">Progresso: ${parcPagas}/${parcTotal} parcelas (${pct}%)</div>
              <div style="height:8px;background:rgba(255,255,255,0.05);border-radius:8px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--gradient-brand);border-radius:8px;transition:width 1s"></div>
              </div>
              ${e.obs ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--text-muted)">Obs: ${escapeHtml(e.obs)}</div>` : ''}
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

  const { data: notifs } = await withTimeout(
    supabase.from('notificacoes_cliente').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }).limit(50),
    10000, 'notificacoes'
  );

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
                <div style="font-weight:700;font-size:0.95rem">${escapeHtml(n.titulo)}</div>
                <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">${escapeHtml(n.mensagem)}</div>
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
