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
  await supabase.auth.signOut();
  currentUser = null;
  clienteData = null;
  showLogin();
}

async function loadClienteData() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('portal_user_id', currentUser.id)
    .single();

  if (data) {
    clienteData = data;
    // Update last login
    await supabase.from('clientes')
      .update({ portal_ultimo_login: new Date().toISOString() })
      .eq('id', data.id);
  }
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
