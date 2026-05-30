// ===== APP MODULE =====
const App = (() => {
  let state = {
    user: null,
    token: null,
    currentView: 'auth',
    projects: [],
    currentProject: null,
    notifications: [],
    socket: null
  };

  const COLORS = ['#0079bf','#d29034','#519839','#b04632','#89609e','#cd5a91','#4bbf6b','#00aecc'];
  let selectedProjectColor = COLORS[0];
  let settingsProjectColor = COLORS[0];

  // ===== INIT =====
  function init() {
    const token = localStorage.getItem('pm_token');
    const userStr = localStorage.getItem('pm_user');
    if (token && userStr) {
      state.token = token;
      state.user = JSON.parse(userStr);
      showApp();
    } else {
      showAuth();
    }

    bindModalCloseEvents();
    initAuthForms();
    initNewProjectForm();
    Board.initTaskModalEvents();
    bindNotificationEvents();
    bindUserMenuEvents();
  }

  // ===== AUTH =====
  function showAuth() {
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    const nav = document.getElementById('nav-username');
    const avatar = document.getElementById('nav-avatar');
    const da = document.getElementById('dropdown-avatar');
    const du = document.getElementById('dropdown-username');
    const de = document.getElementById('dropdown-email');

    if (state.user) {
      nav.textContent = state.user.username;
      avatar.textContent = state.user.username[0].toUpperCase();
      avatar.style.background = state.user.color || '#0079bf';
      da.textContent = state.user.username[0].toUpperCase();
      da.style.background = state.user.color || '#0079bf';
      du.textContent = state.user.username;
      de.textContent = state.user.email;
    }

    initSocket();
    loadDashboard();
    loadNotifications();
  }

  function initAuthForms() {
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', target !== 'register');
      });
    });

    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      try {
        const { token, user } = await API.login({ email, password });
        state.token = token;
        state.user = user;
        localStorage.setItem('pm_token', token);
        localStorage.setItem('pm_user', JSON.stringify(user));
        showApp();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    // Register
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('reg-username').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const errEl = document.getElementById('register-error');
      errEl.classList.add('hidden');
      try {
        const { token, user } = await API.register({ username, email, password });
        state.token = token;
        state.user = user;
        localStorage.setItem('pm_token', token);
        localStorage.setItem('pm_user', JSON.stringify(user));
        showApp();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  }

  function logout() {
    if (state.socket) state.socket.disconnect();
    localStorage.removeItem('pm_token');
    localStorage.removeItem('pm_user');
    state = { user: null, token: null, currentView: 'auth', projects: [], currentProject: null, notifications: [], socket: null };
    showAuth();
  }

  // ===== DASHBOARD =====
  async function loadDashboard() {
    showView('dashboard-view');
    try {
      state.projects = await API.getProjects();
      renderDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderDashboard() {
    const grid = document.getElementById('projects-grid');
    grid.innerHTML = '';

    state.projects.forEach(project => {
      const card = document.createElement('div');
      card.className = 'project-card';
      card.innerHTML = `
        <div class="project-card-header" style="background:${project.color}">
          <div class="project-card-title">${escHtml(project.name)}</div>
        </div>
        <div class="project-card-body">
          <div class="project-card-desc">${escHtml(project.description || 'No description')}</div>
          <div class="project-card-meta">
            <div class="project-card-stats">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                ${project.member_count}
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                ${project.task_count} tasks
              </span>
            </div>
            <span class="project-card-owner">${escHtml(project.owner_name)}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => loadBoard(project.id));
      grid.appendChild(card);
    });

    // New project button
    const newCard = document.createElement('button');
    newCard.className = 'project-card-new';
    newCard.innerHTML = '<div class="plus">+</div><span>New Project</span>';
    newCard.addEventListener('click', () => openNewProjectModal());
    grid.appendChild(newCard);
  }

  // ===== BOARD =====
  async function loadBoard(projectId) {
    showView('board-view');
    const boardEl = document.getElementById('kanban-board');
    boardEl.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
      const [project, boards] = await Promise.all([
        API.getProject(projectId),
        API.getBoards(projectId)
      ]);
      state.currentProject = project;

      document.getElementById('board-project-name').textContent = project.name;
      document.getElementById('board-project-color').style.background = project.color;

      // Render member avatars
      const membersEl = document.getElementById('board-members');
      membersEl.innerHTML = project.members.slice(0, 5).map(m =>
        `<div class="avatar" style="background:${m.color}" title="${escHtml(m.username)}">${m.username[0].toUpperCase()}</div>`
      ).join('');

      Board.render(project, boards);

      // Join socket room
      if (state.socket) {
        state.socket.emit('join-project', projectId);
      }
    } catch (e) {
      toast(e.message, 'error');
      loadDashboard();
    }
  }

  // ===== MODALS =====
  function bindModalCloseEvents() {
    document.querySelectorAll('.modal-close, [data-modal]').forEach(el => {
      el.addEventListener('click', (e) => {
        const modalId = el.dataset.modal || el.closest('.modal')?.id;
        if (modalId) document.getElementById(modalId)?.classList.add('hidden');
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });
  }

  function openNewProjectModal() {
    selectedProjectColor = COLORS[0];
    renderColorPicker('project-color-picker', COLORS, selectedProjectColor, (c) => { selectedProjectColor = c; });
    document.getElementById('new-project-name').value = '';
    document.getElementById('new-project-desc').value = '';
    document.getElementById('new-project-error').classList.add('hidden');
    document.getElementById('modal-new-project').classList.remove('hidden');
    document.getElementById('new-project-name').focus();
  }

  function initNewProjectForm() {
    document.getElementById('btn-new-project').addEventListener('click', openNewProjectModal);

    document.getElementById('form-new-project').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-project-name').value.trim();
      const description = document.getElementById('new-project-desc').value.trim();
      const errEl = document.getElementById('new-project-error');
      errEl.classList.add('hidden');

      try {
        const project = await API.createProject({ name, description, color: selectedProjectColor });
        state.projects.unshift(project);
        document.getElementById('modal-new-project').classList.add('hidden');
        loadBoard(project.id);
        toast('Project created', 'success');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    document.getElementById('nav-home').addEventListener('click', loadDashboard);
    document.getElementById('btn-back').addEventListener('click', () => {
      if (state.socket && state.currentProject) {
        state.socket.emit('leave-project', state.currentProject.id);
      }
      loadDashboard();
    });

    // Manage members
    document.getElementById('btn-manage-members').addEventListener('click', openMembersModal);

    // Project settings
    document.getElementById('btn-project-settings').addEventListener('click', openSettingsModal);
  }

  // ===== MEMBERS MODAL =====
  async function openMembersModal() {
    document.getElementById('modal-members').classList.remove('hidden');
    document.getElementById('member-search').value = '';
    document.getElementById('member-search-results').classList.add('hidden');
    await renderMembersList();
  }

  async function renderMembersList() {
    const list = document.getElementById('members-list');
    list.innerHTML = '<div class="spinner" style="margin:16px auto;width:24px;height:24px;"></div>';
    try {
      const members = await API.getMembers(state.currentProject.id);
      state.currentProject.members = members;

      list.innerHTML = members.map(m => `
        <div class="member-item" data-user-id="${m.id}">
          <div class="avatar" style="background:${m.color}">${m.username[0].toUpperCase()}</div>
          <div class="member-info">
            <div class="member-name">${escHtml(m.username)}</div>
            <div class="member-email">${escHtml(m.email)}</div>
          </div>
          <span class="role-badge role-${m.role}">${m.role}</span>
          ${m.id !== state.user.id && m.role !== 'owner' ?
            `<button class="btn-remove-member" data-user-id="${m.id}" title="Remove">Remove</button>` : ''}
        </div>
      `).join('');

      list.querySelectorAll('.btn-remove-member').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this member?')) return;
          try {
            await API.removeMember(state.currentProject.id, btn.dataset.userId);
            await renderMembersList();
            toast('Member removed');
          } catch (e) { toast(e.message, 'error'); }
        });
      });
    } catch (e) { list.innerHTML = `<p class="text-muted">${e.message}</p>`; }
  }

  function initMemberSearch() {
    const input = document.getElementById('member-search');
    const results = document.getElementById('member-search-results');
    let searchTimer;

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 2) { results.classList.add('hidden'); return; }

      searchTimer = setTimeout(async () => {
        try {
          const users = await API.searchUsers(q);
          if (!users.length) { results.innerHTML = '<div class="search-result-item"><span class="text-muted">No users found</span></div>'; }
          else {
            results.innerHTML = users.map(u => `
              <div class="search-result-item" data-user-id="${u.id}">
                <div class="avatar sm" style="background:${u.color}">${u.username[0].toUpperCase()}</div>
                <div class="search-result-info">
                  <div class="search-result-name">${escHtml(u.username)}</div>
                  <div class="search-result-email">${escHtml(u.email)}</div>
                </div>
                <button class="btn btn-sm btn-primary" data-user-id="${u.id}">Add</button>
              </div>
            `).join('');
          }
          results.classList.remove('hidden');

          results.querySelectorAll('.btn.btn-primary').forEach(btn => {
            btn.addEventListener('click', async () => {
              try {
                await API.addMember(state.currentProject.id, { userId: parseInt(btn.dataset.userId) });
                input.value = '';
                results.classList.add('hidden');
                await renderMembersList();
                toast('Member added', 'success');
              } catch (e) { toast(e.message, 'error'); }
            });
          });
        } catch (e) { results.classList.add('hidden'); }
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
    });
  }

  // ===== PROJECT SETTINGS =====
  function openSettingsModal() {
    if (!state.currentProject) return;
    settingsProjectColor = state.currentProject.color;
    document.getElementById('settings-project-name').value = state.currentProject.name;
    document.getElementById('settings-project-desc').value = state.currentProject.description || '';
    renderColorPicker('settings-color-picker', COLORS, settingsProjectColor, (c) => { settingsProjectColor = c; });
    document.getElementById('modal-project-settings').classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('form-project-settings')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.updateProject(state.currentProject.id, {
          name: document.getElementById('settings-project-name').value.trim(),
          description: document.getElementById('settings-project-desc').value.trim(),
          color: settingsProjectColor
        });
        document.getElementById('modal-project-settings').classList.add('hidden');
        await loadBoard(state.currentProject.id);
        toast('Project updated', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('btn-delete-project')?.addEventListener('click', async () => {
      if (!confirm(`Delete project "${state.currentProject?.name}"? This will delete all tasks permanently.`)) return;
      try {
        await API.deleteProject(state.currentProject.id);
        document.getElementById('modal-project-settings').classList.add('hidden');
        state.projects = state.projects.filter(p => p.id !== state.currentProject.id);
        state.currentProject = null;
        loadDashboard();
        toast('Project deleted');
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // ===== NOTIFICATIONS =====
  async function loadNotifications() {
    try {
      state.notifications = await API.getNotifications();
      renderNotifications();
    } catch (e) {}
  }

  function renderNotifications() {
    const list = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    const unread = state.notifications.filter(n => !n.read);

    badge.textContent = unread.length > 9 ? '9+' : unread.length;
    badge.classList.toggle('hidden', unread.length === 0);

    if (!state.notifications.length) {
      list.innerHTML = '<div class="notif-empty">All caught up! No notifications.</div>';
      return;
    }

    list.innerHTML = state.notifications.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}" data-related-type="${n.related_type}" data-related-id="${n.related_id}">
        ${!n.read ? '<div class="notif-dot"></div>' : '<div style="width:8px"></div>'}
        <div>
          <div class="notif-message">${escHtml(n.message)}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        const notifId = item.dataset.notifId;
        await API.markRead(notifId).catch(() => {});
        const notif = state.notifications.find(n => n.id == notifId);
        if (notif) notif.read = 1;
        renderNotifications();
        document.getElementById('notif-dropdown').classList.add('hidden');
      });
    });
  }

  function bindNotificationEvents() {
    const btn = document.getElementById('btn-notifications');
    const dropdown = document.getElementById('notif-dropdown');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
      document.getElementById('user-dropdown').classList.add('hidden');
    });

    document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
      await API.markAllRead().catch(() => {});
      state.notifications.forEach(n => n.read = 1);
      renderNotifications();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== btn) dropdown.classList.add('hidden');
    });
  }

  function bindUserMenuEvents() {
    const btn = document.getElementById('btn-user-menu');
    const dropdown = document.getElementById('user-dropdown');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
      document.getElementById('notif-dropdown').classList.add('hidden');
    });

    document.getElementById('btn-logout').addEventListener('click', logout);

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== btn) dropdown.classList.add('hidden');
    });
  }

  // ===== SOCKET =====
  function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
      if (state.user) state.socket.emit('join-user', state.user.id);
      if (state.currentProject) state.socket.emit('join-project', state.currentProject.id);
    });

    ['task:created', 'task:updated', 'task:moved', 'task:deleted',
     'board:created', 'board:updated', 'board:deleted', 'comment:added', 'comment:deleted'].forEach(event => {
      state.socket.on(event, (data) => {
        Board.handleSocketEvent(event, data);
      });
    });

    state.socket.on('notification:new', (notif) => {
      state.notifications.unshift({ ...notif, id: Date.now(), read: 0, created_at: new Date().toISOString() });
      renderNotifications();
      showToastNotif(notif.message);
    });
  }

  function showToastNotif(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>${escHtml(message)}`;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // ===== HELPERS =====
  function showView(viewId) {
    ['dashboard-view', 'board-view'].forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    document.getElementById(viewId)?.classList.remove('hidden');
  }

  function toast(message, type = '') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function renderColorPicker(containerId, colors, selected, onChange) {
    const el = document.getElementById(containerId);
    el.innerHTML = colors.map(c =>
      `<div class="color-opt ${c === selected ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`
    ).join('');
    el.querySelectorAll('.color-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        el.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        onChange(opt.dataset.color);
      });
    });
  }

  function timeAgo(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getUser() { return state.user; }

  // ===== START =====
  window.addEventListener('DOMContentLoaded', () => {
    init();
    initMemberSearch();
  });

  return { toast, getUser, loadDashboard, loadBoard };
})();
