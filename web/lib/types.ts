export type CitationKind = "statute" | "document";

export interface Citation {
  ref: number;
  act_title: string;
  act_no: string;
  act_year: string;
  section_label: string;
  section_title: string;
  excerpt: string;
  source_url: string;
  score: number;
  kind: CitationKind;
  doc_filename: string;
  doc_page: number | null;
}

export interface UserDocument {
  doc_id: string;
  filename: string;
  mime: string;
  chunks: number;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}
