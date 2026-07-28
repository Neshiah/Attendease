const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  theme: localStorage.getItem('theme') || 'light',
  active: 'dashboard',
  editingStudent: null,
  editingEvent: null,
  editingUser: null,
  editingPost: null,
  editingOfficer: null,
};

const app = document.querySelector('#app');
document.documentElement.dataset.theme = state.theme;
let activeRequests = 0;
let contentAnimationFrame = null;
const isAdminLoginPage = window.location.pathname.startsWith('/admin-login');
const isStudentLoginPage = window.location.pathname.startsWith('/student-login') || window.location.pathname === '/';
const isRegisterPage = window.location.pathname.startsWith('/student-register');
const isAdminForgotPasswordPage = window.location.pathname.startsWith('/admin-forgot-password');
const isStudentForgotPasswordPage = window.location.pathname.startsWith('/student-forgot-password')
  || window.location.pathname.startsWith('/forgot-password');
const isForgotPasswordPage = isAdminForgotPasswordPage || isStudentForgotPasswordPage;
let cachedBranding = JSON.parse(localStorage.getItem('systemSettings') || 'null');

const navByRole = {
  student: [
    ['hub', 'Home'],
    ['officers', 'Officers'],
    ['events', 'Events'],
    ['scan', 'Scan QR'],
    ['feedback', 'Feedback'],
    ['wallet', 'Points Wallet'],
    ['redeem', 'Redeem Printing'],
    ['history', 'Redemption History'],
    ['notifications', 'Notifications'],
    ['profile', 'Profile'],
  ],
  admin: [
    ['dashboard', 'Dashboard'],
    ['hub', 'Information Hub'],
    ['officers', 'Officers'],
    ['students', 'Manage Students'],
    ['eventsAdmin', 'Manage Events'],
    ['qr', 'Generate QR'],
    ['attendance', 'Attendance Records'],
    ['feedbackAdmin', 'Feedback Results'],
    ['points', 'Points Management'],
    ['printing', 'Printing Requests'],
    ['reports', 'Reports'],
    ['users', 'User Management'],
    ['settings', 'Settings'],
    ['profile', 'Profile'],
  ],
  organizer: [
    ['dashboard', 'Dashboard'],
    ['hub', 'Information Hub'],
    ['officers', 'Officers'],
    ['eventsAdmin', 'Assigned Events'],
    ['attendance', 'Attendance Records'],
    ['feedbackAdmin', 'Feedback Results'],
    ['reports', 'Reports'],
    ['profile', 'Profile'],
  ],
  printing_staff: [
    ['dashboard', 'Dashboard'],
    ['hub', 'Information Hub'],
    ['officers', 'Officers'],
    ['students', 'Search Students'],
    ['printing', 'Printing Requests'],
    ['reportsPrinting', 'Printing Report'],
    ['profile', 'Profile'],
  ],
};

const navShortLabels = {
  dashboard: 'Home',
  hub: 'Hub',
  officers: 'Team',
  events: 'Events',
  scan: 'Scan',
  feedback: 'Feedback',
  wallet: 'Wallet',
  redeem: 'Redeem',
  history: 'History',
  notifications: 'Alerts',
  profile: 'Profile',
};

function navIcon(key, label) {
  const icons = {
    dashboard: 'HM',
    hub: 'HB',
    officers: 'OF',
    events: 'EV',
    eventsAdmin: 'EV',
    scan: 'QR',
    feedback: 'FB',
    feedbackAdmin: 'FB',
    wallet: 'PT',
    redeem: 'PR',
    history: 'HS',
    notifications: 'NT',
    profile: 'ME',
    students: 'ST',
    qr: 'QR',
    attendance: 'AT',
    points: 'PT',
    printing: 'PX',
    reports: 'RP',
    reportsPrinting: 'RP',
    users: 'US',
    settings: 'SE',
  };
  const icon = label === 'Home' ? 'HM' : (icons[key] || (navShortLabels[key] || label).slice(0, 2));
  return `<span class="nav-icon" aria-hidden="true">${esc(icon)}</span>`;
}

function saveSession(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
}

function logout() {
  const wasStudent = state.user?.role === 'student';
  localStorage.clear();
  localStorage.setItem('theme', state.theme);
  state.token = null;
  state.user = null;
  window.location.href = wasStudent ? '/' : '/admin-login';
}

function ensureGlobalProgress() {
  let progress = document.querySelector('#networkProgress');
  if (progress) return progress;
  progress = document.createElement('div');
  progress.id = 'networkProgress';
  progress.className = 'network-progress';
  progress.setAttribute('aria-hidden', 'true');
  progress.innerHTML = '<span></span>';
  document.body.appendChild(progress);
  return progress;
}

function requestActionButton() {
  const focused = document.activeElement;
  const button = focused?.closest?.('button');
  if (button && !button.matches('.nav-btn, .nav-toggle, .theme-toggle, .auth-theme-toggle, .profile-pill')) {
    return button;
  }
  return focused?.closest?.('form')?.querySelector('button[type="submit"]') || null;
}

function beginRequest() {
  activeRequests += 1;
  ensureGlobalProgress();
  document.body.classList.remove('network-complete');
  document.body.classList.add('network-busy');
  const button = requestActionButton();
  if (button) {
    const requestCount = Number(button.dataset.requestCount || 0);
    if (!requestCount) button.dataset.wasDisabled = String(button.disabled);
    button.dataset.requestCount = String(requestCount + 1);
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
  }
  return button;
}

function endRequest(button) {
  activeRequests = Math.max(0, activeRequests - 1);
  if (button?.isConnected) {
    const requestCount = Math.max(0, Number(button.dataset.requestCount || 1) - 1);
    button.dataset.requestCount = String(requestCount);
    if (!requestCount) {
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      button.disabled = button.dataset.wasDisabled === 'true';
      delete button.dataset.requestCount;
      delete button.dataset.wasDisabled;
    }
  }
  if (!activeRequests) {
    document.body.classList.remove('network-busy');
    document.body.classList.add('network-complete');
    window.setTimeout(() => document.body.classList.remove('network-complete'), 280);
  }
}

async function api(path, options = {}) {
  const actionButton = beginRequest();
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.message || 'Request failed.');
    return data;
  } finally {
    endRequest(actionButton);
  }
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function confirmAction(message, title = 'Confirm action') {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="dialog-card">
        <span class="dialog-kicker">Please confirm</span>
        <h2>${esc(title)}</h2>
        <p>${esc(message)}</p>
        <div class="actions">
          <button type="submit" class="secondary" value="cancel">Cancel</button>
          <button type="submit" class="danger" value="confirm">Continue</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    }, { once: true });
    dialog.showModal();
  });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

function badge(value) {
  return `<span class="badge ${esc(value)}">${esc(value)}</span>`;
}

function personInitials(name = 'User') {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase() || 'U';
}

function loadingSkeleton(label = 'Loading your workspace') {
  return `
    <div class="skeleton-page" role="status" aria-live="polite" aria-label="${esc(label)}">
      <div class="skeleton-status">
        <span class="loading-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>${esc(label)}</span>
      </div>
      <div class="skeleton skeleton-heading"></div>
      <div class="skeleton-grid">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
      <div class="skeleton skeleton-panel"></div>
    </div>
  `;
}

function metricCard(label, value, note, tone = '') {
  return `
    <article class="metric-card ${tone}">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
      <small>${esc(note)}</small>
    </article>
  `;
}

function pageHeader(title, subtitle, action = '') {
  return `
    <div class="page-head">
      <div>
        <span class="page-kicker">${esc(state.user?.role || 'system')}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(subtitle)}</p>
      </div>
      ${action ? `<div class="page-action">${action}</div>` : ''}
    </div>
  `;
}

function searchBox(placeholder = 'Search records') {
  return `
    <div class="list-controls">
      <label class="search-box">Search <input id="searchInput" placeholder="${esc(placeholder)}" autocomplete="off" /></label>
      <label class="sort-box">Sort
        <select id="sortSelect">
          <option value="">Default</option>
          <option value="alpha-asc">Alphabetical A-Z</option>
          <option value="alpha-desc">Alphabetical Z-A</option>
          <option value="date-desc">Newest Date</option>
          <option value="date-asc">Oldest Date</option>
        </select>
      </label>
    </div>
  `;
}

function bindSearch() {
  const input = document.querySelector('#searchInput');
  const sort = document.querySelector('#sortSelect');
  const paginatedList = document.querySelector('[data-paginate="true"]');
  const pageSize = Number(paginatedList?.dataset.pageSize || 6);
  let currentPage = 1;

  const allRows = () => Array.from(
    paginatedList?.querySelectorAll('[data-search-row]')
      || document.querySelectorAll('[data-search-row]'),
  );

  const renderPagination = () => {
    const rows = allRows();
    const query = input?.value.toLowerCase().trim() || '';
    const matching = rows.filter((row) => !query || row.dataset.searchRow.includes(query));
    const pages = Math.max(1, Math.ceil(matching.length / pageSize));
    currentPage = Math.min(currentPage, pages);

    rows.forEach((row) => row.classList.add('hidden'));
    if (paginatedList) {
      matching.slice((currentPage - 1) * pageSize, currentPage * pageSize)
        .forEach((row) => row.classList.remove('hidden'));
    } else {
      matching.forEach((row) => row.classList.remove('hidden'));
    }

    if (!paginatedList) return;
    let pager = paginatedList.parentElement.querySelector('.pagination');
    if (!pager) {
      pager = document.createElement('nav');
      pager.className = 'pagination';
      pager.setAttribute('aria-label', 'List pagination');
      paginatedList.insertAdjacentElement('afterend', pager);
    }
    pager.innerHTML = `
      <button class="secondary" type="button" data-page="prev" aria-label="Previous page" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page <strong>${currentPage}</strong> of ${pages} <small>${matching.length} records</small></span>
      <button class="secondary" type="button" data-page="next" aria-label="Next page" ${currentPage === pages ? 'disabled' : ''}>Next</button>
    `;
    pager.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
      currentPage -= 1;
      renderPagination();
    });
    pager.querySelector('[data-page="next"]')?.addEventListener('click', () => {
      currentPage += 1;
      renderPagination();
    });
  };

  const applySearch = () => {
    currentPage = 1;
    renderPagination();
  };
  const applySort = () => {
    if (!sort?.value) return;
    const rows = allRows();
    if (!rows.length) return;
    const parent = rows[0].parentElement;
    const value = sort.value;
    rows.sort((a, b) => {
      if (value.startsWith('date')) {
        const dateA = sortableDate(a);
        const dateB = sortableDate(b);
        return value.endsWith('asc') ? dateA - dateB : dateB - dateA;
      }
      const textA = sortableText(a);
      const textB = sortableText(b);
      return value.endsWith('asc') ? textA.localeCompare(textB) : textB.localeCompare(textA);
    });
    rows.forEach((row) => parent.appendChild(row));
    currentPage = 1;
    renderPagination();
  };
  input?.addEventListener('input', applySearch);
  sort?.addEventListener('change', applySort);
  renderPagination();
}

function sortableText(row) {
  return (row.querySelector('h3')?.textContent || row.dataset.searchRow || row.textContent || '').trim().toLowerCase();
}

function sortableDate(row) {
  const text = `${row.dataset.sortDate || ''} ${row.textContent || ''}`;
  const match = text.match(/\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/);
  const value = match ? Date.parse(match[0]) : 0;
  return Number.isFinite(value) ? value : 0;
}

function searchable(text) {
  return esc(String(text ?? '').toLowerCase());
}

