import { Token } from './token'
import { LiteralToken } from './literal-token'
import { ValueToken } from './value-token'
import { IdentifierToken } from './identifier-token'
import { NumberToken } from './number-token'
import { RangeToken } from './range-token'
import { QuotedToken } from './quoted-token'
import { FilteredValueToken } from './filtered-value-token'
import { TokenKind } from '../parser'

export class PropertyAccessToken extends Token {
  /** @internal cached literal path for the sync fast path; `null` when not applicable */
  public literalProps?: (string | number)[] | null = undefined
  constructor (
    public variable: QuotedToken | RangeToken | LiteralToken | NumberToken | FilteredValueToken | undefined,
    public props: (ValueToken | IdentifierToken)[],
    input: string,
    begin: number,
    end: number,
    file?: string
  ) {
    super(TokenKind.PropertyAccess, input, begin, end, file)
  }
}
