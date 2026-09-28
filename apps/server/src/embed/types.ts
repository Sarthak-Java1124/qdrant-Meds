/** Text to a unit-length 384-d vector. The server always embeds itself and never trusts vectors from phones. */
export type Embed = (text: string) => Promise<number[]>;
