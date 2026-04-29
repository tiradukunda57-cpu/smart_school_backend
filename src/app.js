require('dotenv').config()

const express     = require('express')
const cors        = require('cors')
const helmet      = require('helmet')
const morgan      = require('morgan')
const compression = require('compression')
const rateLimit   = require('express-rate-limit')

const { pool, query } = require('./config/db')

const authRoutes       = require('./routes/auth')
const studentRoutes    = require('./routes/students')
const teacherRoutes    = require('./routes/teachers')
const attendanceRoutes = require('./routes/attendance')
const assignmentRoutes = require('./routes/assignments')
const noteRoutes       = require('./routes/notes')
const messageRoutes    = require('./routes/messages')

const { errorHandler, notFound } = require('./middleware/errorHandler')

const app = express()
const PORT = parseInt(process.env.PORT) || 5000


// ══════════════════════════════════════════════════════════════
// DATABASE CONNECTION VERIFICATION
// ══════════════════════════════════════════════════════════════

async function verifyDatabaseConnection() {
  console.log('\n🔄 Checking database connection...')
  console.log(`   Host     : ${process.env.DB_HOST || 'localhost'}`)
  console.log(`   Port     : ${process.env.DB_PORT || '5432'}`)
  console.log(`   Database : ${process.env.DB_NAME || 'smart_school'}`)
  console.log(`   User     : ${process.env.DB_USER || 'postgres'}`)

  try {
    // Test 1: Basic connection
    const client = await pool.connect()
    console.log('   ✅ Connection established')

    // Test 2: Verify database name
    const dbResult = await client.query('SELECT current_database() AS db_name')
    console.log(`   ✅ Connected to database: ${dbResult.rows[0].db_name}`)

    // Test 3: Verify all required tables exist
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    const existingTables = tablesResult.rows.map(r => r.table_name)
    const requiredTables = [
      'users', 'teachers', 'students',
      'attendance', 'assignments', 'notes', 'messages'
    ]

    const missingTables = requiredTables.filter(t => !existingTables.includes(t))

    if (missingTables.length > 0) {
      console.log(`   ⚠️  Missing tables: ${missingTables.join(', ')}`)
      console.log('   ⚠️  Run: npm run db:init  to create all tables')
    } else {
      console.log(`   ✅ All ${requiredTables.length} required tables found`)
    }

    // Test 4: Show table record counts
    console.log('\n   📊 Table Statistics:')
    console.log('   ┌──────────────┬──────────┐')
    console.log('   │ Table        │ Records  │')
    console.log('   ├──────────────┼──────────┤')

    for (const table of requiredTables) {
      if (existingTables.includes(table)) {
        try {
          const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`)
          const count = countResult.rows[0].count
          console.log(`   │ ${table.padEnd(12)} │ ${String(count).padStart(8)} │`)
        } catch {
          console.log(`   │ ${table.padEnd(12)} │  error   │`)
        }
      } else {
        console.log(`   │ ${table.padEnd(12)} │ missing  │`)
      }
    }

    console.log('   └──────────────┴──────────┘')

    // Test 5: Check PostgreSQL version
    const versionResult = await client.query('SELECT version()')
    const pgVersion = versionResult.rows[0].version.split(',')[0]
    console.log(`\n   ✅ ${pgVersion}`)

    client.release()
    return true

  } catch (err) {
    console.error('\n   ❌ DATABASE CONNECTION FAILED!')
    console.error(`   Error: ${err.message}`)
    console.error('')
    console.error('   🔧 Troubleshooting:')
    console.error('   ───────────────────────────────────────────')
    console.error('   1. Is PostgreSQL running?')
    console.error('      → Windows: Check Services → PostgreSQL')
    console.error('      → Mac:     brew services start postgresql')
    console.error('      → Linux:   sudo systemctl start postgresql')
    console.error('')
    console.error('   2. Does the database exist?')
    console.error('      → Run: createdb -U postgres smart_school')
    console.error('')
    console.error('   3. Are .env credentials correct?')
    console.error('      → Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME')
    console.error('')
    console.error('   4. Is the password correct?')
    console.error('      → Try: psql -U postgres -h localhost')
    console.error('   ───────────────────────────────────────────')
    return false
  }
}


// ══════════════════════════════════════════════════════════════
// MIDDLEWARE SETUP
// ══════════════════════════════════════════════════════════════

// ── Security Headers ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Compression ───────────────────────────────────────────
app.use(compression())

// ── Request Logging ───────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
}

// ── Body Parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Rate Limiting ─────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
})

app.use('/api', generalLimiter)
app.use('/api/auth', authLimiter)


// ══════════════════════════════════════════════════════════════
// HEALTH CHECK & DATABASE STATUS ROUTES
// ══════════════════════════════════════════════════════════════

// ── Basic health check ────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let dbStatus = 'unknown'
  let dbLatency = null

  try {
    const start = Date.now()
    await query('SELECT 1')
    dbLatency = Date.now() - start
    dbStatus = 'connected'
  } catch {
    dbStatus = 'disconnected'
  }

  res.json({
    status: 'OK',
    message: 'EduManage API is running',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    uptime: `${Math.floor(process.uptime())}s`,
    database: {
      status: dbStatus,
      latency: dbLatency ? `${dbLatency}ms` : null,
    },
  })
})

// ── Database status (detailed) ────────────────────────────
app.get('/api/health/db', async (req, res) => {
  try {
    const client = await pool.connect()

    // Database info
    const dbInfo = await client.query('SELECT current_database() AS name, version() AS version')

    // Table counts
    const tables = ['users', 'teachers', 'students', 'attendance', 'assignments', 'notes', 'messages']
    const counts = {}

    for (const table of tables) {
      try {
        const r = await client.query(`SELECT COUNT(*) FROM ${table}`)
        counts[table] = parseInt(r.rows[0].count)
      } catch {
        counts[table] = 'table not found'
      }
    }

    // Pool stats
    const poolStats = {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount,
    }

    client.release()

    res.json({
      status: 'connected',
      database: dbInfo.rows[0].name,
      postgresVersion: dbInfo.rows[0].version.split(',')[0],
      tables: counts,
      totalRecords: Object.values(counts)
        .filter(v => typeof v === 'number')
        .reduce((a, b) => a + b, 0),
      pool: poolStats,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    res.status(503).json({
      status: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  }
})

// ── API documentation route ───────────────────────────────
app.get('/api/docs', (req, res) => {
  const docs = {
    name: 'EduManage — Smart School Management API',
    version: '1.0.0',
    description: 'Complete REST API for managing students, teachers, attendance, assignments, notes, and messaging.',
    baseUrl: `http://localhost:${PORT}/api`,
    documentation: `http://localhost:${PORT}/api/docs`,
    healthCheck: `http://localhost:${PORT}/api/health`,
    databaseStatus: `http://localhost:${PORT}/api/health/db`,

    authentication: {
      type: 'Bearer Token (JWT)',
      header: 'Authorization: Bearer <token>',
      tokenExpiry: process.env.JWT_EXPIRES_IN || '7d',
      note: 'Include token in Authorization header for protected routes',
    },

    roles: {
      teacher: {
        description: 'Full CRUD access to students, attendance, assignments, notes. Can view/send messages.',
        permissions: ['create', 'read', 'update', 'delete'],
      },
      student: {
        description: 'Read-only access to attendance, assignments, notes. Can view teachers and send messages.',
        permissions: ['read'],
      },
    },

    endpoints: {

      // ── AUTH ──────────────────────────────────────────────
      auth: {
        prefix: '/api/auth',
        routes: [
          {
            method: 'POST',
            path: '/api/auth/student/register',
            description: 'Register a new student account',
            access: 'Public',
            body: {
              required: ['first_name', 'last_name', 'email', 'password', 'grade'],
              optional: ['phone', 'date_of_birth', 'address'],
            },
            response: '201 — { message, token, user }',
          },
          {
            method: 'POST',
            path: '/api/auth/teacher/register',
            description: 'Register a new teacher account',
            access: 'Public',
            body: {
              required: ['first_name', 'last_name', 'email', 'password', 'subject'],
              optional: ['phone', 'qualification', 'bio'],
            },
            response: '201 — { message, token, user }',
          },
          {
            method: 'POST',
            path: '/api/auth/student/login',
            description: 'Login as student',
            access: 'Public',
            body: { required: ['email', 'password'] },
            response: '200 — { message, token, user }',
          },
          {
            method: 'POST',
            path: '/api/auth/teacher/login',
            description: 'Login as teacher',
            access: 'Public',
            body: { required: ['email', 'password'] },
            response: '200 — { message, token, user }',
          },
          {
            method: 'GET',
            path: '/api/auth/profile',
            description: 'Get current user profile',
            access: 'Authenticated',
            response: '200 — { user }',
          },
          {
            method: 'PUT',
            path: '/api/auth/profile',
            description: 'Update current user profile',
            access: 'Authenticated',
            body: { optional: ['first_name', 'last_name', 'phone', 'subject', 'qualification', 'bio'] },
            response: '200 — { message, user }',
          },
        ],
      },

      // ── STUDENTS ─────────────────────────────────────────
      students: {
        prefix: '/api/students',
        routes: [
          {
            method: 'GET',
            path: '/api/students',
            description: 'Get all students (paginated, searchable)',
            access: 'Teacher only',
            query: { optional: ['search', 'grade', 'page', 'limit'] },
            response: '200 — { students[], total, page, totalPages }',
          },
          {
            method: 'GET',
            path: '/api/students/stats',
            description: 'Get student statistics',
            access: 'Teacher only',
            response: '200 — { total, byGrade[] }',
          },
          {
            method: 'GET',
            path: '/api/students/:id',
            description: 'Get student by ID',
            access: 'Teacher only',
            response: '200 — { student }',
          },
          {
            method: 'PUT',
            path: '/api/students/:id',
            description: 'Update student information',
            access: 'Teacher only',
            body: { optional: ['first_name', 'last_name', 'email', 'phone', 'grade', 'address'] },
            response: '200 — { message, student }',
          },
          {
            method: 'DELETE',
            path: '/api/students/:id',
            description: 'Delete a student (cascades to user)',
            access: 'Teacher only',
            response: '200 — { message }',
          },
        ],
      },

      // ── TEACHERS ─────────────────────────────────────────
      teachers: {
        prefix: '/api/teachers',
        routes: [
          {
            method: 'GET',
            path: '/api/teachers',
            description: 'Get all teachers (searchable)',
            access: 'Authenticated',
            query: { optional: ['search', 'limit', 'page'] },
            response: '200 — { teachers[], total }',
          },
          {
            method: 'GET',
            path: '/api/teachers/:id',
            description: 'Get teacher profile by ID',
            access: 'Authenticated',
            response: '200 — { teacher }',
          },
          {
            method: 'PUT',
            path: '/api/teachers/:id',
            description: 'Update teacher profile (own only)',
            access: 'Teacher (own profile)',
            body: { optional: ['first_name', 'last_name', 'phone', 'subject', 'qualification', 'bio'] },
            response: '200 — { message, teacher }',
          },
        ],
      },

      // ── ATTENDANCE ───────────────────────────────────────
      attendance: {
        prefix: '/api/attendance',
        routes: [
          {
            method: 'GET',
            path: '/api/attendance',
            description: 'Get all attendance records (filterable)',
            access: 'Teacher only',
            query: { optional: ['search', 'status', 'date', 'subject', 'page', 'limit'] },
            response: '200 — { records[], total }',
          },
          {
            method: 'GET',
            path: '/api/attendance/my',
            description: 'Get current student attendance records',
            access: 'Student only',
            query: { optional: ['status', 'date'] },
            response: '200 — { records[], total }',
          },
          {
            method: 'POST',
            path: '/api/attendance',
            description: 'Create single attendance record',
            access: 'Teacher only',
            body: { required: ['student_id', 'status', 'date'], optional: ['subject', 'note'] },
            response: '201 — { message, record }',
          },
          {
            method: 'POST',
            path: '/api/attendance/bulk',
            description: 'Create bulk attendance for entire class',
            access: 'Teacher only',
            body: { required: ['records[]'], recordFields: ['student_id', 'status', 'date', 'subject?', 'note?'] },
            response: '201 — { message, records[] }',
          },
          {
            method: 'PUT',
            path: '/api/attendance/:id',
            description: 'Update attendance record',
            access: 'Teacher only',
            body: { optional: ['status', 'note'] },
            response: '200 — { message, record }',
          },
          {
            method: 'DELETE',
            path: '/api/attendance/:id',
            description: 'Delete attendance record',
            access: 'Teacher only',
            response: '200 — { message }',
          },
          {
            method: 'GET',
            path: '/api/attendance/summary/:studentId',
            description: 'Get attendance summary for a student',
            access: 'Authenticated',
            response: '200 — { summary: { present, absent, late, excused, total } }',
          },
        ],
      },

      // ── ASSIGNMENTS ──────────────────────────────────────
      assignments: {
        prefix: '/api/assignments',
        routes: [
          {
            method: 'GET',
            path: '/api/assignments',
            description: 'Get all assignments (searchable)',
            access: 'Authenticated (both roles)',
            query: { optional: ['search', 'priority', 'page', 'limit'] },
            response: '200 — { assignments[], total }',
          },
          {
            method: 'GET',
            path: '/api/assignments/:id',
            description: 'Get single assignment details',
            access: 'Authenticated',
            response: '200 — { assignment }',
          },
          {
            method: 'POST',
            path: '/api/assignments',
            description: 'Create assignment (broadcast to all students)',
            access: 'Teacher only',
            body: {
              required: ['title', 'description'],
              optional: ['subject', 'due_date', 'priority'],
            },
            response: '201 — { message, assignment }',
          },
          {
            method: 'PUT',
            path: '/api/assignments/:id',
            description: 'Update assignment (own only)',
            access: 'Teacher only',
            body: { optional: ['title', 'description', 'subject', 'due_date', 'priority'] },
            response: '200 — { message, assignment }',
          },
          {
            method: 'DELETE',
            path: '/api/assignments/:id',
            description: 'Delete assignment (own only)',
            access: 'Teacher only',
            response: '200 — { message }',
          },
        ],
      },

      // ── NOTES ────────────────────────────────────────────
      notes: {
        prefix: '/api/notes',
        routes: [
          {
            method: 'GET',
            path: '/api/notes',
            description: 'Get all notes (searchable, filterable by category)',
            access: 'Authenticated (both roles)',
            query: { optional: ['search', 'category', 'page', 'limit'] },
            response: '200 — { notes[], total }',
          },
          {
            method: 'GET',
            path: '/api/notes/:id',
            description: 'Get single note with full content',
            access: 'Authenticated',
            response: '200 — { note }',
          },
          {
            method: 'POST',
            path: '/api/notes',
            description: 'Create and publish note to all students',
            access: 'Teacher only',
            body: {
              required: ['title', 'content'],
              optional: ['subject', 'category'],
            },
            note: 'Categories: Lecture, Summary, Reference, Exercise, Announcement',
            response: '201 — { message, note }',
          },
          {
            method: 'PUT',
            path: '/api/notes/:id',
            description: 'Update note (own only)',
            access: 'Teacher only',
            body: { optional: ['title', 'content', 'subject', 'category'] },
            response: '200 — { message, note }',
          },
          {
            method: 'DELETE',
            path: '/api/notes/:id',
            description: 'Delete note (own only)',
            access: 'Teacher only',
            response: '200 — { message }',
          },
        ],
      },

      // ── MESSAGES ─────────────────────────────────────────
      messages: {
        prefix: '/api/messages',
        routes: [
          {
            method: 'GET',
            path: '/api/messages/conversations',
            description: 'Get all conversations with last message and unread count',
            access: 'Authenticated',
            response: '200 — { conversations[] }',
          },
          {
            method: 'GET',
            path: '/api/messages/unread/count',
            description: 'Get total unread message count',
            access: 'Authenticated',
            response: '200 — { count }',
          },
          {
            method: 'GET',
            path: '/api/messages/:userId',
            description: 'Get chat history with a specific user (auto marks as read)',
            access: 'Authenticated',
            response: '200 — { messages[] }',
          },
          {
            method: 'POST',
            path: '/api/messages',
            description: 'Send a message (students can only message teachers)',
            access: 'Authenticated',
            body: { required: ['receiver_id', 'content'] },
            response: '201 — { message, data }',
          },
          {
            method: 'PUT',
            path: '/api/messages/:id/read',
            description: 'Mark a specific message as read',
            access: 'Authenticated',
            response: '200 — { message }',
          },
        ],
      },
    },

    statusCodes: {
      200: 'OK — Request succeeded',
      201: 'Created — Resource created successfully',
      400: 'Bad Request — Invalid input or missing fields',
      401: 'Unauthorized — Not logged in or token expired',
      403: 'Forbidden — Insufficient permissions for this action',
      404: 'Not Found — Resource does not exist',
      409: 'Conflict — Duplicate entry (email, attendance record, etc.)',
      429: 'Too Many Requests — Rate limit exceeded',
      500: 'Internal Server Error — Something went wrong on the server',
      503: 'Service Unavailable — Database connection failed',
    },

    rateLimits: {
      general: '200 requests per 15 minutes',
      auth: '20 requests per 15 minutes (login/register)',
    },
  }

  res.json(docs)
})

// ── Route statistics ──────────────────────────────────────
app.get('/api/routes', (req, res) => {
  const routes = []

  const extractRoutes = (stack, basePath = '') => {
    stack.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods)
          .filter(m => layer.route.methods[m])
          .map(m => m.toUpperCase())

        routes.push({
          methods: methods.join(', '),
          path: basePath + layer.route.path,
        })
      } else if (layer.name === 'router' && layer.handle.stack) {
        const match = layer.regexp.toString()
        let prefix = ''
        const pathMatch = match.match(/\\\/([a-zA-Z]+)/)
        if (pathMatch) prefix = '/' + pathMatch[1]

        // Better prefix extraction from regexp
        const cleanPrefix = layer.regexp.source
          .replace(/^\^\\\//, '/')
          .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
          .replace(/\\/g, '')

        extractRoutes(layer.handle.stack, basePath + cleanPrefix)
      }
    })
  }

  extractRoutes(app._router.stack, '')

  // Build summary
  const summary = {
    totalRoutes: routes.length,
    routesByMethod: {},
    routesByModule: {},
  }

  routes.forEach(r => {
    const methods = r.methods.split(', ')
    methods.forEach(m => {
      summary.routesByMethod[m] = (summary.routesByMethod[m] || 0) + 1
    })

    const parts = r.path.split('/').filter(Boolean)
    const module = parts[1] || 'root' // api/MODULE/...
    summary.routesByModule[module] = (summary.routesByModule[module] || 0) + 1
  })

  res.json({
    title: 'EduManage API — Route Statistics',
    summary,
    routes: routes.map((r, i) => ({
      '#': i + 1,
      ...r,
    })),
    generatedAt: new Date().toISOString(),
  })
})


