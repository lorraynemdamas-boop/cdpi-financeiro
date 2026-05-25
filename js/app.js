/* =====================================================
   CDPI Financial System — Main Application
   ===================================================== */

'use strict';

// ─── State ───────────────────────────────────────────
const STATE = {
  currentPage: 'dashboard',
  sortState: {},
  pagination: { receber: 1, pagar: 1 },
  perPage: 25,
  filteredReceber: [],
  filteredPagar: [],
  chartInstances: {},
  editingId: null,
  modalType: null
};

const TODAY = new Date('2026-04-06');

// ─── MultiSelect Sistema ──────────────────────────────
const MS = {}; // { filterId: Set<string> }

const MS_CALLBACKS = {
  'dash-empresa-filter': () => renderDashboard(),
  'rec-empresa':         () => { applyFilters('receber'); renderReceberKpis(); },
  'pag-empresa':         () => { applyFilters('pagar'); renderPagarKpis(); },
  'pivot-empresa':       () => renderPivot(),
  'fluxo-empresa':       () => renderFluxo(),
  'pd-empresa':          () => renderProjecaoDiaria(),
  'proj-empresa':        () => renderProjetado(),
  'bol-empresa':         () => renderBoletim(),
  'bol-forma':           () => renderBoletim(),
  'bol-conta':           () => renderBoletim(),
};

function msToggle(id) {
  const widget = document.getElementById('msw-' + id);
  const isOpen = widget?.classList.contains('open');
  // Fecha todos
  document.querySelectorAll('.ms-widget.open').forEach(w => w.classList.remove('open'));
  if (!isOpen && widget) widget.classList.add('open');
}

function msSelectAll(id) {
  const cbs = document.querySelectorAll(`#mspanel-${id} .ms-cb`);
  const allCb = document.querySelector(`#mspanel-${id} .ms-all-cb`);
  cbs.forEach(cb => cb.checked = false);
  if (allCb) allCb.checked = true;
  MS[id] = new Set();
  msSyncLabel(id);
  MS_CALLBACKS[id]?.();
}

function msChange(id) {
  const cbs    = [...document.querySelectorAll(`#mspanel-${id} .ms-cb`)];
  const allCb  = document.querySelector(`#mspanel-${id} .ms-all-cb`);
  const checked = cbs.filter(cb => cb.checked);
  MS[id] = new Set(checked.map(cb => cb.value));
  if (allCb) allCb.checked = MS[id].size === 0;
  msSyncLabel(id);
  MS_CALLBACKS[id]?.();
}

function msSyncLabel(id) {
  const lbl = document.getElementById('mslbl-' + id);
  const badge = document.getElementById('msbadge-' + id);
  if (!lbl) return;
  const sel = MS[id] || new Set();
  if (sel.size === 0) {
    lbl.textContent = 'Todas as Empresas';
    if (badge) badge.style.display = 'none';
  } else if (sel.size === 1) {
    lbl.textContent = [...sel][0];
    if (badge) badge.style.display = 'none';
  } else {
    lbl.textContent = `${sel.size} empresas`;
    if (badge) { badge.textContent = sel.size; badge.style.display = ''; }
  }
}

function getMSVal(id) {
  const s = MS[id];
  return s && s.size > 0 ? [...s] : [];
}

// Fecha ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.ms-widget')) {
    document.querySelectorAll('.ms-widget.open').forEach(w => w.classList.remove('open'));
  }
});

// ─── Parâmetros Financeiros — Projeção Abril/2026 ────
// Estes valores podem ser editados na tela de Parâmetros
const PARAMS = {
  saldoInicial:       1045540,   // Saldo em caixa/conta no início do mês
  projecaoFat:         600000,   // Meta/Projeção de Faturamento
  limiteAntecipacao:   600000,   // Limite de Antecipação disponível
  aReceberAvista:      118560,   // Recebíveis à vista (antecipação/cheque)
  // A Pagar e A Receber abaixo incluem dados consolidados de todas as fontes
  // Se preferir usar apenas os dados do Excel, defina como null
  totalAPagarExt:     1509947,   // Total consolidado a pagar (todas as fontes)
  totalAReceberExt:    918035,   // Total consolidado a receber (todas as fontes)
};

const SALDO_INICIAL    = PARAMS.saldoInicial;
const META_FATURAMENTO = PARAMS.projecaoFat;

// ─── Utility ─────────────────────────────────────────
const fmt = (v, showSign = false) => {
  const abs = Math.abs(v);
  const str = 'R$ ' + abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (showSign && v < 0) return '−' + str;
  return str;
};

const fmtShort = v => {
  if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + ' M';
  if (Math.abs(v) >= 1e3) return 'R$ ' + (v / 1e3).toFixed(1).replace('.', ',') + ' k';
  return fmt(v);
};

const fmtDate = d => {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length < 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const parseDate = d => d ? new Date(d + 'T00:00:00') : null;

const isOverdue = row => {
  const venc = parseDate(row.vencimento);
  return row.status !== 'Recebido' && venc && venc < TODAY;
};

const isDueSoon = row => {
  const venc = parseDate(row.vencimento);
  if (!venc) return false;
  const diff = (venc - TODAY) / 86400000;
  return row.status !== 'Recebido' && diff >= 0 && diff <= 7;
};

const destroyChart = id => {
  if (STATE.chartInstances[id]) {
    STATE.chartInstances[id].destroy();
    delete STATE.chartInstances[id];
  }
};

const createChart = (id, config) => {
  destroyChart(id);
  const el = document.getElementById(id);
  if (!el) return;
  STATE.chartInstances[id] = new Chart(el.getContext('2d'), config);
};

const groupBy = (arr, key) => arr.reduce((acc, r) => {
  const k = r[key] || 'Sem ' + key;
  acc[k] = (acc[k] || []);
  acc[k].push(r);
  return acc;
}, {});

const sumField = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);

// Chart defaults
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;

const PALETTE = {
  blue:   '#2563eb',
  navy:   '#1e3a8a',
  light:  '#93c5fd',
  green:  '#10b981',
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#f59e0b',
  gray:   '#94a3b8',
  purple: '#8b5cf6',
  teal:   '#14b8a6'
};

const EMPRESA_COLORS = {
  'CDPI PHARMA':    PALETTE.blue,
  'FACULDADE CDPI': PALETTE.navy,
  'CONSULTORES':    PALETTE.teal,
  'EKOS':           PALETTE.purple,
  'QUIRON':         PALETTE.orange,
  'ESTABILIDADE':   PALETTE.yellow
};

