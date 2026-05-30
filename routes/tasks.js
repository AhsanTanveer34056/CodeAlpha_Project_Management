const express = require('express');
const { getDB, isProjectMember, createNotification } = require('../database');
const { auth } = require('../middleware/auth');

const router = express.Router();

function getTaskWithDetails(db, taskId) {
  return db.prepare(`
    SELECT t.*, u.username as assignee_name, u.color as assignee_color,
      c.username as creator_name, b.name as board_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users c ON t.created_by = c.id
    LEFT JOIN boards b ON t.board_id = b.id
    WHERE t.id = ?
  `).get(taskId);
}

router.get('/:id', auth, (req, res) => {
  const db = getDB();
  const task = getTaskWithDetails(db, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isProjectMember(task.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  res.json(task);
});

router.post('/board/:boardId', auth, (req, res) => {
  const db = getDB();
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.boardId);
  if (!board) return res.status(404).json({ error: 'Board not found' });

  if (!isProjectMember(board.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const { title, description, assigned_to, due_date, priority, labels } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE board_id = ?').get(board.id);
  const position = (maxPos.m ?? -1) + 1;

  const result = db.prepare(`
    INSERT INTO tasks (board_id, project_id, title, description, assigned_to, created_by, due_date, priority, position, labels)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    board.id, board.project_id, title, description || '', assigned_to || null,
    req.user.id, due_date || null, priority || 'medium', position,
    JSON.stringify(labels || [])
  );

  const task = getTaskWithDetails(db, result.lastInsertRowid);

  // Notify assignee
  const io = req.app.get('io');
  if (assigned_to && assigned_to !== req.user.id) {
    const msg = `${req.user.username} assigned you to task "${title}"`;
    createNotification(db, assigned_to, 'task_assigned', msg, 'task', task.id);
    io.to(`user-${assigned_to}`).emit('notification:new', {
      type: 'task_assigned', message: msg, related_type: 'task', related_id: task.id
    });
  }

  io.to(`project-${board.project_id}`).emit('task:created', task);
  res.status(201).json(task);
});

router.put('/:id', auth, (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isProjectMember(task.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const { title, description, assigned_to, due_date, priority, labels } = req.body;
  const newAssignee = assigned_to !== undefined ? assigned_to : task.assigned_to;
  const newTitle = title || task.title;

  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, assigned_to = ?, due_date = ?,
      priority = ?, labels = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    newTitle,
    description !== undefined ? description : task.description,
    newAssignee || null,
    due_date !== undefined ? due_date : task.due_date,
    priority || task.priority,
    labels ? JSON.stringify(labels) : task.labels,
    req.params.id
  );

  const updated = getTaskWithDetails(db, req.params.id);

  // Notify if new assignee
  const io = req.app.get('io');
  if (newAssignee && newAssignee !== task.assigned_to && newAssignee !== req.user.id) {
    const msg = `${req.user.username} assigned you to task "${updated.title}"`;
    createNotification(db, newAssignee, 'task_assigned', msg, 'task', task.id);
    io.to(`user-${newAssignee}`).emit('notification:new', {
      type: 'task_assigned', message: msg, related_type: 'task', related_id: task.id
    });
  }

  io.to(`project-${task.project_id}`).emit('task:updated', updated);
  res.json(updated);
});

router.patch('/:id/move', auth, (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isProjectMember(task.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const { board_id } = req.body;
  if (!board_id) return res.status(400).json({ error: 'board_id required' });

  const targetBoard = db.prepare('SELECT * FROM boards WHERE id = ? AND project_id = ?').get(board_id, task.project_id);
  if (!targetBoard) return res.status(400).json({ error: 'Invalid target board' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE board_id = ?').get(board_id);
  const position = (maxPos.m ?? -1) + 1;

  db.prepare('UPDATE tasks SET board_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(board_id, position, req.params.id);

  const updated = getTaskWithDetails(db, req.params.id);
  const io = req.app.get('io');
  io.to(`project-${task.project_id}`).emit('task:moved', {
    taskId: task.id, fromBoardId: task.board_id, toBoardId: parseInt(board_id), task: updated
  });

  res.json(updated);
});

router.delete('/:id', auth, (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isProjectMember(task.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);

  const io = req.app.get('io');
  io.to(`project-${task.project_id}`).emit('task:deleted', {
    taskId: task.id, boardId: task.board_id
  });

  res.json({ success: true });
});

module.exports = router;
