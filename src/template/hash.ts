import { evalTokenFast } from '../render/expression'
import { Deferred } from '../util/async'
import { Context } from '../context/context'
import { Tokenizer } from '../parser/tokenizer'
import { Token } from '../tokens/token'

type HashValueTokens = Record<string, Token | undefined>

/**
 * Key-Value Pairs Representing Tag Arguments
 * Example:
 *    For the markup `, foo:'bar', coo:2 reversed %}`,
 *    hash['foo'] === 'bar'
 *    hash['coo'] === 2
 *    hash['reversed'] === undefined
 */
export class Hash {
  hash: HashValueTokens = {}

  constructor (input: string | Tokenizer, jekyllStyle?: boolean | string) {
    const tokenizer = input instanceof Tokenizer ? input : new Tokenizer(input, {})
    for (const hash of tokenizer.readHashes(jekyllStyle)) {
      this.hash[hash.name.content] = hash.value
    }
  }

  * render (ctx: Context): Generator<unknown, Record<string, any>, unknown> {
    const hash: Record<string, any> = {}
    for (const key of Object.keys(this.hash)) {
      const token = this.hash[key]
      if (token === undefined) { hash[key] = true; continue }
      const val = evalTokenFast(token, ctx)
      hash[key] = val instanceof Deferred ? yield * val.gen : val
    }
    return hash
  }
}
