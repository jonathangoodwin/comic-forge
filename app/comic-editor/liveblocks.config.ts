import { createClient } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";

const client = createClient({
  publicApiKey: process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY || "",
});

type Presence = {
  cursor: { x: number; y: number } | null;
  selectedId: string | null;
};

type Storage = {
  canvasJson: string;
  comments: Comment[];
};

export type Comment = {
  id: string;
  x: number;
  y: number;
  text: string;
  author: string;
  createdAt: number;
  resolved: boolean;
};

export const {
  RoomProvider,
  useMyPresence,
  useOthers,
  useStorage,
  useMutation,
  useRoom,
} = createRoomContext<Presence, Storage>(client);
