# Karen AI OS

Asistente ejecutiva inteligente para la directora de un laboratorio farmacéutico. Procesa reuniones, llamadas, mails y notas de voz usando GPT-4o-mini y Whisper, extrae tareas accionables y las organiza en un panel ejecutivo.

## Requisitos

- Node.js 18+
- Una API key de OpenAI con acceso a `gpt-4o-mini` y `whisper-1`

## Instalación local

```bash
# 1. Clonar / descomprimir el proyecto
cd karen-ai-os

# 2. Instalar dependencias
npm install

# 3. Crear archivo de variables de entorno
cp .env.example .env
# Editar .env y pegar tu OPENAI_API_KEY

# 4. Iniciar el servidor
npm start
```

Abrir en el navegador: **http://localhost:3000**

## Variables de entorno

| Variable        | Descripción                          | Requerido |
|-----------------|--------------------------------------|-----------|
| `OPENAI_API_KEY`| API key de OpenAI                    | ✅         |
| `PORT`          | Puerto del servidor (default: 3000)  | No        |

Crear un archivo `.env` en la raíz del proyecto:

```env
OPENAI_API_KEY=sk-...tu-key-aquí...
PORT=3000
```

## Deploy en Railway

1. Subir el proyecto a un repositorio de GitHub
2. Crear nuevo proyecto en [railway.app](https://railway.app)
3. Conectar el repositorio
4. Agregar la variable de entorno `OPENAI_API_KEY` en Railway → Variables
5. Railway detecta automáticamente Node.js y usa el comando de `railway.json`

## Estructura del proyecto

```
karen-ai-os/
├── server.js          # Backend Express + OpenAI + SQLite
├── package.json
├── railway.json       # Configuración de deploy
├── .gitignore
├── public/
│   └── index.html     # Frontend SPA (vanilla JS)
├── uploads/           # Archivos de audio temporales (auto-creado)
└── karen.db           # Base de datos SQLite (auto-creado)
```

## API Endpoints

| Método   | Ruta                    | Descripción                              |
|----------|-------------------------|------------------------------------------|
| `POST`   | `/api/process-text`     | Procesa texto y retorna JSON estructurado|
| `POST`   | `/api/process-audio`    | Transcribe audio y procesa               |
| `GET`    | `/api/tasks`            | Lista todas las tareas                   |
| `PATCH`  | `/api/tasks/:id`        | Actualiza estado de una tarea            |
| `DELETE` | `/api/tasks/:id`        | Elimina una tarea                        |
| `GET`    | `/api/interactions`     | Lista todas las interacciones            |

## Funcionalidades

- **Procesar texto**: Pegá el contenido de una reunión, mail, WhatsApp o nota y Karen lo estructura automáticamente
- **Dictado por voz**: Usá el micrófono para dictar en español argentino (requiere Chrome/Edge)
- **Procesar audio**: Subí un archivo de audio (mp3, m4a, wav, webm) y Whisper lo transcribe
- **Tareas**: Visualizá, cambiá el estado o eliminá tareas ordenadas por prioridad
- **Interacciones**: Historial de todo lo procesado

## Notas

- La base de datos SQLite se crea automáticamente en la primera ejecución
- Los archivos de audio se eliminan del servidor después de ser procesados
- En Railway, la base de datos es efímera (se borra con cada deploy); para producción real, usar Railway PostgreSQL o un volumen persistente
