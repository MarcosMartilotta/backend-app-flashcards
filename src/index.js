const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// --- CORS ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }
    next();
});

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
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

const generateToken = (user) => {
    return jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role,
        depende: user.depende,
        clase: user.clase,
        institucion: user.institucion
    }, JWT_SECRET, { expiresIn: '30d' });
};

// --- AUTH ENDPOINTS ---

app.post('/auth/register', async (req, res) => {
    const { email, name, password, role, institucion } = req.body;
    try {
        const password_hash = await bcrypt.hash(password, 10);
        const finalRole = role || 'student';
        const finalInst = institucion || '';

        const [result] = await pool.query(
            "INSERT INTO users (email, name, password_hash, role, depende, clase, institucion) VALUES (?, ?, ?, ?, 0, '', ?)",
            [email, name, password_hash, finalRole, finalInst]
        );

        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        const user = rows[0];
        const token = generateToken(user);

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                institucion: user.institucion
            }
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
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

        const token = generateToken(user);
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                institucion: user.institucion,
                depende: user.depende,
                clase: user.clase
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- CARD ENDPOINTS ---

app.get('/cards', authenticateToken, async (req, res) => {
    const { id: userId, role, depende, clase } = req.user;
    try {
        let sql = `
            SELECT DISTINCT c.*, COALESCE(uc.is_active, 1) as is_active 
            FROM cards c
            LEFT JOIN user_cards uc ON c.id = uc.card_id AND uc.user_id = ?
            WHERE uc.user_id = ? 
        `;
        let params = [userId, userId];

        if (role === 'student' && depende) {
            sql += ` OR (c.teacher_id = ? AND (c.clase = ? OR c.clase = 'TODAS')) `;
            params.push(depende, clase);
        } else if (role === 'teacher') {
            sql += ` OR (c.teacher_id = ?) `;
            params.push(userId);
        }

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (err) {
        console.error("GET /cards error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/cards', authenticateToken, async (req, res) => {
    const { pregunta, respuesta, selectedClase } = req.body;
    const { id: userId, role } = req.user;

    if (!pregunta?.trim() || !respuesta?.trim()) {
        return res.status(400).json({ error: 'Pregunta and respuesta are required' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // If teacher, save teacher_id and clase
        const teacherId = role === 'teacher' ? userId : null;
        const cardClase = (role === 'teacher' && selectedClase) ? selectedClase : null;

        const [result] = await connection.query(
            'INSERT INTO cards (pregunta, respuesta, teacher_id, clase) VALUES (?, ?, ?, ?)',
            [pregunta, respuesta, teacherId, cardClase]
        );
        const cardId = result.insertId;

        await connection.query('INSERT INTO user_cards (user_id, card_id, is_active) VALUES (?, ?, ?)', [userId, cardId, 1]);

        await connection.commit();
        res.json({ id: cardId, pregunta, respuesta, is_active: 1, teacher_id: teacherId, clase: cardClase });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("POST /cards error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

app.put('/cards/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { pregunta, respuesta } = req.body;
    try {
        await pool.query('UPDATE cards SET pregunta = ?, respuesta = ? WHERE id = ?', [pregunta, respuesta, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/cards/:id/toggle-archive', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    const userId = req.user.id;
    try {
        await pool.query(
            'INSERT INTO user_cards (user_id, card_id, is_active) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_active = ?',
            [userId, id, is_active, is_active]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/cards/batch-archive', authenticateToken, async (req, res) => {
    const { updates } = req.body;
    const userId = req.user.id;
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'Updates must be an array' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        for (const update of updates) {
            await connection.query(
                'INSERT INTO user_cards (user_id, card_id, is_active) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_active = ?',
                [userId, update.card_id, update.is_active, update.is_active]
            );
        }
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- TEACHER ENDPOINTS ---

// Search students by email (autocomplete)
app.get('/teachers/students/search', authenticateToken, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Forbidden' });
    const query = req.query.q;
    const { institucion } = req.user;
    try {
        const [rows] = await pool.query(
            "SELECT id, email, name FROM users WHERE role = 'student' AND (email LIKE ? OR name LIKE ?) AND institucion = ? LIMIT 10",
            [`%${query}%`, `%${query}%`, institucion]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all distinct classes for this teacher
app.get('/teachers/classes', authenticateToken, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Forbidden' });
    try {
        const [rows] = await pool.query(
            'SELECT DISTINCT clase FROM users WHERE depende = ?',
            [req.user.id]
        );
        res.json(rows.map(r => r.clase).filter(c => c !== null));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get students in a class
app.get('/teachers/classes/:className/students', authenticateToken, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Forbidden' });
    const { className } = req.params;
    try {
        const [rows] = await pool.query(
            'SELECT id, email, name FROM users WHERE depende = ? AND clase = ?',
            [req.user.id, className]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create/Update class and assign students
app.post('/teachers/classes', authenticateToken, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Forbidden' });
    const { className, studentIds } = req.body;
    if (!className || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ error: 'Class name and at least one student required' });
    }

    const { institucion } = req.user;
    try {
        await pool.query(
            "UPDATE users SET depende = ?, clase = ? WHERE id IN (?) AND institucion = ?",
            [req.user.id, className, studentIds, institucion]
        );
        res.json({ success: true, message: 'Students assigned to class' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove student from class
app.delete('/teachers/classes/:className/students/:studentId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Forbidden' });
    const { studentId } = req.params;
    try {
        await pool.query(
            "UPDATE users SET depende = 0, clase = '' WHERE id = ? AND depende = ?",
            [studentId, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('API running on port 3000');
});
