// kuromoji's internal modules, used to plug in our own dictionary loader.
declare module 'kuromoji/src/loader/DictionaryLoader' {
  type Callback = (err: unknown, buffer: ArrayBuffer | null) => void
  export default class DictionaryLoader {
    constructor(dicPath: string)
    loadArrayBuffer(url: string, callback: Callback): void
    load(callback: (err: unknown, dic: unknown) => void): void
  }
}

declare module 'kuromoji/src/Tokenizer' {
  import type { IpadicFeatures } from 'kuromoji'
  export default class Tokenizer {
    constructor(dic: unknown)
    tokenize(text: string): IpadicFeatures[]
  }
}