function downloadCsv(filename, rows) {
  if (!rows.length) {
    toast('No rows to export.');
    return;
  }
  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindCsvExport(rows, filename) {
  document.querySelector('[data-export-csv]')?.addEventListener('click', () => downloadCsv(filename, rows));
}

function option(value, label, selected) {
  return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
}

function courseSelect(selected = 'BSIT') {
  return `
    <select name="course" required>
      ${option('BSIT', 'BSIT', selected)}
      ${option('BSED', 'BSED', selected)}
      ${option('BSA', 'BSA', selected)}
      ${option('BTLED', 'BTLED', selected)}
    </select>
  `;
}

function yearSelect(selected = '1') {
  return `
    <select name="year_level" required>
      ${option('1', '1', String(selected))}
      ${option('2', '2', String(selected))}
      ${option('3', '3', String(selected))}
      ${option('4', '4', String(selected))}
    </select>
  `;
}

function sectionSelect(selected = 'A') {
  return `
    <select name="section" required>
      ${option('A', 'A', selected)}
      ${option('B', 'B', selected)}
      ${option('C', 'C', selected)}
      ${option('D', 'D', selected)}
    </select>
  `;
}

function resetEditing() {
  state.editingStudent = null;
  state.editingEvent = null;
  state.editingUser = null;
}

function enhancePasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.querySelector(button.dataset.togglePassword);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Show' : 'Hide';
      button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

function brandLogo(mark = 'AR', size = 'brand') {
  const logo = cachedBranding?.logo_data;
  if (logo) {
    const className = size === 'dot' ? 'brand-dot logo-img' : 'brand-mark logo-img';
    return `<img class="${className}" src="${logo}" alt="${esc(cachedBranding?.app_name || 'System logo')}" />`;
  }
  return size === 'dot'
    ? `<span class="brand-dot">${esc(mark)}</span>`
    : `<div class="brand-mark">${esc(mark)}</div>`;
}

async function renderLogin() {
  try {
    cachedBranding = await api('/public-settings');
    localStorage.setItem('systemSettings', JSON.stringify(cachedBranding));
  } catch (error) {
    cachedBranding = cachedBranding || null;
  }
  const mode = isAdminLoginPage ? 'admin' : 'student';
  const title = mode === 'admin' ? 'Admin / Staff Login' : 'Student Login';
  const portalTitle = mode === 'admin' ? 'Staff Operations Portal' : 'Student Rewards Portal';
  const brandTitle = mode === 'admin' ? 'Admin / Staff Access' : 'Student Attendance Rewards';
  const description = mode === 'admin'
    ? 'OSA staff, organizers, faculty, and printing staff can manage attendance, feedback, points, reports, and printing requests.'
    : 'Students can view events, submit attendance, answer feedback, earn points, and redeem free printing.';
  const loginLabel = mode === 'admin' ? 'Email Address' : 'Student ID or Email';
  const hint = mode === 'admin' ? 'Use your assigned admin, organizer, faculty, or printing staff account.' : 'Use your student ID or registered Gmail account.';
  const extraLinks = mode === 'student'
    ? '<a href="/student-register">Student QR Registration</a> | <a href="/student-forgot-password">Forgot Password?</a>'
    : '<a href="/admin-forgot-password">Forgot Password?</a>';
  const featureList = mode === 'admin'
    ? ['Manage events and QR codes', 'Review reports and redemptions', 'Control system settings']
    : ['Scan event QR attendance', 'Answer feedback forms', 'Redeem points for printing'];

  app.innerHTML = `
    <section class="auth-shell auth-${mode}">
      <button class="auth-theme-toggle secondary" id="authThemeToggle" type="button" aria-label="Switch color theme" title="Switch color theme">
        <span class="theme-icon" aria-hidden="true"></span>
      </button>
      <div class="brand">
        ${brandLogo('AR')}
        <span class="auth-eyebrow">${esc(cachedBranding?.school_name || 'Campus OSA')}</span>
        <h1>${esc(brandTitle)}</h1>
        <p>${description}</p>
        <div class="auth-feature-list">
          ${featureList.map((item) => `<span>${esc(item)}</span>`).join('')}
        </div>
      </div>
      <form id="loginForm" class="panel">
        <span class="auth-form-kicker">${mode === 'admin' ? 'Admin / Staff only' : 'Students only'}</span>
        <h2>${title}</h2>
        <p class="auth-subtitle">${esc(portalTitle)}</p>
        <label>${loginLabel} <input id="login" required /></label>
        <label>Password
          <span class="password-control">
            <input id="password" type="password" required />
            <button type="button" class="mini-button" data-toggle-password="#password" aria-label="Show password">Show</button>
          </span>
        </label>
        <button type="submit">Sign in</button>
        <p class="hint">${hint}</p>
        <p class="hint">${extraLinks}</p>
      </form>
    </section>
  `;
  document.querySelector('#authThemeToggle').addEventListener('click', toggleTheme);
  enhancePasswordToggles();
  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          login: document.querySelector('#login').value.trim(),
          password: document.querySelector('#password').value,
        }),
      });
      if (mode === 'student' && data.user.role !== 'student') {
        localStorage.clear();
        toast('Please use the Admin / Staff Login page.');
        return;
      }
      if (mode === 'admin' && data.user.role === 'student') {
        localStorage.clear();
        toast('Please use the Student Login page.');
        return;
      }
      if (data.settings) {
        cachedBranding = data.settings;
        localStorage.setItem('systemSettings', JSON.stringify(data.settings));
      }
      saveSession(data);
      state.active = data.user.role === 'student' ? 'hub' : 'dashboard';
      renderShell();
    } catch (error) {
      toast(error.message);
    }
  });
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  document.documentElement.dataset.theme = state.theme;
}

function renderForgotPassword() {
  const mode = isAdminForgotPasswordPage ? 'admin' : 'student';
  const accountType = mode === 'admin' ? 'staff' : 'student';
  const title = mode === 'admin' ? 'Admin / Staff Password Recovery' : 'Student Password Recovery';
  const description = mode === 'admin'
    ? 'Recover only an active admin, organizer, faculty, or printing staff account.'
    : 'Recover only an active student account using its registered email.';
  const backUrl = mode === 'admin' ? '/admin-login' : '/';
  const backLabel = mode === 'admin' ? 'Back to Admin / Staff Login' : 'Back to Student Login';
  app.innerHTML = `
    <section class="auth-shell auth-${mode} auth-reset">
      <button class="auth-theme-toggle secondary" id="authThemeToggle" type="button" aria-label="Switch color theme" title="Switch color theme">
        <span class="theme-icon" aria-hidden="true"></span>
      </button>
      <div class="brand">
        ${brandLogo(mode === 'admin' ? 'AS' : 'ST')}
        <span class="auth-eyebrow">${mode === 'admin' ? 'Staff account recovery' : 'Student account recovery'}</span>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <form id="forgotForm" class="panel">
        <span class="auth-form-kicker">${mode === 'admin' ? 'Admin / Staff only' : 'Students only'}</span>
        <h2>Reset Password</h2>
        <p class="auth-subtitle">A six-digit code will be sent to your registered email.</p>
        <label>Registered Email <input id="resetEmail" type="email" autocomplete="email" required /></label>
        <button type="button" id="sendResetCode">Send Code</button>
        <p class="hint reset-code-note" id="resetCodeHint">The reset code expires after 15 minutes.</p>
        <label>Verification Code <input id="resetCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /></label>
        <label>New Password
          <span class="password-control">
            <input id="newPassword" type="password" autocomplete="new-password" required minlength="6" />
            <button type="button" class="mini-button" data-toggle-password="#newPassword" aria-label="Show password">Show</button>
          </span>
        </label>
        <button type="submit">Update Password</button>
        <p class="hint"><a href="${backUrl}">${backLabel}</a></p>
      </form>
    </section>
  `;
  document.querySelector('#authThemeToggle').addEventListener('click', toggleTheme);
  enhancePasswordToggles();
  document.querySelector('#sendResetCode').addEventListener('click', async () => {
    try {
      const data = await api('/password/forgot', {
        method: 'POST',
        body: JSON.stringify({
          email: document.querySelector('#resetEmail').value.trim().toLowerCase(),
          account_type: accountType,
        }),
      });
      if (data.dev_code) {
        document.querySelector('#resetCode').value = data.dev_code;
        document.querySelector('#resetCodeHint').innerHTML = `Testing code: <strong>${esc(data.dev_code)}</strong>`;
      } else {
        document.querySelector('#resetCodeHint').textContent = data.message;
      }
      toast(data.dev_code ? `Reset code: ${data.dev_code}` : data.message);
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#forgotForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          email: document.querySelector('#resetEmail').value.trim().toLowerCase(),
          code: document.querySelector('#resetCode').value.trim(),
          password: document.querySelector('#newPassword').value,
          account_type: accountType,
        }),
      });
      toast('Password updated. Please login.');
      setTimeout(() => window.location.href = backUrl, 900);
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderStudentRegistration() {
  app.innerHTML = `
    <section class="auth-shell register-shell">
      <button class="auth-theme-toggle secondary" id="authThemeToggle" type="button" aria-label="Switch color theme" title="Switch color theme">
        <span class="theme-icon" aria-hidden="true"></span>
      </button>
      <div class="brand">
        <div class="brand-mark">QR</div>
        <h1>Student Self Registration</h1>
        <p>Verify your Gmail, scan your face using the camera, then submit your student information.</p>
      </div>
      <form id="registerForm" class="panel">
        <h2>Register Student Account</h2>
        <div class="grid two">
          <label>Full Name <input name="name" required /></label>
          <label>Gmail <input id="regEmail" name="email" type="email" required /></label>
          <label>Student ID <input name="student_no" required /></label>
          <label>Password
            <span class="password-control">
              <input id="regPassword" name="password" type="password" required minlength="6" />
              <button type="button" class="mini-button" data-toggle-password="#regPassword">Show</button>
            </span>
          </label>
          <label>Course ${courseSelect('BSIT')}</label>
          <label>Year Level ${yearSelect('1')}</label>
          <label>Section ${sectionSelect('A')}</label>
          <label>Contact Number <input name="contact_no" /></label>
        </div>
        <div class="actions">
          <button type="button" id="sendRegCode">Send Gmail Code</button>
          <label class="inline-field">Verification Code <input name="email_code" required /></label>
        </div>
        <div class="camera-box liveness-checker">
          <div class="liveness-heading">
            <div>
              <span class="eyebrow">Identity verification</span>
              <h3>AI-assisted liveness check</h3>
            </div>
            <span class="ai-status-chip" id="aiStatusChip">AI model idle</span>
          </div>
          <div class="face-frame" id="faceFrame">
            <video id="faceVideo" autoplay muted playsinline></video>
            <img id="facePreview" class="hidden" alt="Verified student face preview" />
            <span class="face-guide" aria-hidden="true"></span>
            <div class="camera-placeholder" id="cameraPlaceholder">
              <span class="camera-placeholder-icon" aria-hidden="true"></span>
              <strong>Camera is off</strong>
              <small>Your live camera stays on this device during the check.</small>
            </div>
            <span class="face-quality-badge" id="faceQualityBadge">Waiting for camera</span>
          </div>
          <canvas id="faceCanvas" class="hidden"></canvas>
          <input type="hidden" name="face_data" id="faceData" />
          <input type="hidden" name="liveness_passed" id="livenessPassed" />
          <input type="hidden" name="liveness_method" value="mediapipe_face_landmarker_v1" />
          <div class="liveness-card" aria-live="polite">
            <div class="liveness-steps" aria-label="Liveness check progress">
              <div class="liveness-step" data-liveness-step="position">
                <span>1</span>
                <small>Position</small>
              </div>
              <div class="liveness-step" data-liveness-step="challenge">
                <span>2</span>
                <small>Actions</small>
              </div>
              <div class="liveness-step" data-liveness-step="verified">
                <span>3</span>
                <small>Verified</small>
              </div>
            </div>
            <div class="liveness-progress" aria-hidden="true"><span id="livenessProgress"></span></div>
            <strong id="livenessPrompt">Ready for your secure face check</strong>
            <span id="livenessDetail">Start the camera, keep one face inside the guide, and follow the on-screen actions.</span>
          </div>
          <div class="actions">
            <button type="button" id="startCamera">Start AI Check</button>
            <button type="button" class="secondary" id="retryLiveness" disabled>Retry</button>
          </div>
          <div class="liveness-trust">
            <span>One face required</span>
            <span>Random motion prompts</span>
            <span>Processed on device</span>
          </div>
          <p class="hint" id="faceStatus">A live face check is required. A saved photo cannot complete this step.</p>
        </div>
        <button type="submit">Submit Registration</button>
        <p class="hint"><a href="/">Back to Student Login</a></p>
      </form>
    </section>
  `;
  document.querySelector('#authThemeToggle').addEventListener('click', toggleTheme);
  enhancePasswordToggles();
  let stream = null;
  let landmarker = null;
  let animationFrame = null;
  let checkSession = null;
  const video = document.querySelector('#faceVideo');
  const startButton = document.querySelector('#startCamera');
  const retryButton = document.querySelector('#retryLiveness');
  const faceFrame = document.querySelector('#faceFrame');
  const aiStatusChip = document.querySelector('#aiStatusChip');
  const faceQualityBadge = document.querySelector('#faceQualityBadge');
  const progressBar = document.querySelector('#livenessProgress');
  const prompt = document.querySelector('#livenessPrompt');
  const detail = document.querySelector('#livenessDetail');
  const status = document.querySelector('#faceStatus');

  const setStep = (step, progress = 0) => {
    const order = ['position', 'challenge', 'verified'];
    const activeIndex = order.indexOf(step);
    document.querySelectorAll('[data-liveness-step]').forEach((element, index) => {
      element.classList.toggle('active', index === activeIndex);
      element.classList.toggle('complete', index < activeIndex || step === 'verified');
    });
    progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  };

  const stopCamera = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  };

  const resetLiveness = () => {
    stopCamera();
    checkSession = null;
    document.querySelector('#faceData').value = '';
    document.querySelector('#livenessPassed').value = '';
    document.querySelector('#facePreview').classList.add('hidden');
    video.classList.remove('hidden');
    document.querySelector('#cameraPlaceholder').classList.remove('hidden');
    faceFrame.classList.remove('camera-active', 'face-ready', 'verified', 'face-warning');
    aiStatusChip.className = 'ai-status-chip';
    aiStatusChip.textContent = 'AI model idle';
    faceQualityBadge.textContent = 'Waiting for camera';
    prompt.textContent = 'Ready for your secure face check';
    detail.textContent = 'Start the camera, keep one face inside the guide, and follow the on-screen actions.';
    status.textContent = 'A live face check is required. A saved photo cannot complete this step.';
    startButton.disabled = false;
    startButton.textContent = 'Start AI Check';
    retryButton.disabled = true;
    setStep('position', 0);
  };

  const finishLiveness = () => {
    const canvas = document.querySelector('#faceCanvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const faceData = canvas.toDataURL('image/jpeg', 0.86);
    document.querySelector('#faceData').value = faceData;
    document.querySelector('#livenessPassed').value = 'true';
    const preview = document.querySelector('#facePreview');
    preview.src = faceData;
    preview.classList.remove('hidden');
    video.classList.add('hidden');
    document.querySelector('#cameraPlaceholder').classList.add('hidden');
    faceFrame.classList.remove('face-warning');
    faceFrame.classList.add('verified');
    aiStatusChip.className = 'ai-status-chip success';
    aiStatusChip.textContent = 'AI check passed';
    faceQualityBadge.textContent = 'Live face verified';
    prompt.textContent = 'Identity check complete';
    detail.textContent = 'Your centered profile photo was captured after the live motion challenges.';
    status.textContent = 'Liveness passed. You can now submit your registration.';
    startButton.disabled = true;
    startButton.textContent = 'Verified';
    retryButton.disabled = false;
    setStep('verified', 100);
    stopCamera();
  };

  const failLiveness = (message) => {
    stopCamera();
    checkSession = null;
    faceFrame.classList.remove('camera-active', 'face-ready');
    faceFrame.classList.add('face-warning');
    aiStatusChip.className = 'ai-status-chip error';
    aiStatusChip.textContent = 'Check interrupted';
    faceQualityBadge.textContent = 'Try again';
    prompt.textContent = 'Liveness check was not completed';
    detail.textContent = message;
    status.textContent = message;
    startButton.disabled = false;
    startButton.textContent = 'Try Again';
    retryButton.disabled = false;
  };

  const runFrameCheck = () => {
    if (!checkSession || !stream || video.readyState < 2) return;
    const now = performance.now();
    if (now - checkSession.startedAt > 30000) {
      failLiveness('The check timed out. Improve the lighting, keep your face centered, and retry.');
      return;
    }
    if (now - checkSession.lastScan < 90 || video.currentTime === checkSession.lastVideoTime) {
      animationFrame = requestAnimationFrame(runFrameCheck);
      return;
    }
    checkSession.lastScan = now;
    checkSession.lastVideoTime = video.currentTime;
    try {
      const result = landmarker.detectForVideo(video, now);
      const metrics = getLivenessMetrics(result);
      advanceLivenessSession(checkSession, metrics, {
        faceFrame,
        faceQualityBadge,
        prompt,
        detail,
        setStep,
        finish: finishLiveness,
      });
    } catch (error) {
      failLiveness('The AI face model stopped unexpectedly. Please retry the check.');
      return;
    }
    if (checkSession) animationFrame = requestAnimationFrame(runFrameCheck);
  };

  const startLiveness = async () => {
    resetLiveness();
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      failLiveness('Camera access requires the secure HTTPS website.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      failLiveness('This browser does not support live camera access. Use the latest Chrome, Edge, or Safari.');
      return;
    }
    startButton.disabled = true;
    startButton.textContent = 'Loading AI...';
    aiStatusChip.className = 'ai-status-chip loading';
    aiStatusChip.textContent = 'Loading AI model';
    prompt.textContent = 'Preparing secure face detection';
    detail.textContent = 'Please allow camera access when your browser asks.';
    status.textContent = 'Loading the on-device face landmark model...';
    try {
      const modelPromise = loadFaceLandmarker().then((model) => {
        aiStatusChip.className = 'ai-status-chip active';
        aiStatusChip.textContent = 'AI model ready';
        status.textContent = 'AI is ready. Waiting for camera permission...';
        return model;
      });
      const cameraPromise = navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        }).then((cameraStream) => {
          prompt.textContent = 'Starting your camera';
          detail.textContent = 'Keep this page open and place your face inside the guide.';
          return cameraStream;
        });
      [landmarker, stream] = await Promise.all([modelPromise, cameraPromise]);
      video.srcObject = stream;
      await video.play();
      document.querySelector('#cameraPlaceholder').classList.add('hidden');
      faceFrame.classList.add('camera-active');
      aiStatusChip.className = 'ai-status-chip active';
      aiStatusChip.textContent = 'AI analyzing';
      faceQualityBadge.textContent = 'Find your face';
      prompt.textContent = 'Center your face';
      detail.textContent = 'Look straight ahead and hold still inside the oval guide.';
      status.textContent = 'The check will start automatically when exactly one face is centered.';
      startButton.textContent = 'Checking...';
      retryButton.disabled = false;
      checkSession = createLivenessSession();
      setStep('position', 8);
      animationFrame = requestAnimationFrame(runFrameCheck);
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'Camera permission was blocked. Allow camera access in your browser settings, then retry.'
        : error?.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'The AI model or camera could not start. Check your connection and camera permission, then retry.';
      failLiveness(message);
    }
  };

  document.querySelector('#sendRegCode').addEventListener('click', async () => {
    try {
      const data = await api('/registration/send-code', {
        method: 'POST',
        body: JSON.stringify({ email: document.querySelector('#regEmail').value.trim() }),
      });
      toast(data.dev_code ? `Verification code: ${data.dev_code}` : data.message);
    } catch (error) {
      toast(error.message);
    }
  });
  startButton.addEventListener('click', startLiveness);
  retryButton.addEventListener('click', startLiveness);
  document.querySelector('#registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      if (document.querySelector('#livenessPassed').value !== 'true' || !document.querySelector('#faceData').value) {
        throw new Error('Complete the AI-assisted liveness check before submitting.');
      }
      const data = formData(event.currentTarget);
      await api('/registration/student', { method: 'POST', body: JSON.stringify(data) });
      stopCamera();
      toast('Registration saved. You can now login.');
      setTimeout(() => window.location.href = '/', 1000);
    } catch (error) {
      toast(error.message);
    }
  });
  window.addEventListener('pagehide', stopCamera, { once: true });
  setStep('position', 0);
}

