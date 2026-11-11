// PClient varlık servisi: hangi UUID'lerin son 90 saniyede PClient'tan bildirim yaptığını tutar.
// Yalnızca bellekte tutulur; sunucu adresi, kullanıcı adı veya IP kaydedilmez.
const TTL_MS = 90_000;
const MAX_PLAYERS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class PresenceRoom {
  constructor() {
    this.seen = new Map();
    this.pruned = 0;
  }

  async fetch(request) {
    const body = await request.json().catch(() => null);
    if (!body || !UUID.test(body.self) || !Array.isArray(body.players) || body.players.length > MAX_PLAYERS) {
      return new Response("bad request", { status: 400 });
    }
    const now = Date.now();
    this.seen.set(body.self, now);
    if (now - this.pruned > TTL_MS) {
      this.pruned = now;
      for (const [id, at] of this.seen) if (now - at > TTL_MS) this.seen.delete(id);
    }
    const online = body.players.filter((id) => now - (this.seen.get(id) ?? 0) <= TTL_MS);
    return Response.json({ online });
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/v1/presence") return new Response("not found", { status: 404 });
    return env.ROOM.get(env.ROOM.idFromName("global")).fetch(request);
  },
};
