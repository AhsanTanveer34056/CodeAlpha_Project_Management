const express = require('express');
const { getDB, isProjectMember } = require('../database');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/project/:projectId', auth, (req, res) => {
  const db = getDB();
  const { projectId } = req.params;

  if (!isProjectMember(projectId, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const boards = db.prepare(
    'SELECT * FROM boards WHERE project_id = ? ORDER BY position ASC'
  ).all(projectId);

  const tasks = db.prepare(`
    SELECT t.*, u.username as assignee_name, u.color as assignee_color,
      c.username as creator_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users c ON t.created_by = c.id
    WHERE t.project_id = ?
    ORDER BY t.position ASC
  `).all(projectId);

  const boardsWithTasks = boards.map(b => ({
    ...b,
    tasks: tasks.filter(t => t.board_id === b.id)
  }));

  res.json(boardsWithTasks);
});

router.post('/project/:projectId', auth, (req, res) => {
  const db = getDB();
  const { projectId } = req.params;

  if (!isProjectMember(projectId, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Board name required' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM boards WHERE project_id = ?').get(projectId);
  const position = (maxPos.m ?? -1) + 1;

  const result = db.prepare(
    'INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)'
  ).run(projectId, name, position);

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(result.lastInsertRowid);
  board.tasks = [];

  const io = req.app.get('io');
  io.to(`project-${projectId}`).emit('board:created', board);

  res.status(201).json(board);
});

router.put('/:id', auth, (req, res) => {
  const db = getDB();
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });

  if (!isProjectMember(board.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, req.params.id);

  const io = req.app.get('io');
  io.to(`project-${board.project_id}`).emit('board:updated', { id: board.id, name });

  res.json({ success: true, id: board.id, name });
});

router.delete('/:id', auth, (req, res) => {
  const db = getDB();
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });

  if (!isProjectMember(board.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const taskCount = db.prepare('SELECT COUNT(*) as n FROM tasks WHERE board_id = ?').get(req.params.id).n;
  if (taskCount > 0) return res.status(400).json({ error: 'Remove all tasks from this column first' });

  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);

  const io = req.app.get('io');
  io.to(`project-${board.project_id}`).emit('board:deleted', { id: board.id });

  res.json({ success: true });
});

module.exports = router;
