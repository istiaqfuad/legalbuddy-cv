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
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
}

export type Language = "auto" | "english" | "bengali";
