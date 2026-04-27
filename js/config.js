// ═══════════════════════════════════════════════════════════════
// CrediGestor Portal — Supabase Configuration
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://yxqkyodiargitrxkvqwq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4cWt5b2RpYXJnaXRyeGt2cXdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyODQ0NjQsImV4cCI6MjA5Mjg2MDQ2NH0.no4P35c4ZykHa-dzPJV1A1ShF8H0y65jp9gxqufWzcY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Formatters
function formatMoney(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}
function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function statusLabel(s) {
  const map = { pendente:'Pendente', em_analise:'Em Análise', aprovado:'Aprovado', reprovado:'Reprovado', cancelado:'Cancelado', ativo:'Ativo', pago:'Pago' };
  return map[s] || s;
}