function renderShell() {
  const items = navByRole[state.user.role] || navByRole.student;
  if (!items.some(([key]) => key === state.active)) {
    state.active = state.user.role === 'student' ? 'hub' : 'dashboard';
  }
  app.innerHTML = `
    <section class="app-shell role-${esc(state.user.role)} ${state.user.role === 'student' ? 'student-app-shell' : ''}">
      <header class="topbar">
        <div class="topbar-brand">
          <button class="nav-toggle" id="navToggle" type="button" aria-label="Open navigation" aria-expanded="false">
            <span></span><span></span><span></span>
          </button>
          <h1>${brandLogo('AR', 'dot')} <span>${esc(cachedBranding?.app_name || 'Student Attendance Rewards')}</span></h1>
        </div>
        <div class="topbar-actions">
          ${state.user.role === 'student' ? '<span class="points-chip" id="topPointsChip">0 pts</span>' : ''}
          <button class="theme-toggle secondary" id="themeToggle" type="button" aria-label="Switch color theme" title="Switch color theme">
            <span class="theme-icon" aria-hidden="true"></span>
          </button>
          <div class="profile-menu">
            <button class="profile-pill" id="profileMenuButton" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="profile-avatar">${esc(personInitials(state.user.name))}</span>
              <span class="profile-copy">${esc(state.user.name)} <small>${esc(state.user.role)}</small></span>
              <span class="profile-chevron" aria-hidden="true"></span>
            </button>
            <div class="profile-dropdown hidden" id="profileDropdown" role="menu">
              <button type="button" data-profile-action="profile" role="menuitem">My Profile</button>
              ${state.user.role === 'admin' ? '<button type="button" data-profile-action="settings" role="menuitem">System Settings</button>' : ''}
              <button type="button" data-profile-action="logout" role="menuitem">Sign out</button>
            </div>
          </div>
        </div>
      </header>
      <div class="layout">
        <nav class="sidebar" id="mainNavigation" aria-label="Main navigation">
          ${items.map(([key, label]) => `<button class="nav-btn ${state.active === key ? 'active' : ''}" data-view="${key}" ${state.active === key ? 'aria-current="page"' : ''}>${navIcon(key, label)}<span>${esc(label)}</span></button>`).join('')}
        </nav>
        <div class="main-stage">
          <main class="content" id="content" tabindex="-1"></main>
          <footer class="app-footer">
            <span>${esc(cachedBranding?.app_name || 'Attendease')}</span>
            <span>Attendance, rewards, and student services</span>
          </footer>
        </div>
      </div>
      <button class="nav-scrim hidden" id="navScrim" type="button" aria-label="Close navigation"></button>
    </section>
  `;
  bindShellControls();
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      navigateToView(button.dataset.view);
    });
  });
  hydrateStudentTopPoints();
  renderView();
}

function closeShellNavigation() {
  const shell = document.querySelector('.app-shell');
  const navToggle = document.querySelector('#navToggle');
  const navScrim = document.querySelector('#navScrim');
  shell?.classList.remove('nav-open');
  navToggle?.setAttribute('aria-expanded', 'false');
  navScrim?.classList.add('hidden');
}

function navigateToView(view) {
  if (!view || view === state.active) {
    closeShellNavigation();
    return;
  }
  state.active = view;
  resetEditing();
  closeShellNavigation();
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelector('#profileDropdown')?.classList.add('hidden');
  document.querySelector('#profileMenuButton')?.setAttribute('aria-expanded', 'false');
  document.querySelector('.app-shell')?.classList.remove('profile-menu-open');
  renderView();
}

function bindShellControls() {
  const shell = document.querySelector('.app-shell');
  const navToggle = document.querySelector('#navToggle');
  const navScrim = document.querySelector('#navScrim');
  const profileButton = document.querySelector('#profileMenuButton');
  const profileDropdown = document.querySelector('#profileDropdown');

  const closeProfileMenu = () => {
    profileDropdown.classList.add('hidden');
    profileButton.setAttribute('aria-expanded', 'false');
    shell.classList.remove('profile-menu-open');
  };
  const closeNavigation = () => {
    closeShellNavigation();
  };
  navToggle.addEventListener('click', () => {
    const open = shell.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(open));
    navScrim.classList.toggle('hidden', !open);
  });
  navScrim.addEventListener('click', closeNavigation);

  document.querySelector('#themeToggle').addEventListener('click', toggleTheme);

  profileButton.addEventListener('click', () => {
    const closed = profileDropdown.classList.toggle('hidden');
    profileButton.setAttribute('aria-expanded', String(!closed));
    shell.classList.toggle('profile-menu-open', !closed);
  });
  document.querySelectorAll('[data-profile-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.profileAction;
      if (action === 'logout') return logout();
      closeProfileMenu();
      navigateToView(action);
    });
  });
  document.onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    closeNavigation();
    closeProfileMenu();
  };
  document.onclick = (event) => {
    if (event.target.closest('.profile-menu')) return;
    closeProfileMenu();
  };
}

async function hydrateStudentTopPoints() {
  if (state.user.role !== 'student' || !state.user.student_id) return;
  try {
    const balance = await api(`/points/balance/${state.user.student_id}`);
    const chip = document.querySelector('#topPointsChip');
    if (chip) chip.textContent = `${balance.balance} pts`;
  } catch (error) {
    const chip = document.querySelector('#topPointsChip');
    if (chip) chip.textContent = '0 pts';
  }
}

function setContent(html, options = {}) {
  const content = document.querySelector('#content');
  if (!content) return;
  const loading = Boolean(options.loading);
  content.innerHTML = html;
  content.classList.remove('is-entering', 'is-loading-view');
  content.classList.toggle('is-loading-view', loading);
  content.setAttribute('aria-busy', String(loading));
  if (loading || options.animate === false) return;
  if (contentAnimationFrame) cancelAnimationFrame(contentAnimationFrame);
  contentAnimationFrame = requestAnimationFrame(() => {
    content.classList.add('is-entering');
    contentAnimationFrame = null;
  });
}

async function renderView() {
  setContent(loadingSkeleton(), { loading: true, animate: false });
  try {
    const role = state.user.role;
    if (state.active === 'dashboard') return await renderDashboard();
    if (state.active === 'hub') return await renderInformationHub();
    if (state.active === 'officers') return await renderOfficers();
    if (state.active === 'profile') return await renderProfile();
    if (state.active === 'students') return await renderStudents();
    if (state.active === 'events') return await renderStudentEvents();
    if (state.active === 'eventsAdmin') return await renderAdminEvents();
    if (state.active === 'qr') return await renderQr();
    if (state.active === 'scan') return await renderScan();
    if (state.active === 'feedback') return await renderFeedbackForm();
    if (state.active === 'wallet') return await renderWallet();
    if (state.active === 'redeem') return await renderRedeem();
    if (state.active === 'history') return await renderHistory();
    if (state.active === 'notifications') return await renderNotifications();
    if (state.active === 'attendance') return await renderAttendanceReport();
    if (state.active === 'feedbackAdmin') return await renderFeedbackReport();
    if (state.active === 'points') return await renderPoints();
    if (state.active === 'printing') return await renderPrinting();
    if (state.active === 'reports') return await renderReports();
    if (state.active === 'reportsPrinting') return await renderPrintingReport();
    if (state.active === 'users') return await renderUsers();
    if (state.active === 'settings') return await renderSettings();
    setContent(`<div class="panel">No view found for ${esc(state.active)} / ${esc(role)}.</div>`);
  } catch (error) {
    setContent(`<div class="panel"><h2>Something went wrong</h2><p>${esc(error.message)}</p></div>`);
  }
}

async function renderDashboard() {
  if (state.user.role === 'student') {
    const [balance, events, posts, history] = await Promise.all([
      api(`/points/balance/${state.user.student_id}`),
      api('/events'),
      api('/hub/posts').catch(() => []),
      api('/printing/redemptions').catch(() => []),
    ]);
    setContent(`
      <section class="student-hero">
        <div>
          <span class="eyebrow">Hello</span>
          <h2>${esc(state.user.name)}</h2>
          <p>Track attendance, campus updates, rewards, and free printing in one place.</p>
        </div>
        <div class="hero-points">
          <span>Reward Points</span>
          <strong>${esc(balance.balance)}</strong>
          <small>${Math.floor(balance.balance / 10)} printable pages</small>
        </div>
      </section>
      <div class="grid three">
        ${metricCard('Points Balance', balance.balance, 'Available reward points', 'teal')}
        ${metricCard('Events', events.length, 'Upcoming and active events', 'blue')}
        ${metricCard('Print Credits', Math.floor(balance.balance / 10), 'Redeemable pages', 'gold')}
      </div>
      <div class="quick-actions">
        <button data-jump="events">View Events</button>
        <button data-jump="scan" class="secondary">Submit QR</button>
        <button data-jump="redeem" class="secondary">Redeem Printing</button>
      </div>
      <div class="toolbar dashboard-search">
        ${searchBox('Search dashboard posts, events, requests')}
      </div>
      <div class="dashboard-feed-layout">
        <section class="feed-column">
          <div class="feed-title">
            <h3>Information Feed</h3>
            <button class="secondary" data-jump="hub">Open Hub</button>
          </div>
          <div class="hub-feed dashboard-hub-scroll">${posts.map(hubPostCard).join('') || emptyState('No information posts yet.', 'Admin announcements and resolutions will appear here.')}</div>
        </section>
        <aside class="feed-side">
          <section class="panel">
            <div class="feed-title">
              <h3>Events</h3>
              <button class="secondary" data-jump="events">All Events</button>
            </div>
            <div class="card-list">${events.slice(0, 5).map(eventFeedCard).join('') || emptyState('No events posted yet.', 'Upcoming and active events will appear here.')}</div>
          </section>
          <section class="panel">
            <h3>Recent Printing Requests</h3>
            <div class="card-list">${history.slice(0, 3).map(printingCard).join('') || emptyState('No redemption requests yet.', 'Your recent printing requests will appear here.')}</div>
          </section>
        </aside>
      </div>
    `);
    bindJumpButtons();
    bindHubActions(posts);
    bindEventSocialActions();
    bindPrintingDownloads();
    bindSearch();
    return;
  }

  const attendance = await api('/reports/attendance').catch(() => []);
  const printing = await api('/reports/printing').catch(() => []);
  const feedback = await api('/reports/feedback').catch(() => []);
  setContent(`
    ${pageHeader('Operations Dashboard', 'Monitor participation, feedback, points, and printing redemptions.')}
    <div class="grid three">
      ${metricCard('Events Tracked', attendance.length, 'Attendance report rows', 'teal')}
      ${metricCard('Feedback Sets', feedback.length, 'Feedback summary rows', 'blue')}
      ${metricCard('Printing Statuses', printing.length, 'Request status groups', 'gold')}
    </div>
    <div class="quick-actions">
      ${state.user.role === 'admin' ? '<button data-jump="students">Add Student</button><button data-jump="eventsAdmin" class="secondary">Create Event</button><button data-jump="qr" class="secondary">Generate QR</button>' : ''}
      ${state.user.role === 'printing_staff' ? '<button data-jump="printing">Review Printing</button>' : ''}
      ${state.user.role === 'organizer' ? '<button data-jump="attendance">Attendance Records</button><button data-jump="feedbackAdmin" class="secondary">Feedback Results</button>' : ''}
    </div>
    <section class="panel analytics-panel" aria-label="Operations overview">
      <div class="feed-title">
        <div>
          <span class="page-kicker">Live overview</span>
          <h3>Service activity</h3>
        </div>
        <span class="muted">Current report totals</span>
      </div>
      <div class="mini-chart">
        <div><span style="--bar:${Math.min(100, 24 + attendance.length * 8)}%"></span><small>Attendance</small><strong>${attendance.length}</strong></div>
        <div><span style="--bar:${Math.min(100, 24 + feedback.length * 8)}%"></span><small>Feedback</small><strong>${feedback.length}</strong></div>
        <div><span style="--bar:${Math.min(100, 24 + printing.length * 8)}%"></span><small>Printing</small><strong>${printing.length}</strong></div>
      </div>
    </section>
    <div class="toolbar dashboard-search">
      ${searchBox('Search dashboard records')}
    </div>
  `);
  bindJumpButtons();
  bindSearch();
}

