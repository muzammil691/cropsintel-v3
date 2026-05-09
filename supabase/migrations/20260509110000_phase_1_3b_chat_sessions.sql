-- =============================================================================
-- Phase 1.3b — chat_sessions for registered/verified users
-- =============================================================================
-- Master plan §11.2 Phase 1.5 (landing) + §9.2 Phase 1.10 (Zyra) scaffold.
--
-- guest_sessions (1.3a) handles anonymous-tier conversations. Once a user signs
-- up, their landing-page conversation continues in chat_sessions. The auto
-- 10-deep-output gate stops applying because tier > guest, so we just track the
-- conversation history + role/geography for downstream personalization.
--
-- Foundation-first: builds on profiles + auth.users (foundation migration) and
-- the public.set_updated_at() / is_team_or_admin() helpers also from foundation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  summary text,
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  deep_outputs_count int NOT NULL DEFAULT 0,
  geography_country text,
  role_active text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
  ON public.chat_sessions(user_id, last_message_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own chat sessions" ON public.chat_sessions;
CREATE POLICY "users read own chat sessions"
  ON public.chat_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users write own chat sessions" ON public.chat_sessions;
CREATE POLICY "users write own chat sessions"
  ON public.chat_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "team/admin read all chat sessions" ON public.chat_sessions;
CREATE POLICY "team/admin read all chat sessions"
  ON public.chat_sessions FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

DROP POLICY IF EXISTS "service_role full access chat_sessions" ON public.chat_sessions;
CREATE POLICY "service_role full access chat_sessions"
  ON public.chat_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON public.chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- End of Phase 1.3b chat_sessions migration
-- =============================================================================
