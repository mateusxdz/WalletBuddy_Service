import express from 'express';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is not set!');
  process.exit(1);
}

// Setup lowdb
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { 
  users: [],       // <-- add users array
  config: null, 
  transactions: [], 
  spendings: [] 
});
await db.read();
db.data = db.data || { users: [], config: {}, transactions: [], spendings: [] };
await db.write();
// Helper: Save DB
async function saveDb() {
  await db.write();
}

// --- AUTH HELPERS ---

// Generate JWT token for user
function generateToken(user) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
}

// Middleware to protect routes
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Authorization header missing' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // store user info in request
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- SIGN UP ---
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Check if user already exists
  const existingUser = db.data.users.find(u => u.username === username);
  if (existingUser) {
    return res.status(409).json({ error: 'User already exists' });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = {
    id: uuidv4(),
    username,
    password: hashedPassword,
  };

  db.data.users.push(user);
  await saveDb();

  res.status(201).json({ message: 'User created' });
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = db.data.users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Generate token
  const token = generateToken(user);

  res.json({ token });
});

// --- PROTECT ALL OTHER ENDPOINTS ---

// Middleware to require login for following routes
app.use((req, res, next) => {
  // Allow login and signup without token
  if (req.path === '/login' || req.path === '/signup') {
    return next();
  }
  authenticateToken(req, res, next);
});

// === CONFIG ===
// Store config per user
app.post('/config', async (req, res) => {
  const { start_money, start_date, end_money, end_date } = req.body;

  if (!db.data.config) db.data.config = {};

  db.data.config[req.user.userId] = { start_money, start_date, end_money, end_date };
  await saveDb();

  res.json({ message: 'Config saved' });
});

app.get('/config', async (req, res) => {
  const config = db.data.config ? db.data.config[req.user.userId] : null;
  if (!config) return res.status(404).json({ error: 'Config not found' });
  res.json(config);
});

// === TRANSACTIONS ===
// Only return transactions for user
app.post('/transactions', async (req, res) => {
  const transactionid = uuidv4();
  const transaction = { ...req.body, transactionid, userId: req.user.userId };
  db.data.transactions.push(transaction);
  await saveDb();
  res.json({ id: transactionid });
});

app.get('/transactions', async (req, res) => {
  const userTransactions = db.data.transactions.filter(t => t.userId === req.user.userId);
  res.json(userTransactions);
});

app.delete('/transactions/:id', async (req, res) => {
  const { id } = req.params;
  const originalLength = db.data.transactions.length;
  db.data.transactions = db.data.transactions.filter(t => !(t.transactionid === id && t.userId === req.user.userId));

  if (db.data.transactions.length === originalLength) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  await saveDb();
  res.json({ message: 'Transaction deleted successfully.' });
});

// === SPENDINGS ===
app.post('/spendings', async (req, res) => {
  const spendingid = uuidv4();
  const spending = { ...req.body, spendingid, userId: req.user.userId };
  db.data.spendings.push(spending);
  await saveDb();
  res.json({ id: spendingid });
});

app.get('/spendings', async (req, res) => {
  const userSpendings = db.data.spendings.filter(s => s.userId === req.user.userId);
  res.json(userSpendings);
});

app.delete('/spendings/:id', async (req, res) => {
  const { id } = req.params;
  const originalLength = db.data.spendings.length;
  db.data.spendings = db.data.spendings.filter(s => !(s.spendingid === id && s.userId === req.user.userId));

  if (db.data.spendings.length === originalLength) {
    return res.status(404).json({ error: 'Spending not found' });
  }

  await saveDb();
  res.json({ message: 'Spending deleted successfully.' });
});

// === DAILY ALLOWANCE ===
app.get('/daily-allowance/:date', async (req, res) => {
  const { date } = req.params;

  const config = db.data.config ? db.data.config[req.user.userId] : null;
  if (!config) {
    return res.status(400).json({ error: 'Config not set' });
  }

  const { start_money, start_date, end_money, end_date } = config;
  const parsedDate = dayjs(date.replace(/_/g, '/'), 'DD/MM/YYYY');
  const start = dayjs(start_date, 'DD/MM/YYYY');
  const end = dayjs(end_date, 'DD/MM/YYYY');

  if (parsedDate.isBefore(start) || parsedDate.isAfter(end)) {
    return res.status(400).json({ error: 'Date is out of bounds' });
  }

  const totalDays = end.diff(start, 'day') + 1;
  
  // Only consider user's transactions
  let remainingMoney = start_money - end_money +
    db.data.transactions
      .filter(t => t.userId === req.user.userId)
      .reduce((sum, t) => sum + (t.isIncome ? t.amount : -t.amount), 0);

  let current = start;

  while (current.isBefore(parsedDate, 'day')) {
    const spentToday = db.data.spendings
      .filter(s => s.userId === req.user.userId && dayjs(s.date, 'DD/MM/YYYY').isSame(current, 'day'))
      .reduce((sum, s) => sum + s.amount, 0);

    const daysLeft = end.diff(current, 'day');
    if (daysLeft <= 0) break;

    const todayAllowance = remainingMoney / daysLeft;
    remainingMoney -= spentToday;

    current = current.add(1, 'day');
  }

  const remainingDays = end.diff(parsedDate, 'day') + 1;
  const finalAllowance = remainingMoney / remainingDays;

  res.json({
    dailyAllowance: Number(finalAllowance.toFixed(2))
  });
});

// === START SERVER ===
app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});
