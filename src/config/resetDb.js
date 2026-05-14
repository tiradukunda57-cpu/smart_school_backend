// backend/src/config/resetDb.js

require('dotenv').config()
const { Pool } = require('pg')

const DB_NAME = process.env.DB_NAME || 'smart_school'

async function resetDatabase() {
  console.log(`\n⚠️  Dropping and recreating database "${DB_NAME}"...`)
  console.log('   This will DELETE all data!\n')

  // Give 3 seconds to cancel
  await new Promise(r => setTimeout(r, 3000))

  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD,
    database: 'postgres', // connect to default
  })

  const client = await pool.connect()

  try {
    // Terminate existing connections to target db
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [DB_NAME])

    await client.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`)
    console.log(`✅ Dropped database "${DB_NAME}"`)

    client.release()
    await pool.end()

    // Re-run init
    require('./initDb')

  } catch (err) {
    console.error('❌ Reset failed:', err.message)
    client.release()
    await pool.end()
    process.exit(1)
  }
}

resetDatabase()