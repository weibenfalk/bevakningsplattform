/**
 * Artikeltexten kommer från internet och får inte kunna stänga eller öppna avgränsningen i prompten.
 * Gäller alla prompter som lägger text mellan <artikel> och </artikel>. Upprepas tills inget mer tas bort, eftersom
 * `<<artikel>artikel>` annars blir `<artikel>` när den inre taggen tagits bort.
 */
export function neutralize(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(/<\/?artikel[^>]*>/gi, '');
    if (next === current) return next;
    current = next;
  }
}
