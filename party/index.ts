import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

/**
 * PartyKit server — one room per document.
 * y-partykit handles the full Yjs WebSocket protocol and persists
 * the document state in PartyKit's durable storage automatically.
 */
export default class ComicParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    return onConnect(conn, this.room, { persist: true });
  }
}

export const options: Party.ServerOptions = {
  hibernate: true, // keep the room alive between connections
};
