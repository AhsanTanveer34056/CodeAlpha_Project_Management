const express = require('express');
const { getDB, isProjectMember, createNotification } = require('../database');
const { auth } = require('../middleware/auth');

const router = express.Router();
const COLORS = ['#0079bf', '#d29034', '#519839', '#b04632', '#89609e', '#cd5a91', '#4bbf6b', '#00aecc'];

router.get('/', auth, (req, res) => {
  const db = getDB();
  const projects = db.prepare(`
    SELECT p.*, u.username as owner_name, u.color as owner_color,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
      pm.role as my_role
    FROM projects p
    JOIN users u ON p.owner_id = u.id
    JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id);
  res.json(projects);
});

router.post('/', auth, (req, res) => {
  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });

  const db = getDB();
  const projectColor = color || COLORS[Math.floor(Math.random() * COLORS.length)];

  const insertProject = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)'
    ).run(name, description || '', projectColor, req.user.id);

    const projectId = result.lastInsertRowid;

    // Add creator as owner member
    db.prepare(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
    ).run(projectId, req.user.id, 'owner');

    // Create default boards
    const defaults = ['To Do', 'In Progress', 'Done'];
    defaults.forEach((name, i) => {
      db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(projectId, name, i);
    });

    return projectId;
  });

  const projectId = insertProject();
  const project = db.prepare(`
    SELECT p.*, u.username as owner_name,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
      'owner' as my_role
    FROM projects p JOIN users u ON p.owner_id = u.id WHERE p.id = ?
  `).get(projectId);

  res.status(201).json(project);
});

router.get('/:id', auth, (req, res) => {
  const db = getDB();
  if (!isProjectMember(req.params.id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const project = db.prepare(`
    SELECT p.*, u.username as owner_name, u.color as owner_color
    FROM projects p JOIN users u ON p.owner_id = u.id WHERE p.id = ?
  `).get(req.params.id);

  if (!project) return res.status(404).json({ error: 'Project not found' });

  const members = db.prepare(`
    SELECT u.id, u.username, u.email, u.color, pm.role
    FROM project_members pm JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ? ORDER BY pm.role DESC, u.username
  `).all(req.params.id);

  res.json({ ...project, members });
});

router.put('/:id', auth, (req, res) => {
  const db = getDB();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only owner can edit' });

  const { name, description, color } = req.body;
  db.prepare(
    'UPDATE projects SET name = ?, description = ?, color = ? WHERE id = ?'
  ).run(name || project.name, description ?? project.description, color || project.color, req.params.id);

  res.json({ success: true });
});

router.delete('/:id', auth, (req, res) => {
  const db = getDB();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only owner can delete' });

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/:id/members', auth, (req, res) => {
  const db = getDB();
  if (!isProjectMember(req.params.id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const members = db.prepare(`
    SELECT u.id, u.username, u.email, u.color, pm.role, pm.joined_at
    FROM project_members pm JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ? ORDER BY pm.role DESC, u.username
  `).all(req.params.id);

  res.json(members);
});

router.post('/:id/members', auth, (req, res) => {
  const db = getDB();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const myRole = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!myRole || myRole.role === 'member') return res.status(403).json({ error: 'Insufficient permissions' });

  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (existing) return res.status(400).json({ error: 'User already a member' });

  db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(
    req.params.id, userId, role || 'member'
  );

  // Notification
  const io = req.app.get('io');
  const notifMsg = `You were added to project "${project.name}"`;
  createNotification(db, userId, 'added_to_project', notifMsg, 'project', project.id);
  io.to(`user-${userId}`).emit('notification:new', {
    type: 'added_to_project', message: notifMsg, related_type: 'project', related_id: project.id
  });

  const member = db.prepare('SELECT u.id, u.username, u.email, u.color, pm.role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ? AND pm.user_id = ?')
    .get(req.params.id, userId);

  res.status(201).json(member);
});

router.delete('/:id/members/:userId', auth, (req, res) => {
  const db = getDB();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const targetUserId = parseInt(req.params.userId);
  if (targetUserId === project.owner_id) return res.status(400).json({ error: 'Cannot remove owner' });

  const myRole = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  // Allow self-remove or admin/owner to remove others
  if (targetUserId !== req.user.id && (!myRole || myRole.role === 'member'))
    return res.status(403).json({ error: 'Insufficient permissions' });

  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.params.id, targetUserId);
  res.json({ success: true });
});

module.exports = router;