// ─── Navigation ──────────────────────────────────────
function navigate(page) {
  closePivotOverlay(); // fecha overlay antes de trocar de página
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl  = document.querySelector(`[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  const titles = {
    dashboard:        'Dashboard Executivo',
    receber:          'Contas a Receber',
    pagar:            'Contas a Pagar',
    fluxo:            'Fluxo de Caixa',
    empresa:          'Análise por Empresa',
    projetado:        'Projetado × Realizado',
    'projecao-diaria':'Projeção Diária',
    boletim:          'Boletim de Caixa Diário',
    parametros:       'Parâmetros do Sistema'
  };
  document.getElementById('current-page-title').textContent = titles[page] || page;
  STATE.currentPage = page;

  // Render page
  if (page === 'dashboard') renderDashboard();
  if (page === 'receber')   renderReceber();
  if (page === 'pagar')     renderPagar();
  if (page === 'fluxo')     renderFluxo();
  if (page === 'empresa')   renderEmpresa();
  if (page === 'projetado')        renderProjetado();
  if (page === 'projecao-diaria') renderProjecaoDiaria();
  if (page === 'boletim')         renderBoletim();
  if (page === 'parametros')       renderParametros();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main');
  sidebar.classList.toggle('collapsed');
  main.classList.toggle('expanded');
}

// ─── DASHBOARD ───────────────────────────────────────
function renderDashboard() {
  const emps = getMSVal('dash-empresa-filter');
  let data = CDPI_DATA.filter(r => !emps.length || emps.includes(r.empresa));

  const receitas  = data.filter(r => r.tipo === 'C');
  const despesas  = data.filter(r => r.tipo === 'D');
  const recebidos = data.filter(r => r.status === 'Recebido' && r.tipo === 'C');
  const pagos     = data.filter(r => r.status === 'Recebido' && r.tipo === 'D');
  const atrasados = data.filter(isOverdue);
  const aVencer   = data.filter(isDueSoon);

  const totalRec  = sumField(receitas, 'receita');
  const totalDesp = sumField(despesas, 'despesa');
  const totalRecebido = sumField(recebidos, 'receita');
  const totalPago     = sumField(pagos, 'despesa');
  const saldoProj = totalRec - totalDesp;
  const saldoReal = totalRecebido - totalPago;

  const vencidasCount = atrasados.length;
  const vencidasVal   = sumField(atrasados.filter(r => r.tipo === 'C'), 'receita') + sumField(atrasados.filter(r => r.tipo === 'D'), 'despesa');

  // KPIs
  setText('kpi-receber', fmt(totalRec));
  setText('kpi-receber-count', `${receitas.length} lançamentos`);
  setText('kpi-pagar', fmt(totalDesp));
  setText('kpi-pagar-count', `${despesas.length} lançamentos`);
  setText('kpi-saldo-proj', fmt(Math.abs(saldoProj)));
  const projEl = document.getElementById('kpi-saldo-proj');
  if (projEl) projEl.style.color = saldoProj >= 0 ? 'var(--success)' : 'var(--danger)';
  setText('kpi-saldo-proj-label', saldoProj >= 0 ? 'Saldo positivo' : 'Déficit projetado');
  setText('kpi-saldo-real', fmt(Math.abs(saldoReal)));
  const realEl = document.getElementById('kpi-saldo-real');
  if (realEl) realEl.style.color = saldoReal >= 0 ? 'var(--success)' : 'var(--danger)';
  setText('kpi-saldo-real-label', saldoReal >= 0 ? 'Realizado positivo' : 'Déficit realizado');
  setText('kpi-vencidas', vencidasCount);
  setText('kpi-vencidas-val', fmt(vencidasVal));
  const avCount = aVencer.length;
  const avVal   = sumField(aVencer.filter(r => r.tipo === 'C'), 'receita');
  setText('kpi-a-vencer', avCount);
  setText('kpi-a-vencer-val', fmt(avVal));
  setText('kpi-recebido-mes', fmt(totalRecebido));
  setText('kpi-recebido-count', `${recebidos.length} registros`);
  setText('kpi-pago-mes', fmt(totalPago));
  setText('kpi-pago-count', `${pagos.length} registros`);

  // Notification badge
  const notifCount = vencidasCount + avCount;
  setText('notif-count', notifCount > 9 ? '9+' : notifCount);

  // Projeção do Mês
  renderProjecaoCard(data);

  // Charts
  renderDashboardCharts(data, receitas, despesas);

  // Alerts
  renderAlerts(atrasados, aVencer);
}

function renderProjecaoCard(data) {
  const el = document.getElementById('proj-mes-card');
  if (!el) return;

  const _emps = getMSVal('dash-empresa-filter');
  const empresaFilter = _emps.length === 1 ? _emps[0] : (_emps.length ? '__multi__' : '');

  // Use valores externos consolidados quando disponíveis, ou calcula do Excel
  const aPagar    = PARAMS.totalAPagarExt   ?? sumField(data.filter(r => r.tipo === 'D'), 'despesa');
  const aReceber  = PARAMS.totalAReceberExt ?? sumField(data.filter(r => r.tipo === 'C'), 'receita');
  const saldoIni  = PARAMS.saldoInicial;
  const projFat   = PARAMS.projecaoFat;
  const limiteAnt = PARAMS.limiteAntecipacao;
  const avista    = PARAMS.aReceberAvista;

  const difMes    = aReceber - aPagar;                  // A Receber − A Pagar
  const fc        = saldoIni + difMes;                  // Fluxo de Caixa = Saldo Ini + Diferença
  const fcAvista  = fc + avista;                        // FC + A Vista

  const fmtProj = v => {
    const abs = Math.abs(v);
    const str = abs.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (v < 0 ? '−' : '') + str;
  };

  const card = (label, value, variant, icon, sub = '') => `
    <div class="pd2-kpi-card ${variant}">
      <div class="pd2-kpi-icon">${icon}</div>
      <div class="pd2-kpi-body">
        <div class="pd2-kpi-label">${label}</div>
        <div class="pd2-kpi-value">${fmtProj(value)}</div>
        ${sub ? `<div class="pd2-kpi-sub">${sub}</div>` : ''}
      </div>
    </div>`;

  const icoBank    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="2" y="11" width="20" height="10" rx="1"/><path d="M12 2L2 7h20L12 2z"/><line x1="6" y1="11" x2="6" y2="21"/><line x1="12" y1="11" x2="12" y2="21"/><line x1="18" y1="11" x2="18" y2="21"/></svg>`;
  const icoDn      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;
  const icoUp      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
  const icoBar     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
  const icoDelta   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 6 23 6 23 12"/></svg>`;
  const icoWallet  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/><circle cx="17" cy="15" r="1" fill="currentColor"/></svg>`;
  const icoShield  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  const icoCheck   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>`;

  el.innerHTML = `
    <div class="proj-mes-wrap">
      <div class="proj-mes-title">Projeção Abril/2026</div>
      <div style="padding:14px 16px 4px">
        <div class="pd2-kpi-grid">
          ${card('Saldo Inicial',       saldoIni,  'pd2-navy',                              icoBank,   'Posição atual')}
          ${card('A Pagar',             aPagar,    'pd2-red',                               icoDn,     'Despesas do mês')}
          ${card('A Receber',           aReceber,  'pd2-teal',                              icoUp,     'Receitas previstas')}
          ${card('Projeção de Fat.',    projFat,   'pd2-pink',                              icoBar,    'Faturamento projetado')}
          ${card('Diferença Mês',       difMes,    difMes  >= 0 ? 'pd2-green' : 'pd2-red',  icoDelta,  difMes >= 0 ? 'Favorável' : 'Déficit')}
          ${card('FC + A Vista',        fcAvista,  fcAvista >= 0 ? 'pd2-cyan' : 'pd2-red',  icoWallet, 'Fluxo de caixa projetado')}
          ${card('Limite Antecipação',  limiteAnt, 'pd2-navy',                              icoShield, 'Limite disponível')}
          ${card('A Receber à Vista',   avista,    'pd2-green',                             icoCheck,  'Recebimento imediato')}
        </div>
      </div>
    </div>`;
}

function renderDashboardCharts(data, receitas, despesas) {
  // Chart 1: Receitas x Despesas by grupo
  const recGrupo = groupBy(receitas, 'grupoConta');
  const despGrupo = groupBy(despesas, 'grupoConta');
  const allGrupos = [...new Set([...Object.keys(recGrupo), ...Object.keys(despGrupo)])].filter(g => g && g !== 'Sem grupoConta').slice(0, 8);

  createChart('chart-rec-desp', {
    type: 'bar',
    data: {
      labels: allGrupos.map(g => g.length > 22 ? g.slice(0, 22) + '…' : g),
      datasets: [
        {
          label: 'Receita',
          data: allGrupos.map(g => sumField(recGrupo[g] || [], 'receita')),
          backgroundColor: PALETTE.blue + 'cc',
          borderRadius: 4,
          borderSkipped: false
        },
        {
          label: 'Despesa',
          data: allGrupos.map(g => sumField(despGrupo[g] || [], 'despesa')),
          backgroundColor: PALETTE.red + 'cc',
          borderRadius: 4,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 35, font: { size: 10 } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } }
      }
    }
  });

  // Chart 2: Fluxo diário
  const dias = [];
  for (let d = 1; d <= 30; d++) {
    dias.push(`2026-04-${String(d).padStart(2, '0')}`);
  }
  const entDia = dias.map(d => sumField(data.filter(r => r.vencimento === d && r.tipo === 'C'), 'receita'));
  const saiDia = dias.map(d => sumField(data.filter(r => r.vencimento === d && r.tipo === 'D'), 'despesa'));
  let saldoAcum = SALDO_INICIAL;
  const saldoDia = entDia.map((e, i) => { saldoAcum += e - saiDia[i]; return saldoAcum; });

  createChart('chart-fluxo', {
    type: 'line',
    data: {
      labels: dias.map((d, i) => `${i + 1}/04`),
      datasets: [
        {
          label: 'Saldo Projetado',
          data: saldoDia,
          borderColor: PALETTE.blue,
          backgroundColor: PALETTE.blue + '15',
          fill: true,
          tension: .35,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Entradas',
          data: entDia,
          borderColor: PALETTE.green,
          backgroundColor: 'transparent',
          tension: .35,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [4, 4]
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 11 } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } }
      }
    }
  });

  // Chart 3: Status doughnut
  const emAberto  = data.filter(r => r.status === 'Em Aberto' && !isOverdue(r)).length;
  const atrasados = data.filter(isOverdue).length;
  const recebidos = data.filter(r => r.status === 'Recebido').length;

  createChart('chart-status', {
    type: 'doughnut',
    data: {
      labels: ['Em Aberto', 'Em Atraso', 'Baixado / OK'],
      datasets: [{ data: [emAberto, atrasados, recebidos], backgroundColor: [PALETTE.yellow, PALETTE.red, PALETTE.green], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { padding: 12 } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} lançamentos` } } }
    }
  });

  // Chart 4: Por empresa bar
  const empresas = ['CDPI PHARMA', 'FACULDADE CDPI', 'CONSULTORES', 'EKOS'];
  const byEmp = groupBy(data, 'empresa');

  createChart('chart-empresa', {
    type: 'bar',
    data: {
      labels: empresas,
      datasets: [
        {
          label: 'Receita',
          data: empresas.map(e => sumField(byEmp[e] || [], 'receita')),
          backgroundColor: PALETTE.blue + 'cc', borderRadius: 4
        },
        {
          label: 'Despesa',
          data: empresas.map(e => sumField(byEmp[e] || [], 'despesa')),
          backgroundColor: PALETTE.red + 'cc', borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } }
      }
    }
  });

  // Chart 5: Top despesas por grupo
  const despByGrupo = {};
  despesas.forEach(r => {
    const g = r.grupoConta || 'Outros';
    despByGrupo[g] = (despByGrupo[g] || 0) + r.despesa;
  });
  const sortedGrupos = Object.entries(despByGrupo).sort((a, b) => b[1] - a[1]).slice(0, 7);

  createChart('chart-top-desp', {
    type: 'bar',
    data: {
      labels: sortedGrupos.map(([g]) => g.length > 20 ? g.slice(0, 20) + '…' : g),
      datasets: [{
        label: 'Despesa',
        data: sortedGrupos.map(([, v]) => v),
        backgroundColor: [PALETTE.navy, PALETTE.blue, PALETTE.light, PALETTE.teal, PALETTE.purple, PALETTE.orange, PALETTE.yellow].map(c => c + 'cc'),
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderAlerts(atrasados, aVencer) {
  const el = document.getElementById('alert-panel');
  if (!el) return;
  const items = [];

  if (atrasados.length > 0) {
    const val = sumField(atrasados.filter(r => r.tipo === 'C'), 'receita') + sumField(atrasados.filter(r => r.tipo === 'D'), 'despesa');
    items.push(`
      <div class="dash-alert-item">
        <div class="dash-alert-item-ico alert-ico-danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div class="dash-alert-body">
          <div class="dash-alert-item-title">
            <span class="dash-alert-badge badge-danger">${atrasados.length}</span>
            título(s) em atraso — ${fmt(val)} total
          </div>
          <div class="dash-alert-item-desc">Há lançamentos vencidos sem baixa que requerem atenção imediata.</div>
        </div>
      </div>`);
  }

  if (aVencer.length > 0) {
    const val = sumField(aVencer.filter(r => r.tipo === 'C'), 'receita') + sumField(aVencer.filter(r => r.tipo === 'D'), 'despesa');
    items.push(`
      <div class="dash-alert-item">
        <div class="dash-alert-item-ico alert-ico-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="dash-alert-body">
          <div class="dash-alert-item-title">
            <span class="dash-alert-badge badge-warning">${aVencer.length}</span>
            vencimento(s) nos próximos 7 dias — ${fmt(val)} em risco
          </div>
          <div class="dash-alert-item-desc">Acompanhe os lançamentos que vencem entre hoje e 13/04/2026.</div>
        </div>
      </div>`);
  }

  if (items.length === 0) {
    items.push(`
      <div class="dash-alert-item">
        <div class="dash-alert-item-ico alert-ico-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </div>
        <div class="dash-alert-body">
          <div class="dash-alert-item-title">
            <span class="dash-alert-badge badge-info">OK</span>
            Nenhum alerta crítico para o filtro selecionado.
          </div>
        </div>
      </div>`);
  }

  el.innerHTML = items.join('');
}

// ─── CONTAS A RECEBER / PAGAR ─────────────────────────
function renderReceber() {
  applyFilters('receber');
  renderReceberKpis();
}

function renderPagar() {
  applyFilters('pagar');
  renderPagarKpis();
}

function renderPagarKpis() {
  const grid = document.getElementById('pagar-kpi-grid');
  if (!grid) return;

  // Base dataset: todas as despesas
  const despesas = CDPI_DATA.filter(r =>
    r.tipo === 'D' || (r.tipo === '' && r.despesa > 0)
  );

  // Apply same filters currently active
  const empresas = getMSVal('pag-empresa');
  const grupo   = document.getElementById('pag-grupo')?.value;
  const status  = document.getElementById('pag-status')?.value;
  const banco   = document.getElementById('pag-banco')?.value;
  const search  = document.getElementById('pag-search')?.value?.toLowerCase();

  let filtered = despesas;
  if (empresas.length) filtered = filtered.filter(r => empresas.includes(r.empresa));
  if (status === 'EM ATRASO') filtered = filtered.filter(isOverdue);
  else if (status) filtered = filtered.filter(r => r.status === status);
  if (grupo)  filtered = filtered.filter(r => r.grupoConta === grupo);
  if (banco)  filtered = filtered.filter(r => r.banco === banco);
  if (search) filtered = filtered.filter(r =>
    r.pessoa.toLowerCase().includes(search) ||
    r.descricao.toLowerCase().includes(search)
  );

  // KPI 1: Saldo a Pagar — tudo que ainda não foi pago
  const saldoAPagar = filtered
    .filter(r => r.status !== 'Recebido' && r.status !== 'Pago')
    .reduce((s, r) => s + (r.despesa || 0), 0);

  // KPI 2: Saldo Projetado — total projetado (todas as despesas filtradas)
  const saldoProjetado = filtered.reduce((s, r) => s + (r.despesa || 0), 0);

  // KPI 3: Já Pago — despesas com status Pago/Recebido
  const jaPago = filtered
    .filter(r => r.status === 'Recebido' || r.status === 'Pago')
    .reduce((s, r) => s + (r.despesa || 0), 0);

  const cards = [
    {
      label:   'Total Projetado',
      value:   fmt(saldoProjetado),
      sub:     `${filtered.length} lançamentos no total`,
      variant: 'pag2-navy',
      icon:    '◎'
    },
    {
      label:   'Saldo a Pagar',
      value:   fmt(saldoAPagar),
      sub:     `${filtered.filter(r => r.status !== 'Recebido' && r.status !== 'Pago').length} lançamentos pendentes`,
      variant: 'pag2-danger',
      icon:    '↓'
    },
    {
      label:   'Já Pago',
      value:   fmt(jaPago),
      sub:     `${filtered.filter(r => r.status === 'Recebido' || r.status === 'Pago').length} lançamentos pagos`,
      variant: 'pag2-green',
      icon:    '✓'
    }
  ];

  grid.innerHTML = cards.map(c => `
    <div class="pag2-kpi-card ${c.variant}">
      <div class="pag2-kpi-ico">${c.icon}</div>
      <div class="pag2-kpi-body">
        <div class="pag2-kpi-label">${c.label}</div>
        <div class="pag2-kpi-value">${c.value}</div>
        <div class="pag2-kpi-sub">${c.sub}</div>
      </div>
    </div>
  `).join('');
}

function renderReceberKpis() {
  const grid = document.getElementById('receber-kpi-grid');
  if (!grid) return;

  const receitas = CDPI_DATA.filter(r =>
    r.tipo === 'C' || (r.tipo === '' && r.receita > 0)
  );

  const empresas = getMSVal('rec-empresa');
  const status   = document.getElementById('rec-status')?.value;
  const grupo    = document.getElementById('rec-grupo')?.value;
  const forma    = document.getElementById('rec-forma')?.value;
  const search   = document.getElementById('rec-search')?.value?.toLowerCase();

  let filtered = receitas;
  if (empresas.length) filtered = filtered.filter(r => empresas.includes(r.empresa));
  if (status === 'EM ATRASO') filtered = filtered.filter(isOverdue);
  else if (status) filtered = filtered.filter(r => r.status === status);
  if (grupo)  filtered = filtered.filter(r => r.grupoConta === grupo);
  if (forma)  filtered = filtered.filter(r => r.forma === forma);
  if (search) filtered = filtered.filter(r =>
    r.pessoa.toLowerCase().includes(search) ||
    r.descricao.toLowerCase().includes(search) ||
    r.conta.toLowerCase().includes(search)
  );

  const totalProjetado = filtered.reduce((s, r) => s + (r.receita || 0), 0);
  const saldoAReceber  = filtered
    .filter(r => r.status !== 'Recebido')
    .reduce((s, r) => s + (r.receita || 0), 0);
  const jaRecebido = filtered
    .filter(r => r.status === 'Recebido')
    .reduce((s, r) => s + (r.receita || 0), 0);

  const pendentes  = filtered.filter(r => r.status !== 'Recebido').length;
  const recebidos  = filtered.filter(r => r.status === 'Recebido').length;

  const cards = [
    {
      label:   'Total Projetado',
      value:   fmt(totalProjetado),
      sub:     `${filtered.length} lançamentos no total`,
      variant: 'pag2-navy',
      icon:    '◎'
    },
    {
      label:   'Saldo a Receber',
      value:   fmt(saldoAReceber),
      sub:     `${pendentes} lançamentos pendentes`,
      variant: 'pag2-teal',
      icon:    '↑'
    },
    {
      label:   'Já Recebido',
      value:   fmt(jaRecebido),
      sub:     `${recebidos} lançamentos recebidos`,
      variant: 'pag2-green',
      icon:    '✓'
    }
  ];

  grid.innerHTML = cards.map(c => `
    <div class="pag2-kpi-card ${c.variant}">
      <div class="pag2-kpi-ico">${c.icon}</div>
      <div class="pag2-kpi-body">
        <div class="pag2-kpi-label">${c.label}</div>
        <div class="pag2-kpi-value">${c.value}</div>
        <div class="pag2-kpi-sub">${c.sub}</div>
      </div>
    </div>
  `).join('');
}

function applyFilters(type) {
  const isRec = type === 'receber';
  const prefix = isRec ? 'rec' : 'pag';
  const tipoFilter = isRec ? 'C' : 'D';

  let data = CDPI_DATA.filter(r => r.tipo === tipoFilter || (r.tipo === '' && (isRec ? r.receita > 0 : r.despesa > 0)));

  const empresas = getMSVal(prefix + '-empresa');
  const status  = document.getElementById(prefix + '-status')?.value;
  const grupo   = document.getElementById(prefix + '-grupo')?.value;
  const forma   = document.getElementById(prefix + '-forma')?.value;
  const banco   = document.getElementById(prefix + '-banco')?.value;
  const search  = document.getElementById(prefix + '-search')?.value?.toLowerCase();

  if (empresas.length) data = data.filter(r => empresas.includes(r.empresa));
  if (status === 'EM ATRASO') data = data.filter(isOverdue);
  else if (status) data = data.filter(r => r.status === status);
  if (grupo)  data = data.filter(r => r.grupoConta === grupo);
  if (forma)  data = data.filter(r => r.forma === forma);
  if (banco)  data = data.filter(r => r.banco === banco);
  if (search) data = data.filter(r =>
    r.pessoa.toLowerCase().includes(search) ||
    r.descricao.toLowerCase().includes(search) ||
    r.conta.toLowerCase().includes(search)
  );

  // Excel-style column filters
  const cf = (STATE.colFilters && STATE.colFilters[type]) || {};
  Object.entries(cf).forEach(([field, set]) => {
    data = data.filter(r => set.has(String(r[field] ?? '')));
  });

  if (isRec) { STATE.filteredReceber = data; STATE.pagination.receber = 1; renderRecTable(); }
  else        { STATE.filteredPagar  = data; STATE.pagination.pagar   = 1; renderPagTable(); }
  updateColFilterIcons(type);
}

/* ============= EXCEL-STYLE COLUMN FILTERS ============= */
if (!STATE.colFilters) STATE.colFilters = { pagar: {}, receber: {} };

function _cfpDataset(type) {
  const isRec = type === 'receber';
  return CDPI_DATA.filter(r =>
    r.tipo === (isRec ? 'C' : 'D') ||
    (r.tipo === '' && (isRec ? r.receita > 0 : r.despesa > 0))
  );
}

function openColFilter(ev, type, field) {
  ev.stopPropagation();
  closeColFilter();
  const data = _cfpDataset(type);
  const uniq = [...new Set(data.map(r => String(r[field] ?? '')))]
    .filter(v => v !== '')
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const active = STATE.colFilters[type][field];
  const isAll = !active;

  const pop = document.createElement('div');
  pop.className = 'col-filter-popover';
  pop.id = 'col-filter-popover';
  pop.innerHTML = `
    <div class="cfp-search">
      <input type="text" placeholder="Buscar valores..." oninput="cfpSearchValues(this.value)">
    </div>
    <div class="cfp-actions">
      <label class="cfp-all">
        <input type="checkbox" id="cfp-all-cb" ${isAll ? 'checked' : ''} onchange="cfpToggleAll(this.checked)">
        <span>Selecionar Tudo</span>
      </label>
    </div>
    <div class="cfp-list" id="cfp-list">
      ${uniq.length === 0 ? '<div class="cfp-empty">Nenhum valor disponível</div>' :
        uniq.map(v => `
        <label class="cfp-item">
          <input type="checkbox" value="${esc(v)}" ${(isAll || (active && active.has(v))) ? 'checked' : ''}>
          <span>${esc(v)}</span>
        </label>
      `).join('')}
    </div>
    <div class="cfp-footer">
      <button class="cfp-clear" onclick="cfpClear('${type}','${field}')">Limpar</button>
      <button class="cfp-apply" onclick="cfpApply('${type}','${field}')">Aplicar</button>
    </div>
  `;
  document.body.appendChild(pop);

  const btn = ev.currentTarget;
  const r = btn.getBoundingClientRect();
  const popW = 260;
  const vw = window.innerWidth;
  let left = r.left;
  if (left + popW > vw - 8) left = vw - popW - 8;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top  = (r.bottom + 4) + 'px';

  setTimeout(() => document.addEventListener('click', _cfpOutside), 0);
}

function _cfpOutside(e) {
  const p = document.getElementById('col-filter-popover');
  if (!p) { document.removeEventListener('click', _cfpOutside); return; }
  if (!p.contains(e.target) && !e.target.closest('.th-filter-btn')) {
    closeColFilter();
  }
}

function closeColFilter() {
  document.getElementById('col-filter-popover')?.remove();
  document.removeEventListener('click', _cfpOutside);
}

function cfpSearchValues(q) {
  const list = document.getElementById('cfp-list');
  if (!list) return;
  const term = (q || '').toLowerCase();
  list.querySelectorAll('.cfp-item').forEach(it => {
    const txt = it.textContent.toLowerCase();
    it.style.display = txt.includes(term) ? '' : 'none';
  });
}

function cfpToggleAll(checked) {
  document.querySelectorAll('#cfp-list .cfp-item').forEach(it => {
    if (it.style.display !== 'none') {
      const cb = it.querySelector('input[type=checkbox]');
      if (cb) cb.checked = checked;
    }
  });
}

function cfpApply(type, field) {
  const allCbs = document.querySelectorAll('#cfp-list input[type=checkbox]');
  const checked = [...allCbs].filter(cb => cb.checked).map(cb => cb.value);
  if (checked.length === allCbs.length || checked.length === 0) {
    delete STATE.colFilters[type][field];
  } else {
    STATE.colFilters[type][field] = new Set(checked);
  }
  closeColFilter();
  applyFilters(type);
  if (type === 'pagar') renderPagarKpis?.();
  else renderReceberKpis?.();
}

function cfpClear(type, field) {
  delete STATE.colFilters[type][field];
  closeColFilter();
  applyFilters(type);
  if (type === 'pagar') renderPagarKpis?.();
  else renderReceberKpis?.();
}

function updateColFilterIcons(type) {
  const tableId = type === 'pagar' ? 'pag-table' : 'rec-table';
  const table = document.getElementById(tableId);
  if (!table) return;
  const cf = STATE.colFilters[type] || {};
  table.querySelectorAll('.th-filter-btn').forEach(btn => {
    const field = btn.dataset.field;
    if (cf[field]) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function clearFilters(type) {
  const prefix = type === 'receber' ? 'rec' : 'pag';
  ['empresa','status','grupo','forma','banco','search'].forEach(f => {
    const el = document.getElementById(prefix + '-' + f);
    if (el) el.value = '';
  });
  if (STATE.colFilters && STATE.colFilters[type]) STATE.colFilters[type] = {};
  applyFilters(type);
}

function sortTable(type, field) {
  const key = type + '-' + field;
  STATE.sortState[key] = STATE.sortState[key] === 'asc' ? 'desc' : 'asc';
  const dir = STATE.sortState[key] === 'asc' ? 1 : -1;
  const arr = type === 'receber' ? STATE.filteredReceber : STATE.filteredPagar;
  arr.sort((a, b) => {
    const va = a[field] || '';
    const vb = b[field] || '';
    if (typeof va === 'number') return (va - vb) * dir;
    return va.localeCompare(vb) * dir;
  });
  if (type === 'receber') renderRecTable();
  else renderPagTable();
}

function renderRecTable() {
  const data  = STATE.filteredReceber;
  const page  = STATE.pagination.receber;
  const total = sumField(data, 'receita');
  const rec   = sumField(data.filter(r => r.status === 'Recebido'), 'receita');
  const ab    = total - rec;

  document.getElementById('rec-summary').innerHTML = `
    <div class="summary-item"><span class="summary-label">Total Filtrado</span><span class="summary-value blue">${fmt(total)}</span></div>
    <div class="summary-item"><span class="summary-label">Recebido</span><span class="summary-value green">${fmt(rec)}</span></div>
    <div class="summary-item"><span class="summary-label">Em Aberto</span><span class="summary-value">${fmt(ab)}</span></div>
    <div class="summary-item"><span class="summary-label">Em Atraso</span><span class="summary-value red">${fmt(sumField(data.filter(isOverdue), 'receita'))}</span></div>
    <div class="summary-item"><span class="summary-label">Lançamentos</span><span class="summary-value">${data.length}</span></div>
  `;

  const paginated = data.slice((page - 1) * STATE.perPage, page * STATE.perPage);
  const tbody = document.getElementById('rec-tbody');
  if (!tbody) return;

  tbody.innerHTML = paginated.map(r => {
    const overdue = isOverdue(r);
    const rowClass = overdue ? 'row-atraso' : (r.status === 'Recebido' ? 'row-recebido' : '');
    return `<tr class="${rowClass}">
      <td>${fmtDate(r.lancamento)}</td>
      <td><span class="truncate" title="${esc(r.descricao)}">${esc(r.descricao)}</span></td>
      <td><span class="truncate" title="${esc(r.pessoa)}">${esc(r.pessoa) || '—'}</span></td>
      <td>${esc(r.conta) || '—'}</td>
      <td>${esc(r.banco) || '—'}</td>
      <td>${esc(r.forma) || '—'}</td>
      <td class="text-right">${r.receita > 0 ? fmt(r.receita) : '—'}</td>
      <td>${statusDateCell(r.vencimento, overdue)}</td>
      <td>${r.pagamento ? fmtDate(r.pagamento) : '—'}</td>
      <td><span class="badge badge-blue">${esc(r.empresa)}</span></td>
      <td>${statusBadge(r, overdue)}</td>
      <td><span class="truncate" title="${esc(r.grupoConta)}" style="max-width:120px">${esc(r.grupoConta) || '—'}</span></td>
      <td class="col-actions">
        <button class="btn-icon" title="Editar" onclick="editRecord(${r.id},'receber')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${r.status !== 'Recebido' ? `<button class="btn-icon success" title="Marcar como Recebido" onclick="baixar(${r.id},'receber')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        <button class="btn-icon danger" title="Excluir" onclick="deleteRecord(${r.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13"><div class="empty-state"><p>Nenhum registro encontrado.</p></div></td></tr>';

  renderPagination('rec-pagination', page, data.length, 'receber');
}

function renderPagTable() {
  const data  = STATE.filteredPagar;
  const page  = STATE.pagination.pagar;
  const total = sumField(data, 'despesa');
  const pago  = sumField(data.filter(r => r.status === 'Recebido'), 'despesa');
  const ab    = total - pago;

  document.getElementById('pag-summary').innerHTML = `
    <div class="summary-item"><span class="summary-label">Total Filtrado</span><span class="summary-value red">${fmt(total)}</span></div>
    <div class="summary-item"><span class="summary-label">Pago</span><span class="summary-value green">${fmt(pago)}</span></div>
    <div class="summary-item"><span class="summary-label">Em Aberto</span><span class="summary-value">${fmt(ab)}</span></div>
    <div class="summary-item"><span class="summary-label">Em Atraso</span><span class="summary-value red">${fmt(sumField(data.filter(isOverdue), 'despesa'))}</span></div>
    <div class="summary-item"><span class="summary-label">Lançamentos</span><span class="summary-value">${data.length}</span></div>
  `;

  const paginated = data.slice((page - 1) * STATE.perPage, page * STATE.perPage);
  const tbody = document.getElementById('pag-tbody');
  if (!tbody) return;

  tbody.innerHTML = paginated.map(r => {
    const overdue = isOverdue(r);
    const rowClass = overdue ? 'row-atraso' : (r.status === 'Recebido' ? 'row-recebido' : '');
    return `<tr class="${rowClass}">
      <td>${fmtDate(r.lancamento)}</td>
      <td><span class="truncate" title="${esc(r.descricao)}">${esc(r.descricao)}</span></td>
      <td><span class="truncate" title="${esc(r.pessoa)}">${esc(r.pessoa) || '—'}</span></td>
      <td>${esc(r.conta) || '—'}</td>
      <td>${esc(r.banco) || '—'}</td>
      <td>${esc(r.forma) || '—'}</td>
      <td class="text-right">${r.despesa > 0 ? fmt(r.despesa) : '—'}</td>
      <td>${statusDateCell(r.vencimento, overdue)}</td>
      <td>${r.pagamento ? fmtDate(r.pagamento) : '—'}</td>
      <td><span class="badge badge-blue">${esc(r.empresa)}</span></td>
      <td>${statusBadge(r, overdue)}</td>
      <td><span class="truncate" title="${esc(r.grupoConta)}" style="max-width:120px">${esc(r.grupoConta) || '—'}</span></td>
      <td class="col-actions">
        <button class="btn-icon" title="Editar" onclick="editRecord(${r.id},'pagar')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${r.status !== 'Recebido' ? `<button class="btn-icon success" title="Marcar como Pago" onclick="baixar(${r.id},'pagar')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        <button class="btn-icon danger" title="Excluir" onclick="deleteRecord(${r.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13"><div class="empty-state"><p>Nenhum registro encontrado.</p></div></td></tr>';

  renderPagination('pag-pagination', page, data.length, 'pagar');
}

function statusDateCell(date, overdue) {
  if (!date) return '—';
  const cls = overdue ? 'style="color:var(--danger);font-weight:600"' : '';
  return `<span ${cls}>${fmtDate(date)}</span>`;
}

function statusBadge(r, overdue) {
  if (overdue)              return '<span class="badge badge-danger">Em Atraso</span>';
  if (r.status === 'Recebido') return '<span class="badge badge-success">Baixado</span>';
  return '<span class="badge badge-warning">Em Aberto</span>';
}

function renderPagination(containerId, currentPage, total, type) {
  const pages = Math.ceil(total / STATE.perPage);
  const el = document.getElementById(containerId);
  if (!el) return;

  const start = (currentPage - 1) * STATE.perPage + 1;
  const end   = Math.min(currentPage * STATE.perPage, total);

  let btns = '';
  const addBtn = (p, label, active = false, disabled = false) => {
    btns += `<button class="page-btn${active ? ' active' : ''}" ${disabled ? 'disabled' : ''} onclick="goPage('${type}',${p})">${label}</button>`;
  };

  addBtn(currentPage - 1, '‹', false, currentPage <= 1);
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) addBtn(i, i, i === currentPage);
  } else {
    addBtn(1, 1, currentPage === 1);
    if (currentPage > 3) btns += '<span style="padding:0 4px;color:var(--text-3)">…</span>';
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(pages - 1, currentPage + 1); i++) addBtn(i, i, i === currentPage);
    if (currentPage < pages - 2) btns += '<span style="padding:0 4px;color:var(--text-3)">…</span>';
    addBtn(pages, pages, currentPage === pages);
  }
  addBtn(currentPage + 1, '›', false, currentPage >= pages);

  el.innerHTML = `
    <span style="color:var(--text-2)">${total > 0 ? `${start}–${end} de ${total} registros` : 'Sem registros'}</span>
    <div class="pagination-controls">${btns}</div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-2)">
      Por página: <select class="select-filter" style="height:28px;min-width:60px;font-size:12px" onchange="changePerPage(this.value)">
        <option value="15" ${STATE.perPage===15?'selected':''}>15</option>
        <option value="25" ${STATE.perPage===25?'selected':''}>25</option>
        <option value="50" ${STATE.perPage===50?'selected':''}>50</option>
        <option value="100" ${STATE.perPage===100?'selected':''}>100</option>
      </select>
    </div>
  `;
}

function goPage(type, page) {
  STATE.pagination[type] = page;
  if (type === 'receber') renderRecTable();
  else renderPagTable();
}

function changePerPage(val) {
  STATE.perPage = parseInt(val);
  STATE.pagination.receber = 1;
  STATE.pagination.pagar   = 1;
  if (STATE.currentPage === 'receber') renderRecTable();
  if (STATE.currentPage === 'pagar')   renderPagTable();
}

// ─── PIVOT TABLE (Tabela Dinâmica) ────────────────────
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const MESES_NUM = ['01','02','03','04','05','06','07','08','09','10','11','12'];
let pivotExpanded      = {}; // tracks which groups are expanded (nivel 1)
let pivotExpandedConta = {}; // tracks which contas are expanded (nivel 2) — key: "grupo::conta"

function setPagarView(view) {
  const lista   = document.getElementById('pag-summary');
  const tCard   = document.querySelector('#page-pagar .pag2-table-card');
  const filters = document.getElementById('pag-lista-filters');
  const pivot   = document.getElementById('pivot-view');
  const btnL    = document.getElementById('btn-view-lista');
  const btnP    = document.getElementById('btn-view-pivot');

  if (view === 'lista') {
    closePivotOverlay();           // garante que overlay fecha ao trocar aba
    if (lista)   lista.style.display = '';
    if (tCard)   tCard.style.display = '';
    if (filters) filters.style.display = '';
    if (pivot)   pivot.style.display = 'none';
    btnL?.classList.add('active');
    btnP?.classList.remove('active');
  } else {
    if (lista)   lista.style.display = 'none';
    if (tCard)   tCard.style.display = 'none';
    if (filters) filters.style.display = 'none';
    if (pivot)   pivot.style.display = '';
    btnL?.classList.remove('active');
    btnP?.classList.add('active');
    updatePivotContaOptions();
    renderPivot();
  }
}

function clearPivotFilters() {
  ['pivot-empresa','pivot-grupo','pivot-conta','pivot-status','pivot-mes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  updatePivotContaOptions();
  renderPivot();
}

// Atualiza o dropdown de Conta conforme o Grupo selecionado
function updatePivotContaOptions() {
  const grupo = document.getElementById('pivot-grupo')?.value || '';
  const sel   = document.getElementById('pivot-conta');
  if (!sel) return;

  const contas = [...new Set(
    CDPI_DATA
      .filter(r => {
        const isDesp = r.tipo === 'D' || (r.tipo === '' && r.despesa > 0);
        return isDesp && (!grupo || r.grupoConta === grupo) && r.conta;
      })
      .map(r => r.conta)
  )].sort();

  const prev = sel.value;
  sel.innerHTML = '<option value="">Todas</option>' +
    contas.map(c => `<option${c === prev ? ' selected' : ''}>${c}</option>`).join('');
}

function renderPivot() {
  const empresas = getMSVal('pivot-empresa');
  const grupo   = document.getElementById('pivot-grupo')?.value  || '';
  const conta   = document.getElementById('pivot-conta')?.value  || '';
  const status  = document.getElementById('pivot-status')?.value || '';
  const mes     = document.getElementById('pivot-mes')?.value    || '';

  const source  = CDPI_DATA.filter(r => {
    const isDesp = r.tipo === 'D' || (r.tipo === '' && r.despesa > 0);
    if (!isDesp) return false;
    if (empresas.length && !empresas.includes(r.empresa)) return false;
    if (grupo   && r.grupoConta !== grupo)   return false;
    if (conta   && r.conta      !== conta)   return false;
    if (status === 'EM ATRASO') { if (!isOverdue(r)) return false; }
    else if (status && r.status !== status)  return false;
    if (mes) {
      const d = r.vencimento || r.lancamento;
      if (!d || d.slice(5, 7) !== mes) return false;
    }
    return true;
  });

  // Determine which months have data
  const monthsWithData = new Set();
  source.forEach(r => {
    const d = r.vencimento || r.lancamento;
    if (d) monthsWithData.add(d.slice(5, 7));
  });
  const months = MESES_NUM.filter(m => monthsWithData.has(m));

  // ── Build pivot: Grupo → Conta → Pessoa ─────────────
  // pivot[grupo][conta][pessoa] = { proj, pago }
  const pivot = {};
  let grandProj = 0, grandPago = 0;

  source.forEach(r => {
    const g = r.grupoConta || 'Sem Grupo';
    const c = r.conta      || 'Sem Conta';
    const p = r.pessoa     || r.descricao || 'Sem Identificação';
    const val  = r.despesa || 0;
    const pago = (r.status === 'Recebido' || r.status === 'Pago') ? val : 0;

    if (!pivot[g])       pivot[g] = {};
    if (!pivot[g][c])    pivot[g][c] = {};
    if (!pivot[g][c][p]) pivot[g][c][p] = { proj: 0, pago: 0 };

    pivot[g][c][p].proj += val;
    pivot[g][c][p].pago += pago;
    grandProj += val;
    grandPago += pago;
  });

  const grandFalta = grandProj - grandPago;

  // ── Header ──────────────────────────────────────────
  const thead = document.getElementById('pivot-thead');
  thead.innerHTML = `
    <tr>
      <th style="min-width:320px;text-align:left;padding-left:18px;letter-spacing:.03em">RÓTULOS DE LINHA</th>
      <th style="background:linear-gradient(135deg,#1e4fa8,#234a8a);text-align:center;min-width:150px;letter-spacing:.04em">💰 PROJETADO</th>
      <th style="background:linear-gradient(135deg,#0d7a4e,#1a6644);text-align:center;min-width:140px;letter-spacing:.04em">✅ PAGO</th>
      <th style="background:linear-gradient(135deg,#9a2020,#7a2020);text-align:center;min-width:150px;letter-spacing:.04em">⏳ FALTA PAGAR</th>
    </tr>`;

  // ── Body ────────────────────────────────────────────
  const tbody = document.getElementById('pivot-tbody');
  let rows = '';
  const grupos = Object.keys(pivot).sort();

  // Inicializa estados de expansão
  grupos.forEach(g => {
    if (pivotExpanded[g] === undefined) pivotExpanded[g] = false;
    Object.keys(pivot[g]).forEach(c => {
      const key = g + '::' + c;
      if (pivotExpandedConta[key] === undefined) pivotExpandedConta[key] = false;
    });
  });

  grupos.forEach(grupo => {
    const contas    = Object.keys(pivot[grupo]).sort();
    const grpExp    = pivotExpanded[grupo];
    const groupId   = 'pg_' + grupo.replace(/\W/g, '_');

    // ── Totais do Grupo ──
    let gTotalProj = 0, gTotalPago = 0;
    contas.forEach(c => {
      Object.values(pivot[grupo][c]).forEach(p => {
        gTotalProj += p.proj;
        gTotalPago += p.pago;
      });
    });
    const gTotalFalta = gTotalProj - gTotalPago;

    // ── Linha do Grupo (Nível 1) ──
    rows += `<tr class="pivot-row-group" onclick="togglePivotGroup('${groupId}','${esc(grupo)}')">
      <td>
        <span class="pivot-toggle" id="tog-${groupId}">${grpExp ? '−' : '+'}</span>
        ${esc(grupo)}
      </td>
      <td class="pv-proj-tot" style="text-align:center">${fmtPivot(gTotalProj)}</td>
      <td class="pv-pago-tot" style="text-align:center">${gTotalPago > 0 ? fmtPivot(gTotalPago) : '—'}</td>
      <td class="pv-falta-tot" style="text-align:center">${fmtPivot(gTotalFalta)}</td>
    </tr>`;

    contas.forEach(conta => {
      const pessoas   = Object.keys(pivot[grupo][conta]).sort();
      const contaKey  = grupo + '::' + conta;
      const contaId   = 'pc_' + (grupo + '_' + conta).replace(/\W/g, '_');
      const cntExp    = pivotExpandedConta[contaKey];

      // ── Totais da Conta ──
      let cTotalProj = 0, cTotalPago = 0;
      pessoas.forEach(p => {
        cTotalProj += pivot[grupo][conta][p].proj;
        cTotalPago += pivot[grupo][conta][p].pago;
      });
      const cTotalFalta = cTotalProj - cTotalPago;

      // ── Linha da Conta (Nível 2) ──
      rows += `<tr class="pivot-row-conta grp-child-${groupId}" style="display:${grpExp ? '' : 'none'}"
                   onclick="togglePivotConta('${esc(grupo)}','${esc(conta)}','${contaId}')">
        <td>
          <span class="pivot-toggle-conta" id="tog-${contaId}">${cntExp ? '−' : '+'}</span>
          ${esc(conta)}
        </td>
        <td class="pv-proj">${cTotalProj > 0 ? fmtPivot(cTotalProj) : '—'}</td>
        <td class="pv-pago">${cTotalPago > 0 ? fmtPivot(cTotalPago) : '—'}</td>
        <td class="pv-falta ${cTotalFalta === 0 ? 'pivot-zero' : ''}">${cTotalFalta > 0 ? fmtPivot(cTotalFalta) : '—'}</td>
      </tr>`;

      // ── Linhas de Pessoa (Nível 3) ──
      pessoas.forEach(pessoa => {
        const pProj  = pivot[grupo][conta][pessoa].proj;
        const pPago  = pivot[grupo][conta][pessoa].pago;
        const pFalta = pProj - pPago;
        const showPessoa = grpExp && cntExp;
        rows += `<tr class="pivot-row-pessoa grp-child-${groupId} cnt-child-${contaId}" style="display:${showPessoa ? '' : 'none'}">
          <td>${esc(pessoa)}</td>
          <td class="pv-proj">${pProj > 0 ? fmtPivot(pProj) : '—'}</td>
          <td class="pv-pago">${pPago > 0 ? fmtPivot(pPago) : '—'}</td>
          <td class="pv-falta ${pFalta === 0 ? 'pivot-zero' : ''}">${pFalta > 0 ? fmtPivot(pFalta) : '—'}</td>
        </tr>`;
      });
    });
  });

  tbody.innerHTML = rows;

  // ── Footer ──────────────────────────────────────────
  const tfoot = document.getElementById('pivot-tfoot');
  tfoot.innerHTML = `<tr>
    <td>Total Geral</td>
    <td style="text-align:center">${fmtPivot(grandProj)}</td>
    <td style="text-align:center;background:#0f4a30">${grandPago > 0 ? fmtPivot(grandPago) : '—'}</td>
    <td style="text-align:center;background:#5a1a1a">${fmtPivot(grandFalta)}</td>
  </tr>`;
}

function togglePivotGroup(groupId, grupo) {
  pivotExpanded[grupo] = !pivotExpanded[grupo];
  const show = pivotExpanded[grupo];
  const tog  = document.getElementById(`tog-${groupId}`);
  if (tog) tog.textContent = show ? '−' : '+';

  // Mostra/oculta linhas de conta deste grupo
  document.querySelectorAll(`.grp-child-${groupId}`).forEach(row => {
    if (row.classList.contains('pivot-row-conta')) {
      row.style.display = show ? '' : 'none';
    } else {
      // Linha de pessoa: só mostra se conta também estiver expandida
      if (!show) {
        row.style.display = 'none';
      } else {
        // Verifica se a conta-pai está expandida checando o toggle
        const contaClasses = [...row.classList].find(c => c.startsWith('cnt-child-'));
        if (contaClasses) {
          const contaId = contaClasses.replace('cnt-child-', '');
          const togConta = document.getElementById(`tog-${contaId}`);
          row.style.display = (togConta && togConta.textContent === '−') ? '' : 'none';
        }
      }
    }
  });
}

function togglePivotConta(grupo, conta, contaId) {
  const key = grupo + '::' + conta;
  pivotExpandedConta[key] = !pivotExpandedConta[key];
  const show = pivotExpandedConta[key];
  const tog  = document.getElementById(`tog-${contaId}`);
  if (tog) tog.textContent = show ? '−' : '+';

  document.querySelectorAll(`.cnt-child-${contaId}`).forEach(row => {
    row.style.display = show ? '' : 'none';
  });
}

function expandAllPivot() {
  // Expande todos os grupos e contas
  document.querySelectorAll('.pivot-row-group').forEach(row => {
    const td = row.querySelector('td');
    if (td) pivotExpanded[td.textContent.trim().replace(/^[+−]\s*/, '')] = true;
  });
  Object.keys(pivotExpandedConta).forEach(k => pivotExpandedConta[k] = true);
  renderPivot();
  openPivotOverlay();
}

function collapseAllPivot() {
  Object.keys(pivotExpanded).forEach(g => pivotExpanded[g] = false);
  Object.keys(pivotExpandedConta).forEach(k => pivotExpandedConta[k] = false);
  renderPivot();
}

function openPivotOverlay() {
  const overlay   = document.getElementById('pivot-overlay');
  const container = document.getElementById('pivot-table-container');
  const body      = document.getElementById('pivot-overlay-body');
  if (!overlay || !container || !body) return;
  if (overlay.classList.contains('open')) return; // já aberto

  // Guarda referência da posição original (antes do overlay no DOM)
  overlay._origPrev = container.previousSibling;

  body.appendChild(container);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Sincroniza filtros
  const sync = (fromId, toId) => {
    const from = document.getElementById(fromId);
    const to   = document.getElementById(toId);
    if (from && to) to.value = from.value;
  };
  sync('pivot-grupo',  'ov-pivot-grupo');
  sync('pivot-status', 'ov-pivot-status');
}

function closePivotOverlay() {
  const overlay   = document.getElementById('pivot-overlay');
  const container = document.getElementById('pivot-table-container');
  const pivotView = document.getElementById('pivot-view');
  if (!overlay || !container || !pivotView) return;
  if (!overlay.classList.contains('open')) return;

  // 1. Recolhe todas as linhas antes de voltar à view normal
  Object.keys(pivotExpanded).forEach(g => pivotExpanded[g] = false);
  Object.keys(pivotExpandedConta).forEach(k => pivotExpandedConta[k] = false);
  renderPivot();

  // 2. Devolve o container à posição original (ANTES do #pivot-overlay)
  pivotView.insertBefore(container, overlay);

  // 3. Fecha o overlay
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// Fecha overlay com Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePivotOverlay();
});

function fmtPivot(v) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formatação sem casas decimais — usada na Projeção Diária
const fmtPD     = v => Math.round(v).toLocaleString('pt-BR');
const fmtPDReal = v => 'R$ ' + Math.round(Math.abs(v)).toLocaleString('pt-BR');

// ─── PROJEÇÃO DIÁRIA ─────────────────────────────────
const MESES_NOME = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function renderProjecaoDiaria() {
  const mes     = document.getElementById('pd-mes')?.value || '04';
  const ano     = document.getElementById('pd-ano')?.value || '2026';
  const emps_pd = getMSVal('pd-empresa');

  const mesNum = parseInt(mes, 10);
  const anoNum = parseInt(ano, 10);
  const dias   = new Date(anoNum, mesNum, 0).getDate();
  const prefix = `${ano}-${mes}`;

  // ── Filter data ────────────────────────────────────────
  const despesas = CDPI_DATA.filter(r => {
    const d  = r.vencimento || r.lancamento;
    const isD = r.tipo === 'D' || (r.tipo === '' && r.despesa > 0);
    return isD && d && d.startsWith(prefix) && (!emps_pd.length || emps_pd.includes(r.empresa));
  });
  const receitas = CDPI_DATA.filter(r => {
    const d  = r.vencimento || r.lancamento;
    const isC = r.tipo === 'C' || (r.tipo === '' && r.receita > 0);
    return isC && d && d.startsWith(prefix) && (!emps_pd.length || emps_pd.includes(r.empresa));
  });

  // ── Aggregate by day ───────────────────────────────────
  const dailyPagar = {}, dailyReceber = {};
  for (let d = 1; d <= dias; d++) { dailyPagar[d] = 0; dailyReceber[d] = 0; }
  despesas.forEach(r => {
    const d = parseInt((r.vencimento || r.lancamento).slice(8, 10), 10);
    if (d >= 1 && d <= dias) dailyPagar[d] += r.despesa || 0;
  });
  receitas.forEach(r => {
    const d = parseInt((r.vencimento || r.lancamento).slice(8, 10), 10);
    if (d >= 1 && d <= dias) dailyReceber[d] += r.receita || 0;
  });

  // ── A Receber à Vista (proportional distribution) ──────
  const aVistaTotal  = PARAMS.aReceberAvista;
  const totalReceber = Object.values(dailyReceber).reduce((a, b) => a + b, 0);
  const dailyVista   = {};
  for (let d = 1; d <= dias; d++) {
    dailyVista[d] = totalReceber > 0
      ? Math.round((dailyReceber[d] / totalReceber) * aVistaTotal * 100) / 100
      : Math.round((aVistaTotal / dias) * 100) / 100;
  }
  const diff = aVistaTotal - Object.values(dailyVista).reduce((a, b) => a + b, 0);
  if (diff !== 0) dailyVista[1] = Math.round((dailyVista[1] + diff) * 100) / 100;

  // ── Today markers ─────────────────────────────────────
  const todayDay = TODAY.getDate();
  const todayMes = TODAY.getMonth() + 1;
  const todayAno = TODAY.getFullYear();

  // ── Max values for mini-bar scaling ───────────────────
  const maxPagar   = Math.max(1, ...Object.values(dailyPagar));
  const maxReceber = Math.max(1, ...Object.values(dailyReceber));

  // ── Build rows + chart arrays ─────────────────────────
  let grandPagar = 0, grandReceber = 0, grandVista = 0;
  let balance    = PARAMS.saldoInicial;
  let rows = '';

  for (let d = 1; d <= dias; d++) {
    const date      = new Date(anoNum, mesNum - 1, d);
    const dow       = date.getDay();
    const diaSem    = DIAS_SEMANA[dow];
    const isWeekend = dow === 0 || dow === 6;
    const isToday   = d === todayDay && mesNum === todayMes && anoNum === todayAno;
    const isPast    = date < TODAY && !isToday;

    const pagar   = dailyPagar[d];
    const receber = dailyReceber[d];
    const vista   = dailyVista[d];
    balance = balance - pagar + receber + vista;

    grandPagar   += pagar;
    grandReceber += receber;
    grandVista   += vista;

    const fluxoCls   = balance >= 0 ? 'positive' : 'negative';
    const rowCls     = isToday ? 'pd2-today' : isWeekend ? 'pd2-weekend' : isPast ? 'pd2-past' : '';
    const todayBadge = isToday ? '<span class="pd2-today-badge">HOJE</span>' : '';
    const pagarW     = pagar   > 0 ? Math.max(4, Math.round((pagar   / maxPagar)   * 54)) : 0;
    const receberW   = receber > 0 ? Math.max(4, Math.round((receber / maxReceber) * 54)) : 0;
    const pagarBar   = pagarW   > 0 ? `<span class="pd2-mini-bar pd2-bar-pagar"   style="width:${pagarW}px"></span>` : '';
    const receberBar = receberW > 0 ? `<span class="pd2-mini-bar pd2-bar-receber" style="width:${receberW}px"></span>` : '';

    rows += `<tr class="${rowCls}">
      <td>
        <div class="pd2-date-cell">
          <span class="pd2-day-num">${String(d).padStart(2,'0')}</span>
          <div class="pd2-day-info">
            <span class="pd2-day-name">${diaSem}${isWeekend ? ' 🌙' : ''} ${todayBadge}</span>
            <span style="font-size:10px;color:var(--text-3)">${String(d).padStart(2,'0')}/${mes}/${ano}</span>
          </div>
        </div>
      </td>
      <td class="td2-pagar ${pagar === 0 ? 'td2-zero' : ''}">
        <div class="pd2-bar-wrap">${pagarBar}${pagar > 0 ? fmtPD(pagar) : '—'}</div>
      </td>
      <td class="td2-receber ${receber === 0 ? 'td2-zero' : ''}">
        <div class="pd2-bar-wrap">${receberBar}${receber > 0 ? fmtPD(receber) : '—'}</div>
      </td>
      <td class="td2-vista">${fmtPD(vista)}</td>
      <td class="td2-fluxo ${fluxoCls}">${fmtPD(balance)}</td>
    </tr>`;
  }

  // ── Thead ─────────────────────────────────────────────
  document.getElementById('pd-thead').innerHTML = `<tr>
    <th>Data</th>
    <th class="th2-pagar">A Pagar</th>
    <th class="th2-receber">A Receber</th>
    <th class="th2-vista">À Vista</th>
    <th class="th2-fluxo">Saldo Projetado</th>
  </tr>`;

  // ── Tbody ─────────────────────────────────────────────
  document.getElementById('pd-tbody').innerHTML = rows;

  // ── Tfoot ─────────────────────────────────────────────
  document.getElementById('pd-tfoot').innerHTML = `<tr>
    <td>Total / Saldo Final</td>
    <td class="tf2-pagar">${fmtPD(grandPagar)}</td>
    <td class="tf2-receber">${fmtPD(grandReceber)}</td>
    <td class="tf2-vista">${fmtPD(grandVista)}</td>
    <td class="tf2-fluxo">${fmtPD(balance)}</td>
  </tr>`;

  // ── KPI Cards ─────────────────────────────────────────
  const saldoVariant = balance >= 0 ? 'pd2-green' : 'pd2-red';
  const kpis = [
    { label: 'Total a Pagar',         value: fmtPDReal(grandPagar),   sub: `${despesas.length} lançamentos`, variant: 'pd2-navy',   icon: '↓' },
    { label: 'Total a Receber',        value: fmtPDReal(grandReceber), sub: `${receitas.length} lançamentos`, variant: 'pd2-teal',   icon: '↑' },
    { label: 'A Receber à Vista',      value: fmtPDReal(grandVista),   sub: 'Antecipação / cheque',            variant: 'pd2-orange', icon: '⚡' },
    { label: 'Saldo Final Projetado',  value: fmtPDReal(balance),      sub: `Início: R$ ${Math.round(PARAMS.saldoInicial).toLocaleString('pt-BR')}`, variant: saldoVariant, icon: '◎' },
  ];
  document.getElementById('pd-kpi-bar').innerHTML = kpis.map(k => `
    <div class="pd2-kpi-card ${k.variant}">
      <div class="pd2-kpi-icon">${k.icon}</div>
      <div class="pd2-kpi-body">
        <div class="pd2-kpi-label">${k.label}</div>
        <div class="pd2-kpi-value">${k.value}</div>
        <div class="pd2-kpi-sub">${k.sub}</div>
      </div>
    </div>`).join('');

}

function exportProjecaoDiariaCSV() {
  const table = document.getElementById('pd-table');
  if (!table) return;
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [...tr.querySelectorAll('th,td')].map(td =>
      `"${td.textContent.trim().replace(/"/g,'""')}"`);
    rows.push(cells.join(';'));
  });
  const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `cdpi_projecao_diaria_${document.getElementById('pd-mes')?.value || '04'}_${document.getElementById('pd-ano')?.value || '2026'}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
}

function exportPivotCSV() {
  const table = document.getElementById('pivot-table');
  if (!table) return;
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [...tr.querySelectorAll('th,td')].map(td => `"${td.textContent.trim().replace(/"/g,'""')}"`);
    rows.push(cells.join(';'));
  });
  const csv  = rows.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `cdpi_tabela_dinamica_${new Date().toISOString().slice(0,10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── FLUXO DE CAIXA ──────────────────────────────────
let FLX_VIEW = 'mensal'; // 'mensal' | 'diario'

function flxTab(name, btn) {
  ['evolucao','lancamentos'].forEach(t => {
    const el = document.getElementById('flx-tab-' + t);
    const tb = document.getElementById('flxtab-' + t);
    if (el) el.style.display = t === name ? '' : 'none';
    if (tb) tb.classList.toggle('active', t === name);
  });
}

function flxSetView(view, btn) {
  FLX_VIEW = view;
  document.querySelectorAll('.flx2-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFluxo();
}

function _flxInitDefaults() {
  const ini = document.getElementById('flx-dt-ini');
  const fim = document.getElementById('flx-dt-fim');
  const si  = document.getElementById('flx-saldo-input');
  if (ini && !ini.value) {
    // default: first date in data
    const dates = CDPI_DATA.map(r => r.vencimento).filter(Boolean).sort();
    ini.value = dates[0] || '2026-01-01';
  }
  if (fim && !fim.value) {
    const dates = CDPI_DATA.map(r => r.vencimento).filter(Boolean).sort();
    fim.value = dates[dates.length - 1] || '2026-12-31';
  }
  if (si && !si.value) {
    si.value = SALDO_INICIAL || 0;
  }
}

function renderFluxo() {
  _flxInitDefaults();
  const emps_f = getMSVal('fluxo-empresa');
  const dtIni  = document.getElementById('flx-dt-ini')?.value || '';
  const dtFim  = document.getElementById('flx-dt-fim')?.value || '';
  const saldoIni = parseFloat(document.getElementById('flx-saldo-input')?.value || 0) || SALDO_INICIAL;

  let data = CDPI_DATA.filter(r => {
    if (emps_f.length && !emps_f.includes(r.empresa)) return false;
    if (dtIni && r.vencimento < dtIni) return false;
    if (dtFim && r.vencimento > dtFim) return false;
    return true;
  });

  const entradas = data.filter(r => r.tipo === 'C');
  const saidas   = data.filter(r => r.tipo === 'D');
  const totalRec  = sumField(entradas, 'receita');
  const totalDesp = sumField(saidas,   'despesa');
  const saldoPer  = totalRec - totalDesp;
  const saldoFinal = saldoIni + saldoPer;

  // KPIs
  setText('flx-saldo-ini',    fmt(saldoIni));
  setText('flx-ent-prev',     fmt(totalRec));
  setText('flx-sai-prev',     fmt(totalDesp));
  setText('flx-saldo-periodo', fmt(saldoPer));
  setText('flx-saldo-proj',   fmt(saldoFinal));
  setText('flx-ent-count',    `${entradas.length} lançamento${entradas.length !== 1 ? 's' : ''}`);
  setText('flx-sai-count',    `${saidas.length} lançamento${saidas.length !== 1 ? 's' : ''}`);
  setText('flx-lanc-badge',   data.length);

  // Color saldo do período dynamically
  const perEl = document.getElementById('flx-saldo-periodo');
  if (perEl) perEl.className = 'flx2-kpi-value ' + (saldoPer >= 0 ? 'flx2-value-green' : 'flx2-value-red');
  const finEl = document.getElementById('flx-saldo-proj');
  if (finEl) finEl.className = 'flx2-kpi-value ' + (saldoFinal >= 0 ? 'flx2-value-green' : 'flx2-value-red');

  // ── Build monthly buckets ──
  const monthMap = {};
  data.forEach(r => {
    if (!r.vencimento) return;
    const ym = r.vencimento.slice(0, 7); // YYYY-MM
    if (!monthMap[ym]) monthMap[ym] = { rec: 0, desp: 0 };
    if (r.tipo === 'C') monthMap[ym].rec  += r.receita  || 0;
    if (r.tipo === 'D') monthMap[ym].desp += r.despesa  || 0;
  });
  const months = Object.keys(monthMap).sort();

  const MONTH_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const mLabel = ym => {
    const [y, m] = ym.split('-');
    return MONTH_PT[parseInt(m, 10) - 1] + '/' + y.slice(2);
  };

  // ── Chart ──
  if (FLX_VIEW === 'mensal') {
    const labels   = months.map(mLabel);
    const entArr   = months.map(m => monthMap[m].rec);
    const saiArr   = months.map(m => monthMap[m].desp);
    let acc = saldoIni;
    const saldoAcc = months.map(m => { acc += monthMap[m].rec - monthMap[m].desp; return acc; });

    createChart('chart-fluxo-main', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Entradas', data: entArr, backgroundColor: '#10b98188', borderRadius: 4, yAxisID: 'y' },
          { label: 'Saídas',   data: saiArr, backgroundColor: '#ef444488', borderRadius: 4, yAxisID: 'y' },
          { label: 'Saldo Acumulado', data: saldoAcc, type: 'line', borderColor: PALETTE.navy,
            backgroundColor: 'transparent', tension: .35, borderWidth: 2.5, pointRadius: 4,
            pointBackgroundColor: PALETTE.navy, yAxisID: 'y2' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
        scales: {
          x: { grid: { display: false } },
          y:  { position: 'left',  grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } },
          y2: { position: 'right', grid: { display: false },   ticks: { callback: v => fmtShort(v) } }
        }
      }
    });
  } else {
    // Daily view
    const dayMap = {};
    data.forEach(r => {
      if (!r.vencimento) return;
      if (!dayMap[r.vencimento]) dayMap[r.vencimento] = { rec: 0, desp: 0 };
      if (r.tipo === 'C') dayMap[r.vencimento].rec  += r.receita  || 0;
      if (r.tipo === 'D') dayMap[r.vencimento].desp += r.despesa  || 0;
    });
    const days   = Object.keys(dayMap).sort();
    const labels = days.map(d => d.slice(5).replace('-', '/'));
    const entArr = days.map(d => dayMap[d].rec);
    const saiArr = days.map(d => dayMap[d].desp);
    let acc = saldoIni;
    const saldoAcc = days.map(d => { acc += dayMap[d].rec - dayMap[d].desp; return acc; });

    createChart('chart-fluxo-main', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Entradas', data: entArr, backgroundColor: '#10b98188', borderRadius: 3, yAxisID: 'y' },
          { label: 'Saídas',   data: saiArr, backgroundColor: '#ef444488', borderRadius: 3, yAxisID: 'y' },
          { label: 'Saldo Acumulado', data: saldoAcc, type: 'line', borderColor: PALETTE.navy,
            backgroundColor: 'transparent', tension: .3, borderWidth: 2, pointRadius: 2,
            pointBackgroundColor: PALETTE.navy, yAxisID: 'y2' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 15 } },
          y:  { position: 'left',  grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } },
          y2: { position: 'right', grid: { display: false },   ticks: { callback: v => fmtShort(v) } }
        }
      }
    });
  }

  // ── Resumo Mensal table ──
  const tbody = document.getElementById('fluxo-tbody');
  if (tbody) {
    let accSaldo = saldoIni;
    let totalEntRow = 0, totalSaiRow = 0;
    const rows = months.map(m => {
      const abertura = accSaldo;
      const { rec, desp } = monthMap[m];
      totalEntRow += rec; totalSaiRow += desp;
      accSaldo += rec - desp;
      const saldoMes = rec - desp;
      const mc = saldoMes >= 0 ? 'fluxo-positivo' : 'fluxo-negativo';
      const ac = accSaldo  >= 0 ? 'fluxo-positivo' : 'fluxo-negativo';
      return `<tr>
        <td><strong>${mLabel(m)}</strong></td>
        <td class="text-right">${fmt(abertura)}</td>
        <td class="text-right text-success">${fmt(rec)}</td>
        <td class="text-right text-danger">${fmt(desp)}</td>
        <td class="text-right ${mc}">${fmt(saldoMes)}</td>
        <td class="text-right ${ac}"><strong>${fmt(accSaldo)}</strong></td>
      </tr>`;
    });
    const totCls = (totalEntRow - totalSaiRow) >= 0 ? 'fluxo-positivo' : 'fluxo-negativo';
    rows.push(`<tr class="flx2-total-row">
      <td><strong>Total</strong></td>
      <td class="text-right">${fmt(saldoIni)}</td>
      <td class="text-right text-success"><strong>${fmt(totalEntRow)}</strong></td>
      <td class="text-right text-danger"><strong>${fmt(totalSaiRow)}</strong></td>
      <td class="text-right ${totCls}"><strong>${fmt(totalEntRow - totalSaiRow)}</strong></td>
      <td class="text-right ${totCls}"><strong>${fmt(saldoFinal)}</strong></td>
    </tr>`);
    tbody.innerHTML = rows.join('');
  }

  // ── Projected table by grupoConta ──
  _renderFlxProjTable(data, months, mLabel);

  // ── Lançamentos tab ──
  _renderFlxLancamentos(data);
}

function _renderFlxProjTable(data, months, mLabel) {
  const container = document.getElementById('flx-proj-table');
  if (!container) return;

  // Group by tipo (ENTRADAS/SAÍDAS) → grupoConta → month sums
  const groups = { ENTRADAS: {}, SAÍDAS: {} };
  data.forEach(r => {
    if (!r.vencimento) return;
    const ym   = r.vencimento.slice(0, 7);
    const grp  = r.grupoConta || '(Sem Grupo)';
    const side = r.tipo === 'C' ? 'ENTRADAS' : 'SAÍDAS';
    if (!groups[side][grp]) groups[side][grp] = {};
    if (!groups[side][grp][ym]) groups[side][grp][ym] = 0;
    groups[side][grp][ym] += r.tipo === 'C' ? (r.receita || 0) : (r.despesa || 0);
  });

  // Calculate totals per month per side for AV%
  const sideTotals = { ENTRADAS: {}, SAÍDAS: {} };
  Object.entries(groups).forEach(([side, grps]) => {
    months.forEach(m => {
      sideTotals[side][m] = Object.values(grps).reduce((s, mg) => s + (mg[m] || 0), 0);
    });
  });

  const headerCols = months.map(m => `<th class="text-right">${mLabel(m)}</th><th class="text-right flx2-av">AV%</th>`).join('');
  let html = `<table class="data-table flx2-proj-table">
    <thead>
      <tr>
        <th style="min-width:200px">Grupo de Conta</th>
        <th class="text-right">Total</th>
        ${headerCols}
      </tr>
    </thead>
    <tbody>`;

  ['ENTRADAS','SAÍDAS'].forEach(side => {
    const isSai = side === 'SAÍDAS';
    const sideCls = isSai ? 'flx2-side-sai' : 'flx2-side-ent';
    const sideTotal = months.reduce((s, m) => s + (sideTotals[side][m] || 0), 0);
    html += `<tr class="flx2-group-header ${sideCls}" onclick="flxToggleGroup(this)">
      <td colspan="${2 + months.length * 2}">
        <div class="flx2-group-inner">
          <span class="flx2-group-arrow">▼</span>
          <strong>${side === 'ENTRADAS' ? '⬆ ENTRADAS' : '⬇ SAÍDAS'}</strong>
          <span class="flx2-group-total">${fmt(sideTotal)}</span>
        </div>
      </td>
    </tr>`;

    const grpNames = Object.keys(groups[side]).sort();
    grpNames.forEach(grp => {
      const mg = groups[side][grp];
      const rowTotal = months.reduce((s, m) => s + (mg[m] || 0), 0);
      let prev = null;
      const cols = months.map(m => {
        const v = mg[m] || 0;
        const av = sideTotals[side][m] > 0 ? (v / sideTotals[side][m] * 100).toFixed(1) : '—';
        const cell = `<td class="text-right">${v > 0 ? fmt(v) : '<span class="flx2-zero">—</span>'}</td>
          <td class="text-right flx2-av">${av !== '—' ? av + '%' : '—'}</td>`;
        prev = v;
        return cell;
      }).join('');
      html += `<tr class="flx2-proj-row flx2-grp-${side}">
        <td class="flx2-conta-name">${grp}</td>
        <td class="text-right"><strong>${fmt(rowTotal)}</strong></td>
        ${cols}
      </tr>`;
    });
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function flxToggleGroup(headerRow) {
  const side   = headerRow.classList.contains('flx2-side-ent') ? 'ENTRADAS' : 'SAÍDAS';
  const cls    = 'flx2-grp-' + side;
  const arrow  = headerRow.querySelector('.flx2-group-arrow');
  const isOpen = arrow?.textContent === '▼';
  const rows   = headerRow.parentElement?.querySelectorAll('.' + cls) || [];
  rows.forEach(r => r.style.display = isOpen ? 'none' : '');
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

function _renderFlxLancamentos(data) {
  const tbody = document.getElementById('flx-lanc-tbody');
  if (!tbody) return;
  const sorted = [...data].sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const statusBadge = s => {
    if (s === 'Recebido')   return `<span class="badge badge-success">Recebido</span>`;
    if (s === 'EM ATRASO')  return `<span class="badge badge-danger">Em Atraso</span>`;
    return `<span class="badge badge-warning">Em Aberto</span>`;
  };
  tbody.innerHTML = sorted.map(r => {
    const val  = r.tipo === 'C' ? (r.receita || 0) : (r.despesa || 0);
    const tipo = r.tipo === 'C'
      ? '<span class="badge badge-success">Entrada</span>'
      : '<span class="badge badge-danger">Saída</span>';
    return `<tr>
      <td>${fmtDate(r.vencimento)}</td>
      <td>${r.empresa || '—'}</td>
      <td>${r.pessoa || r.nomeFantasia || '—'}</td>
      <td>${r.grupoConta || '—'}</td>
      <td>${r.forma || '—'}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="text-right">${fmt(val)}</td>
      <td>${tipo}</td>
    </tr>`;
  }).join('');
}

// ─── POR EMPRESA ─────────────────────────────────────
function renderEmpresa() {
  const empresas = ['CDPI PHARMA', 'FACULDADE CDPI', 'CONSULTORES', 'EKOS'];
  const byEmp = groupBy(CDPI_DATA, 'empresa');

  // Cards
  document.getElementById('empresa-cards').innerHTML = empresas.map(emp => {
    const d = byEmp[emp] || [];
    const receita = sumField(d.filter(r => r.tipo === 'C'), 'receita');
    const despesa = sumField(d.filter(r => r.tipo === 'D'), 'despesa');
    const saldo   = receita - despesa;
    const recebido = sumField(d.filter(r => r.status === 'Recebido' && r.tipo === 'C'), 'receita');
    const atrasados = d.filter(isOverdue).length;
    const saldoCls = saldo >= 0 ? 'text-success' : 'text-danger';
    const color = EMPRESA_COLORS[emp] || PALETTE.blue;
    return `
      <div class="card kpi-card" style="border-top:3px solid ${color}">
        <div class="kpi-body" style="width:100%">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <span class="kpi-label" style="font-size:13px;font-weight:700;color:var(--text-1)">${emp}</span>
            <span class="badge" style="background:${color}22;color:${color}">${d.length} reg.</span>
          </div>
          <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><div style="font-size:11px;color:var(--text-3)">Receita</div><div style="font-weight:700;color:var(--success)">${fmtShort(receita)}</div></div>
            <div><div style="font-size:11px;color:var(--text-3)">Despesa</div><div style="font-weight:700;color:var(--danger)">${fmtShort(despesa)}</div></div>
            <div><div style="font-size:11px;color:var(--text-3)">Saldo</div><div class="${saldoCls}" style="font-weight:700">${fmtShort(Math.abs(saldo))}</div></div>
            <div><div style="font-size:11px;color:var(--text-3)">Em Atraso</div><div style="font-weight:700;color:${atrasados>0?'var(--danger)':'var(--text-1)'}">${atrasados}</div></div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Bar chart
  createChart('chart-emp-bar', {
    type: 'bar',
    data: {
      labels: empresas,
      datasets: [
        { label: 'Receita', data: empresas.map(e => sumField(byEmp[e]?.filter(r => r.tipo==='C')||[], 'receita')), backgroundColor: PALETTE.blue + 'cc', borderRadius: 5 },
        { label: 'Despesa', data: empresas.map(e => sumField(byEmp[e]?.filter(r => r.tipo==='D')||[], 'despesa')), backgroundColor: PALETTE.red  + 'cc', borderRadius: 5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } }
      }
    }
  });

  // Pie chart
  const despesas = empresas.map(e => sumField(byEmp[e]?.filter(r => r.tipo==='D')||[], 'despesa'));
  createChart('chart-emp-pie', {
    type: 'doughnut',
    data: {
      labels: empresas,
      datasets: [{ data: despesas, backgroundColor: empresas.map(e => EMPRESA_COLORS[e] || PALETTE.blue), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '60%',
      plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)}` } } }
    }
  });

  // Detail tables per empresa
  const detEl = document.getElementById('empresa-details');
  detEl.innerHTML = empresas.map(emp => {
    const d = byEmp[emp] || [];
    const receita  = sumField(d.filter(r => r.tipo==='C'), 'receita');
    const despesa  = sumField(d.filter(r => r.tipo==='D'), 'despesa');
    const recebido = sumField(d.filter(r => r.status==='Recebido' && r.tipo==='C'), 'receita');
    const pago     = sumField(d.filter(r => r.status==='Recebido' && r.tipo==='D'), 'despesa');
    const emAberto = d.filter(r => r.status==='Em Aberto' && !isOverdue(r)).length;
    const atrasados= d.filter(isOverdue).length;
    return `
      <div class="empresa-detail-card">
        <div class="empresa-detail-header">${emp} — Detalhamento por Grupo de Conta</div>
        <div class="empresa-detail-body">
          <div class="empresa-stats">
            <div class="emp-stat"><div class="emp-stat-value" style="color:var(--success)">${fmt(receita)}</div><div class="emp-stat-label">Total Receita</div></div>
            <div class="emp-stat"><div class="emp-stat-value" style="color:var(--danger)">${fmt(despesa)}</div><div class="emp-stat-label">Total Despesa</div></div>
            <div class="emp-stat"><div class="emp-stat-value" style="color:var(--primary-med)">${fmt(recebido)}</div><div class="emp-stat-label">Recebido</div></div>
            <div class="emp-stat"><div class="emp-stat-value" style="color:${atrasados>0?'var(--danger)':'var(--text-1)'}">${atrasados}</div><div class="emp-stat-label">Em Atraso</div></div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Grupo de Conta</th><th class="text-right">Receita</th><th class="text-right">Despesa</th><th class="text-right">Saldo</th><th class="text-right">Lançamentos</th></tr></thead>
              <tbody>${renderEmpresaGrupoRows(d)}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderEmpresaGrupoRows(data) {
  const byGrupo = groupBy(data, 'grupoConta');
  return Object.entries(byGrupo).map(([grupo, rows]) => {
    const rec  = sumField(rows.filter(r => r.tipo==='C'), 'receita');
    const desp = sumField(rows.filter(r => r.tipo==='D'), 'despesa');
    const saldo = rec - desp;
    return `<tr>
      <td>${grupo}</td>
      <td class="text-right" style="color:var(--success)">${rec > 0 ? fmt(rec) : '—'}</td>
      <td class="text-right" style="color:var(--danger)">${desp > 0 ? fmt(desp) : '—'}</td>
      <td class="text-right" style="font-weight:600;color:${saldo>=0?'var(--success)':'var(--danger)'}">${fmt(Math.abs(saldo))}</td>
      <td class="text-right">${rows.length}</td>
    </tr>`;
  }).join('');
}

// ─── PROJETADO × REALIZADO ───────────────────────────
function renderProjetado() {
  const emps_pj = getMSVal('proj-empresa');
  let data = CDPI_DATA.filter(r => !emps_pj.length || emps_pj.includes(r.empresa));

  const recTotal = sumField(data.filter(r => r.tipo==='C'), 'receita');
  const recReal  = sumField(data.filter(r => r.tipo==='C' && r.status==='Recebido'), 'receita');
  const recPct   = recTotal > 0 ? ((recReal / recTotal) * 100).toFixed(1) : 0;
  const recDiff  = recTotal - recReal;

  setText('proj-rec-proj', fmt(recTotal));
  setText('proj-rec-real', fmt(recReal));
  setText('proj-rec-pct', `${recPct}% da meta`);
  setText('proj-rec-diff', fmt(recDiff));

  // Chart: by empresa
  const empresas = ['CDPI PHARMA', 'FACULDADE CDPI', 'CONSULTORES', 'EKOS'];
  const byEmp = groupBy(data, 'empresa');

  createChart('chart-proj-rec', {
    type: 'bar',
    data: {
      labels: empresas,
      datasets: [
        { label: 'Projetado',  data: empresas.map(e => sumField(byEmp[e]?.filter(r=>r.tipo==='C')||[], 'receita')), backgroundColor: PALETTE.blue + 'aa', borderRadius: 4 },
        { label: 'Realizado',  data: empresas.map(e => sumField(byEmp[e]?.filter(r=>r.tipo==='C' && r.status==='Recebido')||[], 'receita')), backgroundColor: PALETTE.green + 'aa', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } }
      }
    }
  });

  // Chart: despesas by grupo
  const despGrupo = {};
  data.filter(r => r.tipo==='D').forEach(r => {
    const g = r.grupoConta || 'Outros';
    if (!despGrupo[g]) despGrupo[g] = { prev: 0, real: 0 };
    despGrupo[g].prev += r.despesa;
    if (r.status === 'Recebido') despGrupo[g].real += r.despesa;
  });
  const grupoLabels = Object.keys(despGrupo).filter(g => g !== 'Sem grupoConta');

  createChart('chart-proj-desp', {
    type: 'bar',
    data: {
      labels: grupoLabels.map(g => g.length > 25 ? g.slice(0, 25) + '…' : g),
      datasets: [
        { label: 'Projetado', data: grupoLabels.map(g => despGrupo[g].prev), backgroundColor: PALETTE.red + 'aa', borderRadius: 4 },
        { label: 'Realizado', data: grupoLabels.map(g => despGrupo[g].real), backgroundColor: PALETTE.orange + 'aa', borderRadius: 4 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmtShort(v) } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // Table: all groups (receitas + despesas)
  const allGroups = {};
  data.forEach(r => {
    const g = r.grupoConta || 'Outros';
    if (!allGroups[g]) allGroups[g] = { prev: 0, real: 0, tipo: r.tipo };
    allGroups[g].prev += (r.receita || 0) + (r.despesa || 0);
    if (r.status === 'Recebido') allGroups[g].real += (r.receita || 0) + (r.despesa || 0);
  });

  const tbody = document.getElementById('proj-tbody');
  if (!tbody) return;
  tbody.innerHTML = Object.entries(allGroups).filter(([g]) => g !== 'Sem grupoConta').map(([grupo, vals]) => {
    const diff = vals.prev - vals.real;
    const pct  = vals.prev > 0 ? ((vals.real / vals.prev) * 100).toFixed(1) : 0;
    const pctN = parseFloat(pct);
    const cls  = pctN >= 80 ? 'badge-success' : pctN >= 50 ? 'badge-warning' : 'badge-danger';
    return `<tr>
      <td>${grupo}</td>
      <td class="text-right">${fmt(vals.prev)}</td>
      <td class="text-right">${fmt(vals.real)}</td>
      <td class="text-right" style="color:${diff<0?'var(--success)':'var(--danger)'};font-weight:600">${fmt(Math.abs(diff))}</td>
      <td class="text-right">
        <div>${pct}%</div>
        <div class="proj-pct-bar"><div class="proj-pct-fill" style="width:${Math.min(100,pctN)}%;background:${pctN>=80?'var(--success)':pctN>=50?'var(--warning)':'var(--danger)'}"></div></div>
      </td>
      <td><span class="badge ${cls}">${pctN>=80?'Atingido':pctN>=50?'Parcial':'Crítico'}</span></td>
    </tr>`;
  }).join('');
}

// ─── PARÂMETROS ───────────────────────────────────────
function renderParametros() {
  const empresas = ['CDPI PHARMA', 'FACULDADE CDPI', 'CONSULTORES', 'EKOS', 'QUIRON', 'ESTABILIDADE'];
  const grupos   = [...new Set(CDPI_DATA.map(r => r.grupoConta).filter(Boolean))];
  const formas   = [...new Set(CDPI_DATA.map(r => r.forma).filter(Boolean))];

  const renderList = (id, items) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.map(item => `
      <div class="param-item">
        <span class="param-item-name">${item}</span>
        <div class="param-actions">
          <button class="btn-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
      </div>`).join('');
  };

  renderList('param-empresas', empresas);
  renderList('param-grupos', grupos);
  renderList('param-formas', formas);
}

function addParamItem(type) {
  const val = prompt(`Novo item para ${type}:`);
  if (val) alert(`"${val}" adicionado! (Integração com backend necessária para persistência.)`);
}

function saveParams() {
  const get = id => parseFloat(document.getElementById(id)?.value || 0);
  PARAMS.saldoInicial       = get('param-saldo-ini');
  PARAMS.totalAPagarExt     = get('param-a-pagar-ext');
  PARAMS.totalAReceberExt   = get('param-a-receber-ext');
  PARAMS.projecaoFat        = get('param-proj-fat');
  PARAMS.limiteAntecipacao  = get('param-limite-ant');
  PARAMS.aReceberAvista     = get('param-avista');

  // Persist to localStorage
  localStorage.setItem('cdpi_params', JSON.stringify(PARAMS));

  // Refresh dashboard with new values
  navigate('dashboard');

  // Show feedback
  const btn = document.querySelector('[onclick="saveParams()"]');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg> Salvo!';
    btn.style.background = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.borderColor = ''; }, 2000);
  }
}

function previewProj() {
  const el = document.getElementById('param-proj-preview');
  if (!el) return;
  const get = id => parseFloat(document.getElementById(id)?.value || 0);
  const saldoIni  = get('param-saldo-ini');
  const aPagar    = get('param-a-pagar-ext');
  const aReceber  = get('param-a-receber-ext');
  const projFat   = get('param-proj-fat');
  const limiteAnt = get('param-limite-ant');
  const avista    = get('param-avista');
  const difMes    = aReceber - aPagar;
  const fc        = saldoIni + difMes;
  const fcAvista  = fc + avista;

  const fmtP = v => (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  el.innerHTML = `
    <div style="background:var(--bg);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--text-2)">
      <strong style="color:var(--text-1)">Pré-visualização do card:</strong>
      <span style="margin-left:16px">Diferença do Mês = <strong style="color:${difMes>=0?'var(--success)':'var(--danger)'}">${fmtP(difMes)}</strong></span>
      <span style="margin-left:16px">FC = <strong>${fmtP(fc)}</strong></span>
      <span style="margin-left:16px">FC + À Vista = <strong style="color:${fcAvista>=0?'var(--success)':'var(--danger)'}">${fmtP(fcAvista)}</strong></span>
    </div>`;
}

function loadSavedParams() {
  try {
    const saved = localStorage.getItem('cdpi_params');
    if (saved) {
      const p = JSON.parse(saved);
      Object.assign(PARAMS, p);
    }
  } catch (e) { /* ignore */ }
}

// ─── MODAL ───────────────────────────────────────────
function openModal(type, data = null) {
  STATE.modalType = type;
  STATE.editingId = data?.id || null;
  const isRec = type === 'receber';
  document.getElementById('modal-title').textContent = data ? 'Editar Lançamento' : (isRec ? 'Novo Recebível' : 'Nova Despesa');

  const empresas = ['CDPI PHARMA', 'FACULDADE CDPI', 'CONSULTORES', 'EKOS', 'QUIRON', 'ESTABILIDADE'];
  const grupos   = [...new Set(CDPI_DATA.map(r => r.grupoConta).filter(Boolean))];
  const formas   = ['Boleto Automático', 'Boleto', 'Transferência', 'Cartão de Crédito', 'Cartão de Crédito (Recorrente)', 'DDA - Débito Automático'];
  const bancos   = ['Sicoob', 'Itaú', 'PagSeguro', 'FACULDADE'];

  const opt = (arr, sel = '') => arr.map(v => `<option${v===sel?' selected':''}>${v}</option>`).join('');

  document.getElementById('modal-body').innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Data do Lançamento</label><input type="date" id="f-lancamento" value="${data?.lancamento || '2026-04-06'}"></div>
      <div class="form-group"><label>Vencimento</label><input type="date" id="f-vencimento" value="${data?.vencimento || ''}"></div>
      <div class="form-group full-width"><label>Descrição</label><input type="text" id="f-descricao" value="${esc(data?.descricao || '')}" placeholder="Descreva o lançamento..."></div>
      <div class="form-group"><label>${isRec ? 'Cliente / Pessoa' : 'Fornecedor / Pessoa'}</label><input type="text" id="f-pessoa" value="${esc(data?.pessoa || '')}"></div>
      <div class="form-group"><label>Empresa</label><select id="f-empresa"><option value="">Selecione...</option>${opt(empresas, data?.empresa)}</select></div>
      <div class="form-group"><label>${isRec ? 'Valor da Receita' : 'Valor da Despesa'}</label><input type="number" step="0.01" id="f-valor" value="${isRec ? (data?.receita||'') : (data?.despesa||'')}"></div>
      <div class="form-group"><label>Conta</label><input type="text" id="f-conta" value="${esc(data?.conta||'')}"></div>
      <div class="form-group"><label>Banco</label><select id="f-banco"><option value="">Selecione...</option>${opt(bancos, data?.banco)}</select></div>
      <div class="form-group"><label>Forma de Pagamento</label><select id="f-forma"><option value="">Selecione...</option>${opt(formas, data?.forma)}</select></div>
      <div class="form-group"><label>Grupo de Conta</label><select id="f-grupo"><option value="">Selecione...</option>${opt(grupos, data?.grupoConta)}</select></div>
      <div class="form-group"><label>Data de ${isRec ? 'Recebimento' : 'Pagamento'}</label><input type="date" id="f-pagamento" value="${data?.pagamento || ''}"></div>
      <div class="form-group"><label>Status</label><select id="f-status"><option value="Em Aberto">Em Aberto</option><option value="Recebido" ${data?.status==='Recebido'?'selected':''}>Baixado</option></select></div>
      <div class="form-group full-width"><label>Observações</label><textarea id="f-obs" placeholder="Observações adicionais...">${esc(data?.observacoes||'')}</textarea></div>
    </div>`;

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  STATE.editingId = null;
  STATE.modalType = null;
}

function saveModal() {
  const isRec = STATE.modalType === 'receber';
  const valor = parseFloat(document.getElementById('f-valor')?.value || 0);

  const record = {
    id: STATE.editingId || (CDPI_DATA.length + 1),
    lancamento: document.getElementById('f-lancamento')?.value || '',
    descricao:  document.getElementById('f-descricao')?.value  || '',
    pessoa:     document.getElementById('f-pessoa')?.value     || '',
    empresa:    document.getElementById('f-empresa')?.value    || '',
    conta:      document.getElementById('f-conta')?.value      || '',
    banco:      document.getElementById('f-banco')?.value      || '',
    forma:      document.getElementById('f-forma')?.value      || '',
    grupoConta: document.getElementById('f-grupo')?.value      || '',
    vencimento: document.getElementById('f-vencimento')?.value || '',
    pagamento:  document.getElementById('f-pagamento')?.value  || '',
    status:     document.getElementById('f-status')?.value     || 'Em Aberto',
    statusDetalhe: '',
    tipo: isRec ? 'C' : 'D',
    receita:  isRec ? valor : 0,
    despesa:  isRec ? 0 : valor,
    observacoes: document.getElementById('f-obs')?.value || '',
    turma: '', nomeFantasia: '', operadorId: '', operador: 'Lorena Kellen', identificadorConta: ''
  };

  if (STATE.editingId) {
    const idx = CDPI_DATA.findIndex(r => r.id === STATE.editingId);
    if (idx !== -1) CDPI_DATA[idx] = record;
  } else {
    CDPI_DATA.push(record);
  }

  closeModal();
  if (isRec) renderReceber();
  else renderPagar();
  navigate('dashboard');
}

function editRecord(id, type) {
  const record = CDPI_DATA.find(r => r.id === id);
  if (record) openModal(type, record);
}

function deleteRecord(id) {
  if (!confirm('Deseja excluir este lançamento?')) return;
  const idx = CDPI_DATA.findIndex(r => r.id === id);
  if (idx !== -1) CDPI_DATA.splice(idx, 1);
  if (STATE.currentPage === 'receber') applyFilters('receber');
  else applyFilters('pagar');
}

function baixar(id, type) {
  const today = '2026-04-06';
  const record = CDPI_DATA.find(r => r.id === id);
  if (!record) return;
  record.status   = 'Recebido';
  record.statusDetalhe = 'OK';
  record.pagamento = today;
  if (type === 'receber') renderReceber();
  else renderPagar();
}

// ─── EXPORT ──────────────────────────────────────────
function exportCSV(type) {
  const isRec = type === 'receber';
  const data  = isRec ? STATE.filteredReceber : STATE.filteredPagar;
  const cols  = ['id','lancamento','descricao','pessoa','conta','banco','forma',isRec?'receita':'despesa','vencimento','pagamento','empresa','status','grupoConta','tipo'];
  const header = cols.join(';');
  const rows   = data.map(r => cols.map(c => `"${String(r[c]||'').replace(/"/g,'""')}"`).join(';'));
  const csv    = [header, ...rows].join('\n');
  const blob   = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url    = URL.createObjectURL(blob);
  const a      = Object.assign(document.createElement('a'), { href: url, download: `cdpi_${type}_${new Date().toISOString().slice(0,10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

function exportReport() {
  exportCSV('receber');
}

// ─── BOLETIM DE CAIXA DIÁRIO ─────────────────────────
const BOL_FORMAS_DEFAULT = [
  'Boleto Automático','Boleto','Transferência',
  'Cartão de Crédito','Cartão de Crédito (Recorrente)',
  'DDA - Débito Automático','Cartão de Débito'
];
let BOL_FORMAS = [];

function loadBolFormas() {
  try {
    const saved = localStorage.getItem('cdpi_bol_formas');
    BOL_FORMAS = saved ? JSON.parse(saved) : [...BOL_FORMAS_DEFAULT];
  } catch(e) { BOL_FORMAS = [...BOL_FORMAS_DEFAULT]; }
}

function saveBolFormas() {
  try { localStorage.setItem('cdpi_bol_formas', JSON.stringify(BOL_FORMAS)); } catch(e) {}
}

function renderBolFormaPanel() {
  const panel = document.getElementById('mspanel-bol-forma');
  if (!panel) return;
  const checked = getMSVal('bol-forma');
  panel.innerHTML =
    `<label class="ms-opt ms-all-opt"><input type="checkbox" class="ms-all-cb" ${checked.length===0?'checked':''} onchange="msSelectAll('bol-forma')"><span>Todas as Formas</span></label>` +
    `<div class="ms-divider"></div>` +
    BOL_FORMAS.map(f =>
      `<label class="ms-opt"><input type="checkbox" class="ms-cb" value="${esc(f)}" ${checked.includes(f)?'checked':''} onchange="msChange('bol-forma')"><span>${esc(f)}</span></label>`
    ).join('');
}

function renderBolContaPanel() {
  const panel = document.getElementById('mspanel-bol-conta');
  if (!panel) return;
  const checked = getMSVal('bol-conta');
  const contas = [...new Set(CDPI_DATA.map(r => r.conta).filter(Boolean))].sort();
  panel.innerHTML =
    `<label class="ms-opt ms-all-opt"><input type="checkbox" class="ms-all-cb" ${checked.length === 0 ? 'checked' : ''} onchange="msSelectAll('bol-conta')"><span>Todas as Contas</span></label>` +
    `<div class="ms-divider"></div>` +
    contas.map(c =>
      `<label class="ms-opt"><input type="checkbox" class="ms-cb" value="${esc(c)}" ${checked.includes(c) ? 'checked' : ''} onchange="msChange('bol-conta')"><span>${esc(c)}</span></label>`
    ).join('');
}

function addBolForma() {
  const nome = prompt('Nome da nova forma de pagamento:');
  if (!nome || !nome.trim()) return;
  const val = nome.trim();
  if (BOL_FORMAS.includes(val)) { alert('Essa forma já existe na lista.'); return; }
  BOL_FORMAS.push(val);
  saveBolFormas();
  renderBolFormaPanel();
}

let BOL_BANCOS = {};

function loadBolBancos() {
  try {
    const saved = localStorage.getItem('cdpi_bol_bancos');
    if (saved) BOL_BANCOS = JSON.parse(saved);
  } catch(e) {}
  const empresas = ['', 'FACULDADE CDPI', 'CDPI PHARMA', 'CONSULTORES', 'EKOS', 'ESTABILIDADE', 'QUIRON'];
  empresas.forEach(k => {
    if (!BOL_BANCOS[k]) BOL_BANCOS[k] = [{label: 'Saldo Sicoob', valor: 0}];
  });
}

function saveBolBancos() {
  try { localStorage.setItem('cdpi_bol_bancos', JSON.stringify(BOL_BANCOS)); } catch(e) {}
}

function renderBoletim() {
  loadBolBancos();
  loadBolFormas();
  renderBolFormaPanel();
  renderBolContaPanel();
  const dataEl = document.getElementById('bol-data');
  if (!dataEl) return;

  const data      = dataEl.value;
  const empresas  = getMSVal('bol-empresa');
  const formas    = getMSVal('bol-forma');
  const contas    = getMSVal('bol-conta');
  const dateLabel = data ? fmtDate(data) : '—';

  const empLabel   = empresas.length === 0 ? 'Todas as Empresas'
                   : empresas.length === 1 ? empresas[0]
                   : `${empresas.length} empresas`;
  const parts = [];
  if (formas.length)  parts.push(formas.length === 1 ? formas[0]  : `${formas.length} formas`);
  if (contas.length)  parts.push(contas.length === 1 ? contas[0]  : `${contas.length} contas`);
  const sub = document.getElementById('bol-sub');
  if (sub) sub.textContent = `${empLabel} — ${dateLabel}${parts.length ? ' · ' + parts.join(' · ') : ''}`;

  const bancosTitle = document.getElementById('bol-bancos-title');
  if (bancosTitle) bancosTitle.textContent = empresas.length === 1 ? `Bancos ${empresas[0]}` : 'Bancos';

  const pagarTitle = document.getElementById('bol-pagar-title');
  if (pagarTitle) pagarTitle.textContent = data ? `Contas a Pagar — ${dateLabel}` : 'Contas a Pagar';

  const bancoKey = empresas.length === 1 ? empresas[0] : '';
  _renderBolBancos(bancoKey);
  _renderBolPagar(data, empresas, formas, contas);
}

function _renderBolBancos(empresa) {
  const key    = empresa || '';
  const bancos = BOL_BANCOS[key] || [];
  const tbody  = document.getElementById('bol-bancos-tbody');
  if (!tbody) return;

  const keyEsc = key.replace(/'/g, "\\'");
  tbody.innerHTML = bancos.map((b, i) => `
    <tr class="bol-banco-row">
      <td style="padding:9px 18px 9px 12px">
        <input class="bol-banco-input bol-banco-label" type="text" value="${esc(b.label)}"
          onchange="BOL_BANCOS['${keyEsc}'][${i}].label=this.value;saveBolBancos()"
          placeholder="Nome do banco / conta">
      </td>
      <td style="padding:9px 0 9px 8px;width:160px">
        <input class="bol-banco-input bol-banco-valor" type="number" step="0.01" value="${b.valor}"
          onchange="BOL_BANCOS['${keyEsc}'][${i}].valor=parseFloat(this.value)||0;saveBolBancos();_updateBolTotals('${keyEsc}')"
          oninput="_updateBolTotals('${keyEsc}')"
          placeholder="0,00">
      </td>
      <td style="padding:6px 14px 6px 6px;width:32px">
        <button class="bol-del-btn" onclick="removeBancoRow('${keyEsc}',${i})">×</button>
      </td>
    </tr>
  `).join('');

  _updateBolTotals(key);
}

function _updateBolTotals(key) {
  const bancos = BOL_BANCOS[key] || [];
  const total  = bancos.reduce((s, b) => s + (parseFloat(b.valor) || 0), 0);
  const el = document.getElementById('bol-total-receita');
  if (el) el.textContent = total.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  _updateBolCaixaFinal();
}

function addBancoRow() {
  const empEl = document.getElementById('bol-empresa');
  const key   = empEl ? empEl.value : '';
  loadBolBancos();
  if (!BOL_BANCOS[key]) BOL_BANCOS[key] = [];
  BOL_BANCOS[key].push({label: 'Novo Banco', valor: 0});
  saveBolBancos();
  _renderBolBancos(key);
}

function removeBancoRow(key, index) {
  if (!BOL_BANCOS[key]) return;
  BOL_BANCOS[key].splice(index, 1);
  saveBolBancos();
  _renderBolBancos(key);
}

function _renderBolPagar(data, empresas, formas, contas) {
  const tbody = document.getElementById('bol-pagar-tbody');
  if (!tbody) return;

  const rows = CDPI_DATA.filter(r => {
    if (r.tipo !== 'D' && !(r.tipo === '' && r.despesa > 0)) return false;
    if (r.despesa <= 0) return false;
    if (data && r.vencimento !== data) return false;
    if (empresas.length > 0 && !empresas.includes(r.empresa)) return false;
    if (formas.length > 0  && !formas.includes(r.forma))   return false;
    if (contas.length > 0  && !contas.includes(r.conta))   return false;
    return true;
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="bol-empty-row"><td colspan="2">Nenhum pagamento encontrado para esta data${data ? ' (' + fmtDate(data) + ')' : ''}.</td></tr>`;
    const depEl = document.getElementById('bol-total-despesa');
    if (depEl) depEl.textContent = '0,00';
    _updateBolCaixaFinal();
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const nome  = (r.nomeFantasia || r.pessoa || '').trim();
    const desc  = (r.descricao || '').trim();
    const label = nome && desc ? `${nome} — ${desc}` : (desc || nome);
    const val   = r.despesa.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    return `<tr class="bol-pagar-row">
      <td class="bol-pagar-desc">${esc(label)}</td>
      <td class="bol-pagar-val text-right">${val}</td>
    </tr>`;
  }).join('');

  const total = rows.reduce((s, r) => s + r.despesa, 0);
  const depEl = document.getElementById('bol-total-despesa');
  if (depEl) depEl.textContent = total.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  _updateBolCaixaFinal();
}

function _updateBolCaixaFinal() {
  const recRaw  = document.getElementById('bol-total-receita')?.textContent  || '0';
  const despRaw = document.getElementById('bol-total-despesa')?.textContent || '0';
  const rec  = parseFloat(recRaw.replace(/\./g,'').replace(',','.'))  || 0;
  const desp = parseFloat(despRaw.replace(/\./g,'').replace(',','.')) || 0;
  const final = rec - desp;
  const el = document.getElementById('bol-caixa-final');
  if (!el) return;
  el.textContent = Math.abs(final).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  el.className = 'bol-cf-value ' + (final >= 0 ? 'cf-positive' : 'cf-negative');
}

function printBoletim() {
  window.print();
}

// ─── GLOBAL SEARCH ───────────────────────────────────
function globalSearch(term) {
  if (!term || term.length < 2) return;
  const results = CDPI_DATA.filter(r =>
    r.descricao.toLowerCase().includes(term.toLowerCase()) ||
    r.pessoa.toLowerCase().includes(term.toLowerCase()) ||
    r.conta.toLowerCase().includes(term.toLowerCase())
  );
  // Navigate to appropriate page and apply search
  if (results.length > 0) {
    const hasRec  = results.some(r => r.tipo === 'C');
    const target  = hasRec ? 'receber' : 'pagar';
    navigate(target);
    const prefix = hasRec ? 'rec' : 'pag';
    const srch = document.getElementById(prefix + '-search');
    if (srch) { srch.value = term; applyFilters(target); }
  }
}

// ─── HELPERS ─────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── INIT ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Restore saved parameters
  loadSavedParams();

  // Pre-fill param inputs with current values
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('param-saldo-ini',    PARAMS.saldoInicial);
  setVal('param-a-pagar-ext',  PARAMS.totalAPagarExt);
  setVal('param-a-receber-ext',PARAMS.totalAReceberExt);
  setVal('param-proj-fat',     PARAMS.projecaoFat);
  setVal('param-limite-ant',   PARAMS.limiteAntecipacao);
  setVal('param-avista',       PARAMS.aReceberAvista);

  // Set default date for boletim to today
  const bolData = document.getElementById('bol-data');
  if (bolData) bolData.value = '2026-04-06';
  loadBolFormas();
  renderBolFormaPanel();
  renderBolContaPanel();

  // Pre-compute filtered data
  STATE.filteredReceber = CDPI_DATA.filter(r => r.tipo === 'C' || (r.tipo === '' && r.receita > 0));
  STATE.filteredPagar   = CDPI_DATA.filter(r => r.tipo === 'D' || (r.tipo === '' && r.despesa > 0));

  renderDashboard();
});