function emptyState(title, note = '') {
  return `<div class="empty-state"><strong>${esc(title)}</strong>${note ? `<span>${esc(note)}</span>` : ''}</div>`;
}

function bindJumpButtons() {
  document.querySelectorAll('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      navigateToView(button.dataset.jump);
    });
  });
}

async function renderInformationHub() {
  const posts = await api('/hub/posts');
  const isAdmin = state.user.role === 'admin';
  const isStudent = state.user.role === 'student';
  setContent(`
    ${pageHeader(
      isStudent ? 'Home' : 'Information Hub',
      isStudent
        ? 'Latest campus announcements, activities, events, and resolutions.'
        : 'Activities, announcements, and resolutions for transparent student services.',
    )}
    ${isAdmin ? hubPostFormHtml(state.editingPost) : ''}
    <div class="toolbar">${searchBox(isStudent ? 'Search campus updates' : 'Search posts, resolutions, announcements')}</div>
    <div class="hub-feed">${posts.map(hubPostCard).join('') || '<p class="muted">No information posts yet.</p>'}</div>
  `);
  if (isAdmin) bindHubPostForm(posts);
  bindHubActions(posts);
  bindSearch();
}

function hubImages(row) {
  if (Array.isArray(row?.images) && row.images.length) {
    return row.images
      .filter((image) => image?.data)
      .map((image) => ({ data: image.data, caption: image.caption || '' }));
  }
  return row?.image_data
    ? [{ data: row.image_data, caption: row.image_caption || '' }]
    : [];
}

function hubImageEditorCard(image, index) {
  return `
    <article class="hub-image-editor-card">
      <img src="${esc(image.data)}" alt="Selected post photo ${index + 1}" />
      <label>Photo ${index + 1} caption
        <input data-hub-caption="${index}" maxlength="240" value="${esc(image.caption || '')}" placeholder="Optional photo caption" />
      </label>
      <button type="button" class="secondary" data-remove-hub-photo="${index}">Remove</button>
    </article>
  `;
}

function hubPostFormHtml(row = null) {
  const editing = Boolean(row);
  const images = hubImages(row);
  return `
    <form id="hubPostForm" class="panel">
      <h2>${editing ? 'Edit Information Post' : 'Create Information Post'}</h2>
      <div class="grid two">
        <label>Title <input name="title" value="${esc(row?.title || '')}" required /></label>
        <label>Category
          <select name="category">
            ${option('activity', 'Admin Activity', row?.category || 'activity')}
            ${option('resolution', 'Resolution', row?.category)}
            ${option('announcement', 'Announcement', row?.category)}
          </select>
        </label>
        <label>Status
          <select name="status">
            ${option('published', 'published', row?.status || 'published')}
            ${option('draft', 'draft', row?.status)}
            ${option('archived', 'archived', row?.status)}
          </select>
        </label>
      </div>
      <label>Details <textarea name="content" required>${esc(row?.content || '')}</textarea></label>
      <section class="hub-image-uploader hub-multi-image-uploader">
        <div class="hub-image-preview-grid" id="hubImagePreview">
          ${images.length ? images.map(hubImageEditorCard).join('') : '<p class="muted">No photos selected.</p>'}
        </div>
        <div class="hub-upload-controls">
          <label>Post Photos
            <input id="hubImageFile" type="file" accept="image/png,image/jpeg,image/webp" multiple />
          </label>
          <div class="actions">
            <button type="button" class="secondary" id="removeHubImages" ${images.length ? '' : 'disabled'}>Remove All</button>
          </div>
          <p class="hint">Choose up to 4 JPG, PNG, or WEBP photos. Photos are optimized automatically for fast loading.</p>
        </div>
      </section>
      <div class="actions">
        <button type="submit">${editing ? 'Update Post' : 'Publish Post'}</button>
        ${editing ? '<button type="button" class="secondary" id="cancelPostEdit">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function hubPostCard(row) {
  const images = hubImages(row);
  const captions = images.map((image) => image.caption).filter(Boolean).join(' ');
  return `
    <article class="record hub-post" data-search-row="${searchable(`${row.title} ${row.category} ${row.content} ${captions} ${row.author_name} ${row.status}`)}">
      <div>
        <div class="actions">
          ${badge(row.category)}
          ${state.user.role === 'admin' ? badge(row.status) : ''}
        </div>
        <h3>${esc(row.title)}</h3>
        <p>${esc(row.content)}</p>
        ${images.length ? `
          <figure class="hub-media">
            <div class="hub-media-grid hub-media-count-${Math.min(images.length, 4)}">
              ${images.map((image, index) => `
                <button class="hub-media-button" type="button" data-hub-photo="${row.id}" data-photo-index="${index}" aria-label="View photo ${index + 1} of ${images.length}">
                  <img src="${esc(image.data)}" alt="${esc(image.caption || `${row.title}, photo ${index + 1}`)}" loading="lazy" decoding="async" />
                  ${image.caption ? `<span>${esc(image.caption)}</span>` : ''}
                </button>
              `).join('')}
            </div>
            <figcaption>Click a photo to view the full gallery.</figcaption>
          </figure>
        ` : ''}
        <p class="muted">Posted by ${esc(row.author_name)} | ${esc(row.created_at)}</p>
        <div class="comment-list hidden" id="comments-${row.id}"></div>
      </div>
      <div class="actions hub-actions">
        <button class="${Number(row.liked_by_me) ? '' : 'secondary'}" data-like-post="${row.id}">${Number(row.liked_by_me) ? 'Liked' : 'Like'} (${row.like_count || 0})</button>
        <button class="secondary" data-comments-post="${row.id}">Comments (${row.comment_count || 0})</button>
        ${state.user.role === 'admin' ? `<button class="secondary" data-edit-post="${row.id}">Edit</button><button class="danger" data-delete-post="${row.id}">Delete</button>` : ''}
      </div>
    </article>
  `;
}

function bindHubPostForm(posts) {
  let postImages = hubImages(state.editingPost);
  const preview = document.querySelector('#hubImagePreview');
  const removeAllButton = document.querySelector('#removeHubImages');

  const renderImageEditors = () => {
    preview.innerHTML = postImages.length
      ? postImages.map(hubImageEditorCard).join('')
      : '<p class="muted">No photos selected.</p>';
    removeAllButton.disabled = !postImages.length;
    preview.querySelectorAll('[data-hub-caption]').forEach((input) => {
      input.addEventListener('input', () => {
        postImages[Number(input.dataset.hubCaption)].caption = input.value;
      });
    });
    preview.querySelectorAll('[data-remove-hub-photo]').forEach((button) => {
      button.addEventListener('click', () => {
        postImages.splice(Number(button.dataset.removeHubPhoto), 1);
        renderImageEditors();
      });
    });
  };

  document.querySelector('#hubPostForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      data.images = postImages;
      if (state.editingPost) {
        await api(`/hub/posts/${state.editingPost.id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Information post updated.');
        state.editingPost = null;
      } else {
        await api('/hub/posts', { method: 'POST', body: JSON.stringify(data) });
        toast('Information post published.');
      }
      renderInformationHub();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#cancelPostEdit')?.addEventListener('click', () => {
    state.editingPost = null;
    renderInformationHub();
  });
  document.querySelectorAll('[data-edit-post]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editingPost = posts.find((row) => Number(row.id) === Number(button.dataset.editPost));
      renderInformationHub();
    });
  });
  document.querySelector('#hubImageFile')?.addEventListener('change', async (event) => {
    const files = [...event.currentTarget.files];
    if (!files.length) return;
    try {
      if (postImages.length + files.length > 4) throw new Error('A post can contain up to 4 photos.');
      const additions = [];
      for (const file of files) {
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error(`${file.name} is not a supported image.`);
        const dataUrl = await readOptimizedImageDataUrl(file);
        additions.push({ data: dataUrl, caption: '' });
      }
      postImages = [...postImages, ...additions];
      renderImageEditors();
    } catch (error) {
      toast(error.message);
    }
    event.currentTarget.value = '';
  });
  removeAllButton?.addEventListener('click', () => {
    postImages = [];
    document.querySelector('#hubImageFile').value = '';
    renderImageEditors();
  });
  renderImageEditors();
}

