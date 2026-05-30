const API = (() => {
  const BASE = '/api';

  function getToken() {
    return localStorage.getItem('pm_token');
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  return {
    // Auth
    register: (d) => request('POST', '/auth/register', d),
    login: (d) => request('POST', '/auth/login', d),
    me: () => request('GET', '/auth/me'),
    searchUsers: (q) => request('GET', `/auth/users/search?q=${encodeURIComponent(q)}`),

    // Projects
    getProjects: () => request('GET', '/projects'),
    createProject: (d) => request('POST', '/projects', d),
    getProject: (id) => request('GET', `/projects/${id}`),
    updateProject: (id, d) => request('PUT', `/projects/${id}`, d),
    deleteProject: (id) => request('DELETE', `/projects/${id}`),
    getMembers: (id) => request('GET', `/projects/${id}/members`),
    addMember: (id, d) => request('POST', `/projects/${id}/members`, d),
    removeMember: (id, uid) => request('DELETE', `/projects/${id}/members/${uid}`),

    // Boards
    getBoards: (projectId) => request('GET', `/boards/project/${projectId}`),
    createBoard: (projectId, d) => request('POST', `/boards/project/${projectId}`, d),
    updateBoard: (id, d) => request('PUT', `/boards/${id}`, d),
    deleteBoard: (id) => request('DELETE', `/boards/${id}`),

    // Tasks
    getTask: (id) => request('GET', `/tasks/${id}`),
    createTask: (boardId, d) => request('POST', `/tasks/board/${boardId}`, d),
    updateTask: (id, d) => request('PUT', `/tasks/${id}`, d),
    moveTask: (id, boardId) => request('PATCH', `/tasks/${id}/move`, { board_id: boardId }),
    deleteTask: (id) => request('DELETE', `/tasks/${id}`),

    // Comments
    getComments: (taskId) => request('GET', `/comments/task/${taskId}`),
    addComment: (taskId, content) => request('POST', `/comments/task/${taskId}`, { content }),
    deleteComment: (id) => request('DELETE', `/comments/${id}`),

    // Notifications
    getNotifications: () => request('GET', '/notifications'),
    markRead: (id) => request('PATCH', `/notifications/${id}/read`),
    markAllRead: () => request('PATCH', '/notifications/read-all'),
  };
})();
