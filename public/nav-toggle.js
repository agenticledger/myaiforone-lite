/* Work / AI Gym compact toggle — auto-injected into topbar on non-home2 pages */
(function() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const tabGroup = topbar.querySelector('.tab-group');
  if (!tabGroup) return;

  // Determine current mode from URL
  const isGym = /^\/(gym)/.test(location.pathname) || new URLSearchParams(location.search).get('mode') === 'coach';

  // Create compact toggle
  const toggle = document.createElement('div');
  toggle.className = 'nav-mode-toggle';
  toggle.innerHTML =
    '<a class="nav-mode-btn' + (isGym ? '' : ' active') + '" href="/">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
      'Work</a>' +
    '<a class="nav-mode-btn' + (isGym ? ' active' : '') + '" href="/?mode=coach">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="4" x2="20" y2="4"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/></svg>' +
      'AI Gym</a>';

  // Insert after tab-group
  tabGroup.after(toggle);

  // Inject styles
  const style = document.createElement('style');
  style.textContent =
    '.nav-mode-toggle{display:flex;background:var(--bg-input);border-radius:7px;padding:2px;gap:1px;border:1px solid var(--border-dim);margin-left:auto;flex-shrink:0}' +
    '.nav-mode-btn{font-family:var(--font-display,system-ui);font-size:11px;font-weight:700;padding:4px 12px;border-radius:5px;border:none;cursor:pointer;background:transparent;color:var(--text-muted);transition:all .2s;letter-spacing:.02em;display:flex;align-items:center;gap:4px;text-decoration:none;white-space:nowrap}' +
    '.nav-mode-btn svg{width:12px;height:12px;flex-shrink:0}' +
    '.nav-mode-btn.active{background:var(--accent);color:#000}' +
    '.nav-mode-btn:hover:not(.active){color:var(--text-secondary)}';
  document.head.appendChild(style);
})();
