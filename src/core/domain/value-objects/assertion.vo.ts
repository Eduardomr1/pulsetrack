export type AssertionTarget =
  | 'status_code'
  | 'latency_ms'
  | 'body_contains'
  | 'body_regex'
  | 'json_path'
  | 'header'
  | 'ssl_days_remaining';

export type AssertionOperator =
  | 'equals'
  | 'not_equals'
  | 'less_than'
  | 'greater_than'
  | 'contains'
  | 'matches_regex';

export interface AssertionRule {
  target: AssertionTarget;
  operator: AssertionOperator;
  property?: string; // e.g. header name or json key path
  expectedValue: string | number;
}

export class AssertionVo {
  public readonly target: AssertionTarget;
  public readonly operator: AssertionOperator;
  public readonly property?: string;
  public readonly expectedValue: string | number;

  constructor(rule: AssertionRule) {
    this.target = rule.target;
    this.operator = rule.operator;
    this.property = rule.property;
    this.expectedValue = rule.expectedValue;
  }

  public toJSON(): AssertionRule {
    return {
      target: this.target,
      operator: this.operator,
      property: this.property,
      expectedValue: this.expectedValue,
    };
  }

  public toString(): string {
    const prop = this.property ? ` (${this.property})` : '';
    return `Assert: ${this.target}${prop} ${this.operator} ${this.expectedValue}`;
  }
}
