-- LegalBuddy Postgres schema (Neon). Applied by scripts/db-migrate.mjs.
-- Users come from credentials signup or Google OAuth; conversations and
-- messages belong to exactly one user and vanish with them (CASCADE).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image TEXT,
  password_hash TEXT, -- NULL for OAuth-only accounts
  provider TEXT NOT NULL DEFAULT 'credentials',
  provider_account_id TEXT,
  -- Account type picked at signup (individual/business) and role.
  -- onboarded is FALSE until the signup steps or post-OAuth onboarding finish.
  account_type TEXT NOT NULL DEFAULT 'individual' CHECK (account_type IN ('individual', 'business')),
  company_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'lawyer', 'admin')),
  lawyer_status TEXT NOT NULL DEFAULT 'none' CHECK (lawyer_status IN ('none', 'pending', 'verified', 'rejected')),
  onboarded BOOLEAN NOT NULL DEFAULT TRUE,
  -- Billing (Stripe is the source of truth; these columns are a cache
  -- written only from verified webhook events, never from the client).
  stripe_customer_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'lite' CHECK (plan IN ('lite', 'professional', 'business')),
  subscription_status TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration for databases created before billing/lawyer columns existed.
-- IF NOT EXISTS keeps this safe to re-run on every deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'individual' CHECK (account_type IN ('individual', 'business'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'lawyer', 'admin'));
-- Admin role (reserved): no signup form or API accepts it. Until the admin
-- dashboard exists, grant it manually: UPDATE users SET role = 'admin' WHERE email = '...';
-- Existing databases carry the old two-value CHECK under the same name.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'lawyer', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS lawyer_status TEXT NOT NULL DEFAULT 'none' CHECK (lawyer_status IN ('none', 'pending', 'verified', 'rejected'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'lite' CHECK (plan IN ('lite', 'professional', 'business'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  citations JSONB NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages(conversation_id, created_at ASC);

-- User-uploaded documents. Vectors live in Qdrant (`user-documents`,
-- keyed by user_id + doc_id); this table is the metadata of record, so
-- listings and deletes never depend on vector-store scrolls.
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_user_idx
  ON documents(user_id, created_at DESC);

-- Lawyer verification requests. The Sanad scan lives in object storage
-- (private bucket); only its key is stored here. ocr_* columns record the
-- automated cross-check; status flips to verified automatically on a
-- name+number match, otherwise a human reviews.
CREATE TABLE IF NOT EXISTS lawyer_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  sanad_no TEXT NOT NULL,
  enrollment_date DATE,
  bar_association TEXT NOT NULL,
  object_key TEXT NOT NULL,
  ocr_text TEXT,
  ocr_match BOOLEAN,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reviewer_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lawyer public profiles for the recommender. Practice areas use a fixed
-- taxonomy (criminal, family, property, corporate, labor, tax, consumer,
-- immigration); profile_embedding caches the Voyage embedding of the
-- bio + areas for cosine matching.
CREATE TABLE IF NOT EXISTS lawyer_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  practice_areas TEXT[] NOT NULL DEFAULT '{}',
  languages TEXT[] NOT NULL DEFAULT '{english}',
  city TEXT,
  bio TEXT,
  profile_embedding JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client ratings. One review per user per lawyer, no self-reviews
-- (enforced in the API; the UNIQUE pair keeps repeats honest).
-- Scoring uses a Bayesian average so new lawyers start neutral instead
-- of buried: (3*3.5 + sum) / (3 + n), normalized to 0..1.
CREATE TABLE IF NOT EXISTS lawyer_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lawyer_id, reviewer_id),
  CHECK (lawyer_id <> reviewer_id)
);
CREATE INDEX IF NOT EXISTS lawyer_reviews_lawyer_idx ON lawyer_reviews(lawyer_id);

-- Documents attached to a conversation: scoping retrieval to the
-- conversation's own files.
CREATE TABLE IF NOT EXISTS conversation_documents (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, document_id)
);
