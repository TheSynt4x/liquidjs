import { QuotedToken, RangeToken, OperatorToken, Token, PropertyAccessToken, OperatorType, operatorTypes, FilteredValueToken } from '../tokens'
import { isRangeToken, isPropertyAccessToken, isFilteredValueToken, UndefinedVariableError, range, isOperatorToken, assert, toValue, Deferred, isPromise, isIterator } from '../util'
import type { Context } from '../context'
import type { UnaryOperatorHandler } from '../render'
import { Drop } from '../drop'
import { Filter } from '../template/filter'

export class Expression {
  readonly postfix: Token[]

  public constructor (tokens: Iterable<Token>) {
    this.postfix = [...toPostfix(tokens)]
  }
  public * evaluate (ctx: Context, lenient?: boolean): Generator<unknown, unknown, unknown> {
    const val = this.evaluateFast(ctx, lenient)
    return val instanceof Deferred ? yield * val.gen : val
  }
  /**
   * Evaluate without creating generators when every operand and operator result is
   * available synchronously. Returns a `Deferred` to finish the rest otherwise.
   */
  public evaluateFast (ctx: Context, lenient?: boolean): unknown {
    assert(ctx, 'unable to evaluate: context not defined')
    const postfix = this.postfix
    if (postfix.length === 1) return evalTokenFast(postfix[0], ctx, lenient)
    const operands: any[] = []
    for (let i = 0; i < postfix.length; i++) {
      const token = postfix[i]
      let result
      if (isOperatorToken(token)) {
        const r = operands.pop()
        if (operatorTypes[token.operator] === OperatorType.Unary) {
          result = (ctx.opts.operators[token.operator] as UnaryOperatorHandler)(r, ctx)
        } else {
          const l = operands.pop()
          result = ctx.opts.operators[token.operator](l, r, ctx)
        }
        if (isPromise(result) || isIterator(result)) return new Deferred(this.evaluateFrom(ctx, lenient, operands, i + 1, result, false))
      } else {
        result = evalTokenFast(token, ctx, lenient)
        if (result instanceof Deferred) return new Deferred(this.evaluateFrom(ctx, lenient, operands, i + 1, result.gen, true))
      }
      operands.push(result)
    }
    return operands[0]
  }
  private * evaluateFrom (ctx: Context, lenient: boolean | undefined, operands: any[], start: number, pending: unknown, delegate: boolean): Generator<unknown, unknown, unknown> {
    operands.push(delegate ? yield * (pending as Generator<unknown, unknown, unknown>) : yield pending)
    const postfix = this.postfix
    for (let i = start; i < postfix.length; i++) {
      const token = postfix[i]
      if (isOperatorToken(token)) {
        const r = operands.pop()
        let result
        if (operatorTypes[token.operator] === OperatorType.Unary) {
          result = yield (ctx.opts.operators[token.operator] as UnaryOperatorHandler)(r, ctx)
        } else {
          const l = operands.pop()
          result = yield ctx.opts.operators[token.operator](l, r, ctx)
        }
        operands.push(result)
      } else {
        operands.push(yield * evalToken(token, ctx, lenient))
      }
    }
    return operands[0]
  }
  public valid () {
    return !!this.postfix.length
  }
}

/**
 * Evaluate `token`, preserving Drops.
 * Operators use this so `Comparable` drops (`empty`, `nil`, `blank`) and custom drops
 * are compared as drops rather than as their `valueOf()` result.
 */
/**
 * Like `evalToken` but returns plain values for literals and literal-path variable
 * lookups; everything else (and anything async) comes back as a `Deferred`.
 */
export function evalTokenFast (token: Token | undefined, ctx: Context, lenient = false): unknown {
  if (!token) return
  if ('content' in token) return token.content
  if (isPropertyAccessToken(token)) {
    const props = literalProps(token)
    if (props) {
      try {
        const val = ctx._getFast(props)
        return val instanceof Deferred ? new Deferred(guardLookup(val.gen, token, lenient)) : val
      } catch (e) {
        if (lenient && (e as Error).name === 'InternalUndefinedVariableError') return null
        throw (new UndefinedVariableError(e as Error, token))
      }
    }
  }
  return new Deferred(evalToken(token, ctx, lenient))
}

