export type OperatorQueryType =
  | 'BeginsWith'
  | 'LessThan'
  | 'GreaterThan'
  | 'LessThanEqual'
  | 'GreaterThanEqual'
  | 'Equal'
  | 'NotEqual'
  | 'Between';

/**
 * These additional operators are valid for condition expressions but not query expressions.
 */
export type OperatorType =
  | OperatorQueryType
  | 'AttributeExists'
  | 'AttributeNotExists';

export interface ConditionExpressionArgs {
  operator: OperatorType;
  field: string;
  value?: string;
  /** Used only for Between comparison */
  betweenSecondValue?: string;
}

export interface ConditionExpressionQueryArgs {
  operator: OperatorQueryType;
  field: string;
  value?: string;
  /** Used only for Between comparison */
  betweenSecondValue?: string;
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
export const decorrelatedJitterBackoff = (previousDelay: number) => {
  const maxDelayMiliseconds = 4000;
  const baseMiliseconds = 50;

  const nextDelay = Math.min(
    maxDelayMiliseconds,
    Math.random() * previousDelay * 3 + baseMiliseconds,
  );
  return nextDelay;
};

const buildCondition = (args: ConditionExpressionArgs): string => {
  const { operator, value, betweenSecondValue, field } = args;
  let conditionExpression = '';

  switch (operator) {
    case 'BeginsWith':
      conditionExpression = `begins_with(${field}, ${value})`;
      break;
    case 'Equal':
      conditionExpression = `${field} = ${value}`;
      break;
    case 'NotEqual':
      conditionExpression = `${field} <> ${value}`;
      break;
    case 'GreaterThan':
      conditionExpression = `${field} > ${value}`;
      break;
    case 'GreaterThanEqual':
      conditionExpression = `${field} >= ${value}`;
      break;
    case 'LessThan':
      conditionExpression = `${field} < ${value}`;
      break;
    case 'LessThanEqual':
      conditionExpression = `${field} <= ${value}`;
      break;
    case 'Between':
      conditionExpression = `${field} BETWEEN ${value} AND ${betweenSecondValue}`;
      break;
    case 'AttributeExists':
      conditionExpression = `attribute_exists(${field})`;
      break;
    case 'AttributeNotExists':
      conditionExpression = `attribute_not_exists(${field})`;
      break;
    default:
      throw new Error('Unknown Query Condition type');
  }
  return conditionExpression;
};

interface ConditionExpressData {
  conditionExpression: string;
  attributeNames: Record<string, string> | null;
  attributeValues: Record<string, string> | null;
}

export const buildConditionExpression = (
  conditions?: ConditionExpressionArgs[],
): ConditionExpressData | null => {
  if (!conditions?.length) {
    return null;
  }

  let count = 0;
  const attributeNames: Record<string, string> = {};
  const attributeValues: Record<string, string> = {};
  let conditionExpression = '';

  conditions.forEach((values: ConditionExpressionArgs) => {
    if (conditionExpression?.length) {
      conditionExpression += ' AND ';
    }
    conditionExpression += buildCondition({
      field: `#field${count}`,
      value: `:val${count}`,
      operator: values.operator,
      betweenSecondValue: `:val${count + 1}`,
    });
    attributeNames[`#field${count}`] = values.field;

    if (values.value !== undefined) {
      attributeValues[`:val${count}`] = values.value;
    }

    if (values.betweenSecondValue !== undefined) {
      attributeValues[`:val${count + 1}`] = values.betweenSecondValue;
    }
    count += 2;
  });

  if (!conditionExpression?.length) {
    return null;
  }

  return {
    conditionExpression,
    attributeNames: Object.keys(attributeNames).length ? attributeNames : null,
    attributeValues: Object.keys(attributeValues).length
      ? attributeValues
      : null,
  };
};
