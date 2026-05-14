const { query, getClient } = require('../config/db')

// ── Helpers ───────────────────────────────────────────────────

// Get teacher record for the current user
// Returns null if not found — does NOT throw 403
const getTeacherRecord = async (userId) => {
  const result = await query(
    'SELECT id, status FROM teachers WHERE user_id = $1',
    [userId]
  )
  return result.rows[0] || null
}

// Get student record for the current user
const getStudentRecord = async (userId) => {
  const result = await query(
    'SELECT id FROM students WHERE user_id = $1',
    [userId]
  )
  return result.rows[0] || null
}

// ── Teacher: Create Quiz ──────────────────────────────────────
const createQuiz = async (req, res, next) => {
  const client = await getClient()
  try {
    const {
      title, description, course,
      time_limit, max_attempts, shuffle,
      show_results, starts_at, ends_at,
      questions,
    } = req.body

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Quiz title is required.' })
    }
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'At least one question is required.' })
    }

    // Get teacher record — create quiz for ANY teacher (no approval required)
    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    await client.query('BEGIN')

    // Create quiz
    const quizRes = await client.query(
      `INSERT INTO quizzes
         (teacher_id, title, description, course, time_limit,
          max_attempts, shuffle, show_results, starts_at, ends_at, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)
       RETURNING *`,
      [
        teacher.id,
        title.trim(),
        description?.trim() || null,
        course?.trim()      || null,
        time_limit          ? parseInt(time_limit) : null,
        max_attempts        ? parseInt(max_attempts) : 1,
        shuffle             === true || shuffle === 'true',
        show_results !== undefined ? show_results !== false && show_results !== 'false' : true,
        starts_at           || null,
        ends_at             || null,
      ]
    )
    const quiz = quizRes.rows[0]

    // Insert questions
    const insertedQuestions = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]

      if (!q.question || !q.question.trim()) {
        await client.query('ROLLBACK')
        return res.status(400).json({
          message: `Question ${i + 1} text is required.`,
        })
      }

      // Validate options for multiple choice
      let optionsJson = null
      if (q.type === 'multiple_choice') {
        const opts = Array.isArray(q.options)
          ? q.options.filter(o => o && String(o).trim())
          : []
        if (opts.length < 2) {
          await client.query('ROLLBACK')
          return res.status(400).json({
            message: `Question ${i + 1} needs at least 2 options.`,
          })
        }
        optionsJson = JSON.stringify(opts)
      } else if (q.type === 'true_false') {
        optionsJson = JSON.stringify(['True', 'False'])
      }

      const qRes = await client.query(
        `INSERT INTO quiz_questions
           (quiz_id, question, type, options, correct, points, explanation, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          quiz.id,
          q.question.trim(),
          q.type || 'multiple_choice',
          optionsJson,
          q.correct?.trim() || null,
          parseInt(q.points) || 1,
          q.explanation?.trim() || null,
          i,
        ]
      )
      insertedQuestions.push(qRes.rows[0])
    }

    await client.query('COMMIT')

    return res.status(201).json({
      message: 'Quiz created successfully.',
      quiz: { ...quiz, questions: insertedQuestions },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ── Teacher: Get my quizzes ───────────────────────────────────
const getMyQuizzes = async (req, res, next) => {
  try {
    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const result = await query(
      `SELECT
         q.*,
         (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id)         AS question_count,
         (SELECT COUNT(DISTINCT student_id) FROM quiz_sessions WHERE quiz_id = q.id) AS attempt_count
       FROM quizzes q
       WHERE q.teacher_id = $1
       ORDER BY q.created_at DESC`,
      [teacher.id]
    )

    return res.json({ quizzes: result.rows })
  } catch (err) {
    next(err)
  }
}

// ── Teacher: Get quiz by ID (with questions + correct answers) ─
const getQuizById = async (req, res, next) => {
  try {
    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const quizRes = await query(
      'SELECT * FROM quizzes WHERE id = $1 AND teacher_id = $2',
      [req.params.id, teacher.id]
    )
    if (quizRes.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found.' })
    }

    const questionsRes = await query(
      'SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order',
      [req.params.id]
    )

    return res.json({
      quiz: {
        ...quizRes.rows[0],
        questions: questionsRes.rows,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── Teacher: Toggle publish ───────────────────────────────────
const togglePublish = async (req, res, next) => {
  try {
    const { is_published } = req.body
    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const result = await query(
      `UPDATE quizzes SET is_published = $1
       WHERE id = $2 AND teacher_id = $3
       RETURNING *`,
      [is_published, req.params.id, teacher.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found.' })
    }

    return res.json({
      message: is_published ? 'Quiz published. Students can now take it.' : 'Quiz unpublished.',
      quiz: result.rows[0],
    })
  } catch (err) {
    next(err)
  }
}

// ── Teacher: Delete quiz ──────────────────────────────────────
const deleteQuiz = async (req, res, next) => {
  try {
    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const result = await query(
      'DELETE FROM quizzes WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [req.params.id, teacher.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found.' })
    }

    return res.json({ message: 'Quiz deleted.' })
  } catch (err) {
    next(err)
  }
}

// ── Student: Get available quizzes ────────────────────────────
const getAvailableQuizzes = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         q.id, q.title, q.description, q.course,
         q.time_limit, q.max_attempts, q.starts_at, q.ends_at,
         (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) AS question_count,
         CONCAT(t.first_name, ' ', t.last_name)                    AS teacher_name,
         t.course                                                   AS teacher_course
       FROM quizzes q
       JOIN teachers t ON t.id = q.teacher_id
       WHERE q.is_published = TRUE
         AND (q.starts_at IS NULL OR q.starts_at <= NOW())
         AND (q.ends_at   IS NULL OR q.ends_at   >= NOW())
       ORDER BY q.created_at DESC`
    )

    return res.json({ quizzes: result.rows })
  } catch (err) {
    next(err)
  }
}

