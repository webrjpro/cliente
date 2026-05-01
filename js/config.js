// ═══════════════════════════════════════════════════════════════
// CrediGestor Portal — Supabase Configuration
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://yxqkyodiargitrxkvqwq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4cWt5b2RpYXJnaXRyeGt2cXdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyODQ0NjQsImV4cCI6MjA5Mjg2MDQ2NH0.no4P35c4ZykHa-dzPJV1A1ShF8H0y65jp9gxqufWzcY';

// O CDN UMD expõe `window.supabase` com `createClient`. Não dá pra declarar
// `const supabase = ...` no mesmo escopo (conflita com a global). Solução:
// extrair `createClient`, sobrescrever `window.supabase` com a instância do
// client. Assim auth.js e app.js continuam usando `supabase.auth.xxx` normal.
(function initSupabaseClient() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[config] SDK do Supabase não carregou. Verifique o <script> do CDN no index.html.');
    return;
  }
  const { createClient } = window.supabase;
  window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();

// Formatters
function formatMoney(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}
function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}
function formatDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function statusLabel(s) {
  const map = { pendente:'Pendente', em_analise:'Em Análise', aprovado:'Aprovado', reprovado:'Reprovado', cancelado:'Cancelado', ativo:'Ativo', pago:'Pago' };
  return map[s] || s;
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function cssToken(value, fallback = 'default') {
  const token = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return token || fallback;
}
function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}
