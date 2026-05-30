const express = require('express');
const { getDB, isProjectMember, createNotification } = require('../database');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/task/:taskId', auth, (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isProjectMember(task.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const comments = db.prepare(`
    SELECT c.*, u.username, u.color
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.task_id = ? ORDER BY c.created_at ASC
  `).all(req.params.taskId);

  res.json(comments);
});

router.post('/task/:taskId', auth, (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isProjectMember(task.project_id, req.user.id))
    return res.status(403).json({ error: 'Access denied' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Comment content required' });

  const result = db.prepare(
    'INSERT INTO comments (task_id, user_id, content) VALUES (?, ?, ?)'
  ).run(req.params.taskId, req.user.id, content.trim());

  const comment = db.prepare(`
    SELECT c.*, u.username, u.color
    FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?
  `).get(result.lastInsertRowid);

  // Notify task creator and assignee (if different from commenter)
  const io = req.app.get('io');
  const msg = `${req.user.username} commented on task "${task.title}"`;
  const notifyUsers = new Set();

  if (task.created_by !== req.user.id) notifyUsers.add(task.created_by);
  if (task.assigned_to && task.assigned_to !== req.user.id) notifyUsers.add(task.assigned_to);

  notifyUsers.forEach(uid => {
    createNotification(db, uid, 'comment_added', msg, 'task', task.id);
    io.to(`user-${uid}`).emit('notification:new', {
      type: 'comment_added', message: msg, related_type: 'task', related_id: task.id
    });
  });

  io.to(`project-${task.project_id}`).emit('comment:added', {
    taskId: task.id, comment
  });

  res.status(201).json(comment);
});

router.delete('/:id', auth, (req, res) => {
  const db = getDB();
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Can only delete your own comments' });

  const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(comment.task_id);

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);

  const io = req.app.get('io');
  if (task) {
    io.to(`project-${task.project_id}`).emit('comment:deleted', {
      commentId: comment.id, taskId: comment.task_id
    });
  }

  res.json({ success: true });
});

module.exports = router;