function bindHubActions(posts) {
  const postsById = new Map(posts.map((post) => [Number(post.id), post]));
  document.querySelectorAll('[data-hub-photo]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = postsById.get(Number(button.dataset.hubPhoto));
      openHubGallery(hubImages(post), Number(button.dataset.photoIndex), post?.title || 'Post photos');
    });
  });
  document.querySelectorAll('[data-like-post]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/hub/posts/${button.dataset.likePost}/like`, { method: 'POST', body: '{}' });
        renderView();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  document.querySelectorAll('[data-comments-post]').forEach((button) => {
    button.addEventListener('click', async () => {
      await togglePostComments(button.dataset.commentsPost);
    });
  });
  document.querySelectorAll('[data-delete-post]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Delete this information post? This cannot be undone.', 'Delete information post')) return;
      try {
        await api(`/hub/posts/${button.dataset.deletePost}`, { method: 'DELETE' });
        toast('Information post deleted.');
        renderView();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function openHubGallery(images, startIndex = 0, title = 'Post photos') {
  if (!images.length) return;
  let currentIndex = Math.max(0, Math.min(startIndex, images.length - 1));
  const previousOverflow = document.body.style.overflow;
  const overlay = document.createElement('div');
  overlay.className = 'media-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  overlay.innerHTML = `
    <button class="media-lightbox-close" type="button" aria-label="Close photo viewer">&times;</button>
    <button class="media-lightbox-nav previous" type="button" aria-label="Previous photo">&#8249;</button>
    <figure>
      <img alt="" />
      <figcaption></figcaption>
      <span class="media-lightbox-count"></span>
    </figure>
    <button class="media-lightbox-nav next" type="button" aria-label="Next photo">&#8250;</button>
  `;
  const image = overlay.querySelector('img');
  const caption = overlay.querySelector('figcaption');
  const counter = overlay.querySelector('.media-lightbox-count');
  const previous = overlay.querySelector('.previous');
  const next = overlay.querySelector('.next');

  const render = () => {
    const selected = images[currentIndex];
    image.src = selected.data;
    image.alt = selected.caption || `${title}, photo ${currentIndex + 1}`;
    caption.textContent = selected.caption || title;
    counter.textContent = `${currentIndex + 1} / ${images.length}`;
    previous.hidden = images.length < 2;
    next.hidden = images.length < 2;
  };
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    document.body.style.overflow = previousOverflow;
    overlay.remove();
  };
  const move = (direction) => {
    currentIndex = (currentIndex + direction + images.length) % images.length;
    render();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') move(-1);
    if (event.key === 'ArrowRight') move(1);
  };
  overlay.querySelector('.media-lightbox-close').addEventListener('click', close);
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);
  render();
  overlay.querySelector('.media-lightbox-close').focus();
}

async function togglePostComments(postId) {
  const box = document.querySelector(`#comments-${postId}`);
  if (!box) return;
  if (!box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }
  const comments = await api(`/hub/posts/${postId}/comments`);
  box.innerHTML = `
    ${comments.map((row) => `<div class="comment-item"><strong>${esc(row.author_name)}</strong><p>${esc(row.comment)}</p><small>${esc(row.created_at)}</small></div>`).join('') || '<p class="muted">No comments yet.</p>'}
    <form class="comment-form" data-comment-form="${postId}">
      <input name="comment" placeholder="Write a comment" required />
      <button type="submit">Comment</button>
    </form>
  `;
  box.classList.remove('hidden');
  box.querySelector('[data-comment-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/hub/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) });
      box.classList.add('hidden');
      await togglePostComments(postId);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function renderOfficers() {
  const rows = await api('/officers');
  const isAdmin = state.user.role === 'admin';
  setContent(`
    ${pageHeader('Officers', 'View student service officers and office contact information.')}
    ${isAdmin ? officerFormHtml(state.editingOfficer) : ''}
    <div class="toolbar">${searchBox('Search officers')}</div>
    <div class="officer-grid">${rows.map(officerCard).join('') || '<p class="muted">No officers listed yet.</p>'}</div>
  `);
  if (isAdmin) bindOfficerForm(rows);
  bindSearch();
}

function officerFormHtml(row = null) {
  const editing = Boolean(row);
  return `
    <form id="officerForm" class="panel">
      <h2>${editing ? 'Edit Officer' : 'Add Officer'}</h2>
      <div class="grid two">
        <label>Name <input name="name" value="${esc(row?.name || '')}" required /></label>
        <label>Position <input name="position" value="${esc(row?.position || '')}" required /></label>
        <label>Department <input name="department" value="${esc(row?.department || '')}" /></label>
        <label>Email <input name="email" type="email" value="${esc(row?.email || '')}" /></label>
        <label>Contact No. <input name="contact_no" value="${esc(row?.contact_no || '')}" /></label>
        <label>Term <input name="term" value="${esc(row?.term || '')}" placeholder="2026-2027" /></label>
        <label>Display Order <input name="display_order" type="number" min="0" value="${esc(row?.display_order ?? 0)}" /></label>
        <label>Status
          <select name="status">
            ${option('active', 'active', row?.status || 'active')}
            ${option('inactive', 'inactive', row?.status)}
          </select>
        </label>
        <label>Photo <input id="officerPhoto" type="file" accept="image/*" /></label>
      </div>
      <input type="hidden" name="photo_data" id="officerPhotoData" value="${esc(row?.photo_data || '')}" />
      <label>Bio <textarea name="bio">${esc(row?.bio || '')}</textarea></label>
      <div class="actions">
        <button type="submit">${editing ? 'Update Officer' : 'Save Officer'}</button>
        ${editing ? '<button type="button" class="secondary" id="cancelOfficerEdit">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function officerCard(row) {
  return `
    <article class="officer-card" data-search-row="${searchable(`${row.name} ${row.position} ${row.department} ${row.email} ${row.status}`)}">
      <div class="officer-media">
        ${row.photo_data ? `<img class="officer-photo" src="${row.photo_data}" alt="${esc(row.name)}" loading="lazy" decoding="async" />` : `<div class="avatar officer-avatar">${esc(row.name).slice(0, 2).toUpperCase()}</div>`}
      </div>
      <div class="officer-info">
        <div class="officer-heading">
          <div>
            <h3>${esc(row.name)}</h3>
            <span class="officer-position">${esc(row.position)}</span>
          </div>
          ${badge(row.status)}
        </div>
        <div class="officer-details">
          ${row.department ? `<span><strong>Department</strong>${esc(row.department)}</span>` : ''}
          ${row.term ? `<span><strong>Term</strong>${esc(row.term)}</span>` : ''}
          ${row.email ? `<span><strong>Email</strong>${esc(row.email)}</span>` : ''}
          ${row.contact_no ? `<span><strong>Contact</strong>${esc(row.contact_no)}</span>` : ''}
        </div>
        ${row.bio ? `<p class="officer-bio">${esc(row.bio)}</p>` : ''}
        ${state.user.role === 'admin' ? `<div class="actions officer-actions"><button class="secondary" data-edit-officer="${row.id}">Edit</button><button class="danger" data-delete-officer="${row.id}">Deactivate</button></div>` : ''}
      </div>
    </article>
  `;
}

function bindOfficerForm(rows) {
  document.querySelector('#officerPhoto')?.addEventListener('change', async (event) => {
    const file = event.currentTarget.files[0];
    if (!file) return;
    try {
      document.querySelector('#officerPhotoData').value = await readFileAsDataUrl(file);
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#officerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      data.display_order = Number(data.display_order || 0);
      if (state.editingOfficer) {
        await api(`/officers/${state.editingOfficer.id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Officer updated.');
        state.editingOfficer = null;
      } else {
        await api('/officers', { method: 'POST', body: JSON.stringify(data) });
        toast('Officer saved.');
      }
      renderOfficers();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#cancelOfficerEdit')?.addEventListener('click', () => {
    state.editingOfficer = null;
    renderOfficers();
  });
  document.querySelectorAll('[data-edit-officer]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editingOfficer = rows.find((row) => Number(row.id) === Number(button.dataset.editOfficer));
      renderOfficers();
    });
  });
  document.querySelectorAll('[data-delete-officer]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Deactivate this officer profile?', 'Deactivate officer')) return;
      try {
        await api(`/officers/${button.dataset.deleteOfficer}`, { method: 'DELETE' });
        toast('Officer deactivated.');
        renderOfficers();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

const FACE_LANDMARKER_VERSION = '0.10.35';
const FACE_LANDMARKER_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let faceLandmarkerLoader = null;

function loadFaceLandmarker() {
  if (!faceLandmarkerLoader) {
    faceLandmarkerLoader = (async () => {
      const packageRoot = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${FACE_LANDMARKER_VERSION}`;
      const { FaceLandmarker, FilesetResolver } = await import(`${packageRoot}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${packageRoot}/wasm`);
      const options = {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 2,
        minFaceDetectionConfidence: 0.65,
        minFacePresenceConfidence: 0.65,
        minTrackingConfidence: 0.65,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      };
      try {
        return await FaceLandmarker.createFromOptions(fileset, options);
      } catch (gpuError) {
        delete options.baseOptions.delegate;
        return FaceLandmarker.createFromOptions(fileset, options);
      }
    })().catch((error) => {
      faceLandmarkerLoader = null;
      throw error;
    });
  }
  return faceLandmarkerLoader;
}

function createLivenessSession() {
  const challenges = [
    { key: 'blink', prompt: 'Blink both eyes', detail: 'Close both eyes naturally, then open them again.' },
    { key: 'smile', prompt: 'Smile, then relax', detail: 'Give a clear smile, then return to a neutral expression.' },
    { key: 'turn', prompt: 'Turn and return', detail: 'Slowly turn your head to either side, then face the camera again.' },
  ].sort(() => Math.random() - 0.5).slice(0, 2);
  return {
    startedAt: performance.now(),
    lastScan: 0,
    lastVideoTime: -1,
    phase: 'position',
    holdStartedAt: 0,
    challengeIndex: 0,
    challengeActivated: false,
    challenges,
    baseline: null,
    badFrameCount: 0,
  };
}

function blendshapeMap(result) {
  const categories = result.faceBlendshapes?.[0]?.categories || [];
  return Object.fromEntries(categories.map((category) => [category.categoryName, category.score]));
}

function getLivenessMetrics(result) {
  const faceCount = result.faceLandmarks?.length || 0;
  if (faceCount !== 1) return { valid: false, faceCount };
  const landmarks = result.faceLandmarks[0];
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  const centered = Math.abs(centerX - 0.5) < 0.105 && Math.abs(centerY - 0.49) < 0.135;
  const sizeOk = width > 0.2 && width < 0.62 && height > 0.28 && height < 0.8;
  const shapes = blendshapeMap(result);
  const blink = ((shapes.eyeBlinkLeft || 0) + (shapes.eyeBlinkRight || 0)) / 2;
  const smile = ((shapes.mouthSmileLeft || 0) + (shapes.mouthSmileRight || 0)) / 2;
  const nose = landmarks[1];
  const leftSide = landmarks[234];
  const rightSide = landmarks[454];
  const faceMidX = (leftSide.x + rightSide.x) / 2;
  const sideDistance = Math.max(0.001, Math.abs(rightSide.x - leftSide.x));
  const turn = Math.abs(nose.x - faceMidX) / sideDistance;
  return {
    valid: true,
    centered,
    sizeOk,
    blink,
    smile,
    turn,
  };
}

function advanceLivenessSession(session, metrics, ui) {
  const now = performance.now();
  if (!metrics.valid) {
    session.holdStartedAt = 0;
    session.badFrameCount += 1;
    ui.faceFrame.classList.add('face-warning');
    ui.faceFrame.classList.remove('face-ready');
    ui.faceQualityBadge.textContent = metrics.faceCount > 1 ? 'Only one face allowed' : 'No face detected';
    ui.prompt.textContent = metrics.faceCount > 1 ? 'Only one person may be visible' : 'Place your face in the guide';
    ui.detail.textContent = metrics.faceCount > 1 ? 'Ask other people to move out of the camera view.' : 'Use even lighting and look directly at the camera.';
    return;
  }
  if (!metrics.centered || !metrics.sizeOk) {
    session.holdStartedAt = 0;
    session.badFrameCount += 1;
    ui.faceFrame.classList.add('face-warning');
    ui.faceFrame.classList.remove('face-ready');
    ui.faceQualityBadge.textContent = !metrics.sizeOk ? 'Adjust your distance' : 'Center your face';
    ui.prompt.textContent = !metrics.sizeOk ? 'Move closer or farther' : 'Center your face';
    ui.detail.textContent = 'Fit your entire face inside the oval and look straight ahead.';
    return;
  }

  ui.faceFrame.classList.remove('face-warning');
  ui.faceFrame.classList.add('face-ready');
  ui.faceQualityBadge.textContent = 'Face detected';

  if (session.phase === 'position') {
    if (metrics.blink > 0.32 || metrics.turn > 0.115) {
      session.holdStartedAt = 0;
      ui.prompt.textContent = 'Look straight at the camera';
      ui.detail.textContent = 'Keep both eyes open and hold a neutral position.';
      return;
    }
    if (!session.holdStartedAt) session.holdStartedAt = now;
    const holdProgress = Math.min(1, (now - session.holdStartedAt) / 900);
    ui.setStep('position', 8 + holdProgress * 24);
    ui.prompt.textContent = holdProgress < 1 ? 'Hold still for a moment' : 'Face position confirmed';
    ui.detail.textContent = 'Keep looking straight at the camera.';
    if (holdProgress < 1) return;
    session.baseline = { blink: metrics.blink, smile: metrics.smile, turn: metrics.turn };
    session.phase = 'challenge';
    session.holdStartedAt = 0;
  }

  const challenge = session.challenges[session.challengeIndex];
  if (!challenge) {
    session.phase = 'verified';
    ui.finish();
    return;
  }
  ui.setStep('challenge', 36 + (session.challengeIndex / session.challenges.length) * 52);
  ui.prompt.textContent = challenge.prompt;
  ui.detail.textContent = challenge.detail;
  ui.faceQualityBadge.textContent = `Action ${session.challengeIndex + 1} of ${session.challenges.length}`;

  const baseline = session.baseline || { blink: 0, smile: 0, turn: 0 };
  const activated = challenge.key === 'blink'
    ? metrics.blink > Math.max(0.5, baseline.blink + 0.3)
    : challenge.key === 'smile'
      ? metrics.smile > Math.max(0.42, baseline.smile + 0.22)
      : metrics.turn > Math.max(0.105, baseline.turn + 0.065);
  if (!session.challengeActivated && activated) {
    session.challengeActivated = true;
    ui.detail.textContent = challenge.key === 'blink'
      ? 'Good. Open your eyes again.'
      : challenge.key === 'smile'
        ? 'Good. Relax your expression.'
        : 'Good. Return to the center.';
    return;
  }
  if (!session.challengeActivated) return;

  const returned = challenge.key === 'blink'
    ? metrics.blink < Math.max(0.25, baseline.blink + 0.12)
    : challenge.key === 'smile'
      ? metrics.smile < Math.max(0.32, baseline.smile + 0.13)
      : metrics.turn < Math.max(0.075, baseline.turn + 0.035);
  if (!returned) return;

  session.challengeIndex += 1;
  session.challengeActivated = false;
  session.baseline = { blink: metrics.blink, smile: metrics.smile, turn: metrics.turn };
  ui.setStep('challenge', 36 + (session.challengeIndex / session.challenges.length) * 52);
  if (session.challengeIndex >= session.challenges.length) {
    session.phase = 'verified';
    ui.finish();
  } else {
    const next = session.challenges[session.challengeIndex];
    ui.prompt.textContent = 'First action complete';
    ui.detail.textContent = `Next: ${next.prompt.toLowerCase()}.`;
  }
}

async function renderProfile() {
  const profile = await api('/profile');
  const initials = esc(profile.name).slice(0, 2).toUpperCase();
  setContent(`
    ${pageHeader('Profile', 'Account and role information.')}
    <div class="panel profile-card">
      ${profile.face_image_data ? `<img class="profile-photo" src="${profile.face_image_data}" alt="Student face profile" loading="lazy" decoding="async" />` : `<div class="avatar">${initials}</div>`}
      <div>
        <h2>${esc(profile.name)}</h2>
        <p><strong>Email:</strong> ${esc(profile.email)}</p>
        <p><strong>Role:</strong> ${esc(profile.role)}</p>
        ${profile.student_no ? `<p><strong>Student ID:</strong> ${esc(profile.student_no)}</p>` : ''}
        ${profile.course ? `<p><strong>Course:</strong> ${esc(profile.course)} ${esc(profile.year_level)}-${esc(profile.section)}</p>` : ''}
        ${profile.face_verified_at ? '<p><strong>Face Auth:</strong> Verified</p>' : ''}
      </div>
    </div>
  `);
}

async function renderStudents() {
  const rows = await api('/students');
  const activeStudents = rows.filter((row) => row.status === 'active').length;
  setContent(`
    ${pageHeader(
      'Manage Students',
      `${rows.length} student accounts, ${activeStudents} active.`,
      '<button id="showRegistrationQr">Registration QR</button>',
    )}
    <div id="registrationQrPanel"></div>
    ${state.user.role === 'admin' ? `
      <details class="management-form" ${state.editingStudent ? 'open' : ''}>
        <summary>
          <span>${state.editingStudent ? 'Editing student account' : 'Add a student account'}</span>
          <small>${state.editingStudent ? 'Update the selected student details below.' : 'Open the form to register a student manually.'}</small>
        </summary>
        ${studentFormHtml(state.editingStudent)}
      </details>
    ` : ''}
    <div class="toolbar"><h2>Student directory <span class="record-count">${rows.length}</span></h2>${searchBox('Search name, student ID, course, section')}</div>
    <div class="card-list directory-list" data-paginate="true" data-page-size="6">
      ${rows.map((row) => `
        <article class="record directory-card student-record" data-search-row="${searchable(`${row.name} ${row.student_no} ${row.course} ${row.section} ${row.email}`)}">
          <div class="directory-avatar" aria-hidden="true">${esc(personInitials(row.name))}</div>
          <div class="directory-copy">
            <h3>${esc(row.name)}</h3>
            <p class="directory-email">${esc(row.email)}</p>
            <div class="directory-meta">
              <span><small>Student ID</small>${esc(row.student_no)}</span>
              <span><small>Program</small>${esc(row.course)} ${esc(row.year_level)}-${esc(row.section)}</span>
              <span><small>Reward points</small><strong>${esc(row.total_points)}</strong></span>
            </div>
          </div>
          <div class="actions directory-actions">
            ${badge(row.status)}
            ${state.user.role === 'admin' ? `<button class="secondary" data-edit-student="${row.id}">Edit</button><button class="danger" data-delete-student="${row.id}">Deactivate</button>` : ''}
          </div>
        </article>
      `).join('') || emptyState('No students found.', 'Create the first student account using the form above.')}
    </div>
  `);
  bindStudentForm(rows);
  bindRegistrationQr();
  bindSearch();
}

function bindRegistrationQr() {
  document.querySelector('#showRegistrationQr')?.addEventListener('click', async () => {
    try {
      const data = await api('/registration/qr');
      document.querySelector('#registrationQrPanel').innerHTML = `
        <section class="panel qr-panel">
          <h3>Student Self-Registration QR</h3>
          <img class="qr" src="${data.image}" alt="Student registration QR" />
          <p class="hint">Students can scan this or open: <a href="${data.url}" target="_blank">${data.url}</a></p>
        </section>
      `;
    } catch (error) {
      toast(error.message);
    }
  });
}

function studentFormHtml(row = null) {
  const editing = Boolean(row);
  return `
    <form id="studentForm" class="panel">
      <h2>${editing ? 'Edit Student' : 'Add Student'}</h2>
      <div class="grid two">
        <label>Name <input name="name" value="${esc(row?.name || '')}" required /></label>
        <label>Email <input name="email" type="email" value="${esc(row?.email || '')}" required /></label>
        <label>Student ID <input name="student_no" value="${esc(row?.student_no || '')}" required /></label>
        <label>Password
          <span class="password-control">
            <input id="studentPassword" name="password" type="password" value="${editing ? '' : 'password123'}" ${editing ? '' : 'required'} placeholder="${editing ? 'Leave blank to keep current password' : ''}" />
            <button type="button" class="mini-button" data-toggle-password="#studentPassword">Show</button>
          </span>
        </label>
        <label>Course ${courseSelect(row?.course || 'BSIT')}</label>
        <label>Year Level ${yearSelect(row?.year_level || '1')}</label>
        <label>Section ${sectionSelect(row?.section || 'A')}</label>
        <label>Contact <input name="contact_no" value="${esc(row?.contact_no || '')}" /></label>
      </div>
      <div class="actions">
        <button type="submit">${editing ? 'Update Student' : 'Create Student'}</button>
        ${editing ? '<button type="button" class="secondary" id="cancelStudentEdit">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function bindStudentForm(rows) {
  const form = document.querySelector('#studentForm');
  if (!form) return;
  enhancePasswordToggles();
  document.querySelector('#cancelStudentEdit')?.addEventListener('click', () => {
    state.editingStudent = null;
    renderStudents();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(form);
      if (!data.password) delete data.password;
      if (state.editingStudent) {
        await api(`/students/${state.editingStudent.id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Student updated.');
        state.editingStudent = null;
      } else {
        await api('/students', { method: 'POST', body: JSON.stringify(data) });
        toast('Student created.');
      }
      renderStudents();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelectorAll('[data-edit-student]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.editingStudent = rows.find((row) => String(row.id) === String(button.dataset.editStudent));
      if (!state.editingStudent) {
        toast('Unable to find that student record. Refresh and try again.');
        return;
      }
      await renderStudents();
      document.querySelector('.management-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelector('#studentForm input[name="name"]')?.focus({ preventScroll: true });
    });
  });
  document.querySelectorAll('[data-delete-student]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Deactivate this student account?', 'Deactivate student')) return;
      try {
        await api(`/students/${button.dataset.deleteStudent}`, { method: 'DELETE' });
        toast('Student deactivated.');
        renderStudents();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

async function renderStudentEvents() {
  const rows = await api('/events');
  setContent(`
    ${pageHeader('Events', 'View available school events and reward points.')}
    <div class="toolbar">${searchBox('Search event title, venue, status')}</div>
    <div class="card-list">
      ${rows.map(eventFeedCard).join('')}
    </div>
  `);
  bindEventSocialActions();
  bindSearch();
}

function eventFeedCard(row) {
  return `
    <article class="record event-feed-card" data-search-row="${searchable(`${row.title} ${row.description} ${row.venue} ${row.status} ${row.event_type}`)}">
      <div>
        <div class="actions">${badge(row.status)} ${badge(row.event_type || 'event')}</div>
        <h3>${esc(row.title)}</h3>
        <p>${esc(row.description || '')}</p>
        <p class="muted">${esc(row.event_date)} ${esc(row.start_time)}-${esc(row.end_time)} | ${esc(row.venue)} | ${row.points} pts</p>
        <div class="comment-list hidden" id="event-comments-${row.id}"></div>
      </div>
      <div class="actions hub-actions">
        <button class="${Number(row.liked_by_me) ? '' : 'secondary'}" data-like-event="${row.id}">${Number(row.liked_by_me) ? 'Liked' : 'Like'} (${row.like_count || 0})</button>
        <button class="secondary" data-comments-event="${row.id}">Comments (${row.comment_count || 0})</button>
        ${state.user.role === 'student' ? '<button class="secondary" data-jump="scan">Scan QR</button>' : ''}
      </div>
    </article>
  `;
}

function bindEventSocialActions() {
  document.querySelectorAll('[data-like-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/events/${button.dataset.likeEvent}/like`, { method: 'POST', body: '{}' });
        renderView();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  document.querySelectorAll('[data-comments-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      await toggleEventComments(button.dataset.commentsEvent);
    });
  });
  bindJumpButtons();
}

async function toggleEventComments(eventId) {
  const box = document.querySelector(`#event-comments-${eventId}`);
  if (!box) return;
  if (!box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }
  const comments = await api(`/events/${eventId}/comments`);
  box.innerHTML = `
    ${comments.map((row) => `<div class="comment-item"><strong>${esc(row.author_name)}</strong><p>${esc(row.comment)}</p><small>${esc(row.created_at)}</small></div>`).join('') || '<p class="muted">No comments yet.</p>'}
    <form class="comment-form" data-event-comment-form="${eventId}">
      <input name="comment" placeholder="Write a comment" required />
      <button type="submit">Comment</button>
    </form>
  `;
  box.classList.remove('hidden');
  box.querySelector('[data-event-comment-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/events/${eventId}/comments`, { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) });
      box.classList.add('hidden');
      await toggleEventComments(eventId);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function renderAdminEvents() {
  const [rows, settings] = await Promise.all([
    api('/events'),
    state.user.role === 'admin' ? api('/settings').catch(() => ({ default_event_points: 10 })) : Promise.resolve({ default_event_points: 10 }),
  ]);
  setContent(`
    ${pageHeader('Manage Events', 'Create events and configure point rewards.')}
    ${eventFormHtml(state.editingEvent, settings)}
    <div class="toolbar"><h2>Events</h2>${searchBox('Search events')}</div>
    <div class="card-list">${rows.map(eventCard).join('')}</div>
  `);
  bindEventForm(rows);
  bindSearch();
}

function eventFormHtml(row = null, settings = { default_event_points: 10 }) {
  const editing = Boolean(row);
  return `
    <form id="eventForm" class="panel">
      <h2>${editing ? 'Edit Event' : 'Create Event'}</h2>
      <div class="grid two">
        <label>Title <input name="title" value="${esc(row?.title || '')}" required /></label>
        <label>Event Type <input name="event_type" value="${esc(row?.event_type || 'Seminar')}" required /></label>
        <label>Date <input name="event_date" type="date" value="${esc((row?.event_date || new Date().toISOString().slice(0, 10)).toString().slice(0, 10))}" required /></label>
        <label>Venue <input name="venue" value="${esc(row?.venue || 'Campus')}" required /></label>
        <label>Start Time <input name="start_time" value="${esc((row?.start_time || '08:00').toString().slice(0, 5))}" required /></label>
        <label>End Time <input name="end_time" value="${esc((row?.end_time || '23:59').toString().slice(0, 5))}" required /></label>
        <label>Points <input name="points" type="number" value="${esc(row?.points ?? settings.default_event_points ?? 10)}" min="0" required /></label>
        <label>Automatic Status <input value="${esc(row?.status || 'Based on event schedule')}" disabled /></label>
      </div>
      <label>Description <textarea name="description">${esc(row?.description || '')}</textarea></label>
      <div class="actions">
        <button type="submit">${editing ? 'Update Event' : 'Create Event'}</button>
        ${editing ? '<button type="button" class="secondary" id="cancelEventEdit">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function bindEventForm(rows) {
  document.querySelector('#eventForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      data.points = Number(data.points);
      if (state.editingEvent) {
        await api(`/events/${state.editingEvent.id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Event updated.');
        state.editingEvent = null;
      } else {
        await api('/events', { method: 'POST', body: JSON.stringify(data) });
        toast('Event created.');
      }
      renderAdminEvents();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#cancelEventEdit')?.addEventListener('click', () => {
    state.editingEvent = null;
    renderAdminEvents();
  });
  document.querySelectorAll('[data-edit-event]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editingEvent = rows.find((row) => Number(row.id) === Number(button.dataset.editEvent));
      renderAdminEvents();
    });
  });
  document.querySelectorAll('[data-delete-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Cancel this event and stop new attendance scans?', 'Cancel event')) return;
      try {
        await api(`/events/${button.dataset.deleteEvent}`, { method: 'DELETE' });
        toast('Event cancelled.');
        renderAdminEvents();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function eventCard(row) {
  return `
    <article class="record" data-search-row="${searchable(`${row.title} ${row.description} ${row.venue} ${row.status} ${row.event_type}`)}">
      <div>
        <h3>${esc(row.title)}</h3>
        <p>${esc(row.description || '')}</p>
        <p class="muted">${esc(row.event_date)} ${esc(row.start_time)}-${esc(row.end_time)} | ${esc(row.venue)} | ${row.points} pts</p>
      </div>
      <div class="actions">
        ${badge(row.status)}
        ${state.user.role === 'admin' || state.user.role === 'organizer' ? `<button class="secondary" data-edit-event="${row.id}">Edit</button>` : ''}
        ${state.user.role === 'admin' ? `<button class="danger" data-delete-event="${row.id}">Cancel</button>` : ''}
      </div>
    </article>
  `;
}

async function renderQr() {
  const rows = await api('/events');
  setContent(`
    ${pageHeader('Generate Event QR Code', 'Display or copy event QR payloads for attendance validation.')}
    <div class="toolbar">${searchBox('Search event for QR')}</div>
    <div class="card-list">
      ${rows.map((row) => `
        <article class="record" data-search-row="${searchable(`${row.title} ${row.venue} ${row.event_date}`)}">
          <div>
            <h3>${esc(row.title)}</h3>
            <p class="muted">${esc(row.event_date)} | ${esc(row.venue)}</p>
            <div id="qr-${row.id}"></div>
          </div>
          <button data-qr="${row.id}">Show QR</button>
        </article>
      `).join('')}
    </div>
  `);
  document.querySelectorAll('[data-qr]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const data = await api(`/events/${button.dataset.qr}/qr`);
        document.querySelector(`#qr-${button.dataset.qr}`).innerHTML = `
          <img class="qr" src="${data.image}" alt="Event QR" />
          <p class="hint">Expires exactly at event end time: ${esc(data.expires_at || 'event end time')}</p>
          ${data.attendance_code ? `
            <p class="hint">Attendance code for manual entry (admin only):</p>
            <div class="copy-code">${esc(data.attendance_code)}</div>
          ` : '<p class="hint">Manual attendance code is visible to admin only.</p>'}
          <p class="hint">For web testing, copy this QR payload:</p>
          <textarea readonly>${JSON.stringify({ event_id: data.event_id, qr_code: data.qr_code })}</textarea>
        `;
      } catch (error) {
        toast(error.message);
      }
    });
  });
  bindSearch();
}

