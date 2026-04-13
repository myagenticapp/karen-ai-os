import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import multer from 'multer';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { createReadStream, mkdirSync, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Setup ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Uploads directory
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Database ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'karen.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS interactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT    NOT NULL,
    original_text TEXT  NOT NULL,
    summary     TEXT    NOT NULL,
    objectives  TEXT    NOT NULL DEFAULT '[]',
    decisions   TEXT    NOT NULL DEFAULT '[]',
    next_step   TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    interaction_id INTEGER REFERENCES interactions(id) ON DELETE SET NULL,
    title          TEXT    NOT NULL,
    responsible    TEXT    NOT NULL DEFAULT 'Karen',
    due_date       TEXT,
    priority       TEXT    NOT NULL DEFAULT 'media' CHECK(priority IN ('alta','media','baja')),
    status         TEXT    NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_progreso','hecha')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `audio_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB Whisper limit
  fileFilter: (_req, file, cb) => {
    const allowed = /audio\//;
    cb(null, allowed.test(file.mimetype));
  },
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── OpenAI helpers ───────────────────────────────────────────────────────────
async function structureExecutiveText(text, sourceType) {
  const today = new Date().toISOString().split('T')[0];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Eres la asistente ejecutiva personal de la directora de un laboratorio farmacéutico.
Tu única función es analizar el texto que se te proporciona y devolver un JSON estructurado.

REGLAS ESTRICTAS:
1. Devuelve ÚNICAMENTE JSON válido, sin backticks, sin texto adicional, sin explicaciones.
2. No inventes hechos que no estén en el texto original.
3. Si no hay datos para un campo, usa arrays vacíos [] o null según corresponda.
4. La responsable por defecto de las tareas es "Karen" si no se menciona otra persona.
5. Las tareas deben ser concretas y accionables (verbos en infinitivo).
6. Las fechas deben estar en formato YYYY-MM-DD. Hoy es ${today}. Interpreta referencias relativas (mañana, próxima semana, etc.).
7. El source_type del texto es: ${sourceType}.

ESTRUCTURA JSON REQUERIDA (exacta, sin modificar campos):
{
  "summary": "Resumen ejecutivo conciso del contenido",
  "objectives": ["objetivo 1", "objetivo 2"],
  "decisions": ["decisión 1", "decisión 2"],
  "tasks": [
    {
      "title": "Acción concreta a realizar",
      "responsible": "Nombre o Karen",
      "due_date": "YYYY-MM-DD o null",
      "priority": "alta|media|baja",
      "status": "pendiente"
    }
  ],
  "next_step": "El paso inmediato más importante a tomar"
}`,
      },
      {
        role: 'user',
        content: `Analiza el siguiente texto de tipo "${sourceType}" y estructúralo:\n\n${text}`,
      },
    ],
  });

  const raw = completion.choices[0].message.content.trim();
  return JSON.parse(raw);
}

async function transcribeAudio(filePath) {
  const stream = createReadStream(filePath);
  const transcription = await openai.audio.transcriptions.create({
    file: stream,
    model: 'whisper-1',
    language: 'es',
  });
  return transcription.text;
}

function saveInteractionAndTasks(sourceType, originalText, structured) {
  const insertInteraction = db.prepare(`
    INSERT INTO interactions (source_type, original_text, summary, objectives, decisions, next_step)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertTask = db.prepare(`
    INSERT INTO tasks (interaction_id, title, responsible, due_date, priority, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    const result = insertInteraction.run(
      sourceType,
      originalText,
      structured.summary || '',
      JSON.stringify(structured.objectives || []),
      JSON.stringify(structured.decisions || []),
      structured.next_step || ''
    );
    const interactionId = result.lastInsertRowid;

    for (const task of structured.tasks || []) {
      insertTask.run(
        interactionId,
        task.title,
        task.responsible || 'Karen',
        task.due_date || null,
        ['alta', 'media', 'baja'].includes(task.priority) ? task.priority : 'media',
        'pendiente'
      );
    }

    return interactionId;
  });

  return run();
}

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /api/process-text
app.post('/api/process-text', async (req, res) => {
  try {
    const { text, sourceType } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'El campo "text" es requerido y no puede estar vacío.' });
    }
    if (!sourceType) {
      return res.status(400).json({ error: 'El campo "sourceType" es requerido.' });
    }

    const structured = await structureExecutiveText(text.trim(), sourceType);
    const interactionId = saveInteractionAndTasks(sourceType, text.trim(), structured);

    res.json({ success: true, interactionId, data: structured });
  } catch (err) {
    console.error('[process-text]', err);
    res.status(500).json({ error: 'Error al procesar el texto.', detail: err.message });
  }
});

// POST /api/process-audio
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo de audio.' });
    }
    const sourceType = req.body.sourceType || 'audio';

    const transcription = await transcribeAudio(filePath);
    const structured = await structureExecutiveText(transcription, sourceType);
    const interactionId = saveInteractionAndTasks(sourceType, transcription, structured);

    res.json({ success: true, interactionId, transcription, data: structured });
  } catch (err) {
    console.error('[process-audio]', err);
    res.status(500).json({ error: 'Error al procesar el audio.', detail: err.message });
  } finally {
    if (filePath) await unlink(filePath).catch(() => {});
  }
});

// GET /api/tasks
app.get('/api/tasks', (_req, res) => {
  try {
    const tasks = db.prepare(`
      SELECT * FROM tasks
      ORDER BY
        CASE priority WHEN 'alta' THEN 1 WHEN 'media' THEN 2 WHEN 'baja' THEN 3 END,
        CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
        due_date ASC,
        created_at DESC
    `).all();
    res.json(tasks);
  } catch (err) {
    console.error('[get-tasks]', err);
    res.status(500).json({ error: 'Error al obtener las tareas.' });
  }
});

// PATCH /api/tasks/:id
app.patch('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['pendiente', 'en_progreso', 'hecha'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Estado inválido. Opciones: ${allowed.join(', ')}` });
    }
    const result = db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Tarea no encontrada.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[patch-task]', err);
    res.status(500).json({ error: 'Error al actualizar la tarea.' });
  }
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Tarea no encontrada.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[delete-task]', err);
    res.status(500).json({ error: 'Error al eliminar la tarea.' });
  }
});

// GET /api/interactions
app.get('/api/interactions', (_req, res) => {
  try {
    const interactions = db.prepare(`
      SELECT * FROM interactions ORDER BY created_at DESC
    `).all();
    res.json(interactions);
  } catch (err) {
    console.error('[get-interactions]', err);
    res.status(500).json({ error: 'Error al obtener las interacciones.' });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Karen AI OS corriendo en http://localhost:${PORT}`);
});