// ── Student: Start quiz session ───────────────────────────────
const startQuiz = async (req, res, next) => {
  try {
    const quizId = parseInt(req.params.id)

    const student = await getStudentRecord(req.user.id)
    if (!student) {
      return res.status(404).json({ message: 'Student profile not found.' })
    }

    // Verify quiz exists and is published
    const quizRes = await query(
      'SELECT * FROM quizzes WHERE id = $1 AND is_published = TRUE',
      [quizId]
    )
    if (quizRes.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found or not available.' })
    }
    const quiz = quizRes.rows[0]

    // Check time window
    if (quiz.starts_at && new Date(quiz.starts_at) > new Date()) {
      return res.status(403).json({ message: 'Quiz has not started yet.' })
    }
    if (quiz.ends_at && new Date(quiz.ends_at) < new Date()) {
      return res.status(403).json({ message: 'Quiz has ended.' })
    }

    // Check attempts
    const attRes = await query(
      `SELECT COUNT(*) FROM quiz_sessions
       WHERE quiz_id = $1 AND student_id = $2`,
      [quizId, student.id]
    )
    const attempts = parseInt(attRes.rows[0].count)
    if (quiz.max_attempts && attempts >= quiz.max_attempts) {
      return res.status(403).json({
        message: `Maximum ${quiz.max_attempts} attempt(s) already used.`,
      })
    }

    // Resume existing in-progress session
    const activeRes = await query(
      `SELECT id FROM quiz_sessions
       WHERE quiz_id = $1 AND student_id = $2 AND status = 'in_progress'`,
      [quizId, student.id]
    )
    if (activeRes.rows.length > 0) {
      const sessionId = activeRes.rows[0].id
      const qRes = await query(
        `SELECT
           qq.id, qq.question, qq.type, qq.options, qq.points, qq.sort_order,
           qr.answer, qr.answered_at
         FROM quiz_questions qq
         LEFT JOIN quiz_responses qr
           ON qr.question_id = qq.id AND qr.session_id = $1
         WHERE qq.quiz_id = $2
         ORDER BY ${quiz.shuffle ? 'RANDOM()' : 'qq.sort_order'}`,
        [sessionId, quizId]
      )
      return res.json({
        session_id: sessionId,
        questions:  qRes.rows,
        time_limit: quiz.time_limit,
        resumed:    true,
      })
    }

    // Create new session
    const sessionRes = await query(
      `INSERT INTO quiz_sessions (quiz_id, student_id, attempt)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [quizId, student.id, attempts + 1]
    )
    const session = sessionRes.rows[0]

    // Get questions (WITHOUT correct answers for student)
    const qRes = await query(
      `SELECT id, question, type, options, points, sort_order
       FROM quiz_questions
       WHERE quiz_id = $1
       ORDER BY ${quiz.shuffle ? 'RANDOM()' : 'sort_order'}`,
      [quizId]
    )

    return res.status(201).json({
      session_id: session.id,
      questions:  qRes.rows,
      time_limit: quiz.time_limit,
      resumed:    false,
    })
  } catch (err) {
    next(err)
  }
}

// ── Student: Submit answer for a question ─────────────────────
const answerQuestion = async (req, res, next) => {
  try {
    const { session_id, question_id, answer } = req.body

    if (!session_id || !question_id) {
      return res.status(400).json({ message: 'session_id and question_id are required.' })
    }

    const student = await getStudentRecord(req.user.id)
    if (!student) {
      return res.status(404).json({ message: 'Student profile not found.' })
    }

    // Validate session belongs to this student and is in progress
    const sessionRes = await query(
      `SELECT qs.id, qs.quiz_id, q.show_results
       FROM quiz_sessions qs
       JOIN quizzes q ON q.id = qs.quiz_id
       WHERE qs.id = $1 AND qs.student_id = $2 AND qs.status = 'in_progress'`,
      [session_id, student.id]
    )
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ message: 'Active session not found.' })
    }
    const session = sessionRes.rows[0]

    // Get correct answer for this question
    const qRes = await query(
      'SELECT correct, points FROM quiz_questions WHERE id = $1 AND quiz_id = $2',
      [question_id, session.quiz_id]
    )
    if (qRes.rows.length === 0) {
      return res.status(404).json({ message: 'Question not found.' })
    }

    const { correct, points: maxPoints } = qRes.rows[0]

    // Determine if correct
    const userAnswer = answer ? String(answer).trim().toLowerCase() : ''
    const correctAnswer = correct ? String(correct).trim().toLowerCase() : ''
    const isCorrect = correctAnswer && userAnswer && userAnswer === correctAnswer
    const earnedPoints = isCorrect ? parseInt(maxPoints) : 0

    // Upsert the response
    const responseRes = await query(
      `INSERT INTO quiz_responses
         (session_id, question_id, answer, is_correct, points)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, question_id) DO UPDATE
         SET answer      = EXCLUDED.answer,
             is_correct  = EXCLUDED.is_correct,
             points      = EXCLUDED.points,
             answered_at = NOW()
       RETURNING *`,
      [session_id, question_id, answer || null, isCorrect, earnedPoints]
    )

    const responsePayload = { saved: true, response: responseRes.rows[0] }

    // Optionally reveal correctness
    if (session.show_results) {
      responsePayload.is_correct = isCorrect
    }

    return res.json(responsePayload)
  } catch (err) {
    next(err)
  }
}

// ── Student: Submit (finish) quiz ─────────────────────────────
const submitQuiz = async (req, res, next) => {
  try {
    const { session_id } = req.params

    const student = await getStudentRecord(req.user.id)
    if (!student) {
      return res.status(404).json({ message: 'Student profile not found.' })
    }

    // Validate session
    const sessionRes = await query(
      `SELECT * FROM quiz_sessions
       WHERE id = $1 AND student_id = $2 AND status = 'in_progress'`,
      [session_id, student.id]
    )
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ message: 'Active session not found.' })
    }
    const session = sessionRes.rows[0]

    // Calculate total score
    const scoreRes = await query(
      'SELECT COALESCE(SUM(points), 0) AS score FROM quiz_responses WHERE session_id = $1',
      [session_id]
    )
    const totalRes = await query(
      'SELECT COALESCE(SUM(points), 0) AS total FROM quiz_questions WHERE quiz_id = $1',
      [session.quiz_id]
    )

    const score = parseInt(scoreRes.rows[0].score)
    const total = parseInt(totalRes.rows[0].total)
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0

    // Mark session as completed
    const updatedSession = await query(
      `UPDATE quiz_sessions
       SET status = 'completed', finished_at = NOW(), score = $1, total_points = $2
       WHERE id = $3
       RETURNING *`,
      [score, total, session_id]
    )

    return res.json({
      message: 'Quiz submitted successfully.',
      session:    updatedSession.rows[0],
      score,
      total,
      percentage,
    })
  } catch (err) {
    next(err)
  }
}

// ── Teacher: Get live quiz progress ──────────────────────────
const getQuizProgress = async (req, res, next) => {
  try {
    const quizId = parseInt(req.params.id)

    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    // Verify teacher owns this quiz
    const quizRes = await query(
      'SELECT id, title FROM quizzes WHERE id = $1 AND teacher_id = $2',
      [quizId, teacher.id]
    )
    if (quizRes.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found.' })
    }

    // Total questions in quiz
    const totalQRes = await query(
      'SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = $1',
      [quizId]
    )
    const totalQuestions = parseInt(totalQRes.rows[0].count)

    // All sessions with student info
    const sessionsRes = await query(
      `SELECT
         qs.id, qs.status, qs.score, qs.total_points,
         qs.started_at, qs.finished_at, qs.attempt,
         s.first_name, s.last_name, s.level,
         (SELECT COUNT(*) FROM quiz_responses WHERE session_id = qs.id)              AS answered,
         (SELECT COALESCE(SUM(points), 0) FROM quiz_responses WHERE session_id = qs.id) AS current_score
       FROM quiz_sessions qs
       JOIN students s ON s.id = qs.student_id
       WHERE qs.quiz_id = $1
       ORDER BY qs.started_at DESC`,
      [quizId]
    )

    const sessions = sessionsRes.rows

    return res.json({
      quiz_id:         quizId,
      quiz_title:      quizRes.rows[0].title,
      total_questions: totalQuestions,
      sessions,
      total_students:  sessions.length,
      in_progress:     sessions.filter(s => s.status === 'in_progress').length,
      completed:       sessions.filter(s => s.status === 'completed').length,
    })
  } catch (err) {
    next(err)
  }
}

// ── Teacher: Get student answer sheet ────────────────────────
const getAnswerSheet = async (req, res, next) => {
  try {
    const { sessionId } = req.params

    const teacher = await getTeacherRecord(req.user.id)
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    // Verify this session belongs to a quiz owned by this teacher
    const sessionRes = await query(
      `SELECT
         qs.id, qs.score, qs.total_points, qs.status,
         qs.started_at, qs.finished_at,
         s.first_name, s.last_name, s.level,
         q.title AS quiz_title
       FROM quiz_sessions qs
       JOIN students s ON s.id  = qs.student_id
       JOIN quizzes q  ON q.id  = qs.quiz_id
       WHERE qs.id = $1 AND q.teacher_id = $2`,
      [sessionId, teacher.id]
    )
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ message: 'Session not found.' })
    }

    // Get all responses with question details
    const responsesRes = await query(
      `SELECT
         qr.answer, qr.is_correct, qr.points, qr.answered_at,
         qq.question, qq.type, qq.options, qq.correct,
         qq.points AS max_points, qq.explanation, qq.sort_order
       FROM quiz_responses qr
       JOIN quiz_questions qq ON qq.id = qr.question_id
       WHERE qr.session_id = $1
       ORDER BY qq.sort_order`,
      [sessionId]
    )

    return res.json({
      session:   sessionRes.rows[0],
      responses: responsesRes.rows,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  createQuiz,
  getMyQuizzes,
  getQuizById,
  togglePublish,
  deleteQuiz,
  getAvailableQuizzes,
  startQuiz,
  answerQuestion,
  submitQuiz,
  getQuizProgress,
  getAnswerSheet,
}