// ══════════════════════════════════════════════════════════════
// MOUNT ALL API ROUTES
// ══════════════════════════════════════════════════════════════

const routeMounts = [
  { path: '/api/auth',        router: authRoutes,       label: 'Auth (login/register/profile)' },
  { path: '/api/students',    router: studentRoutes,    label: 'Students (CRUD — teacher only)' },
  { path: '/api/teachers',    router: teacherRoutes,    label: 'Teachers (list/profile)' },
  { path: '/api/attendance',  router: attendanceRoutes, label: 'Attendance (bulk/single/my)' },
  { path: '/api/assignments', router: assignmentRoutes, label: 'Assignments (broadcast)' },
  { path: '/api/notes',       router: noteRoutes,       label: 'Notes (publish/download)' },
  { path: '/api/messages',    router: messageRoutes,    label: 'Messages (conversations/chat)' },
]

routeMounts.forEach(({ path, router, label }) => {
  app.use(path, router)
})


// ══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ══════════════════════════════════════════════════════════════

app.use(notFound)
app.use(errorHandler)


// ══════════════════════════════════════════════════════════════
// START SERVER WITH DATABASE CHECK
// ══════════════════════════════════════════════════════════════

async function startServer() {
  console.log('')
  console.log('╔════════════════════════════════════════════════════╗')
  console.log('║         🎓 EduManage API Server                    ║')
  console.log('║         Smart School Management Platform           ║')
  console.log('╚════════════════════════════════════════════════════╝')

  // ── Verify Database ─────────────────────────────────────
  const dbConnected = await verifyDatabaseConnection()

  if (!dbConnected) {
    console.log('\n⚠️  Server will start but database features will not work.')
    console.log('   Fix database connection and restart the server.\n')
  }

  // ── Print Route Mounts ──────────────────────────────────
  console.log('\n📡 Mounted API Routes:')
  console.log('   ┌─────────────────────────────┬────────────────────────────────────────┐')
  console.log('   │ Endpoint                    │ Description                            │')
  console.log('   ├─────────────────────────────┼────────────────────────────────────────┤')

  routeMounts.forEach(({ path, label }) => {
    console.log(`   │ ${path.padEnd(27)} │ ${label.padEnd(38)} │`)
  })

  // Extra utility routes
  const utilityRoutes = [
    { path: '/api/health',    label: 'Health check (basic)' },
    { path: '/api/health/db', label: 'Database status (detailed)' },
    { path: '/api/docs',      label: 'API documentation (JSON)' },
    { path: '/api/routes',    label: 'Route statistics' },
  ]

  console.log('   ├─────────────────────────────┼────────────────────────────────────────┤')

  utilityRoutes.forEach(({ path, label }) => {
    console.log(`   │ ${path.padEnd(27)} │ ${label.padEnd(38)} │`)
  })

  console.log('   └─────────────────────────────┴────────────────────────────────────────┘')

  // ── Count total endpoints ───────────────────────────────
  let totalEndpoints = 0
  const endpointCounts = {
    auth:        6,
    students:    5,
    teachers:    3,
    attendance:  7,
    assignments: 5,
    notes:       5,
    messages:    5,
    utility:     4,
  }

  Object.values(endpointCounts).forEach(c => { totalEndpoints += c })

  console.log(`\n   📊 Total API Endpoints: ${totalEndpoints}`)
  console.log('   ┌──────────────┬──────────┐')
  console.log('   │ Module       │ Routes   │')
  console.log('   ├──────────────┼──────────┤')

  Object.entries(endpointCounts).forEach(([mod, count]) => {
    console.log(`   │ ${mod.padEnd(12)} │ ${String(count).padStart(6)}   │`)
  })

  console.log('   └──────────────┴──────────┘')

  // ── Start listening ─────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`
┌─────────────────────────────────────────────────────┐
│                                                     │
│   🚀 Server is live!                                │
│                                                     │
│   Local  : http://localhost:${PORT}                   │
│   API    : http://localhost:${PORT}/api                │
│   Docs   : http://localhost:${PORT}/api/docs           │
│   Health : http://localhost:${PORT}/api/health          │
│   DB     : http://localhost:${PORT}/api/health/db       │
│   Routes : http://localhost:${PORT}/api/routes          │
│                                                     │
│   Env    : ${(process.env.NODE_ENV || 'development').padEnd(20)}              │
│   CORS   : ${(process.env.CORS_ORIGIN || 'http://localhost:3000').padEnd(20)}              │
│   DB     : ${dbConnected ? 'Connected ✅'.padEnd(20) : 'Disconnected ❌'.padEnd(20)}              │
│                                                     │
│   Press Ctrl+C to stop                              │
│                                                     │
└─────────────────────────────────────────────────────┘
    `)
  })
}

// ── Launch ────────────────────────────────────────────────
startServer()


// ══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN & PROCESS HANDLERS
// ══════════════════════════════════════════════════════════════

const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`)

  pool.end(() => {
    console.log('✅ Database pool closed.')
    console.log('👋 Server stopped. Goodbye!')
    process.exit(0)
  })

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after 10s timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT',  () => gracefulShutdown('SIGINT'))

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Promise Rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message)
  console.error(err.stack)
  gracefulShutdown('UNCAUGHT_EXCEPTION')
})

module.exports = app