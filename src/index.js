const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

app.get('/health', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/cards', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cards');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/cards', async (req, res) => {
    const { pregunta, respuesta } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO cards (pregunta, respuesta) VALUES (?, ?)', [pregunta, respuesta]);
        res.json({ id: result.insertId, pregunta, respuesta });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/cards/:id', async (req, res) => {
    const { id } = req.params;
    const { pregunta, respuesta } = req.body;
    try {
        await pool.query('UPDATE cards SET pregunta = ?, respuesta = ? WHERE id = ?', [pregunta, respuesta, id]);
        res.json({ id, pregunta, respuesta });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('API running on port 3000');
});
