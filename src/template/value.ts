import { Filter } from './filter'
import { Expression } from '../render'
import { Tokenizer } from '../parser'
import { assert, Deferred } from '../util'
import type { FilteredValueToken } from '../tokens'
import type { Liquid } from '../liquid'
import type { Context } from '../context'

export class Value {
  public readonly filters: Filter[] = []
  public readonly initial: Expression

  /**
   * @param str the value to be valuated, eg.: "foobar" | truncate: 3
   */
  public constructor (input: string | FilteredValueToken, liquid: Liquid) {
    const token: FilteredValueToken = typeof input === 'string'
      ? new Tokenizer(input, liquid.options.operators, undefined, undefined, liquid.options.groupedExpressions).readFilteredValue()
      : input
    this.initial = token.initial
    this.filters = token.filters.map(token => new Filter(token, this.getFilter(liquid, token.name), liquid))
  }

  /**
   * Evaluate without generators when everything is synchronous; `Deferred` otherwise.
   */
  public valueFast (ctx: Context, lenient?: boolean): unknown {
    const filters = this.filters
    lenient = lenient || (ctx.opts.lenientIf && filters.length > 0 && filters[0].name === 'default')
    let val = this.initial.evaluateFast(ctx, lenient)
    if (val instanceof Deferred) return new Deferred(this.valueFrom(ctx, val.gen, 0))
    for (let i = 0; i < filters.length; i++) {
      val = filters[i].renderFast(val, ctx)
      if (val instanceof Deferred) return new Deferred(this.valueFrom(ctx, val.gen, i + 1))
    }
    return val
  }
  private * valueFrom (ctx: Context, pending: Generator<unknown, unknown, unknown>, start: number): Generator<unknown, unknown, unknown> {
    let val = yield * pending
    for (let i = start; i < this.filters.length; i++) val = yield * this.filters[i].render(val, ctx)
    return val
  }
  public * value (ctx: Context, lenient?: boolean): Generator<unknown, unknown, unknown> {
    const val = this.valueFast(ctx, lenient)
    return val instanceof Deferred ? yield * val.gen : val
  }
  private getFilter (liquid: Liquid, name: string) {
    const impl = liquid.filters[name]
    assert(impl || !liquid.options.strictFilters, () => `undefined filter: ${name}`)
    return impl
  }
}
