'use strict';

const { Pool } = require('pg');

const connectionString = String(process.env.DATABASE_URL || '').trim();
const isLocal = /(?:localhost|127\.0\.0\.1)/i.test(connectionString);
const pool = connectionString ? new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isLocal ? false : { rejectUnauthorized: true },
}) : null;

const enabled = Boolean(pool);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requirePool() {
  if (!pool) throw new Error('Database is not configured');
  return pool;
}

function libraryView(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    inviteToken: row.invite_token,
    createdAt: row.created_at,
  };
}

async function ensureUser({ subject, email, name }) {
  const result = await requirePool().query(`
    insert into public.study_desk_users (google_subject, email, name)
    values ($1, $2, $3)
    on conflict (google_subject) do update set
      email = excluded.email,
      name = case when study_desk_users.profile_complete then study_desk_users.name else excluded.name end,
      updated_at = now()
    returning id, name, avatar, color, photo, profile_complete
  `, [subject, email, name]);
  return result.rows[0];
}

async function getProfile(subject) {
  const result = await requirePool().query(`
    select id, name, avatar, color, photo, profile_complete
    from public.study_desk_users where google_subject = $1
  `, [subject]);
  return result.rows[0] || null;
}

async function updateProfile(subject, profile) {
  const result = await requirePool().query(`
    update public.study_desk_users
    set name = $2, avatar = $3, color = $4, photo = $5,
        profile_complete = true, updated_at = now()
    where google_subject = $1
    returning id, name, avatar, color, photo, profile_complete
  `, [subject, profile.name, profile.avatar, profile.color, profile.photo]);
  return result.rows[0] || null;
}

async function listLibraries(subject) {
  const result = await requirePool().query(`
    select l.id, l.name, l.invite_token, l.created_at, m.role
    from public.study_libraries l
    join public.study_library_memberships m on m.library_id = l.id
    join public.study_desk_users u on u.id = m.user_id
    where u.google_subject = $1
    order by l.created_at asc
  `, [subject]);
  return result.rows.map(libraryView);
}

async function createLibrary(subject, name) {
  const client = await requirePool().connect();
  try {
    await client.query('begin');
    const user = await client.query(
      'select id from public.study_desk_users where google_subject = $1 for update', [subject],
    );
    if (!user.rows[0]) throw new Error('User profile not found');
    const created = await client.query(`
      insert into public.study_libraries (name, owner_user_id)
      values ($1, $2)
      returning id, name, invite_token, created_at
    `, [name, user.rows[0].id]);
    await client.query(`
      insert into public.study_library_memberships (library_id, user_id, role)
      values ($1, $2, 'admin')
    `, [created.rows[0].id, user.rows[0].id]);
    await client.query('commit');
    return libraryView({ ...created.rows[0], role: 'admin' });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function joinLibrary(subject, inviteToken) {
  if (!UUID.test(inviteToken)) return null;
  const client = await requirePool().connect();
  try {
    await client.query('begin');
    const result = await client.query(`
      select l.id, l.name, l.invite_token, l.created_at, u.id as user_id
      from public.study_libraries l
      cross join public.study_desk_users u
      where l.invite_token = $1::uuid and u.google_subject = $2
    `, [inviteToken, subject]);
    const row = result.rows[0];
    if (!row) {
      await client.query('rollback');
      return null;
    }
    await client.query(`
      insert into public.study_library_memberships (library_id, user_id, role)
      values ($1, $2, 'member')
      on conflict (library_id, user_id) do nothing
    `, [row.id, row.user_id]);
    const role = await client.query(`
      select role from public.study_library_memberships where library_id = $1 and user_id = $2
    `, [row.id, row.user_id]);
    await client.query('commit');
    return libraryView({ ...row, role: role.rows[0].role });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function membershipByInvite(subject, inviteToken) {
  if (!UUID.test(inviteToken)) return null;
  const result = await requirePool().query(`
    select l.id, l.name, l.invite_token, l.created_at, m.role
    from public.study_libraries l
    join public.study_library_memberships m on m.library_id = l.id
    join public.study_desk_users u on u.id = m.user_id
    where l.invite_token = $1::uuid and u.google_subject = $2
  `, [inviteToken, subject]);
  return result.rows[0] ? libraryView(result.rows[0]) : null;
}

async function startStudySession(subject, inviteToken, mode, topic) {
  if (!UUID.test(inviteToken)) return null;
  const result = await requirePool().query(`
    insert into public.study_sessions (user_id, library_id, mode, topic)
    select u.id, l.id, $3, $4
    from public.study_desk_users u
    join public.study_library_memberships m on m.user_id = u.id
    join public.study_libraries l on l.id = m.library_id
    where u.google_subject = $1 and l.invite_token = $2::uuid
    returning id, started_at
  `, [subject, inviteToken, mode, topic]);
  return result.rows[0] || null;
}

async function finishStudySession(subject, sessionId, completed, focusSeconds) {
  if (!UUID.test(sessionId)) return null;
  const result = await requirePool().query(`
    update public.study_sessions s
    set ended_at = now(), completed = $3, focus_seconds = $4
    from public.study_desk_users u
    where s.id = $1::uuid and s.user_id = u.id and u.google_subject = $2 and s.ended_at is null
    returning s.id, s.ended_at, s.completed, s.focus_seconds
  `, [sessionId, subject, completed, focusSeconds]);
  return result.rows[0] || null;
}

async function close() {
  if (pool) await pool.end();
}

module.exports = {
  enabled,
  ensureUser,
  getProfile,
  updateProfile,
  listLibraries,
  createLibrary,
  joinLibrary,
  membershipByInvite,
  startStudySession,
  finishStudySession,
  close,
};
