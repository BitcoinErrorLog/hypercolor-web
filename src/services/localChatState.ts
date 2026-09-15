import { getDb } from "@/db";
import { normalizeNickname } from "@/lib/contact-label";
import { likePattern, normalizeSearchBody, sanitizeFtsQuery } from "@/lib/fts-query";
import type { SqlExecutor } from "@/db/sql";

export type ThreadLocalState = {
  threadKey: string;
  muted: boolean;
  archived: boolean;
};

export type MessageSearchHit = {
  threadKey: string;
  eventId: string;
  senderPubky: string;
  bodyNorm: string;
  sentAt: number;
};

let ftsReady: boolean | null = null;

export function ensureMessageSearchFts(db: SqlExecutor): boolean {
  if (ftsReady === false) return false;
  try {
    db.executeSync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS message_search_fts USING fts5(
        body_norm,
        content='message_search',
        content_rowid='rowid'
      )`,
    );
    ftsReady = true;
    return true;
  } catch {
    ftsReady = false;
    return false;
  }
}

function lookupSearchRow(
  db: SqlExecutor,
  ownerPubky: string,
  threadKey: string,
  eventId: string,
): { rowid: number; bodyNorm: string } | null {
  const result = db.executeSync(
    `SELECT rowid, body_norm FROM message_search
     WHERE owner_pubky = ? AND thread_key = ? AND event_id = ?`,
    [ownerPubky, threadKey, eventId],
  );
  const row = result.rows?.[0];
  if (!row) return null;
  return { rowid: Number(row.rowid), bodyNorm: String(row.body_norm ?? "") };
}

function ftsDeleteRow(db: SqlExecutor, rowid: number, bodyNorm: string): void {
  if (!ensureMessageSearchFts(db)) return;
  try {
    db.executeSync(
      `INSERT INTO message_search_fts(message_search_fts, rowid, body_norm) VALUES('delete', ?, ?)`,
      [rowid, bodyNorm],
    );
  } catch {
    /* LIKE path remains */
  }
}

function ftsInsertCurrent(
  db: SqlExecutor,
  ownerPubky: string,
  threadKey: string,
  eventId: string,
): void {
  if (!ensureMessageSearchFts(db)) return;
  try {
    db.executeSync(
      `INSERT INTO message_search_fts(rowid, body_norm)
       SELECT rowid, body_norm FROM message_search
       WHERE owner_pubky = ? AND thread_key = ? AND event_id = ?`,
      [ownerPubky, threadKey, eventId],
    );
  } catch {
    /* LIKE path remains */
  }
}

export function indexDecryptedMessage(
  db: SqlExecutor,
  input: {
    ownerPubky: string;
    threadKey: string;
    eventId: string;
    senderPubky: string;
    body: string;
    sentAt: number;
  },
): void {
  const bodyNorm = normalizeSearchBody(input.body);
  if (!bodyNorm) {
    removeSearchMessage(db, input.ownerPubky, input.threadKey, input.eventId);
    return;
  }
  const existing = lookupSearchRow(db, input.ownerPubky, input.threadKey, input.eventId);
  if (existing) ftsDeleteRow(db, existing.rowid, existing.bodyNorm);
  db.executeSync(
    `INSERT INTO message_search
      (owner_pubky, thread_key, event_id, sender_pubky, body_norm, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_pubky, thread_key, event_id) DO UPDATE SET
       body_norm = excluded.body_norm,
       sender_pubky = excluded.sender_pubky,
       sent_at = excluded.sent_at`,
    [input.ownerPubky, input.threadKey, input.eventId, input.senderPubky, bodyNorm, input.sentAt],
  );
  ftsInsertCurrent(db, input.ownerPubky, input.threadKey, input.eventId);
}

export function removeSearchMessage(
  db: SqlExecutor,
  ownerPubky: string,
  threadKey: string,
  eventId: string,
): void {
  const existing = lookupSearchRow(db, ownerPubky, threadKey, eventId);
  if (existing) ftsDeleteRow(db, existing.rowid, existing.bodyNorm);
  db.executeSync(
    `DELETE FROM message_search WHERE owner_pubky = ? AND thread_key = ? AND event_id = ?`,
    [ownerPubky, threadKey, eventId],
  );
}

export function removeSearchForOwner(db: SqlExecutor, ownerPubky: string): void {
  const rows =
    db.executeSync(`SELECT rowid, body_norm FROM message_search WHERE owner_pubky = ?`, [ownerPubky])
      .rows ?? [];
  for (const row of rows) {
    ftsDeleteRow(db, Number(row.rowid), String(row.body_norm ?? ""));
  }
  db.executeSync(`DELETE FROM message_search WHERE owner_pubky = ?`, [ownerPubky]);
}

export function removeSearchThread(db: SqlExecutor, ownerPubky: string, threadKey: string): void {
  const rows =
    db.executeSync(
      `SELECT rowid, body_norm FROM message_search WHERE owner_pubky = ? AND thread_key = ?`,
      [ownerPubky, threadKey],
    ).rows ?? [];
  for (const row of rows) {
    ftsDeleteRow(db, Number(row.rowid), String(row.body_norm ?? ""));
  }
  db.executeSync(`DELETE FROM message_search WHERE owner_pubky = ? AND thread_key = ?`, [
    ownerPubky,
    threadKey,
  ]);
}

export const LocalChatState = {
  async setNickname(ownerPubky: string, peerPubky: string, nickname: string | null): Promise<void> {
    const db = await getDb();
    const ts = Date.now();
    const next = nickname ? normalizeNickname(nickname) : null;
    if (!next) {
      db.executeSync(`DELETE FROM contact_nicknames WHERE owner_pubky = ? AND peer_pubky = ?`, [
        ownerPubky,
        peerPubky,
      ]);
      return;
    }
    db.executeSync(
      `INSERT INTO contact_nicknames (owner_pubky, peer_pubky, nickname, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_pubky, peer_pubky) DO UPDATE SET
         nickname = excluded.nickname,
         updated_at = excluded.updated_at`,
      [ownerPubky, peerPubky, next, ts],
    );
  },

  async getNickname(ownerPubky: string, peerPubky: string): Promise<string | null> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT nickname FROM contact_nicknames WHERE owner_pubky = ? AND peer_pubky = ?`,
      [ownerPubky, peerPubky],
    );
    const value = result.rows?.[0]?.nickname;
    return typeof value === "string" ? value : null;
  },

  async getNicknames(ownerPubky: string): Promise<Record<string, string>> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT peer_pubky, nickname FROM contact_nicknames WHERE owner_pubky = ?`,
      [ownerPubky],
    );
    const map: Record<string, string> = {};
    for (const row of result.rows ?? []) {
      if (typeof row.peer_pubky === "string" && typeof row.nickname === "string") {
        map[row.peer_pubky] = row.nickname;
      }
    }
    return map;
  },

  async setThreadFlags(
    ownerPubky: string,
    threadKey: string,
    flags: { muted?: boolean; archived?: boolean },
  ): Promise<void> {
    const db = await getDb();
    const current = await this.getThreadFlags(ownerPubky, threadKey);
    const muted = flags.muted ?? current.muted;
    const archived = flags.archived ?? current.archived;
    db.executeSync(
      `INSERT INTO thread_local_state (owner_pubky, thread_key, muted, archived, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_pubky, thread_key) DO UPDATE SET
         muted = excluded.muted,
         archived = excluded.archived,
         updated_at = excluded.updated_at`,
      [ownerPubky, threadKey, muted ? 1 : 0, archived ? 1 : 0, Date.now()],
    );
  },

  async getThreadFlags(ownerPubky: string, threadKey: string): Promise<ThreadLocalState> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT muted, archived FROM thread_local_state WHERE owner_pubky = ? AND thread_key = ?`,
      [ownerPubky, threadKey],
    );
    const row = result.rows?.[0];
    return {
      threadKey,
      muted: row?.muted === 1,
      archived: row?.archived === 1,
    };
  },

  async listThreadFlags(ownerPubky: string): Promise<Record<string, ThreadLocalState>> {
    const db = await getDb();
    const result = db.executeSync(
      `SELECT thread_key, muted, archived FROM thread_local_state WHERE owner_pubky = ?`,
      [ownerPubky],
    );
    const map: Record<string, ThreadLocalState> = {};
    for (const row of result.rows ?? []) {
      if (typeof row.thread_key !== "string") continue;
      map[row.thread_key] = {
        threadKey: row.thread_key,
        muted: row.muted === 1,
        archived: row.archived === 1,
      };
    }
    return map;
  },

  async searchMessages(ownerPubky: string, query: string): Promise<MessageSearchHit[]> {
    const db = await getDb();
    const fts = sanitizeFtsQuery(query);
    if (fts && ensureMessageSearchFts(db)) {
      try {
        const result = db.executeSync(
          `SELECT m.thread_key, m.event_id, m.sender_pubky, m.body_norm, m.sent_at
           FROM message_search_fts f
           JOIN message_search m ON m.rowid = f.rowid
           WHERE m.owner_pubky = ? AND message_search_fts MATCH ?
           ORDER BY m.sent_at DESC
           LIMIT 40`,
          [ownerPubky, fts],
        );
        return (result.rows ?? []).map(rowToHit);
      } catch {
        /* fall through to LIKE */
      }
    }
    const like = likePattern(query);
    if (!like) return [];
    const result = db.executeSync(
      `SELECT thread_key, event_id, sender_pubky, body_norm, sent_at
       FROM message_search
       WHERE owner_pubky = ? AND body_norm LIKE ?
       ORDER BY sent_at DESC
       LIMIT 40`,
      [ownerPubky, like],
    );
    return (result.rows ?? []).map(rowToHit);
  },
};

function rowToHit(row: Record<string, unknown>): MessageSearchHit {
  return {
    threadKey: String(row.thread_key ?? ""),
    eventId: String(row.event_id ?? ""),
    senderPubky: String(row.sender_pubky ?? ""),
    bodyNorm: String(row.body_norm ?? ""),
    sentAt: Number(row.sent_at ?? 0),
  };
}
