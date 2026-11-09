export interface ToolData {
  id: string;
  name: string;
  benefit: string;
  steps: { name: string; text: string }[];
}
export interface ExtData {
  id: string;
  name: string;
  purpose: string;
  tools: ToolData[];
}