function renderScan() {
  setContent(`
    ${pageHeader('Attendance QR Scanner', 'Scan the active event QR code before the event end time.')}
    <section class="panel scanner-panel">
      <div class="feed-title">
        <div>
          <h2>Camera QR Scanner</h2>
          <p class="hint">Use the HTTPS Vercel link on phones. The QR expires exactly at the event end time.</p>
        </div>
        <span class="scan-live-badge">Ready</span>
      </div>
      <div class="camera-box qr-scanner-box">
        <div class="scanner-frame">
          <video id="qrVideo" autoplay playsinline muted></video>
          <span class="scanner-corners" aria-hidden="true"></span>
        </div>
        <div class="actions">
          <button type="button" id="startQrCamera">Start Camera Scan</button>
          <button type="button" class="secondary" id="stopQrCamera">Stop Camera</button>
        </div>
        <p class="hint" id="qrScanStatus">Allow camera access, then point the camera at the event QR code. Keep the QR inside the frame.</p>
      </div>
    </section>
    <form id="scanForm" class="panel">
      <h2>Manual Attendance Entry</h2>
      <p class="hint">If camera scanning is not available, type the attendance code shown by the organizer before the event ends. Example: 1-AB12CD34.</p>
      <label>Attendance Code <input name="attendance_code" placeholder="1-AB12CD34" /></label>
      <label>Optional QR Payload <textarea name="payload" placeholder='{"event_id":1,"qr_code":"..."}'></textarea></label>
      <button type="submit">Submit Attendance</button>
    </form>
  `);
  bindQrCameraScanner();
  document.querySelector('#scanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const code = String(form.get('attendance_code') || '').trim();
      const rawPayload = String(form.get('payload') || '').trim();
      const payload = rawPayload ? JSON.parse(rawPayload) : { attendance_code: code };
      await submitAttendancePayload(payload);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function submitAttendancePayload(payload) {
  await api('/attendance/scan', {
    method: 'POST',
    body: JSON.stringify({
      student_id: state.user.student_id,
      ...(payload.attendance_code ? { attendance_code: payload.attendance_code } : {
        event_id: Number(payload.event_id),
        qr_code: payload.qr_code,
      }),
    }),
  });
  toast('Attendance confirmed.');
}

function loadScriptOnce(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${url}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window[globalName]));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.dataset.src = url;
    script.onload = () => resolve(window[globalName]);
    script.onerror = () => reject(new Error('Unable to load QR scanner library. Use manual QR entry.'));
    document.head.appendChild(script);
  });
}