function * guardLookup (gen: Generator<unknown, unknown, unknown>, token: PropertyAccessToken, lenient: boolean): Generator<unknown, unknown, unknown> {
  try {
    return yield * gen
  } catch (e) {
    if (lenient && (e as Error).name === 'InternalUndefinedVariableError') return null
    throw (new UndefinedVariableError(e as Error, token))
  }
}

function literalProps (token: PropertyAccessToken): (string | number)[] | null {
  let props = token.literalProps
  if (props !== undefined) return props
  props = null
  if (!token.variable && token.props.length && token.props.every(p => 'content' in p && !((p as any).content instanceof Drop))) {
    props = token.props.map(p => (p as any).content as string | number)
  }
  token.literalProps = props
  return props
}

export function * evalToken (token: Token | undefined, ctx: Context, lenient = false): Generator<unknown, unknown, unknown> {
  if (!token) return
  if ('content' in token) return token.content
  if (isPropertyAccessToken(token)) {
    if (literalProps(token)) {
      const val = evalTokenFast(token, ctx, lenient)
      return val instanceof Deferred ? yield * val.gen : val
    }
    return yield * evalPropertyAccessToken(token, ctx, lenient)
  }
  if (isRangeToken(token)) return yield * evalRangeToken(token, ctx)
  if (isFilteredValueToken(token)) return yield * evalFilteredValueToken(token, ctx, lenient)
}

function * evalFilteredValueToken (token: FilteredValueToken, ctx: Context, lenient: boolean): Generator<unknown, unknown, unknown> {
  assert(ctx.liquid, 'FilteredValueToken evaluation requires liquid instance in context')
  lenient = lenient || (ctx.opts.lenientIf && token.filters.length > 0 && token.filters[0].name === 'default')
  let val = yield * token.initial.evaluate(ctx, lenient)

  for (const filterToken of token.filters) {
    const filterImpl = ctx.liquid.filters[filterToken.name]
    assert(filterImpl || !ctx.liquid.options.strictFilters, () => `undefined filter: ${filterToken.name}`)
    const filter = new Filter(filterToken, filterImpl, ctx.liquid)
    val = yield * filter.render(val, ctx)
  }

  return val
}

/**
 * Evaluate `token` to the value filters and tags consume.
 * Awaits a promise returned by `Drop.valueOf()`.
 */
export function * evalTokenValue (token: Token | undefined, ctx: Context, lenient = false): Generator<unknown, unknown, unknown> {
  return yield toValue(yield * evalToken(token, ctx, lenient))
}

function * evalPropertyAccessToken (token: PropertyAccessToken, ctx: Context, lenient: boolean): Generator<unknown, unknown, unknown> {
  const props: (string | number | Drop)[] = []
  for (const prop of token.props) {
    if ('content' in prop && !(prop.content instanceof Drop)) props.push(prop.content as string | number)
    else props.push((yield * evalTokenValue(prop, ctx, false)) as unknown as string | number | Drop)
  }
  try {
    if (token.variable) {
      const variable = yield * evalToken(token.variable, ctx, lenient)
      return yield * ctx._getFromScope(variable, props)
    } else {
      return yield * ctx._get(props)
    }
  } catch (e) {
    if (lenient && (e as Error).name === 'InternalUndefinedVariableError') return null
    throw (new UndefinedVariableError(e as Error, token))
  }
}

export function evalQuotedToken (token: QuotedToken) {
  return token.content
}

function * evalRangeToken (token: RangeToken, ctx: Context): Generator<unknown, unknown, unknown> {
  const low = (yield evalTokenValue(token.lhs, ctx)) as unknown as number
  const high = (yield evalTokenValue(token.rhs, ctx)) as unknown as number
  ctx.memoryLimit.use(high - low + 1)
  return range(+low, +high + 1)
}

function * toPostfix (tokens: Iterable<Token>): IterableIterator<Token> {
  const ops: OperatorToken[] = []
  for (const token of tokens) {
    if (isOperatorToken(token)) {
      while (ops.length && ops[ops.length - 1].getPrecedence() > token.getPrecedence()) {
        yield ops.pop()!
      }
      ops.push(token)
    } else yield token
  }
  while (ops.length) {
    yield ops.pop()!
  }
}
