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
  calendario: () => renderCalendario,
  notificacoes: () => renderNotificacoes,
  perfil: () => renderPerfil,
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

// Parseia o JSON `historico_pagamentos` (lista de parcelas) para um array seguro.
function parseParcelas(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : (Array.isArray(v?.parcelas) ? v.parcelas : []);
  } catch (_) { return []; }
}

// Retorna a próxima parcela a vencer (status pendente, mais próxima de hoje).
// Retorna null se não há parcelas pendentes em nenhum empréstimo ativo.
function getProximoVencimento(emprestimos) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  let melhor = null;
  for (const emp of (emprestimos || [])) {
    if (!emp || emp.status !== 'ativo' || !isPortalVisibleEmprestimo(emp)) continue;
    const parcelas = parseParcelas(emp.historico_pagamentos);
    for (const p of parcelas) {
      const status = String(p?.status || '').toLowerCase();
      if (status === 'pago') continue;
      const dt = new Date(p?.dataVencimento || p?.data_vencimento || emp.data_vencimento);
      if (Number.isNaN(dt.getTime())) continue;
      const valor = Number(p?.valorBase || p?.valor || emp.valor_parcela) || 0;
      if (!melhor || dt < melhor.data) {
        const diasRestantes = Math.round((dt - hoje) / (1000*60*60*24));
        melhor = { data: dt, valor, status, atrasada: diasRestantes < 0, diasRestantes, contrato: emp };
      }
    }
  }
  return melhor;
}

// Tema claro/escuro — persistido em localStorage
function aplicarTema(tema) {
  const t = tema === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('credigestor-theme', t); } catch (_) {}
  // Atualiza ícone do botão se existir
  const btn = document.getElementById('btn-toggle-theme');
  if (btn) btn.textContent = t === 'light' ? '🌙' : '☀️';
}
function toggleTema() {
  const atual = document.documentElement.getAttribute('data-theme') || 'dark';
  aplicarTema(atual === 'light' ? 'dark' : 'light');
}
// Carrega tema salvo na inicialização
(function loadInitialTheme() {
  try {
    const saved = localStorage.getItem('credigestor-theme');
    if (saved === 'light' || saved === 'dark') aplicarTema(saved);
  } catch (_) {}
})();

// Helpers de upload pro bucket "comprovantes" (Supabase Storage).
// Path: <cliente_id>/<contrato_id>/<parcela_num>-<timestamp>.<ext>
async function uploadComprovante(clienteId, contratoId, parcelaNumero, file) {
  if (!file) throw new Error('Nenhum arquivo selecionado');
  if (file.size > 5 * 1024 * 1024) throw new Error('Arquivo maior que 5 MB');
  const okMime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!okMime.includes(file.type)) throw new Error('Apenas JPG, PNG, WEBP ou PDF');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const ts = Date.now();
  const path = `${clienteId}/${contratoId}/p${parcelaNumero}-${ts}.${ext}`;
  const { data, error } = await supabase.storage.from('comprovantes').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('comprovantes').getPublicUrl(data.path);
  return pub.publicUrl;
}

// Push notifications nativas do navegador. Não exige VAPID/backend — usa
// Notification API + realtime do supabase (só funciona com a aba aberta).
function pedirPermissaoNotif() {
  if (!('Notification' in window)) return Promise.resolve('unsupported');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  return Notification.requestPermission();
}

