// ═══════════════════════════════════════════════════════════════
// CrediGestor Portal — Authentication Module
// ═══════════════════════════════════════════════════════════════

let currentUser = null;
let clienteData = null;

// ── Init: Check session on page load ──
(async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadClienteData();
    showApp();
  } else {
    showLogin();
  }

  // Listen for auth state changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await loadClienteData();
      showApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      clienteData = null;
      showLogin();
    }
  });
})();

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  const errorEl = document.getElementById('login-error');

  btn.disabled = true;
  btn.textContent = 'Entrando...';
  errorEl.style.display = 'none';

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await loadClienteData();
    showApp();
    showToast('Bem-vindo ao CrediGestor!', 'success');
  } catch (err) {
    errorEl.textContent = err.message === 'Invalid login credentials'
      ? 'E-mail ou senha incorretos.'
      : (err.message || 'Erro ao fazer login.');
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function handleLogout() {
  try { if (typeof logAudit === 'function') await logAudit('logout', 'Cliente saiu da sessão'); } catch (_) {}
  await supabase.auth.signOut();
  currentUser = null;
  clienteData = null;
  showLogin();
}

async function loadClienteData() {
  if (!currentUser) return;

  // 1) Tenta achar o registro já vinculado via portal_user_id.
  //    Usar maybeSingle() em vez de single() pra evitar 406 quando 0 linhas.
  let { data, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('portal_user_id', currentUser.id)
    .maybeSingle();

  // 2) Se não está vinculado ainda, chama RPC link_portal_account().
  //    A função faz match por email + grava portal_user_id de forma atômica.
  if (!data) {
    const linkRes = await supabase.rpc('link_portal_account');
    if (linkRes && linkRes.data) {
      data = linkRes.data;
    } else if (linkRes && linkRes.error) {
      console.warn('[auth] link_portal_account RPC erro:', linkRes.error.message || linkRes.error);
    }
  }

  // 3) Ainda assim sem cliente? Mostra mensagem amigável e encerra sessão.
  if (!data) {
    showLogin();
    const msgEl = document.getElementById('login-error');
    if (msgEl) {
      msgEl.textContent = 'Sua conta de login existe mas ainda não está vinculada a um cliente cadastrado. Procure o gestor e verifique se o e-mail cadastrado é exatamente o mesmo do login.';
      msgEl.style.display = 'block';
    }
    try { await supabase.auth.signOut(); } catch (_) { }
    currentUser = null;
    clienteData = null;
    return;
  }

  // 4) Bloqueia cliente INATIVO ou em BLACKLIST. Defesa em profundidade:
  //    a RLS no DB também filtra (se aplicada via migration), mas o
  //    client-side avisa o usuário e desloga, em vez de só "não ver dados".
  if (String(data.status || 'ativo').toLowerCase() === 'inativo') {
    showLogin();
    const msgEl = document.getElementById('login-error');
    if (msgEl) {
      msgEl.textContent = 'Sua conta está INATIVA. Contate seu gestor para reativar.';
      msgEl.style.display = 'block';
    }
    try { await supabase.auth.signOut(); } catch (_) {}
    currentUser = null; clienteData = null;
    return;
  }
  if (data.blacklist === true || data.blacklist === 1) {
    showLogin();
    const msgEl = document.getElementById('login-error');
    if (msgEl) {
      msgEl.textContent = 'Acesso bloqueado. Contate seu gestor.';
      msgEl.style.display = 'block';
    }
    try { await supabase.auth.signOut(); } catch (_) {}
    currentUser = null; clienteData = null;
    return;
  }

  clienteData = data;

  // Audit log: registra login bem sucedido
  try {
    if (typeof logAudit === 'function') logAudit('login_sucesso', `Login do portal — ${currentUser.email}`);
  } catch (_) {}

  // Atualiza última atividade do portal (best-effort, não bloqueia UI)
  try {
    await supabase.from('clientes')
      .update({ portal_ultimo_login: new Date().toISOString() })
      .eq('id', data.id);
  } catch (_) { /* ignora — RLS de UPDATE pode não permitir mais alterações depois do link */ }
}

function showLogin() {
  document.getElementById('page-login').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

function showApp() {
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Update user info in sidebar
  if (clienteData) {
    document.getElementById('user-name').textContent = clienteData.nome || 'Cliente';
    document.getElementById('user-email').textContent = currentUser?.email || '';
  } else if (currentUser) {
    document.getElementById('user-name').textContent = currentUser.email?.split('@')[0] || 'Cliente';
    document.getElementById('user-email').textContent = currentUser.email || '';
  }

  navigate('dashboard');
  initRealtimeSubscriptions();
}
