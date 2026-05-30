// ===== BOARD MODULE =====
const Board = (() => {
  let currentBoards = [];
  let currentProject = null;
  let dragTaskId = null;
  let dragSourceBoardId = null;

  const COLORS = ['#0079bf','#d29034','#519839','#b04632','#89609e','#cd5a91','#4bbf6b','#00aecc','#838c91'];
  const LABEL_COLORS = ['#0052cc','#36b37e','#ff991f','#de350b','#6554c0','#00b8d9','#403294','#006644'];
  let selectedLabelColor = LABEL_COLORS[0];
  let currentTaskId = null;
  let currentTaskData = null;
  let saveTimer = null;

  function priorityLabel(p) {
    const map = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    return map[p] || p;
  }

  function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function isOverdue(d) {
    if (!d) return false;
    return new Date(d) < new Date();
  }

  function avatarColor(username) {
    const COLS = ['#0079bf','#d29034','#519839','#b04632','#89609e','#cd5a91','#4bbf6b','#00aecc'];
    let h = 0;
    for (let i = 0; i < username.length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
    return COLS[Math.abs(h) % COLS.length];
  }

  function makeAvatar(username, color, cls = '') {
    const bg = color || avatarColor(username);
    return `<div class="avatar ${cls}" style="background:${bg}">${username[0].toUpperCase()}</div>`;
  }

  function timeAgo(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function render(project, boards) {
    currentProject = project;
    currentBoards = boards;
    const container = document.getElementById('kanban-board');
    container.innerHTML = '';

    boards.forEach(board => {
      container.appendChild(makeColumn(board));
    });

    // Add column button
    container.appendChild(makeAddColumnBtn());
    initDragDrop();
  }

  function makeColumn(board) {
    const col = document.createElement('div');
    col.className = 'kanban-col';
    col.dataset.boardId = board.id;

    col.innerHTML = `
      <div class="col-header">
        <div class="col-title-wrap">
          <span class="col-title">${escHtml(board.name)}</span>
          <span class="col-count">${board.tasks.length}</span>
        </div>
        <button class="col-menu-btn" data-board-id="${board.id}" title="Column options">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
      </div>
      <div class="col-tasks" data-board-id="${board.id}">
        ${board.tasks.map(t => makeTaskCardHTML(t)).join('')}
      </div>
      <div class="col-footer">
        <button class="btn-add-task" data-board-id="${board.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add task
        </button>
      </div>
    `;

    col.querySelector('.col-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showColMenu(board, e.currentTarget);
    });

    col.querySelector('.btn-add-task').addEventListener('click', () => {
      showInlineAddTask(board.id, col.querySelector('.col-tasks'));
    });

    col.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTaskModal(parseInt(card.dataset.taskId)));
    });

    return col;
  }

  function makeTaskCardHTML(task) {
    const labels = JSON.parse(task.labels || '[]');
    const labelChips = labels.map(l =>
      `<span class="label-chip" style="background:${l.color || '#0079bf'};min-width:36px;display:inline-block;">&nbsp;</span>`
    ).join('');
    const overdue = isOverdue(task.due_date);
    return `
      <div class="task-card" data-task-id="${task.id}" draggable="true">
        ${labels.length ? `<div class="task-card-labels">${labelChips}</div>` : ''}
        <div class="task-card-title">${escHtml(task.title)}</div>
        <div class="task-card-footer">
          <div class="task-card-meta">
            <span class="priority-badge priority-${task.priority}">${priorityLabel(task.priority)}</span>
            ${task.due_date ? `<span class="due-date-chip ${overdue ? 'overdue' : ''}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${formatDate(task.due_date)}
            </span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${task.assignee_name ? makeAvatar(task.assignee_name, task.assignee_color, 'task-card-assignee') : ''}
          </div>
        </div>
      </div>
    `;
  }

  function makeAddColumnBtn() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<button class="btn-add-col" id="btn-add-column">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add column
    </button>`;
    wrap.querySelector('#btn-add-column').addEventListener('click', showAddColumnForm);
    return wrap;
  }

  function showAddColumnForm() {
    const board = document.getElementById('kanban-board');
    const existing = board.querySelector('.add-col-form');
    if (existing) { existing.querySelector('input').focus(); return; }

    const btn = board.querySelector('#btn-add-column');
    const form = document.createElement('div');
    form.className = 'add-col-form';
    form.innerHTML = `
      <input type="text" placeholder="Column name..." maxlength="40" />
      <div class="add-col-form-btns">
        <button class="btn btn-primary btn-sm" id="btn-save-col">Add</button>
        <button class="btn btn-ghost btn-sm" id="btn-cancel-col">Cancel</button>
      </div>
    `;
    board.insertBefore(form, btn.parentElement);
    const input = form.querySelector('input');
    input.focus();

    form.querySelector('#btn-save-col').addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        const newBoard = await API.createBoard(currentProject.id, { name });
        newBoard.tasks = [];
        currentBoards.push(newBoard);
        render(currentProject, currentBoards);
      } catch (e) { App.toast(e.message, 'error'); }
    });

    form.querySelector('#btn-cancel-col').addEventListener('click', () => render(currentProject, currentBoards));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') form.querySelector('#btn-save-col').click();
      if (e.key === 'Escape') render(currentProject, currentBoards);
    });
  }

  function showColMenu(board, btn) {
    document.querySelectorAll('.col-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'col-context-menu';
    menu.style.cssText = 'position:absolute;';
    menu.innerHTML = `
      <div class="col-context-item" id="ctx-rename">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Rename
      </div>
      <div class="col-context-item danger" id="ctx-delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        Delete column
      </div>
    `;
    document.body.appendChild(menu);

    const rect = btn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;

    menu.querySelector('#ctx-rename').addEventListener('click', () => {
      menu.remove();
      const col = document.querySelector(`.kanban-col[data-board-id="${board.id}"]`);
      const titleEl = col.querySelector('.col-title');
      const oldName = titleEl.textContent;
      titleEl.contentEditable = 'true';
      titleEl.focus();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);

      const save = async () => {
        titleEl.contentEditable = 'false';
        const newName = titleEl.textContent.trim();
        if (newName && newName !== oldName) {
          try {
            await API.updateBoard(board.id, { name: newName });
            board.name = newName;
          } catch (e) { titleEl.textContent = oldName; App.toast(e.message, 'error'); }
        } else { titleEl.textContent = oldName; }
      };
      titleEl.addEventListener('blur', save, { once: true });
      titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
    });

    menu.querySelector('#ctx-delete').addEventListener('click', async () => {
      menu.remove();
      const taskCount = currentBoards.find(b => b.id === board.id)?.tasks.length || 0;
      if (taskCount > 0) { App.toast('Move all tasks out of this column first', 'error'); return; }
      if (!confirm(`Delete column "${board.name}"?`)) return;
      try {
        await API.deleteBoard(board.id);
        currentBoards = currentBoards.filter(b => b.id !== board.id);
        render(currentProject, currentBoards);
        App.toast('Column deleted');
      } catch (e) { App.toast(e.message, 'error'); }
    });

    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 10);
  }

  function showInlineAddTask(boardId, tasksEl) {
    const existing = tasksEl.querySelector('.add-task-form');
    if (existing) { existing.querySelector('textarea').focus(); return; }

    const form = document.createElement('div');
    form.className = 'add-task-form';
    form.innerHTML = `
      <textarea placeholder="Task title..." rows="2" maxlength="200"></textarea>
      <div class="add-task-form-actions">
        <button class="btn btn-primary btn-sm" id="btn-save-task">Add Task</button>
        <button class="btn btn-ghost btn-sm" id="btn-cancel-task">Cancel</button>
      </div>
    `;
    tasksEl.appendChild(form);
    form.querySelector('textarea').focus();

    form.querySelector('#btn-save-task').addEventListener('click', async () => {
      const title = form.querySelector('textarea').value.trim();
      if (!title) return;
      try {
        const task = await API.createTask(boardId, { title });
        const board = currentBoards.find(b => b.id === boardId);
        if (board) board.tasks.push(task);
        render(currentProject, currentBoards);
        App.toast('Task created', 'success');
      } catch (e) { App.toast(e.message, 'error'); }
    });

    form.querySelector('#btn-cancel-task').addEventListener('click', () => {
      form.remove();
    });

    form.querySelector('textarea').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.querySelector('#btn-save-task').click(); }
      if (e.key === 'Escape') form.remove();
    });
  }

  // ===== DRAG AND DROP =====
  function initDragDrop() {
    document.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragend', handleDragEnd);
    });

    document.querySelectorAll('.col-tasks').forEach(zone => {
      zone.addEventListener('dragover', handleDragOver);
      zone.addEventListener('drop', handleDrop);
      zone.addEventListener('dragenter', handleDragEnter);
      zone.addEventListener('dragleave', handleDragLeave);
    });
  }

  function handleDragStart(e) {
    dragTaskId = parseInt(this.dataset.taskId);
    const col = this.closest('.kanban-col');
    dragSourceBoardId = parseInt(col.dataset.boardId);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragTaskId);
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.col-tasks').forEach(z => z.classList.remove('drag-over'));
    dragTaskId = null;
    dragSourceBoardId = null;
  }

  function handleDragEnter(e) {
    e.preventDefault();
    this.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    if (!this.contains(e.relatedTarget)) this.classList.remove('drag-over');
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    const targetBoardId = parseInt(this.dataset.boardId);
    if (!dragTaskId || targetBoardId === dragSourceBoardId) return;

    try {
      const updated = await API.moveTask(dragTaskId, targetBoardId);
      const srcBoard = currentBoards.find(b => b.id === dragSourceBoardId);
      const dstBoard = currentBoards.find(b => b.id === targetBoardId);
      if (srcBoard) srcBoard.tasks = srcBoard.tasks.filter(t => t.id !== dragTaskId);
      if (dstBoard) dstBoard.tasks.push(updated);
      render(currentProject, currentBoards);
    } catch (e) { App.toast(e.message, 'error'); }
  }

  // ===== TASK MODAL =====
  async function openTaskModal(taskId) {
    currentTaskId = taskId;
    const modal = document.getElementById('modal-task');
    modal.classList.remove('hidden');

    try {
      const [task, comments] = await Promise.all([
        API.getTask(taskId),
        API.getComments(taskId)
      ]);
      currentTaskData = task;
      renderTaskModal(task, comments);
    } catch (e) {
      App.toast(e.message, 'error');
      modal.classList.add('hidden');
    }
  }

  function renderTaskModal(task, comments) {
    const board = currentBoards.find(b => b.id === task.board_id);

    document.getElementById('task-board-label').textContent = board ? board.name : '';
    document.getElementById('task-board-label').style.setProperty('--dot-color', currentProject?.color || '#0079bf');

    const titleEl = document.getElementById('task-title-display');
    titleEl.textContent = task.title;

    const descEl = document.getElementById('task-description-display');
    descEl.textContent = task.description || '';

    document.getElementById('task-priority-select').value = task.priority || 'medium';
    document.getElementById('task-due-date').value = task.due_date || '';
    document.getElementById('task-creator').textContent = task.creator_name || '';
    document.getElementById('task-created-at').textContent = formatDate(task.created_at);

    // Board select
    const boardSel = document.getElementById('task-board-select');
    boardSel.innerHTML = currentBoards.map(b =>
      `<option value="${b.id}" ${b.id === task.board_id ? 'selected' : ''}>${escHtml(b.name)}</option>`
    ).join('');

    // Assignee select
    const assigneeSel = document.getElementById('task-assignee-select');
    assigneeSel.innerHTML = '<option value="">Unassigned</option>' +
      (currentProject?.members || []).map(m =>
        `<option value="${m.id}" ${m.id === task.assigned_to ? 'selected' : ''}>${escHtml(m.username)}</option>`
      ).join('');

    // Labels
    renderLabels(JSON.parse(task.labels || '[]'));

    // Comments
    renderComments(comments);

    // Comment avatar
    const user = App.getUser();
    const commentAvatar = document.getElementById('comment-avatar');
    if (user) commentAvatar.style.background = user.color || '#0079bf';
    commentAvatar.textContent = user ? user.username[0].toUpperCase() : '';
  }

  function renderLabels(labels) {
    const wrap = document.getElementById('task-labels');
    wrap.innerHTML = labels.map((l, i) =>
      `<span class="label-tag" style="background:${l.color}">
        ${escHtml(l.text)}
        <span class="remove-label" data-idx="${i}">×</span>
      </span>`
    ).join('');

    wrap.querySelectorAll('.remove-label').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const newLabels = labels.filter((_, i) => i !== idx);
        try {
          const updated = await API.updateTask(currentTaskId, { labels: newLabels });
          updateTaskInBoards(updated);
          renderLabels(newLabels);
        } catch (e) { App.toast(e.message, 'error'); }
      });
    });
  }

  function renderComments(comments) {
    const list = document.getElementById('comments-list');
    if (!comments.length) {
      list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);font-style:italic;">No comments yet.</div>';
      return;
    }
    list.innerHTML = comments.map(c => `
      <div class="comment-item" data-comment-id="${c.id}">
        ${makeAvatar(c.username, c.color, 'sm')}
        <div class="comment-content">
          <div class="comment-header">
            <span class="comment-author">${escHtml(c.username)}</span>
            <span class="comment-time">${timeAgo(c.created_at)}</span>
            ${c.user_id === App.getUser()?.id ? `<button class="comment-delete" data-comment-id="${c.id}">Delete</button>` : ''}
          </div>
          <div class="comment-body">${escHtml(c.content)}</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.comment-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this comment?')) return;
        try {
          await API.deleteComment(btn.dataset.commentId);
          const [,refreshedComments] = await Promise.all([null, API.getComments(currentTaskId)]);
          renderComments(await API.getComments(currentTaskId));
        } catch (e) { App.toast(e.message, 'error'); }
      });
    });
  }

  function updateTaskInBoards(updatedTask) {
    currentBoards.forEach(board => {
      const idx = board.tasks.findIndex(t => t.id === updatedTask.id);
      if (idx !== -1) board.tasks[idx] = updatedTask;
    });
    const card = document.querySelector(`.task-card[data-task-id="${updatedTask.id}"]`);
    if (card) {
      const parent = card.parentElement;
      const newCard = document.createElement('div');
      newCard.innerHTML = makeTaskCardHTML(updatedTask);
      const newEl = newCard.firstElementChild;
      parent.replaceChild(newEl, card);
      newEl.addEventListener('click', () => openTaskModal(updatedTask.id));
      newEl.draggable = true;
      newEl.addEventListener('dragstart', handleDragStart);
      newEl.addEventListener('dragend', handleDragEnd);
    }
  }

  function initTaskModalEvents() {
    const modal = document.getElementById('modal-task');

    // Auto-save title on blur
    const titleEl = document.getElementById('task-title-display');
    titleEl.addEventListener('blur', async () => {
      if (!currentTaskId) return;
      const newTitle = titleEl.textContent.trim();
      if (!newTitle || newTitle === currentTaskData?.title) return;
      try {
        const updated = await API.updateTask(currentTaskId, { title: newTitle });
        currentTaskData = updated;
        updateTaskInBoards(updated);
      } catch (e) { App.toast(e.message, 'error'); titleEl.textContent = currentTaskData?.title || ''; }
    });

    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

    // Auto-save description
    const descEl = document.getElementById('task-description-display');
    descEl.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (!currentTaskId) return;
        try {
          const updated = await API.updateTask(currentTaskId, { description: descEl.textContent });
          currentTaskData = updated;
          updateTaskInBoards(updated);
        } catch (e) { App.toast(e.message, 'error'); }
      }, 800);
    });

    // Priority change
    document.getElementById('task-priority-select').addEventListener('change', async (e) => {
      if (!currentTaskId) return;
      try {
        const updated = await API.updateTask(currentTaskId, { priority: e.target.value });
        currentTaskData = updated;
        updateTaskInBoards(updated);
      } catch (e) { App.toast(e.message, 'error'); }
    });

    // Due date change
    document.getElementById('task-due-date').addEventListener('change', async (e) => {
      if (!currentTaskId) return;
      try {
        const updated = await API.updateTask(currentTaskId, { due_date: e.target.value || null });
        currentTaskData = updated;
        updateTaskInBoards(updated);
      } catch (e) { App.toast(e.message, 'error'); }
    });

    // Assignee change
    document.getElementById('task-assignee-select').addEventListener('change', async (e) => {
      if (!currentTaskId) return;
      try {
        const updated = await API.updateTask(currentTaskId, { assigned_to: e.target.value ? parseInt(e.target.value) : null });
        currentTaskData = updated;
        updateTaskInBoards(updated);
      } catch (e) { App.toast(e.message, 'error'); }
    });

    // Board (column) change
    document.getElementById('task-board-select').addEventListener('change', async (e) => {
      if (!currentTaskId) return;
      const newBoardId = parseInt(e.target.value);
      try {
        const updated = await API.moveTask(currentTaskId, newBoardId);
        const srcBoard = currentBoards.find(b => b.tasks.some(t => t.id === currentTaskId));
        const dstBoard = currentBoards.find(b => b.id === newBoardId);
        if (srcBoard) srcBoard.tasks = srcBoard.tasks.filter(t => t.id !== currentTaskId);
        if (dstBoard) dstBoard.tasks.push(updated);
        currentTaskData = updated;
        document.getElementById('task-board-label').textContent = dstBoard?.name || '';
        render(currentProject, currentBoards);
        App.toast('Task moved', 'success');
      } catch (e) { App.toast(e.message, 'error'); }
    });

    // Comment submit
    const commentInput = document.getElementById('comment-input');
    const btnSubmit = document.getElementById('btn-submit-comment');

    commentInput.addEventListener('focus', () => { btnSubmit.style.display = 'inline-flex'; });
    commentInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!commentInput.value.trim()) btnSubmit.style.display = 'none';
      }, 200);
    });

    btnSubmit.addEventListener('click', async () => {
      const content = commentInput.value.trim();
      if (!content || !currentTaskId) return;
      try {
        await API.addComment(currentTaskId, content);
        commentInput.value = '';
        btnSubmit.style.display = 'none';
        renderComments(await API.getComments(currentTaskId));
      } catch (e) { App.toast(e.message, 'error'); }
    });

    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnSubmit.click(); }
    });

    // Label add
    const labelInput = document.getElementById('label-input');
    document.getElementById('btn-add-label').addEventListener('click', async () => {
      const text = labelInput.value.trim();
      if (!text || !currentTaskId) return;
      const current = JSON.parse(currentTaskData?.labels || '[]');
      const newLabels = [...current, { text, color: selectedLabelColor }];
      try {
        const updated = await API.updateTask(currentTaskId, { labels: newLabels });
        currentTaskData = updated;
        updateTaskInBoards(updated);
        renderLabels(newLabels);
        labelInput.value = '';
      } catch (e) { App.toast(e.message, 'error'); }
    });

    labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-add-label').click(); });

    // Delete task
    document.getElementById('btn-delete-task').addEventListener('click', async () => {
      if (!currentTaskId) return;
      if (!confirm('Delete this task? This cannot be undone.')) return;
      try {
        await API.deleteTask(currentTaskId);
        currentBoards.forEach(b => { b.tasks = b.tasks.filter(t => t.id !== currentTaskId); });
        modal.classList.add('hidden');
        currentTaskId = null;
        render(currentProject, currentBoards);
        App.toast('Task deleted');
      } catch (e) { App.toast(e.message, 'error'); }
    });
  }

  // ===== SOCKET UPDATES =====
  function handleSocketEvent(event, data) {
    switch (event) {
      case 'task:created':
        const brd = currentBoards.find(b => b.id === data.board_id);
        if (brd && !brd.tasks.find(t => t.id === data.id)) {
          brd.tasks.push(data);
          render(currentProject, currentBoards);
        }
        break;

      case 'task:updated':
        currentBoards.forEach(b => {
          const idx = b.tasks.findIndex(t => t.id === data.id);
          if (idx !== -1) b.tasks[idx] = data;
        });
        if (currentTaskId === data.id) {
          currentTaskData = data;
          document.getElementById('task-title-display').textContent = data.title;
          document.getElementById('task-description-display').textContent = data.description || '';
        }
        render(currentProject, currentBoards);
        break;

      case 'task:moved':
        const src = currentBoards.find(b => b.id === data.fromBoardId);
        const dst = currentBoards.find(b => b.id === data.toBoardId);
        if (src) src.tasks = src.tasks.filter(t => t.id !== data.taskId);
        if (dst && !dst.tasks.find(t => t.id === data.taskId)) dst.tasks.push(data.task);
        render(currentProject, currentBoards);
        break;

      case 'task:deleted':
        currentBoards.forEach(b => { b.tasks = b.tasks.filter(t => t.id !== data.taskId); });
        if (currentTaskId === data.taskId) document.getElementById('modal-task').classList.add('hidden');
        render(currentProject, currentBoards);
        break;

      case 'board:created':
        if (!currentBoards.find(b => b.id === data.id)) {
          currentBoards.push(data);
          render(currentProject, currentBoards);
        }
        break;

      case 'board:updated':
        const b = currentBoards.find(b => b.id === data.id);
        if (b) { b.name = data.name; render(currentProject, currentBoards); }
        break;

      case 'board:deleted':
        currentBoards = currentBoards.filter(b => b.id !== data.id);
        render(currentProject, currentBoards);
        break;

      case 'comment:added':
        if (currentTaskId === data.taskId && document.getElementById('modal-task').classList.contains('hidden') === false) {
          API.getComments(currentTaskId).then(renderComments);
        }
        break;
    }
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getCurrentBoards() { return currentBoards; }
  function getCurrentProject() { return currentProject; }

  return { render, openTaskModal, initTaskModalEvents, handleSocketEvent, getCurrentBoards, getCurrentProject };
})();