function showNativeNotif(title, body, opts = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: opts.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="80">💎</text></svg>',
      badge: opts.badge,
      tag: opts.tag || 'credigestor',
      renotify: true,
    });
  } catch (e) { console.warn('[push] notif falhou:', e); }
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
  const totalDevido = usado;
  const disponivel = Math.max(0, limite - usado);
  const pendentes = solicitacoes.filter(s => s.status === 'pendente' || s.status === 'em_analise').length;
  const proximo = getProximoVencimento(emprestimos);

  // Update badges
  if (pendentes > 0) {
    document.getElementById('badge-pedidos').textContent = pendentes;
    document.getElementById('badge-pedidos').classList.remove('hidden');
  }
  if (notifCount > 0) {
    document.getElementById('badge-notif').textContent = notifCount;
    document.getElementById('badge-notif').classList.remove('hidden');
  }

  // Card de PRÓXIMO VENCIMENTO — destaque grande no topo
  let proxHTML = '';
  if (proximo) {
    const corBg = proximo.atrasada ? 'rgba(239,68,68,0.12)' : (proximo.diasRestantes <= 5 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.10)');
    const corBd = proximo.atrasada ? 'rgba(239,68,68,0.4)' : (proximo.diasRestantes <= 5 ? 'rgba(245,158,11,0.4)' : 'rgba(16,185,129,0.3)');
    const corTxt = proximo.atrasada ? '#ef4444' : (proximo.diasRestantes <= 5 ? '#f59e0b' : '#10b981');
    const titulo = proximo.atrasada ? `⚠️ Vencido há ${Math.abs(proximo.diasRestantes)} dia${Math.abs(proximo.diasRestantes)>1?'s':''}` : (proximo.diasRestantes === 0 ? '⏰ Vence HOJE' : `⏳ Vence em ${proximo.diasRestantes} dia${proximo.diasRestantes>1?'s':''}`);
    proxHTML = `
      <div class="glass-card" style="background:${corBg};border:1px solid ${corBd};margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-size:0.75rem;font-weight:700;color:${corTxt};text-transform:uppercase;margin-bottom:4px">${titulo}</div>
          <div style="font-size:1.4rem;font-weight:900" class="text-money">${formatMoney(proximo.valor)}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Vencimento: ${formatDate(proximo.data)}</div>
        </div>
        <button class="btn-ghost" onclick="navigate('contratos')" style="padding:10px 16px">Ver contratos</button>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>Olá, ${escapeHtml((clienteData.nome || 'Cliente').split(' ')[0])}! 👋</h1>
        <p>Acompanhe seus créditos e faça novas solicitações</p>
      </div>
      ${proxHTML}
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
              <select id="sol-parcelas-i" class="input-field" onchange="atualizarSimulador()">
                ${[1,2,3,4,5,6,8,10,12].map(n => `<option value="${n}">${n}x</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="margin-bottom:16px">
            <label class="input-label">Valor desejado (R$) <span id="sol-margem-hint" style="font-weight:400;font-size:0.78rem;color:var(--brand-emerald)">— máx ${formatMoney(tipoDefault.disponivel)}</span></label>
            <input type="number" id="sol-valor-i" class="input-field" placeholder="0,00" min="1" max="${tipoDefault.disponivel || 999999}" step="0.01" required oninput="atualizarSimulador()">
          </div>

          <div style="margin-bottom:16px">
            <label class="input-label">Taxa de juros estimada (% ao mês) <span style="font-weight:400;font-size:0.72rem;color:var(--text-muted)">— pode variar</span></label>
            <input type="number" id="sol-taxa-i" class="input-field" value="5" min="0" max="50" step="0.1" oninput="atualizarSimulador()">
          </div>

          <!-- SIMULADOR — recalcula em tempo real -->
          <div id="sol-simulador" style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:12px;padding:14px;margin-bottom:20px;display:none">
            <div style="font-size:0.7rem;font-weight:800;color:#818cf8;text-transform:uppercase;margin-bottom:10px">🧮 Simulação</div>
            <div class="grid-2" style="font-size:0.88rem;gap:8px">
              <div>Parcela mensal: <strong id="sim-parcela" class="text-money">—</strong></div>
              <div>Total a pagar: <strong id="sim-total" class="text-money">—</strong></div>
              <div>Juros totais: <strong id="sim-juros" style="color:#f59e0b">—</strong></div>
              <div>CET aprox: <strong id="sim-cet" style="color:var(--text-secondary)">—</strong></div>
            </div>
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
  atualizarSimulador();
}

