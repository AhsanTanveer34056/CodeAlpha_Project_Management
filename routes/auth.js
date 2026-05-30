const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../database');
const { auth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const COLORS = ['#0079bf', '#d29034', '#519839', '#b04632', '#89609e', '#cd5a91', '#4bbf6b', '#00aecc'];

router.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDB();
  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(400).json({ error: 'Email or username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const result = db.prepare(
    'INSERT INTO users (username, email, password, color) VALUES (?, ?, ?, ?)'
  ).run(username, email, hash, color);

  const token = jwt.sign({ id: result.lastInsertRowid, username, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: result.lastInsertRowid, username, email, color } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, color: user.color } });
});

router.get('/me', auth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT id, username, email, color, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.get('/users/search', auth, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json([]);
  const db = getDB();
  const users = db.prepare(
    'SELECT id, username, email, color FROM users WHERE (username LIKE ? OR email LIKE ?) AND id != ? LIMIT 10'
  ).all(`%${q}%`, `%${q}%`, req.user.id);
  res.json(users);
});

module.exports = router;
