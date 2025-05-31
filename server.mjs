import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

dayjs.extend(customParseFormat);

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// === SUPABASE ===
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is not set!');
  process.exit(1);
}

// === AUTH HELPERS ===
function generateToken(user) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// === SIGNUP ===
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();

  if (existingUser) return res.status(409).json({ error: 'User already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('users').insert({
    id: uuidv4(),
    username,
    password: hashedPassword
  });

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ message: 'User created' });
});

// === LOGIN ===
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !user) return res.status(401).json({ error: 'Invalid username or password' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

  const token = generateToken(user);
  res.json({ token });
});

// === AUTHENTICATION MIDDLEWARE ===
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/signup') return next();
  authenticateToken(req, res, next);
});

// === CONFIG ===
app.post('/config', async (req, res) => {
  const { start_money, start_date, end_money, end_date } = req.body;

  const { data: existing } = await supabase
    .from('config')
    .select('*')
    .eq('user_id', req.user.userId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('config')
      .update({ start_money, start_date, end_money, end_date })
      .eq('user_id', req.user.userId);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabase.from('config').insert({
      id: uuidv4(),
      user_id: req.user.userId,
      start_money,
      start_date,
      end_money,
      end_date
    });
    if (error) return res.status(500).json({ error: error.message });
  }

  res.json({ message: 'Config saved' });
});

app.get('/config', async (req, res) => {
  const { data, error } = await supabase
    .from('config')
    .select('*')
    .eq('user_id', req.user.userId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Config not found' });
  res.json(data);
});

// === TRANSACTIONS ===
app.post('/transactions', async (req, res) => {
  const transaction = { ...req.body, id: uuidv4(), user_id: req.user.userId };
  const { error } = await supabase.from('transactions').insert(transaction);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: transaction.id });
});

app.get('/transactions', async (req, res) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/transactions/:id', async (req, res) => {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.userId);

  if (error) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ message: 'Transaction deleted' });
});

// === SPENDINGS ===
app.post('/spendings', async (req, res) => {
  const spending = { ...req.body, id: uuidv4(), user_id: req.user.userId };
  const { error } = await supabase.from('spendings').insert(spending);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: spending.id });
});

app.get('/spendings', async (req, res) => {
  const { data, error } = await supabase
    .from('spendings')
    .select('*')
    .eq('user_id', req.user.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/spendings/:id', async (req, res) => {
  const { error } = await supabase
    .from('spendings')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.userId);

  if (error) return res.status(404).json({ error: 'Spending not found' });
  res.json({ message: 'Spending deleted' });
});

// === DAILY ALLOWANCE ===
app.get('/daily-allowance/:date', async (req, res) => {
  const { date } = req.params;

  const { data: config, error: configError } = await supabase
    .from('config')
    .select('*')
    .eq('user_id', req.user.userId)
    .single();

  if (configError || !config) return res.status(400).json({ error: 'Config not set' });

  const parsedDate = dayjs(date.replace(/_/g, '/'), 'DD/MM/YYYY');
  const start = dayjs(config.start_date, 'DD/MM/YYYY');
  const end = dayjs(config.end_date, 'DD/MM/YYYY');

  if (parsedDate.isBefore(start) || parsedDate.isAfter(end)) {
    return res.status(400).json({ error: 'Date is out of bounds' });
  }

  const totalDays = end.diff(start, 'day') + 1;

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.userId);

  const { data: spendings } = await supabase
    .from('spendings')
    .select('*')
    .eq('user_id', req.user.userId);

  let remainingMoney = config.start_money - config.end_money +
    (transactions?.reduce((sum, t) => sum + (t.is_income ? t.amount : -t.amount), 0) || 0);

  let current = start;

  while (current.isBefore(parsedDate, 'day')) {
    const spentToday = (spendings?.filter(s => dayjs(s.date, 'DD/MM/YYYY').isSame(current, 'day'))
      .reduce((sum, s) => sum + s.amount, 0)) || 0;

    const daysLeft = end.diff(current, 'day');
    if (daysLeft <= 0) break;

    const todayAllowance = remainingMoney / daysLeft;
    remainingMoney -= spentToday;

    current = current.add(1, 'day');
  }

  const remainingDays = end.diff(parsedDate, 'day') + 1;
  const finalAllowance = remainingMoney / remainingDays;

  res.json({ dailyAllowance: Number(finalAllowance.toFixed(2)) });
});

// === START SERVER ===
app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});
