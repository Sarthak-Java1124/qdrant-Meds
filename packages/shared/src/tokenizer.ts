export class WordPiece {
  private vocab = new Map<string, number>();

  constructor(vocabText: string) {
    vocabText.split('\n').forEach((w, i) => {
      const word = w.trim();
      if (word) this.vocab.set(word, i);
    });
  }

  private basic(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/([\p{P}\p{S}])/gu, ' $1 ')
      .split(/\s+/)
      .filter(Boolean);
  }

  encode(text: string, maxLen = 128) {
    const ids = [101]; // [CLS]
    for (const word of this.basic(text)) {
      let start = 0;
      const pieces: number[] = [];
      let bad = false;
      while (start < word.length) {
        let end = word.length;
        let cur = -1;
        while (start < end) {
          const sub = (start > 0 ? '##' : '') + word.slice(start, end);
          if (this.vocab.has(sub)) {
            cur = this.vocab.get(sub)!;
            break;
          }
          end--;
        }
        if (cur === -1) {
          bad = true;
          break;
        }
        pieces.push(cur);
        start = end;
      }
      ids.push(...(bad ? [100] : pieces)); // [UNK]=100
      if (ids.length >= maxLen - 1) break;
    }
    const clipped = ids.slice(0, maxLen - 1);
    clipped.push(102); // [SEP]
    return { ids: clipped, mask: clipped.map(() => 1) };
  }
}