function bindQrImageScanner() {
  const input = document.querySelector('#qrImageFile');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!('BarcodeDetector' in window)) {
      toast('This browser cannot read QR photos. Type the attendance code instead.');
      input.value = '';
      return;
    }
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (!codes.length) {
        toast('No QR code found in the image. Try taking a clearer photo.');
        return;
      }
      const payload = JSON.parse(codes[0].rawValue);
      await submitAttendancePayload(payload);
    } catch (error) {
      toast(error.message || 'Unable to scan QR image.');
    } finally {
      input.value = '';
    }
  });
}

function bindQrCameraScanner() {
  const video = document.querySelector('#qrVideo');
  const status = document.querySelector('#qrScanStatus');
  let stream = null;
  let scanning = false;
  let zxingControls = null;

  const stop = () => {
    scanning = false;
    zxingControls?.stop?.();
    zxingControls = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) video.srcObject = null;
    if (status) status.textContent = 'Camera stopped.';
  };

  document.querySelector('#stopQrCamera').addEventListener('click', stop);

  document.querySelector('#startQrCamera').addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Live camera is blocked by this browser/page. Open the app using the HTTPS Vercel link or use manual attendance code entry.';
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      status.textContent = 'Scanning... point the camera at the event QR code.';

      if (!('BarcodeDetector' in window)) {
        const ZXing = await loadScriptOnce('https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js', 'ZXing');
        const codeReader = new ZXing.BrowserQRCodeReader();
        zxingControls = await codeReader.decodeFromVideoElement(video, async (result) => {
          if (!result || !scanning) return;
          try {
            const payload = JSON.parse(result.getText());
            stop();
            await submitAttendancePayload(payload);
          } catch (error) {
            status.textContent = 'QR was detected but the content is not a valid event QR.';
          }
        });
        return;
      }

      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!scanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const raw = codes[0].rawValue;
            const payload = JSON.parse(raw);
            stop();
            await submitAttendancePayload(payload);
            return;
          }
        } catch (error) {
          // Keep scanning while the video warms up or no QR is visible.
        }
        requestAnimationFrame(scan);
      };

      requestAnimationFrame(scan);
    } catch (error) {
      status.textContent = error.message?.includes('QR scanner library')
        ? error.message
        : 'Camera permission is required. If you are on a phone, open the HTTPS Vercel link or use manual attendance code entry.';
      toast('Unable to start camera scanner.');
    }
  });
}

async function renderFeedbackForm() {
  const rows = await api('/events');
  setContent(`
    ${pageHeader('Feedback Form', 'Submit one 5-point Likert feedback response after attendance.')}
    <form id="feedbackForm" class="panel">
      <h2>Submit Feedback</h2>
      <label>Event
        <select name="event_id">${rows.map((row) => `<option value="${row.id}">${esc(row.title)}</option>`).join('')}</select>
      </label>
      ${[1, 2, 3, 4, 5].map((n) => `<label>Question ${n} Rating <input name="q${n}" type="number" min="1" max="5" value="5" required /></label>`).join('')}
      <label>Comments <textarea name="comments"></textarea></label>
      <button type="submit">Submit Feedback</button>
    </form>
  `);
  document.querySelector('#feedbackForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      ['event_id', 'q1', 'q2', 'q3', 'q4', 'q5'].forEach((key) => data[key] = Number(data[key]));
      data.student_id = state.user.student_id;
      await api('/feedback', { method: 'POST', body: JSON.stringify(data) });
      toast('Feedback submitted. Points awarded.');
    } catch (error) {
      toast(error.message);
    }
  });
}

async function renderWallet() {
  const balance = await api(`/points/balance/${state.user.student_id}`);
  const rows = await api(`/points/transactions/${state.user.student_id}`);
  setContent(`
    ${pageHeader('Points Wallet', 'Review earned, redeemed, and adjusted point transactions.')}
    <div class="grid three">
      ${metricCard('Current Balance', `${balance.balance} pts`, 'Available now', 'teal')}
      ${metricCard('Printable Pages', Math.floor(balance.balance / 10), '10 points per page', 'gold')}
      ${metricCard('Transactions', rows.length, 'Point history records', 'blue')}
    </div>
    <div class="toolbar"><h2>Transactions</h2>${searchBox('Search transactions')}</div>
    <div class="card-list">${rows.map((row) => `
      <article class="record" data-search-row="${searchable(`${row.description} ${row.type} ${row.created_at}`)}"><div><h3>${esc(row.description)}</h3><p class="muted">${esc(row.type)} | ${esc(row.created_at)}</p></div><strong>${row.points}</strong></article>
    `).join('')}</div>
  `);
  bindSearch();
}

function renderRedeem() {
  setContent(`
    ${pageHeader('Redeem Printing', 'Request free printing using earned points.')}
    <form id="redeemForm" class="panel">
      <h2>Redeem Printing</h2>
      <p class="hint">Conversion: 10 points = 1 printed page.</p>
      <label>Pages Requested <input name="pages_requested" type="number" min="1" value="1" required /></label>
      <label>Files to Print
        <input name="print_files" id="printFiles" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png" multiple />
        <span class="hint">Choose up to 5 PDF, Word, PowerPoint, Excel, text, JPG, or PNG files. Maximum 3MB combined.</span>
      </label>
      <div class="selected-print-files" id="selectedPrintFiles"><p class="muted">No files selected.</p></div>
      <label>Remarks <textarea name="remarks"></textarea></label>
      <button type="submit">Request Printing</button>
    </form>
  `);
  const fileInput = document.querySelector('#printFiles');
  const selectedFiles = document.querySelector('#selectedPrintFiles');
  const renderSelectedFiles = () => {
    const files = [...fileInput.files];
    selectedFiles.innerHTML = files.length
      ? files.map((file) => `
          <div>
            <span>${esc(file.name)}</span>
            <strong>${formatFileSize(file.size)}</strong>
          </div>
        `).join('')
      : '<p class="muted">No files selected.</p>';
  };
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > 5 || totalSize > 3 * 1024 * 1024) {
      fileInput.value = '';
      renderSelectedFiles();
      toast(files.length > 5 ? 'Choose no more than 5 files.' : 'Printing files must be 3MB or smaller in total.');
      return;
    }
    renderSelectedFiles();
  });
  document.querySelector('#redeemForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      const files = [...event.currentTarget.elements.print_files.files];
      data.student_id = state.user.student_id;
      data.pages_requested = Number(data.pages_requested);
      delete data.print_files;
      if (files.length > 5) throw new Error('Choose no more than 5 files.');
      if (files.reduce((sum, file) => sum + file.size, 0) > 3 * 1024 * 1024) {
        throw new Error('Printing files must be 3MB or smaller in total.');
      }
      data.files = await Promise.all(files.map(async (file) => ({
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        file_data: await readFileAsDataUrl(file),
      })));
      await api('/printing/redeem', { method: 'POST', body: JSON.stringify(data) });
      toast(`Printing request submitted with ${files.length} file${files.length === 1 ? '' : 's'}.`);
      event.currentTarget.reset();
      renderSelectedFiles();
    } catch (error) {
      toast(error.message);
    }
  });
}

async function renderHistory() {
  const rows = await api('/printing/redemptions');
  setContent(`${pageHeader('Redemption History', 'Track pending, approved, rejected, and completed print requests.')}<div class="toolbar">${searchBox('Search redemption history')}</div><div class="card-list">${rows.map(printingCard).join('')}</div>`);
  bindPrintingDownloads();
  bindSearch();
}