// Recalcula a simulação (parcela, total, juros) — Tabela Price (sistema francês).
// Mostra apenas se valor>0 e parcelas>0. Cálculo: PMT = PV * (i*(1+i)^n) / ((1+i)^n - 1)
function atualizarSimulador() {
  const valor = parseFloat(document.getElementById('sol-valor-i')?.value) || 0;
  const parcelas = parseInt(document.getElementById('sol-parcelas-i')?.value) || 0;
  const taxa = parseFloat(document.getElementById('sol-taxa-i')?.value) || 0;
  const sim = document.getElementById('sol-simulador');
  if (!sim) return;
  if (valor <= 0 || parcelas <= 0) { sim.style.display = 'none'; return; }
  sim.style.display = 'block';

  const i = taxa / 100;
  let parcelaMensal;
  if (i === 0) {
    parcelaMensal = valor / parcelas;
  } else {
    parcelaMensal = valor * (i * Math.pow(1+i, parcelas)) / (Math.pow(1+i, parcelas) - 1);
  }
  const totalPagar = parcelaMensal * parcelas;
  const jurosTotais = totalPagar - valor;
  // CET aproximado anualizado (juros sobre principal × 12 meses)
  const cet = valor > 0 ? ((Math.pow(1+i, 12) - 1) * 100) : 0;

  document.getElementById('sim-parcela').textContent = formatMoney(parcelaMensal);
  document.getElementById('sim-total').textContent = formatMoney(totalPagar);
  document.getElementById('sim-juros').textContent = formatMoney(jurosTotais);
  document.getElementById('sim-cet').textContent = `${cet.toFixed(2)}% a.a.`;
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
  btn.textContent = 'Validando...';

  try {
    // VALIDAÇÃO 1: limite disponível para o tipo escolhido
    const { data: ativos } = await withTimeout(
      supabase.from('emprestimos').select('valor,tipo,aprovacao').eq('cliente_id', clienteData.id).eq('status', 'ativo'),
      10000, 'validar-limite'
    );
    const tipos = getTiposComLimites(clienteData, (ativos || []).filter(isPortalVisibleEmprestimo));
    const t = tipos.find(x => x.key === tipo);
    if (!t || t.limite <= 0) {
      throw new Error(`Você não tem limite configurado para "${smartLabel(tipo)}". Contate seu gestor.`);
    }
    if (valor > t.disponivel) {
      throw new Error(`Valor maior que o disponível (${formatMoney(t.disponivel)}) para ${smartLabel(tipo)}.`);
    }

    // VALIDAÇÃO 2: já tem solicitação pendente do mesmo tipo
    const { data: existentes } = await withTimeout(
      supabase.from('solicitacoes_emprestimo').select('id,valor,tipo,status').eq('cliente_id', clienteData.id).in('status', ['pendente', 'em_analise']),
      10000, 'validar-dupla'
    );
    const dup = (existentes || []).find(s => String(s.tipo).toLowerCase() === String(tipo).toLowerCase());
    if (dup) {
      throw new Error(`Você já tem uma solicitação ${smartLabel(tipo)} de ${formatMoney(dup.valor)} aguardando análise. Aguarde a resposta antes de pedir outra.`);
    }

    btn.textContent = 'Enviando...';
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
        : items.map((e, idx) => {
          const parcPagas = Math.max(0, Number(e.parcelas_pagas) || 0);
          const parcTotal = Math.max(1, Number(e.parcelas) || 1);
          const pct = Math.min(100, Math.round((parcPagas / parcTotal) * 100));
          const parcelas = parseParcelas(e.historico_pagamentos);
          const hoje = new Date(); hoje.setHours(0,0,0,0);

          const parcelasHTML = parcelas.length === 0
            ? `<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:0.85rem">Detalhamento de parcelas indisponível</div>`
            : `<div class="table-container" style="margin-top:12px">
                <table class="data-table">
                  <thead><tr><th>#</th><th>Vencimento</th><th>Valor</th><th>Pago em</th><th>Valor pago</th><th>Status</th><th data-no-print>Comprovante</th></tr></thead>
                  <tbody>${parcelas.map((p, i) => {
                    const dt = new Date(p?.dataVencimento || p?.data_vencimento || '');
                    const status = String(p?.status || 'pendente').toLowerCase();
                    const valor = Number(p?.valorBase || p?.valor) || 0;
                    const dtPago = p?.dataPagamento || p?.data_pagamento;
                    const valorPago = Number(p?.valorPago || p?.valor_pago) || 0;
                    let badge = 'pendente';
                    let label = 'Pendente';
                    if (status === 'pago') { badge = 'aprovado'; label = 'Pago'; }
                    else if (!Number.isNaN(dt.getTime()) && dt < hoje) { badge = 'reprovado'; label = 'Atrasada'; }
                    const num = p?.numero ?? (i+1);
                    return `
                      <tr>
                        <td>${num}</td>
                        <td>${Number.isNaN(dt.getTime()) ? '—' : formatDate(dt)}</td>
                        <td class="text-money" style="font-weight:700">${formatMoney(valor)}</td>
                        <td>${dtPago ? formatDate(dtPago) : '—'}</td>
                        <td>${valorPago > 0 ? `<span class="text-money" style="color:#10b981;font-weight:700">${formatMoney(valorPago)}</span>` : '—'}</td>
                        <td><span class="badge badge-${badge}"><span class="badge-dot"></span>${label}</span></td>
                        <td data-no-print>${status === 'pago' ? '✓' : `<button class="btn-ghost" style="font-size:0.7rem;padding:4px 10px" onclick="abrirUploadComprovante('${escapeHtml(e.id)}', ${num})">📎 Enviar</button>`}</td>
                      </tr>
                    `;
                  }).join('')}</tbody>
                </table>
              </div>`;

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
              <details style="margin-top:12px" ${idx === 0 ? 'open' : ''}>
                <summary style="cursor:pointer;font-size:0.85rem;color:var(--brand-emerald);font-weight:700;padding:6px 0">📋 Ver parcelas (${parcelas.length || parcTotal})</summary>
                ${parcelasHTML}
              </details>
              <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap" data-no-print>
                <button class="btn-ghost" style="font-size:0.75rem;padding:6px 12px" onclick="exportarContratoPDF()">🖨️ Salvar PDF / Imprimir</button>
              </div>
            </div>
          `;
        }).join('')
      }
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// CALENDÁRIO DE PAGAMENTOS
// ═══════════════════════════════════════════════════════════════
let _calMes = null; // {ano, mes} sendo exibido — null = mês atual
async function renderCalendario(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const { data: emprestimos } = await withTimeout(
    supabase.from('emprestimos').select('*').eq('cliente_id', clienteData.id).order('created_at', { ascending: false }),
    10000, 'calendario'
  );
  const ativos = (emprestimos || []).filter(isPortalVisibleEmprestimo);

  // Mês a exibir (default = atual)
  const hoje = new Date();
  const ref = _calMes ? new Date(_calMes.ano, _calMes.mes, 1) : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const ano = ref.getFullYear();
  const mes = ref.getMonth();

  // Mapa de pagamentos por dia desse mês: dia → array de {valor, status, contratoId}
  const eventos = new Map();
  for (const emp of ativos) {
    const parcelas = parseParcelas(emp.historico_pagamentos);
    for (const p of parcelas) {
      const dt = new Date(p?.dataVencimento || p?.data_vencimento || '');
      if (Number.isNaN(dt.getTime())) continue;
      if (dt.getFullYear() !== ano || dt.getMonth() !== mes) continue;
      const dia = dt.getDate();
      const valor = Number(p?.valorBase || p?.valor || emp.valor_parcela) || 0;
      const status = String(p?.status || 'pendente').toLowerCase();
      if (!eventos.has(dia)) eventos.set(dia, []);
      eventos.get(dia).push({ valor, status, contratoId: emp.id });
    }
  }

  const primeiroDia = new Date(ano, mes, 1).getDay(); // 0=Dom
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomesDiaSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];

  // Constrói grid (até 6 semanas × 7 dias)
  const cells = [];
  for (let i = 0; i < primeiroDia; i++) cells.push(null); // dias do mês anterior em branco
  for (let d = 1; d <= diasNoMes; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const isHoje = (dia) => dia === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();

  // Resumo: total pago / pendente / atrasado neste mês
  let totPago = 0, totPendente = 0, totAtrasado = 0;
  const hojeReset = new Date(); hojeReset.setHours(0,0,0,0);
  for (const [dia, evs] of eventos) {
    const dt = new Date(ano, mes, dia);
    for (const ev of evs) {
      if (ev.status === 'pago') totPago += ev.valor;
      else if (dt < hojeReset) totAtrasado += ev.valor;
      else totPendente += ev.valor;
    }
  }

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>📅 Calendário de Pagamentos</h1>
        <p>Visualize seus vencimentos no mês</p>
      </div>

      <div class="glass-card" style="margin-bottom:16px">
        <div class="flex justify-between items-center" style="margin-bottom:16px">
          <button class="btn-ghost" onclick="navMesCalendario(-1)" style="padding:8px 14px">← Anterior</button>
          <div style="font-weight:800;font-size:1.1rem">${nomesMes[mes]} ${ano}</div>
          <button class="btn-ghost" onclick="navMesCalendario(1)" style="padding:8px 14px">Próximo →</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px">
          ${nomesDiaSemana.map(n => `<div style="text-align:center;font-size:0.7rem;font-weight:700;color:var(--text-muted);padding:4px">${n}</div>`).join('')}
        </div>

        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">
          ${cells.map(dia => {
            if (dia === null) return `<div style="min-height:60px"></div>`;
            const evs = eventos.get(dia) || [];
            let cor = 'rgba(255,255,255,0.03)';
            let textCor = 'var(--text-secondary)';
            let dot = '';
            if (evs.length > 0) {
              const dt = new Date(ano, mes, dia);
              const temPago = evs.some(e => e.status === 'pago');
              const temAtrasado = evs.some(e => e.status !== 'pago' && dt < hojeReset);
              const temPendente = evs.some(e => e.status !== 'pago' && dt >= hojeReset);
              if (temAtrasado) { cor = 'rgba(239,68,68,0.18)'; textCor = '#fca5a5'; dot = '#ef4444'; }
              else if (temPendente) { cor = 'rgba(245,158,11,0.18)'; textCor = '#fcd34d'; dot = '#f59e0b'; }
              else if (temPago) { cor = 'rgba(16,185,129,0.18)'; textCor = '#6ee7b7'; dot = '#10b981'; }
            }
            const ringHoje = isHoje(dia) ? 'box-shadow:inset 0 0 0 2px var(--brand-emerald);' : '';
            const total = evs.reduce((s,e) => s + e.valor, 0);
            return `
              <div style="background:${cor};${ringHoje}border-radius:8px;padding:6px 4px;min-height:60px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-size:0.78rem;color:${textCor}">
                <div style="font-weight:700">${dia}</div>
                ${dot ? `<div style="width:6px;height:6px;background:${dot};border-radius:50%;margin-top:4px"></div>` : ''}
                ${evs.length > 0 ? `<div style="font-size:0.62rem;margin-top:2px;text-align:center;line-height:1.1">${formatMoney(total).replace('R$','').trim()}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:16px">
        <div class="glass-card" style="background:rgba(16,185,129,0.06)">
          <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700">Pago no mês</div>
          <div style="font-size:1.3rem;font-weight:900;color:#10b981" class="text-money">${formatMoney(totPago)}</div>
        </div>
        <div class="glass-card" style="background:rgba(245,158,11,0.06)">
          <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:700">A pagar no mês</div>
          <div style="font-size:1.3rem;font-weight:900;color:#f59e0b" class="text-money">${formatMoney(totPendente)}</div>
        </div>
      </div>

      ${totAtrasado > 0 ? `<div class="glass-card" style="background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.3)"><div style="font-size:0.7rem;color:#fca5a5;text-transform:uppercase;font-weight:700">⚠️ Atrasado neste mês</div><div style="font-size:1.3rem;font-weight:900;color:#ef4444" class="text-money">${formatMoney(totAtrasado)}</div></div>` : ''}

      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;font-size:0.75rem;color:var(--text-muted);flex-wrap:wrap">
        <span>🟢 Pago</span><span>🟡 A vencer</span><span>🔴 Atrasado</span>
      </div>
    </div>
  `;
}

function navMesCalendario(delta) {
  const hoje = new Date();
  const ref = _calMes ? new Date(_calMes.ano, _calMes.mes, 1) : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  ref.setMonth(ref.getMonth() + delta);
  _calMes = { ano: ref.getFullYear(), mes: ref.getMonth() };
  navigate('calendario');
}

// ═══════════════════════════════════════════════════════════════
// MEU PERFIL
// ═══════════════════════════════════════════════════════════════
async function renderPerfil(container) {
  if (!clienteData) { container.innerHTML = noDataMsg(); return; }

  const c = clienteData;
  const notifPerm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const notifBtn = notifPerm === 'granted'
    ? `<span style="color:#10b981">✓ Ativadas</span>`
    : (notifPerm === 'denied'
        ? `<span style="color:#ef4444">Bloqueadas pelo navegador</span>`
        : `<button class="btn-brand" onclick="ativarNotifPerfil()" style="padding:8px 16px;font-size:0.85rem">Ativar notificações</button>`);

  container.innerHTML = `
    <div class="fade-in">
      <div class="page-header">
        <h1>👤 Meu Perfil</h1>
        <p>Seus dados cadastrais e configurações</p>
      </div>

      <div class="glass-card" style="margin-bottom:16px">
        <h3 style="font-weight:800;margin-bottom:14px;font-size:1rem">📇 Dados pessoais</h3>
        <div class="grid-2" style="gap:14px;font-size:0.9rem">
          <div><div style="color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:700;margin-bottom:2px">Nome</div><div>${escapeHtml(c.nome || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:700;margin-bottom:2px">Email</div><div>${escapeHtml(currentUser?.email || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:700;margin-bottom:2px">CPF/CNPJ</div><div>${escapeHtml(c.cpf || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:700;margin-bottom:2px">Matrícula</div><div>${escapeHtml(c.matricula || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:700;margin-bottom:2px">Telefone</div><div>${escapeHtml(c.telefone || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;font-weight:700;margin-bottom:2px">Renda informada</div><div>${formatMoney(c.renda)}</div></div>
        </div>
        <p style="margin-top:14px;font-size:0.75rem;color:var(--text-muted)">💡 Para alterar dados cadastrais ou redefinir sua senha, entre em contato com seu gestor.</p>
      </div>

      <div class="glass-card" style="margin-bottom:16px">
        <h3 style="font-weight:800;margin-bottom:14px;font-size:1rem">🔔 Notificações do navegador</h3>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px">Receba avisos do navegador quando seus pedidos forem atualizados, mesmo com a aba minimizada.</p>
        <div>${notifBtn}</div>
      </div>

      <div class="glass-card">
        <h3 style="font-weight:800;margin-bottom:14px;font-size:1rem">📲 Instalar como aplicativo</h3>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px">No celular ou desktop, abra o menu do navegador e escolha <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong>. O CrediGestor abrirá em janela própria, como um app nativo.</p>
      </div>

      <div style="margin-top:20px;text-align:center">
        <button class="btn-ghost" onclick="handleLogout()" style="padding:10px 24px;color:#ef4444">⏻ Sair da conta</button>
      </div>
    </div>
  `;
}

// Imprimir/exportar contrato em PDF — usa CSS @media print pra ocultar
// elementos UI (sidebar, botões) e mostrar só o conteúdo do contrato.
function exportarContratoPDF() {
  // Se algum <details> está fechado, abre todos pra incluir parcelas no print
  document.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
  setTimeout(() => window.print(), 100);
}

// Modal pra cliente fazer upload de comprovante de pagamento de uma parcela.
// Vai pro Supabase Storage (bucket "comprovantes") e cria notificação ao gestor.
function abrirUploadComprovante(contratoId, numeroParcela) {
  let modal = document.getElementById('modal-upload-comprovante');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'modal-upload-comprovante';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:480px">
      <h2 style="font-size:1.1rem;font-weight:800;margin-bottom:16px">📎 Enviar comprovante</h2>
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px">Anexe o comprovante de pagamento (PIX, TED, depósito) da <strong>parcela ${numeroParcela}</strong>. O gestor receberá uma notificação para confirmar.</p>

      <div style="margin-bottom:14px">
        <label class="input-label">Data do pagamento</label>
        <input type="date" id="comp-data" class="input-field" required value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div style="margin-bottom:14px">
        <label class="input-label">Valor pago (R$)</label>
        <input type="number" id="comp-valor" class="input-field" step="0.01" min="0.01" placeholder="0,00" required>
      </div>
      <div style="margin-bottom:14px">
        <label class="input-label">Arquivo (JPG/PNG/PDF, até 5 MB)</label>
        <input type="file" id="comp-file" class="input-field" accept="image/jpeg,image/png,image/webp,application/pdf" required style="padding:8px">
      </div>
      <div style="margin-bottom:18px">
        <label class="input-label">Observação (opcional)</label>
        <textarea id="comp-obs" class="input-field" rows="2" placeholder="Ex.: PIX da minha conta Itaú"></textarea>
      </div>

      <div style="display:flex;gap:10px">
        <button type="button" class="btn-ghost" style="flex:1" onclick="document.getElementById('modal-upload-comprovante').remove()">Cancelar</button>
        <button type="button" class="btn-brand" style="flex:1" id="btn-comp-enviar" onclick="enviarComprovante('${escapeHtml(contratoId)}', ${numeroParcela})">Enviar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function enviarComprovante(contratoId, numeroParcela) {
  const btn = document.getElementById('btn-comp-enviar');
  const dataPag = document.getElementById('comp-data').value;
  const valorPag = parseFloat(document.getElementById('comp-valor').value);
  const file = document.getElementById('comp-file').files[0];
  const obs = document.getElementById('comp-obs').value.trim();
  if (!dataPag || !valorPag || valorPag <= 0 || !file) return showToast('Preencha todos os campos.', 'error');

  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const url = await uploadComprovante(clienteData.id, contratoId, numeroParcela, file);
    // Cria notificação pro gestor (que sincroniza pro app via realtime).
    // Cliente também recebe cópia (aparece em "Notificações").
    await supabase.from('notificacoes_cliente').insert({
      tenant_id: clienteData.tenant_id,
      cliente_id: clienteData.id,
      tipo: 'comprovante_pagamento',
      titulo: `📎 Comprovante enviado — Parcela ${numeroParcela}`,
      mensagem: `Pagamento de ${formatMoney(valorPag)} em ${formatDate(dataPag)}. Aguardando confirmação do gestor.${obs ? ' Obs: ' + obs : ''}`,
      link_acao: url
    });
    showToast('Comprovante enviado! O gestor irá analisar.', 'success');
    document.getElementById('modal-upload-comprovante').remove();
  } catch (err) {
    showToast('Erro ao enviar: ' + (err.message || 'desconhecido'), 'error');
    btn.disabled = false; btn.textContent = 'Enviar';
  }
}

// FAQ embutido — perguntas frequentes (sem chamada externa)
function abrirFAQ() {
  let modal = document.getElementById('modal-faq');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'modal-faq';
  modal.className = 'modal-overlay open';
  const perguntas = [
    { q: 'Como solicito um novo crédito?', a: 'Vá em "Solicitar Crédito" no menu lateral. Escolha o tipo, valor e parcelas. O gestor analisará e responderá.' },
    { q: 'Por que minha solicitação foi reprovada?', a: 'O gestor pode reprovar por análise de crédito ou política interna. Veja o motivo em "Meus Pedidos" → coluna "Decisão".' },
    { q: 'Como faço para pagar uma parcela?', a: 'O pagamento é feito via PIX/TED para a conta do gestor. Após pagar, vá em "Meus Contratos" → parcela → "📎 Enviar" comprovante.' },
    { q: 'Quando o limite é atualizado?', a: 'O limite atualiza em tempo real após o gestor aprovar pagamentos ou alterar seu cadastro.' },
    { q: 'Esqueci minha senha. O que fazer?', a: 'Entre em contato com seu gestor. Ele pode redefinir sua senha em poucos segundos.' },
    { q: 'Posso instalar como aplicativo?', a: 'Sim! No Chrome/Edge clique em "Instalar app" na barra. No iPhone, use "Adicionar à tela de início" no Safari.' },
    { q: 'O que são os "tipos extras" (PIS, INSS)?', a: 'Linhas de crédito específicas configuradas pelo gestor, separadas dos limites principais. Cada uma tem sua margem.' },
    { q: 'Por que não consigo pedir mais crédito?', a: 'Você pode ter atingido o limite ou ter uma solicitação pendente do mesmo tipo. Aguarde a resposta do gestor.' },
  ];
  modal.innerHTML = `
    <div class="modal-content" style="max-width:600px;max-height:80vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-size:1.2rem;font-weight:800">❓ Perguntas Frequentes</h2>
        <button class="btn-ghost" style="padding:6px 12px" onclick="document.getElementById('modal-faq').remove()">✕</button>
      </div>
      ${perguntas.map(p => `
        <details style="margin-bottom:8px;padding:10px;background:var(--bg-glass);border-radius:8px;border:1px solid var(--border-glass)">
          <summary style="cursor:pointer;font-weight:700;font-size:0.9rem;color:var(--text-primary)">${escapeHtml(p.q)}</summary>
          <p style="margin-top:10px;font-size:0.85rem;color:var(--text-secondary);line-height:1.6">${escapeHtml(p.a)}</p>
        </details>
      `).join('')}
    </div>
  `;
  document.body.appendChild(modal);
}

async function ativarNotifPerfil() {
  const r = await pedirPermissaoNotif();
  if (r === 'granted') {
    showToast('Notificações ativadas! 🔔', 'success');
    showNativeNotif('CrediGestor', 'Pronto! Você receberá avisos por aqui.');
    navigate('perfil');
  } else if (r === 'denied') {
    showToast('Notificações bloqueadas. Habilite nas configurações do navegador.', 'error');
  } else {
    showToast('Notificações não suportadas neste navegador', 'error');
  }
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
        const tipo = s.status === 'aprovado' ? 'success' : 'error';
        showToast(`Pedido de ${formatMoney(s.valor)} → ${statusLabel(s.status)}`, tipo);
        showNativeNotif(
          `Pedido ${statusLabel(s.status)}`,
          `Sua solicitação de ${formatMoney(s.valor)} foi ${statusLabel(s.status).toLowerCase()}.`,
          { tag: 'pedido-' + s.id }
        );
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
      showNativeNotif(payload.new.titulo, payload.new.mensagem || '', { tag: 'notif-' + payload.new.id });
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
