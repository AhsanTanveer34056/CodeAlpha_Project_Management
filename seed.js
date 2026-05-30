const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.db');

async function seed() {
  // Remove existing DB
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const { initDB, getDB } = require('./database');
  await initDB();
  const db = getDB();

  const bcrypt = require('bcryptjs');
  const hash = (p) => bcrypt.hashSync(p, 10);

  // ── Users ──────────────────────────────────────────────────────────────
  const users = [
    { username: 'alice',   email: 'alice@demo.com',   password: 'password123', color: '#0079bf' },
    { username: 'bob',     email: 'bob@demo.com',     password: 'password123', color: '#d29034' },
    { username: 'carol',   email: 'carol@demo.com',   password: 'password123', color: '#519839' },
    { username: 'david',   email: 'david@demo.com',   password: 'password123', color: '#b04632' },
    { username: 'eva',     email: 'eva@demo.com',     password: 'password123', color: '#89609e' },
  ];

  const userIds = {};
  for (const u of users) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (username, email, password, color) VALUES (?, ?, ?, ?)'
    ).run(u.username, u.email, hash(u.password), u.color);
    userIds[u.username] = lastInsertRowid;
  }
  console.log('✔ Users created:', Object.keys(userIds).join(', '));

  // ── Helper ─────────────────────────────────────────────────────────────
  function addMember(projectId, userId, role = 'member') {
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
      .run(projectId, userId, role);
  }

  function addTask(boardId, projectId, { title, desc = '', assigned, createdBy, due, priority = 'medium', labels = [] }) {
    const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE board_id = ?').get(boardId);
    const pos = (maxPos.m ?? -1) + 1;
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO tasks (board_id, project_id, title, description, assigned_to, created_by, due_date, priority, position, labels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(boardId, projectId, title, desc, assigned || null, createdBy, due || null, priority, pos, JSON.stringify(labels));
    return lastInsertRowid;
  }

  function addComment(taskId, userId, content) {
    db.prepare('INSERT INTO comments (task_id, user_id, content) VALUES (?, ?, ?)').run(taskId, userId, content);
  }

  // ── PROJECT 1: Website Redesign ────────────────────────────────────────
  const p1 = db.prepare(
    'INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)'
  ).run('Website Redesign', 'Complete overhaul of the marketing site — new design system, faster load times, improved mobile UX.', '#0079bf', userIds.alice).lastInsertRowid;

  addMember(p1, userIds.alice, 'owner');
  addMember(p1, userIds.bob,   'admin');
  addMember(p1, userIds.carol, 'member');
  addMember(p1, userIds.david, 'member');

  // boards: To Do=b1_1, In Progress=b1_2, Review=b1_3, Done=b1_4
  const b1_1 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p1, 'To Do',       0).lastInsertRowid;
  const b1_2 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p1, 'In Progress', 1).lastInsertRowid;
  const b1_3 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p1, 'Review',      2).lastInsertRowid;
  const b1_4 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p1, 'Done',        3).lastInsertRowid;

  const t1 = addTask(b1_1, p1, { title: 'Define new color palette & typography', priority: 'high', createdBy: userIds.alice, assigned: userIds.carol, due: '2026-06-10', labels: [{ text: 'Design', color: '#89609e' }] });
  const t2 = addTask(b1_1, p1, { title: 'Audit current site for accessibility issues', priority: 'medium', createdBy: userIds.alice, assigned: userIds.bob, due: '2026-06-12' });
  const t3 = addTask(b1_2, p1, { title: 'Redesign homepage hero section', priority: 'urgent', createdBy: userIds.alice, assigned: userIds.carol, due: '2026-06-05', labels: [{ text: 'Design', color: '#89609e' }, { text: 'Frontend', color: '#0079bf' }] });
  const t4 = addTask(b1_2, p1, { title: 'Implement new navigation component', priority: 'high', createdBy: userIds.bob, assigned: userIds.david, due: '2026-06-08', labels: [{ text: 'Frontend', color: '#0079bf' }] });
  const t5 = addTask(b1_3, p1, { title: 'Cross-browser testing (Chrome, Firefox, Safari)', priority: 'medium', createdBy: userIds.bob, assigned: userIds.bob, due: '2026-06-03' });
  const t6 = addTask(b1_4, p1, { title: 'Set up CI/CD pipeline for staging', priority: 'high', createdBy: userIds.alice, assigned: userIds.david, desc: 'Using GitHub Actions → Vercel. Already deployed to staging.vercel.app.' });
  const t7 = addTask(b1_4, p1, { title: 'Create component library in Storybook', priority: 'medium', createdBy: userIds.carol, assigned: userIds.carol });

  addComment(t3, userIds.alice, 'The new hero mockup looks amazing, Carol! Can we also add a subtle animation on scroll?');
  addComment(t3, userIds.carol, 'On it! I\'ll add a fade-in with a slight upward translate. Should be smooth at 60fps.');
  addComment(t3, userIds.bob,   'Make sure we keep it under 200ms duration so it doesn\'t feel sluggish on mobile.');
  addComment(t4, userIds.david, 'Almost done with the nav. Sticky behaviour is working, just ironing out the mobile drawer.');
  addComment(t4, userIds.bob,   'Great — also please add keyboard trap for accessibility when the drawer is open.');
  addComment(t5, userIds.bob,   'Found a flexbox gap issue in Safari 15. Fixed with a fallback margin. Marking as done shortly.');
  addComment(t6, userIds.alice, 'Pipeline is green ✅. Deployments now happen automatically on every merge to main.');

  console.log('✔ Project 1 (Website Redesign) seeded');

  // ── PROJECT 2: Mobile App v2.0 ─────────────────────────────────────────
  const p2 = db.prepare(
    'INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)'
  ).run('Mobile App v2.0', 'Major release featuring dark mode, push notifications, offline support, and a redesigned onboarding flow.', '#519839', userIds.bob).lastInsertRowid;

  addMember(p2, userIds.bob,   'owner');
  addMember(p2, userIds.alice, 'admin');
  addMember(p2, userIds.eva,   'member');
  addMember(p2, userIds.david, 'member');

  const b2_1 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p2, 'Backlog',     0).lastInsertRowid;
  const b2_2 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p2, 'In Progress', 1).lastInsertRowid;
  const b2_3 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p2, 'QA',          2).lastInsertRowid;
  const b2_4 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p2, 'Released',    3).lastInsertRowid;

  const t8  = addTask(b2_1, p2, { title: 'Design dark mode token system', priority: 'high', createdBy: userIds.bob, assigned: userIds.eva, due: '2026-06-15', labels: [{ text: 'Design', color: '#89609e' }] });
  const t9  = addTask(b2_1, p2, { title: 'Research push notification providers (FCM vs APNs)', priority: 'medium', createdBy: userIds.alice, due: '2026-06-10' });
  const t10 = addTask(b2_2, p2, { title: 'Implement offline-first data sync with SQLite', priority: 'urgent', createdBy: userIds.bob, assigned: userIds.david, due: '2026-06-07', desc: 'Use SQLite + background sync queue. Must handle conflict resolution.', labels: [{ text: 'Backend', color: '#d29034' }, { text: 'Critical', color: '#de350b' }] });
  const t11 = addTask(b2_2, p2, { title: 'Redesign onboarding flow (3 steps → 1 screen)', priority: 'high', createdBy: userIds.bob, assigned: userIds.eva, due: '2026-06-09', labels: [{ text: 'Design', color: '#89609e' }] });
  const t12 = addTask(b2_3, p2, { title: 'QA: Regression testing on iOS 17 & Android 14', priority: 'high', createdBy: userIds.alice, assigned: userIds.alice });
  const t13 = addTask(b2_4, p2, { title: 'App Store & Play Store listing update', priority: 'low', createdBy: userIds.bob, assigned: userIds.bob, desc: 'Updated screenshots, descriptions, and keywords for v2.0.' });

  addComment(t10, userIds.david, 'Sync queue is working for most cases. Still debugging the edge case where the user goes offline mid-transaction.');
  addComment(t10, userIds.bob,   'Let\'s add a local journal/write-ahead log pattern. It handles this case cleanly.');
  addComment(t10, userIds.alice, 'Agreed. Also make sure we emit a toast notification when sync resumes after offline period.');
  addComment(t11, userIds.eva,   'New onboarding fits in a single scroll. Tested on iPhone SE and it still looks great on small screens!');
  addComment(t11, userIds.bob,   'Love it. Ship it to QA when ready 🚀');
  addComment(t12, userIds.alice, 'Found 2 minor UI glitches on Android 14 — notch overlap in landscape mode. Filing tickets.');

  console.log('✔ Project 2 (Mobile App v2.0) seeded');

  // ── PROJECT 3: Q3 Marketing Campaign ──────────────────────────────────
  const p3 = db.prepare(
    'INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)'
  ).run('Q3 Marketing Campaign', 'Launch campaign for the summer product line. Covers social media, email sequences, landing pages, and paid ads.', '#d29034', userIds.carol).lastInsertRowid;

  addMember(p3, userIds.carol, 'owner');
  addMember(p3, userIds.alice, 'member');
  addMember(p3, userIds.eva,   'admin');

  const b3_1 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p3, 'Ideas',       0).lastInsertRowid;
  const b3_2 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p3, 'In Progress', 1).lastInsertRowid;
  const b3_3 = db.prepare('INSERT INTO boards (project_id, name, position) VALUES (?, ?, ?)').run(p3, 'Done',        2).lastInsertRowid;

  const t14 = addTask(b3_1, p3, { title: 'Draft 5 email subject line variations for A/B test', priority: 'medium', createdBy: userIds.carol, assigned: userIds.eva, due: '2026-06-14' });
  const t15 = addTask(b3_1, p3, { title: 'Create 30-day social media content calendar', priority: 'high', createdBy: userIds.carol, assigned: userIds.carol, due: '2026-06-11', labels: [{ text: 'Social', color: '#cd5a91' }] });
  const t16 = addTask(b3_2, p3, { title: 'Design campaign landing page', priority: 'urgent', createdBy: userIds.carol, assigned: userIds.alice, due: '2026-06-06', labels: [{ text: 'Design', color: '#89609e' }, { text: 'Frontend', color: '#0079bf' }] });
  const t17 = addTask(b3_2, p3, { title: 'Set up Google Ads & Meta Ads campaigns', priority: 'high', createdBy: userIds.eva, assigned: userIds.eva, due: '2026-06-08' });
  const t18 = addTask(b3_3, p3, { title: 'Define campaign KPIs and reporting dashboard', priority: 'medium', createdBy: userIds.carol, assigned: userIds.carol });
  const t19 = addTask(b3_3, p3, { title: 'Competitor analysis report', priority: 'low', createdBy: userIds.eva, assigned: userIds.eva, desc: 'Analyzed 8 competitors. Report shared in Notion.' });

  addComment(t16, userIds.alice, 'Landing page is 80% done. Adding the countdown timer widget and then it\'s ready for review.');
  addComment(t16, userIds.carol, 'Looks stunning, Alice! Make sure the CTA button is above the fold on mobile.');
  addComment(t17, userIds.eva,   'Initial budgets set — $500/day on Meta, $300/day on Google. Will optimize after first 48h of data.');

  console.log('✔ Project 3 (Q3 Marketing Campaign) seeded');

  // ── Notifications ──────────────────────────────────────────────────────
  const notifs = [
    [userIds.alice, 'task_assigned',    'Bob assigned you to "Audit current site for accessibility issues"',         'task', t2],
    [userIds.carol, 'comment_added',    'Alice commented on "Redesign homepage hero section"',                       'task', t3],
    [userIds.david, 'task_assigned',    'Bob assigned you to "Implement offline-first data sync with SQLite"',       'task', t10],
    [userIds.alice, 'added_to_project', 'Bob added you to project "Mobile App v2.0"',                               'project', p2],
    [userIds.eva,   'added_to_project', 'Bob added you to project "Mobile App v2.0"',                               'project', p2],
    [userIds.alice, 'added_to_project', 'Carol added you to project "Q3 Marketing Campaign"',                       'project', p3],
    [userIds.bob,   'comment_added',    'David commented on "Implement offline-first data sync with SQLite"',        'task', t10],
  ];

  for (const [uid, type, msg, rtype, rid] of notifs) {
    db.prepare(
      'INSERT INTO notifications (user_id, type, message, related_type, related_id) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, type, msg, rtype, rid);
  }

  console.log('✔ Notifications seeded');
  console.log('\n─────────────────────────────────────────');
  console.log('  Seed complete! Login with any account:');
  console.log('  Email:    alice@demo.com (or bob / carol / david / eva)');
  console.log('  Password: password123');
  console.log('─────────────────────────────────────────\n');
}

seed().catch(console.error);