async function renderNotifications() {
  const rows = await api('/notifications');
  setContent(`
    ${pageHeader('Notifications', 'System updates about points, attendance, and printing.')}
    <div class="toolbar">
      ${searchBox('Search notifications')}
      <button class="secondary" data-read-all>Mark All Read</button>
    </div>
    <div class="card-list">${rows.map(notificationCard).join('') || '<p class="muted">No notifications yet.</p>'}</div>
  `);
  document.querySelector('[data-read-all]')?.addEventListener('click', async () => {
    try {
      await api('/notifications/read-all', { method: 'PUT', body: '{}' });
      toast('All notifications marked read.');
      renderNotifications();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelectorAll('[data-notification-read]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/notifications/${button.dataset.notificationRead}/read`, { method: 'PUT', body: '{}' });
        toast('Notification marked read.');
        renderNotifications();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  document.querySelectorAll('[data-notification-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/notifications/${button.dataset.notificationDelete}`, { method: 'DELETE' });
        toast('Notification deleted.');
        renderNotifications();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  bindSearch();
}

function notificationCard(row) {
  return `
    <article class="record ${row.is_read ? '' : 'unread'}" data-search-row="${searchable(`${row.title} ${row.message} ${row.created_at}`)}">
      <div>
        <h3>${esc(row.title)} ${row.is_read ? '' : '<span class="badge pending">new</span>'}</h3>
        <p>${esc(row.message)}</p>
        <p class="muted">${esc(row.created_at)}</p>
      </div>
      <div class="actions">
        <button class="secondary" data-notification-read="${row.id}" ${row.is_read ? 'disabled' : ''}>Mark Read</button>
        <button class="danger" data-notification-delete="${row.id}">Delete</button>
      </div>
    </article>
  `;
}

async function renderAttendanceReport() {
  const rows = await api('/reports/attendance');
  setContent(`${pageHeader('Attendance Records', 'Event participation summaries.')}<div class="toolbar">${searchBox('Search attendance')}<button class="secondary" data-export-csv>Export CSV</button></div><div class="card-list">${rows.map(reportCard).join('')}</div>`);
  bindCsvExport(rows, 'attendance-report.csv');
  bindSearch();
}

async function renderFeedbackReport() {
  const rows = await api('/reports/feedback');
  setContent(`${pageHeader('Feedback Results', 'Average event satisfaction and response counts.')}<div class="toolbar">${searchBox('Search feedback')}<button class="secondary" data-export-csv>Export CSV</button></div><div class="card-list">${rows.map(reportCard).join('')}</div>`);
  bindCsvExport(rows, 'feedback-report.csv');
  bindSearch();
}

async function renderPoints() {
  const rows = await api('/reports/points');
  setContent(`
    ${pageHeader('Points Management', 'Adjust balances and monitor top point holders.')}
    <form id="pointsForm" class="panel">
      <h2>Adjust Points</h2>
      <label>Student
        <select name="student_id" required>
          ${rows.map((row) => `<option value="${row.student_id}">${esc(row.name)} - ${esc(row.student_no || 'No student ID')}</option>`).join('')}
        </select>
      </label>
      <label>Points (+ or -) <input name="points" type="number" required /></label>
      <label>Description <input name="description" value="Manual adjustment" required /></label>
      <button type="submit">Save Adjustment</button>
    </form>
    <div class="toolbar"><h2>Point Balances</h2>${searchBox('Search balances')}<button class="secondary" data-export-csv>Export CSV</button></div>
    <div class="card-list">${rows.map(reportCard).join('')}</div>
  `);
  bindCsvExport(rows, 'points-report.csv');
  document.querySelector('#pointsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      data.student_id = Number(data.student_id);
      data.points = Number(data.points);
      await api('/points/adjust', { method: 'POST', body: JSON.stringify(data) });
      toast('Points adjusted.');
      renderPoints();
    } catch (error) {
      toast(error.message);
    }
  });
  bindSearch();
}

async function renderPrinting() {
  const rows = await api('/printing/redemptions');
  setContent(`${pageHeader('Printing Redemption Requests', 'Approve, reject, and complete student printing requests.')}<div class="toolbar">${searchBox('Search printing requests')}<button class="secondary" data-export-csv>Export CSV</button></div><div class="card-list">${rows.map(printingCard).join('')}</div>`);
  bindCsvExport(rows, 'printing-redemptions.csv');
  document.querySelectorAll('[data-print-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/printing/redemptions/${button.dataset.id}/${button.dataset.printAction}`, { method: 'PUT', body: '{}' });
        toast(`Request ${button.dataset.printAction} successful.`);
        renderPrinting();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  bindPrintingDownloads();
  bindSearch();
}

function printingCard(row) {
  const status = row.status;
  const files = printingFiles(row);
  const fileNames = files.map((file) => file.file_name).join(' ');
  return `
    <article class="record" data-search-row="${searchable(`${row.name} ${row.student_no} ${row.student_id} ${row.status} ${row.pages_requested} ${fileNames}`)}">
      <div>
        <h3>${esc(row.name || `Request #${row.id}`)} - ${row.pages_requested} pages</h3>
        <p class="muted">Student: ${esc(row.student_no || 'Student account')} | Points: ${row.points_required}</p>
        ${files.length ? `
          <div class="print-file-list">
            ${files.map((file) => `
              <div>
                <span>${esc(file.file_name)}</span>
                <small>${formatFileSize(file.file_size || 0)}</small>
                <button class="secondary" data-file-redemption="${row.id}" data-file-id="${file.id ?? ''}" data-file-name="${esc(file.file_name)}">Download</button>
              </div>
            `).join('')}
          </div>
        ` : '<p class="muted">No print files attached.</p>'}
        ${badge(status)}
      </div>
      <div class="actions">
        ${state.user.role === 'admin' || state.user.role === 'printing_staff' ? `
          <button data-print-action="approve" data-id="${row.id}" ${status !== 'pending' ? 'disabled' : ''}>Approve</button>
          <button class="secondary" data-print-action="reject" data-id="${row.id}" ${status !== 'pending' ? 'disabled' : ''}>Reject</button>
          <button class="secondary" data-print-action="complete" data-id="${row.id}" ${status !== 'approved' ? 'disabled' : ''}>Complete</button>
        ` : ''}
      </div>
    </article>
  `;
}

function printingFiles(row) {
  if (Array.isArray(row.files) && row.files.length) return row.files;
  return row.file_name
    ? [{ id: null, file_name: row.file_name, file_type: row.file_type, file_size: row.file_size }]
    : [];
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bindPrintingDownloads() {
  document.querySelectorAll('[data-file-redemption]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await downloadPrintingFile(
          button.dataset.fileRedemption,
          button.dataset.fileId,
          button.dataset.fileName || 'printing-file',
        );
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

async function renderReports() {
  if (state.user.role === 'organizer') {
    const [attendance, feedback] = await Promise.all([
      api('/reports/attendance'),
      api('/reports/feedback'),
    ]);
    setContent(`
      ${pageHeader('Reports', 'Organizer attendance and feedback summaries.')}
      <div class="grid two">
        <section class="panel"><div class="toolbar"><h2>Attendance</h2><button class="secondary" data-report-export="attendance">Export CSV</button></div>${attendance.map(reportMini).join('')}</section>
        <section class="panel"><div class="toolbar"><h2>Feedback</h2><button class="secondary" data-report-export="feedback">Export CSV</button></div>${feedback.map(reportMini).join('')}</section>
      </div>
    `);
    bindReportExports({ attendance, feedback });
    return;
  }

  const [attendance, feedback, points, printing] = await Promise.all([
    api('/reports/attendance'),
    api('/reports/feedback'),
    api('/reports/points'),
    api('/reports/printing'),
  ]);
  setContent(`
    ${pageHeader('Reports', 'Administrative summaries for attendance, feedback, points, and printing.')}
    <div class="grid two">
      <section class="panel"><div class="toolbar"><h2>Attendance</h2><button class="secondary" data-report-export="attendance">Export CSV</button></div>${attendance.map(reportMini).join('')}</section>
      <section class="panel"><div class="toolbar"><h2>Feedback</h2><button class="secondary" data-report-export="feedback">Export CSV</button></div>${feedback.map(reportMini).join('')}</section>
      <section class="panel"><div class="toolbar"><h2>Points</h2><button class="secondary" data-report-export="points">Export CSV</button></div>${points.map(reportMini).join('')}</section>
      <section class="panel"><div class="toolbar"><h2>Printing</h2><button class="secondary" data-report-export="printing">Export CSV</button></div>${printing.map(reportMini).join('')}</section>
    </div>
  `);
  bindReportExports({ attendance, feedback, points, printing });
}

async function renderPrintingReport() {
  const rows = await api('/reports/printing');
  setContent(`${pageHeader('Printing Report', 'Printing request volume by status.')}<div class="toolbar"><button class="secondary" data-export-csv>Export CSV</button></div><div class="card-list">${rows.map(reportCard).join('')}</div>`);
  bindCsvExport(rows, 'printing-report.csv');
}

function bindReportExports(groups) {
  document.querySelectorAll('[data-report-export]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.reportExport;
      downloadCsv(`${key}-report.csv`, groups[key] || []);
    });
  });
}

async function renderUsers() {
  const allRows = await api('/users');
  const rows = allRows.filter((row) => row.role !== 'student');
  const activeUsers = rows.filter((row) => row.status === 'active').length;
  setContent(`
    ${pageHeader('User Management', `${rows.length} staff accounts, ${activeUsers} active.`)}
    <details class="management-form" ${state.editingUser ? 'open' : ''}>
      <summary>
        <span>${state.editingUser ? 'Editing staff account' : 'Add a staff account'}</span>
        <small>${state.editingUser ? 'Update access, role, and account status.' : 'Create an admin, organizer, faculty, or printing staff login.'}</small>
      </summary>
      ${userFormHtml(state.editingUser)}
    </details>
    <div class="toolbar"><h2>Staff directory <span class="record-count">${rows.length}</span></h2>${searchBox('Search name, email, role, or status')}</div>
    <div class="card-list directory-list" data-paginate="true" data-page-size="6">${rows.map((row) => `
      <article class="record directory-card user-record" data-search-row="${searchable(`${row.name} ${row.email} ${row.role} ${row.status}`)}">
        <div class="directory-avatar staff" aria-hidden="true">${esc(personInitials(row.name))}</div>
        <div class="directory-copy">
          <h3>${esc(row.name)}</h3>
          <p class="directory-email">${esc(row.email)}</p>
          <div class="directory-meta">
            <span><small>Access role</small>${esc(row.role.replace(/_/g, ' '))}</span>
            <span><small>Account</small>${String(row.id) === String(state.user.id) ? 'Current user' : 'Staff user'}</span>
          </div>
        </div>
        <div class="actions directory-actions">
          ${badge(row.status)}
          <button class="secondary" data-edit-user="${row.id}">Edit</button>
          ${String(row.id) !== String(state.user.id) ? `<button class="danger" data-delete-user="${row.id}">Deactivate</button>` : ''}
        </div>
      </article>
    `).join('') || emptyState('No staff accounts found.', 'Create an admin, organizer, or printing staff account above.')}</div>
  `);
  bindUserForm(rows);
  bindSearch();
}

function userFormHtml(row = null) {
  const editing = Boolean(row);
  return `
    <form id="userForm" class="panel">
      <h2>${editing ? 'Edit Staff User' : 'Add Staff User'}</h2>
      <div class="grid two">
        <label>Name <input name="name" value="${esc(row?.name || '')}" required /></label>
        <label>Email <input name="email" type="email" value="${esc(row?.email || '')}" required /></label>
        <label>Password
          <span class="password-control">
            <input id="staffPassword" name="password" type="password" value="${editing ? '' : 'password123'}" ${editing ? '' : 'required'} placeholder="${editing ? 'Leave blank to keep current password' : ''}" />
            <button type="button" class="mini-button" data-toggle-password="#staffPassword">Show</button>
          </span>
        </label>
        <label>Role
          <select name="role">
            ${option('admin', 'Admin / OSA', row?.role || 'admin')}
            ${option('organizer', 'Organizer / Faculty', row?.role)}
            ${option('printing_staff', 'Printing Staff', row?.role)}
          </select>
        </label>
        <label>Status
          <select name="status">
            ${option('active', 'active', row?.status || 'active')}
            ${option('inactive', 'inactive', row?.status)}
          </select>
        </label>
      </div>
      <div class="actions">
        <button type="submit">${editing ? 'Update User' : 'Create User'}</button>
        ${editing ? '<button type="button" class="secondary" id="cancelUserEdit">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function bindUserForm(rows) {
  enhancePasswordToggles();
  document.querySelector('#userForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      if (!data.password) delete data.password;
      if (state.editingUser) {
        await api(`/users/${state.editingUser.id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('User updated.');
        state.editingUser = null;
      } else {
        await api('/users', { method: 'POST', body: JSON.stringify(data) });
        toast('User created.');
      }
      renderUsers();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#cancelUserEdit')?.addEventListener('click', () => {
    state.editingUser = null;
    renderUsers();
  });
  document.querySelectorAll('[data-edit-user]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.editingUser = rows.find((row) => String(row.id) === String(button.dataset.editUser));
      if (!state.editingUser) {
        toast('Unable to find that staff account. Refresh and try again.');
        return;
      }
      await renderUsers();
      document.querySelector('.management-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelector('#userForm input[name="name"]')?.focus({ preventScroll: true });
    });
  });
  document.querySelectorAll('[data-delete-user]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!await confirmAction('Deactivate this staff user account?', 'Deactivate staff user')) return;
      try {
        await api(`/users/${button.dataset.deleteUser}`, { method: 'DELETE' });
        toast('User deactivated.');
        renderUsers();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  bindSearch();
}

async function renderSettings() {
  const settings = await api('/settings');
  setContent(`
    ${pageHeader('System Settings', 'Control point rules, registration, printing redemption, QR scanning, and system labels.')}
    <form id="settingsForm" class="panel settings-panel">
      <div class="grid two">
        <label>Application Name <input name="app_name" value="${esc(settings.app_name)}" required /></label>
        <label>School / Office Name <input name="school_name" value="${esc(settings.school_name)}" required /></label>
        <label>Points per Printed Page <input name="points_per_printed_page" type="number" min="1" max="1000" value="${esc(settings.points_per_printed_page)}" required /></label>
        <label>Default Event Points <input name="default_event_points" type="number" min="0" max="1000" value="${esc(settings.default_event_points)}" required /></label>
      </div>
      <section class="logo-settings">
        <div class="logo-preview">
          ${settings.logo_data ? `<img id="logoPreview" src="${settings.logo_data}" alt="Current logo" />` : '<div id="logoPreview" class="brand-mark">AR</div>'}
        </div>
        <div>
          <h3>Logo</h3>
          <p class="muted">Upload a PNG, JPG, or WEBP logo. It appears on the login page and system header.</p>
          <input type="hidden" name="logo_data" id="logoData" value="${esc(settings.logo_data || '')}" />
          <div class="actions">
            <label class="file-button">Choose Logo <input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp" /></label>
            <button type="button" class="secondary" id="removeLogo">Remove Logo</button>
          </div>
        </div>
      </section>
      <div class="settings-toggles">
        ${settingsToggle('registration_enabled', 'Student Registration', 'Allow new students to register using QR and Gmail verification.', settings.registration_enabled)}
        ${settingsToggle('redemption_enabled', 'Printing Redemption', 'Allow students to submit free printing requests.', settings.redemption_enabled)}
        ${settingsToggle('qr_camera_enabled', 'QR Camera Scanner', 'Show camera scanning as an available attendance option.', settings.qr_camera_enabled)}
      </div>
      <label>Dashboard Announcement <textarea name="dashboard_announcement" placeholder="Message for administrators to remember system notes">${esc(settings.dashboard_announcement || '')}</textarea></label>
      <div class="actions">
        <button type="submit">Save Settings</button>
        <button type="button" class="secondary" id="resetSettingsForm">Reset Form</button>
      </div>
    </form>
    <section class="panel">
      <h3>Current Rules</h3>
      <div class="grid three">
        ${metricCard('Printing Rate', `${settings.points_per_printed_page}:1`, 'points per printed page', 'teal')}
        ${metricCard('Event Default', settings.default_event_points, 'points for new events', 'blue')}
        ${metricCard('Registration', settings.registration_enabled ? 'Open' : 'Closed', 'student self-registration', 'gold')}
      </div>
    </section>
  `);
  bindSettingsForm();
}

function settingsToggle(name, title, note, checked) {
  return `
    <label class="toggle-card">
      <input name="${name}" type="checkbox" ${checked ? 'checked' : ''} />
      <span>
        <strong>${esc(title)}</strong>
        <small>${esc(note)}</small>
      </span>
    </label>
  `;
}

function bindSettingsForm() {
  document.querySelector('#settingsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = formData(event.currentTarget);
      data.points_per_printed_page = Number(data.points_per_printed_page);
      data.default_event_points = Number(data.default_event_points);
      data.registration_enabled = Boolean(event.currentTarget.registration_enabled.checked);
      data.redemption_enabled = Boolean(event.currentTarget.redemption_enabled.checked);
      data.qr_camera_enabled = Boolean(event.currentTarget.qr_camera_enabled.checked);
      await api('/settings', { method: 'PUT', body: JSON.stringify(data) });
      cachedBranding = { ...(cachedBranding || {}), ...data };
      localStorage.setItem('systemSettings', JSON.stringify(cachedBranding));
      toast('System settings saved.');
      renderSettings();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#resetSettingsForm')?.addEventListener('click', renderSettings);
  document.querySelector('#logoFile')?.addEventListener('change', async (event) => {
    const file = event.currentTarget.files[0];
    if (!file) return;
    try {
      if (file.size > 900 * 1024) throw new Error('Logo must be 900KB or smaller.');
      const dataUrl = await readFileAsDataUrl(file);
      document.querySelector('#logoData').value = dataUrl;
      document.querySelector('.logo-preview').innerHTML = `<img id="logoPreview" src="${dataUrl}" alt="Selected logo" />`;
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#removeLogo')?.addEventListener('click', () => {
    document.querySelector('#logoData').value = '';
    document.querySelector('.logo-preview').innerHTML = '<div id="logoPreview" class="brand-mark">AR</div>';
  });
}

function displayReportEntries(row) {
  return Object.entries(row).filter(([key]) => {
    if (key === 'id' || key === 'user_id') return false;
    if ((key === 'student_id' || key === 'event_id') && (row.student_no || row.title || row.event_title || row.name)) return false;
    return true;
  });
}

function friendlyLabel(key) {
  return key
    .replace(/_no$/g, ' number')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function reportMini(row) {
  const entries = displayReportEntries(row);
  return `<p>${entries.map(([key, value]) => `<strong>${esc(friendlyLabel(key))}:</strong> ${esc(value)}`).join(' | ')}</p>`;
}

function reportCard(row) {
  return `<article class="record" data-search-row="${searchable(Object.values(row).join(' '))}"><div>${reportMini(row)}</div></article>`;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Unable to optimize the selected photo.'))),
      type,
      quality,
    );
  });
}

async function loadImageForCanvas(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      image.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function readOptimizedImageDataUrl(file, maxBytes = 500 * 1024, maxDimension = 1600) {
  const bitmap = await loadImageForCanvas(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap.source || bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, 'image/webp', quality);
  while (blob.size > maxBytes && quality > 0.42) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, 'image/webp', quality);
  }
  if (blob.size > maxBytes) {
    throw new Error(`${file.name} is too detailed to optimize below 500KB. Choose a smaller photo.`);
  }
  return readFileAsDataUrl(blob);
}

async function downloadPrintingFile(redemptionId, fileId, fallbackName = 'printing-file') {
  const path = fileId === null || fileId === undefined || fileId === ''
    ? `/api/printing/redemptions/${redemptionId}/file`
    : `/api/printing/redemptions/${redemptionId}/files/${fileId}`;
  const response = await fetch(path, {
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'Unable to download file.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

if (isRegisterPage) {
  renderStudentRegistration();
} else if (isForgotPasswordPage) {
  renderForgotPassword();
} else if (state.token && state.user && ((isAdminLoginPage && state.user.role !== 'student') || (!isAdminLoginPage && state.user.role === 'student'))) {
  renderShell();
} else {
  if (state.token && state.user) localStorage.clear();
  renderLogin();
}
