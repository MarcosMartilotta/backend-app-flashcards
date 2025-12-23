const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secret-key';

// --- MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// --- AUTH ENDPOINTS ---

app.post('/auth/register', async (req, res) => {
    const { email, name, password } = req.body;
    try {
        // Encriptar contraseña
        const password_hash = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
            [email, name, password_hash]
        );

        // Generar token
        const token = jwt.sign({ id: result.insertId, email }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: { id: result.insertId, email, name }
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            user: { id: user.id, email: user.email, name: user.name }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/health', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/cards', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await pool.query(`
            SELECT c.*, COALESCE(uc.is_active, 1) as is_active 
            FROM cards c
            LEFT JOIN user_cards uc ON c.id = uc.card_id AND uc.user_id = ?
        `, [userId]);
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

app.put('/cards/:id', authenticateToken, async (req, res) => {
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

app.post('/cards/:id/toggle-archive', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body; // 1 for active, 0 for learned/archived
    const userId = req.user.id;
    try {
        await pool.query(`
            INSERT INTO user_cards (user_id, card_id, is_active) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)
        `, [userId, id, is_active]);
        res.json({ success: true, card_id: id, is_active });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('API running on port 3000');
});
