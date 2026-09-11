CREATE TABLE IF NOT EXISTS users(
 id BIGSERIAL PRIMARY KEY,
 full_name TEXT NOT NULL,
 login TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','student')),
 blocked BOOLEAN NOT NULL DEFAULT FALSE,
 in_leaderboard BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS topics(
 id BIGSERIAL PRIMARY KEY,
 name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS tests(
 id BIGSERIAL PRIMARY KEY,
 title TEXT NOT NULL,
 description TEXT DEFAULT '',
 topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,
 duration_seconds INT,
 max_attempts INT,
 published BOOLEAN NOT NULL DEFAULT FALSE,
 shuffle_questions BOOLEAN NOT NULL DEFAULT TRUE,
 shuffle_options BOOLEAN NOT NULL DEFAULT TRUE,
 result_mode TEXT NOT NULL DEFAULT 'immediate' CHECK(result_mode IN ('immediate','approval')),
 starts_at TIMESTAMPTZ,
 ends_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions(
 id BIGSERIAL PRIMARY KEY,
 test_id BIGINT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
 type TEXT NOT NULL,
 prompt TEXT NOT NULL,
 points NUMERIC(10,2) NOT NULL DEFAULT 1,
 position INT NOT NULL DEFAULT 0,
 options JSONB NOT NULL DEFAULT '[]'::jsonb,
 correct_answer JSONB,
 topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attempts(
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 test_id BIGINT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
 question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
 option_orders JSONB NOT NULL DEFAULT '{}'::jsonb,
 score NUMERIC(10,2) NOT NULL DEFAULT 0,
 max_score NUMERIC(10,2) NOT NULL DEFAULT 0,
 correct_count INT NOT NULL DEFAULT 0,
 wrong_count INT NOT NULL DEFAULT 0,
 unanswered_count INT NOT NULL DEFAULT 0,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 finished_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','submitted','approved')),
 approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS answers(
 id BIGSERIAL PRIMARY KEY,
 attempt_id BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
 question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 answer JSONB,
 is_correct BOOLEAN,
 points_awarded NUMERIC(10,2) NOT NULL DEFAULT 0,
 answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(attempt_id,question_id)
);

CREATE TABLE IF NOT EXISTS announcements(
 id BIGSERIAL PRIMARY KEY,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rating_resets(
 id BIGSERIAL PRIMARY KEY,
 scope TEXT NOT NULL,
 test_id BIGINT REFERENCES tests(id) ON DELETE CASCADE,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_test ON attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_questions_test ON questions(test_id);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
