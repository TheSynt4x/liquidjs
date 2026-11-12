import { evalToken, evalTokenFast } from '../render'
import { Context } from '../context'
import { identify, isFunction, isPromise, isIterator } from '../util/underscore'
import { Deferred } from '../util/async'
import { FilterHandler, FilterImplOptions } from './filter-impl-options'
import { FilterArg, isKeyValuePair } from '../parser/filter-arg'
import { Liquid } from '../liquid'
import { FilterToken } from '../tokens'

export class Filter {
  public name: string
  public args: FilterArg[]
  public readonly raw: boolean
  private handler: FilterHandler
  private liquid: Liquid
  private token: FilterToken

  public constructor (token: FilterToken, options: FilterImplOptions | undefined, liquid: Liquid) {
    this.token = token
    this.name = token.name
    this.handler = isFunction(options)
      ? options
      : (isFunction(options?.handler) ? options!.handler : identify)
    this.raw = !isFunction(options) && !!options?.raw
    this.args = token.args
    this.liquid = liquid
  }
  /**
   * Apply the filter without generators when all args resolve synchronously.
   * Returns a `Deferred` otherwise.
   */
  public renderFast (value: any, context: Context): unknown {
    const args = this.args as FilterArg[]
    const argv: [any, ...any[]] = [value]
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      const v = evalTokenFast(isKeyValuePair(arg) ? arg[1] : arg, context)
      if (v instanceof Deferred) return new Deferred(this.renderFrom(argv, i, v.gen, context))
      argv.push(isKeyValuePair(arg) ? [arg[0], v] : v)
    }
    const result = this.handler.apply({ context, token: this.token, liquid: this.liquid }, argv)
    return isPromise(result) || isIterator(result) ? new Deferred(yieldOnce(result)) : result
  }
  // continue `renderFast` at arg `i` without re-evaluating the args already in `argv`
  private * renderFrom (argv: [any, ...any[]], i: number, pending: Generator<unknown, unknown, unknown>, context: Context): Generator<unknown, unknown, unknown> {
    const args = this.args as FilterArg[]
    for (; i < args.length; i++) {
      const arg = args[i]
      const v = pending ? yield * pending : yield * evalToken(isKeyValuePair(arg) ? arg[1] : arg, context)
      pending = undefined as any
      argv.push(isKeyValuePair(arg) ? [arg[0], v] : v)
    }
    const result = this.handler.apply({ context, token: this.token, liquid: this.liquid }, argv)
    return isPromise(result) || isIterator(result) ? yield result : result
  }
  public * render (value: any, context: Context): Generator<unknown, unknown, unknown> {
    const argv: any[] = []
    for (const arg of this.args as FilterArg[]) {
      if (isKeyValuePair(arg)) argv.push([arg[0], yield * evalToken(arg[1], context)])
      else argv.push(yield * evalToken(arg, context))
    }
    const result = this.handler.apply({ context, token: this.token, liquid: this.liquid }, [value, ...argv])
    return isPromise(result) || isIterator(result) ? yield result : result
  }
}

function * yieldOnce (v: unknown): Generator<unknown, unknown, unknown> {
  return yield v
}
