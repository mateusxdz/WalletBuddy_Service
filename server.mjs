import express from 'express';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import cors from 'cors';

dayjs.extend(customParseFormat);

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// Setup lowdb
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { 
  config: null, 
  transactions: [], 
  spendings: [] 
});
await db.read();

// === CONFIG

app.post('/config', async (req, res) => {
  const { start_money, start_date, end_money, end_date } = req.body;
  db.data.config = { start_money, start_date, end_money, end_date };
  await db.write();
  res.json({ message: 'Config saved' });
});

app.get('/config', async (req, res) => {
  res.json(db.data.config);
});

// === TRANSACTIONS ===

app.post('/transactions', async (req, res) => {
  const transactionid = uuidv4();
  const transaction = { ...req.body, transactionid };
  db.data.transactions.push(transaction);
  await db.write();
  res.json({ id: transactionid });
});

app.get('/transactions', async (req, res) => {
  res.json(db.data.transactions);
});

app.delete('/transactions/:id', async (req, res) => {
  db.data.transactions = db.data.transactions.filter(t => t.transactionid !== req.params.id);
  await db.write();
  res.json({ message: 'Transaction deleted successfully.' });
});

// === SPENDINGS ===

app.post('/spendings', async (req, res) => {
  const spendingid = uuidv4();
  const spending = { ...req.body, spendingid };
  db.data.spendings.push(spending);
  await db.write();
  res.json({ id: spendingid });
});

app.get('/spendings', async (req, res) => {
  res.json(db.data.spendings);
});

app.delete('/spendings/:id', async (req, res) => {
  const { id } = req.params;
  const originalLength = db.data.spendings.length;
  db.data.spendings = db.data.spendings.filter(s => s.spendingid !== id);

  if (db.data.spendings.length === originalLength) {
    return res.status(404).json({ error: 'Spending not found' });
  }

  await db.write();
  res.json({ message: 'Spending deleted successfully.' });
});

// === DAILY ALLOWANCE ===

app.get('/daily-allowance/:date', async (req, res) => {
  const { date } = req.params;

  if (!db.data.config) {
    return res.status(400).json({ error: 'Config not set' });
  }

  const { start_money, start_date, end_money, end_date } = db.data.config;
  const parsedDate = dayjs(date.replace(/_/g, '/'), 'DD/MM/YYYY');
  const start = dayjs(start_date, 'DD/MM/YYYY');
  const end = dayjs(end_date, 'DD/MM/YYYY');

  if (parsedDate.isBefore(start) || parsedDate.isAfter(end)) {
    return res.status(400).json({ error: 'Date is out of bounds' });
  }

  const totalDays = end.diff(start, 'day') + 1;
  let remainingMoney = start_money - end_money +
    db.data.transactions.reduce((sum, t) => sum + (t.isIncome ? t.amount : -t.amount), 0);

  let current = start;

  while (current.isBefore(parsedDate, 'day')) {
    const spentToday = db.data.spendings
      .filter(s => dayjs(s.date, 'DD/MM/YYYY').isSame(current, 'day'))
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
