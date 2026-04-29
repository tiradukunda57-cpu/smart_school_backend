require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const fs   = require('fs')
const path = require('path')
const { Pool } = require('pg')

async function initDb() {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'smart_school',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  })

  console.log('')
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  🎓 EduManage — Database Initializer      ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log('')
  console.log(`  Host     : ${process.env.DB_HOST || 'localhost'}`)
  console.log(`  Port     : ${process.env.DB_PORT || '5432'}`)
  console.log(`  Database : ${process.env.DB_NAME || 'smart_school'}`)
  console.log(`  User     : ${process.env.DB_USER || 'postgres'}`)
  console.log('')

  let client

  try {
    console.log('  🔄 Connecting to database...')
    client = await pool.connect()
    console.log('  ✅ Connected successfully')
    console.log('')

    // Verify database
    const dbResult = await client.query('SELECT current_database() AS db')
    console.log(`  📦 Database: ${dbResult.rows[0].db}`)
    console.log('')

    // Read SQL file
    console.log('  🔄 Reading schema file...')
    const schemaPath = path.join(__dirname, 'schema.sql')

    if (!fs.existsSync(schemaPath)) {
      console.error('  ❌ schema.sql not found at:', schemaPath)
      process.exit(1)
    }

    const sql = fs.readFileSync(schemaPath, 'utf8')
    console.log('  ✅ Schema file loaded')
    console.log('')

    // Execute schema
    console.log('  🔄 Creating tables...')
    await client.query(sql)
    console.log('  ✅ Schema executed successfully')
    console.log('')

    // Verify tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    const tables = tablesResult.rows.map(r => r.table_name)
    const required = ['users', 'teachers', 'students', 'attendance', 'assignments', 'notes', 'messages']
    const allPresent = required.every(t => tables.includes(t))

    console.log('  📊 Created Tables:')
    console.log('  ┌──────────────────┬──────────┐')
    console.log('  │ Table            │ Status   │')
    console.log('  ├──────────────────┼──────────┤')

    required.forEach(table => {
      const exists = tables.includes(table)
      const status = exists ? '✅ Ready' : '❌ Missing'
      console.log(`  │ ${table.padEnd(16)} │ ${status.padEnd(8)} │`)
    })

    console.log('  └──────────────────┴──────────┘')
    console.log('')

    if (allPresent) {
      console.log('  ✅ All 7 tables created successfully!')
      console.log('')
      console.log('  🚀 You can now start the server:')
      console.log('     npm run dev')
    } else {
      const missing = required.filter(t => !tables.includes(t))
      console.log(`  ⚠️  Missing tables: ${missing.join(', ')}`)
      console.log('  Please check schema.sql for errors.')
    }

    console.log('')

  } catch (err) {
    console.error('')
    console.error('  ❌ DATABASE INITIALIZATION FAILED')
    console.error('  ─────────────────────────────────')
    console.error(`  Error: ${err.message}`)
    console.error('')

    if (err.message.includes('does not exist')) {
      console.error('  💡 The database may not exist yet.')
      console.error('     Create it first:')
      console.error('     psql -U postgres -c "CREATE DATABASE smart_school;"')
    }

    if (err.message.includes('password authentication')) {
      console.error('  💡 Wrong password in .env file.')
      console.error('     Check DB_PASSWORD in backend/.env')
    }

    if (err.message.includes('ECONNREFUSED')) {
      console.error('  💡 PostgreSQL is not running.')
      console.error('     Start it and try again.')
    }

    console.error('')
    process.exit(1)

  } finally {
    if (client) client.release()
    await pool.end()
  }
}

initDb()