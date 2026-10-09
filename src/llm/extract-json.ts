/** Modeller lägger ibland till kodstaket runt JSON-svaret. */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}
