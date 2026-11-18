(() => {
  'use strict';
  const data = window.RADAR;
  if (!data || !Array.isArray(data.rows)) throw new Error('Radar data is missing. Run main.ts to build the board.');
  const $ = (id) => document.getElementById(id);
  const state = { query: '', category: 'All sectors', chain: 'All chains', watchOnly: false, earlyOnly: true, sort: 'value', tab: 'radar', page: 0, selected: null };
  const pageSize = 12;
  const watch = new Set(data.rows.filter((r) => r.tvl_usd >= data.floor_usd).map((r) => r.slug));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => { if (n == null || !Number.isFinite(Number(n))) return '—'; n = Number(n); if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`; if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`; return `$${Math.round(n)}`; };
  const pct = (n) => n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`;
  const age = (n) => n == null ? 'Unknown' : n < 365 ? `${Math.max(1, Math.round(n / 30))} mo` : `${(n / 365).toFixed(1)} yr`;
  const glyph = (name) => esc(String(name || '?').split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase());
  const list = () => state.tab === 'live' ? data.live : data.rows;

  function fillSelects() {
    const categories = [...new Set(data.rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('categorySelect').innerHTML = '<option>All sectors</option>' + categories.map((x) => `<option>${esc(x)}</option>`).join('');
    const chains = [...new Set(data.rows.flatMap((r) => r.chains || []))].sort((a, b) => a.localeCompare(b));
    $('chainSelect').innerHTML = '<option>All chains</option>' + chains.map((x) => `<option>${esc(x)}</option>`).join('');
  }

  function visibleRows() {
    let rows = list().filter((r) => {
      const q = state.query.trim().toLowerCase();
      const haystack = [r.name, r.slug, r.category, ...(r.chains || [])].join(' ').toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (state.category !== 'All sectors' && r.category !== state.category) return false;
      if (state.chain !== 'All chains' && !(r.chains || []).includes(state.chain)) return false;
      if (state.tab === 'radar' && state.watchOnly && !watch.has(r.slug)) return false;
      if (state.tab === 'radar' && !state.earlyOnly && !watch.has(r.slug)) return false;
      return true;
    });
    rows = [...rows];
    if (state.tab === 'radar') {
      if (state.sort === 'tvl') rows.sort((a, b) => b.tvl_usd - a.tvl_usd || a.rank - b.rank);
      else if (state.sort === 'growth') rows.sort((a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity) || a.rank - b.rank);
      else if (state.sort === 'age') rows.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1) || a.rank - b.rank);
      else rows.sort((a, b) => a.rank - b.rank);
    } else rows.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
    return rows;
  }

  function spark(n) {
    const down = n != null && n < 0;
    const points = down ? '1,2 8,5 15,4 22,10 29,7 37,12' : '1,11 8,8 15,9 22,4 29,7 37,2';
    return `<svg class="mini-line${down ? ' down' : ''}" viewBox="0 0 38 14" aria-hidden="true"><polyline points="${points}"/></svg>`;
  }

  function renderRows() {
    const all = visibleRows();
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const start = state.page * pageSize;
    const current = all.slice(start, start + pageSize);
    $('rowCount').textContent = String(all.length).padStart(2, '0');
    $('resultSummary').textContent = state.tab === 'live' ? `${all.length} protocols with a token recorded` : `${all.length} protocols · snapshot-ranked`;
    $('emptyState').hidden = all.length !== 0;
    $('boardRows').innerHTML = current.map((r) => {
      const isLive = state.tab === 'live';
      const isWatch = watch.has(r.slug);
      const move = r.change_7d == null ? 'growth-na' : r.change_7d >= 0 ? 'growth-pos' : 'growth-neg';
      const status = isLive ? `<span class="token-badge">TOKEN RECORDED</span>` : isWatch ? `<span class="watch-badge">FLOOR LIST</span>` : `<span class="early-badge">EARLY RADAR</span>`;
      const value = isLive ? fmt(r.mcap_usd) : fmt(r.implied_value_usd);
      const valueLabel = isLive ? 'market cap' : 'scenario value';
      const rank = isLive ? '↗' : String(r.rank).padStart(2, '0');
      return `<tr data-slug="${esc(r.slug)}" tabindex="0" aria-label="Open details for ${esc(r.name)}"><td class="rank-cell"><span class="rank-badge">${rank}</span></td><td><div class="protocol-cell"><span class="protocol-glyph">${glyph(r.name)}</span><div class="protocol-text"><div class="protocol-name">${esc(r.name)}</div><div class="protocol-meta">${esc(r.category || 'Unclassified')} · ${(r.chains || []).slice(0, 2).map(esc).join(' / ') || 'chain not listed'} &nbsp;${status}</div></div></div></td><td class="tvl-cell">${fmt(r.tvl_usd)}</td><td><div class="change-wrap ${move}"><span class="trend-mark">${r.change_7d == null ? '·' : r.change_7d >= 0 ? '↗' : '↘'}</span>${pct(r.change_7d)}${spark(r.change_7d)}</div></td><td class="value-cell"><b>${value}</b><small>${valueLabel}</small></td><td class="row-open">›</td></tr>`;
    }).join('');
    $('pageSummary').textContent = all.length ? `Showing ${start + 1}–${Math.min(start + pageSize, all.length)} of ${all.length}` : 'No rows';
    $('pageLabel').textContent = `${state.page + 1} / ${pages}`;
    $('prevPage').disabled = state.page === 0;
    $('nextPage').disabled = state.page >= pages - 1;
    $('boardRows').querySelectorAll('tr').forEach((row) => {
      const open = () => openDetail(row.dataset.slug);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  function openDetail(slug) {
    const row = [...data.rows, ...data.live].find((r) => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    const isLive = !('implied_value_usd' in row);
    const tags = [`${esc(row.category || 'Unclassified')}`, ...(row.chains || []).slice(0, 4).map(esc)];
    const modelStats = isLive
      ? `<div class="live-note">This protocol has a token recorded in the snapshot, so it is separated from the tokenless ranking. Its market cap is the snapshot's figure, not this model's estimate.</div><div class="detail-stats"><div><span>MARKET CAP</span><b>${fmt(row.mcap_usd)}</b></div><div><span>TVL</span><b>${fmt(row.tvl_usd)}</b></div><div><span>7D TVL</span><b>${pct(row.change_7d)}</b></div></div>`
      : `<div class="detail-stats"><div><span>TVL</span><b>${fmt(row.tvl_usd)}</b></div><div><span>7D TVL</span><b>${pct(row.change_7d)}</b></div><div><span>TRACKED</span><b>${age(row.age_days)}</b></div></div><div class="detail-stats"><div><span>GROWTH MULT.</span><b>${Number(row.growth_multiplier).toFixed(3)}×</b></div><div><span>TENURE MULT.</span><b>${Number(row.maturity_multiplier).toFixed(3)}×</b></div><div><span>VALUE / TVL</span><b>${(row.implied_value_usd / Math.max(1, row.tvl_usd) * 100).toFixed(1)}%</b></div></div>`;
    const steps = isLive ? '' : `<div class="detail-section-title"><b>Participation plan</b><span>LOW-RISK FIRST · NO PROMISE</span></div><ol class="farm-list">${row.farm_steps.map((s) => `<li><p>${esc(s)}</p></li>`).join('')}</ol><div class="detail-caveat">Illustrative research only. Use funds you can afford to lose, check the official site and eligibility, and never pay a fee to claim a reward.</div>`;
    $('detailPanel').innerHTML = `<div class="detail-head"><span>${isLive ? 'LIVE TOKEN REFERENCE' : `BOARD RANK ${String(row.rank).padStart(2, '0')}`}</span><button id="closeDetail" type="button" aria-label="Close details">×</button></div><div class="detail-identity"><span class="detail-glyph">${glyph(row.name)}</span><div><div class="detail-name">${esc(row.name)}</div><div class="detail-slug">${esc(row.slug)} · ${isLive ? esc(row.symbol || 'token recorded') : 'no token recorded'}</div></div></div><div class="detail-tags">${tags.map((t) => `<span class="detail-tag">${t}</span>`).join('')}</div><div class="detail-value"><div><span>${isLive ? 'RECORDED MARKET CAP' : 'IMPLIED VALUE · MODEL CLAIM'}</span><b>${isLive ? fmt(row.mcap_usd) : fmt(row.implied_value_usd)}</b></div><small>${isLive ? 'snapshot figure' : 'USD · not a price target'}</small></div>${modelStats}${steps}`;
    $('detailPanel').classList.add('open');
    $('detailPanel').setAttribute('aria-hidden', 'false');
    $('scrim').classList.add('open');
    $('closeDetail').addEventListener('click', closeDetail);
  }
  function closeDetail() { $('detailPanel').classList.remove('open'); $('detailPanel').setAttribute('aria-hidden', 'true'); $('scrim').classList.remove('open'); state.selected = null; }

  function setTab(tab) {
    state.tab = tab; state.page = 0; closeDetail();
    document.querySelectorAll('.view-tab').forEach((b) => { const active = b.dataset.tab === tab; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); });
    $('watchOnly').disabled = tab === 'live'; $('earlyOnly').disabled = tab === 'live';
    $('boardSubhead').textContent = tab === 'live' ? 'Market-cap references for protocols with a token recorded; excluded from the tokenless model.' : 'A relative signal from the same snapshot, not a market-cap target.';
    $('tableHead').innerHTML = tab === 'live' ? '<tr><th class="rank-col">VIEW</th><th>PROTOCOL</th><th>TVL</th><th>7D CHANGE</th><th class="value-col">RECORDED CAP</th><th class="open-col"></th></tr>' : '<tr><th class="rank-col">RANK</th><th>PROTOCOL</th><th>TVL</th><th>7D CHANGE</th><th class="value-col">IMPLIED VALUE</th><th class="open-col"></th></tr>';
    renderRows();
  }

  function wire() {
    $('snapshotDate').textContent = data.as_of;
    $('sourceStamp').textContent = `DATA DATE ${data.as_of}`;
    $('footerDate').textContent = data.as_of;
    $('watchCount').textContent = String(data.watchlist_size).padStart(2, '0');
    $('watchCountSmall').textContent = data.watchlist_size;
    $('earlyCount').textContent = data.early_size;
    $('liveCount').textContent = data.live_size;
    $('liveTabCount').textContent = data.live_size;
    $('modelVersion').textContent = data.model_version;
    $('floorStamp').textContent = fmt(data.floor_usd) + ' FLOOR';
    fillSelects();
    $('searchInput').addEventListener('input', (e) => { state.query = e.target.value; state.page = 0; renderRows(); });
    $('categorySelect').addEventListener('change', (e) => { state.category = e.target.value; state.page = 0; renderRows(); });
    $('chainSelect').addEventListener('change', (e) => { state.chain = e.target.value; state.page = 0; renderRows(); });
    $('sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 0; renderRows(); });
    $('watchOnly').addEventListener('change', (e) => { state.watchOnly = e.target.checked; state.page = 0; renderRows(); });
    $('earlyOnly').addEventListener('change', (e) => { state.earlyOnly = e.target.checked; state.page = 0; renderRows(); });
    $('prevPage').addEventListener('click', () => { state.page--; renderRows(); });
    $('nextPage').addEventListener('click', () => { state.page++; renderRows(); });
    $('resetFilters').addEventListener('click', () => { state.query = ''; state.category = 'All sectors'; state.chain = 'All chains'; state.watchOnly = false; state.earlyOnly = true; state.sort = 'value'; state.page = 0; $('searchInput').value = ''; $('categorySelect').value = state.category; $('chainSelect').value = state.chain; $('watchOnly').checked = false; $('earlyOnly').checked = true; $('sortSelect').value = 'value'; renderRows(); });
    document.querySelectorAll('.view-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('scrim').addEventListener('click', closeDetail);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDetail(); closeMethod(); } });
    $('methodToggle').addEventListener('click', openMethod);
    $('methodCard').addEventListener('click', openMethod);
    $('closeMethod').addEventListener('click', closeMethod);
    const params = new URLSearchParams(location.search);
    const category = params.get('category');
    if (category) { state.category = category; $('categorySelect').value = category; }
    renderRows();
    const detail = params.get('detail');
    if (detail) openDetail(detail);
  }
  function openMethod() { $('methodPanel').hidden = false; $('methodPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function closeMethod() { $('methodPanel').hidden = true; }
  wire();
})();
