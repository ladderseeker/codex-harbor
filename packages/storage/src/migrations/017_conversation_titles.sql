-- Explicit names are never replaced by automatic naming, including a manual
-- rename to the placeholder itself. Existing edited metadata is conservative.
ALTER TABLE sessions ADD COLUMN title_source text NOT NULL DEFAULT 'pending'
  CHECK (title_source IN ('pending','automatic','manual'));
UPDATE sessions SET title_source='manual'
WHERE title <> 'New conversation' OR metadata_revision > 0;
-- One shared rule for backfill and newly accepted turns. Exact greetings and
-- acknowledgments leave naming pending; substantive text containing them does not.
CREATE FUNCTION harbor_conversation_title(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN regexp_replace(lower(prompt), '[[:space:][:punct:]，。！？、；：…]+', '', 'g') IN
      ('','hi','hello','hey','hellothere','goodmorning','goodafternoon','goodevening',
       'ok','okay','yes','no','thanks','thankyou','sure','gotit',
       '你好','您好','嗨','哈喽','早上好','下午好','晚上好','早安','晚安',
       '好','好的','行','可以','是的','嗯','嗯嗯','收到','知道了','明白了','谢谢','谢谢你')
    THEN NULL ELSE left(prompt,80) END
  FROM (SELECT trim(regexp_replace(input, '\s+', ' ', 'g')) AS prompt) normalized
$$;
WITH first_prompts AS (
  SELECT DISTINCT ON (session_id) session_id,
    harbor_conversation_title(text) AS prompt
  FROM messages WHERE role='user' AND harbor_conversation_title(text) IS NOT NULL
  ORDER BY session_id,created_at,id
)
UPDATE sessions s SET title=left(p.prompt,80),title_source='automatic',
  metadata_revision=metadata_revision+1
FROM first_prompts p WHERE s.id=p.session_id AND s.title_source='pending';
