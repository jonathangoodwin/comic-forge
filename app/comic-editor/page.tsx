import { Metadata } from "next";
import ComicEditorClient from "./ComicEditorClient";

export const metadata: Metadata = {
  title: "Comic Forge",
  description: "A comic book production tool with cloud-based collaboration.",
};

export default function ComicEditorPage() {
  return <ComicEditorClient />;
}
