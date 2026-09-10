// Claude sometimes wraps a JSON response in a ```json ... ``` code fence even
// when explicitly told to return only JSON, especially for longer/more
// structured prompts. Strip that before parsing instead of failing outright.
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
