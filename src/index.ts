import {
  AttributeValue,
  DynamoDB,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommandInput,
  BatchGetCommandInput,
  DeleteCommandInput,
  DynamoDBDocument,
  GetCommandInput,
  PutCommandInput,
  QueryCommandInput,
  ScanCommandInput,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  NativeAttributeValue,
  marshall,
  marshallOptions,
  unmarshall,
  unmarshallOptions,
} from '@aws-sdk/util-dynamodb';
import {
  sleep,
  buildConditionExpression,
  decorrelatedJitterBackoff,
  ConditionExpressionArgs,
  ConditionExpressionQueryArgs,
} from './utils/utils';

// Re export useful util types
export { type ConditionExpressionArgs, type ConditionExpressionQueryArgs };
export type DynamoClientConfig = DynamoDBClientConfig & { region: string };

/**
 * Provided to get around conflicting versions of DynamoDBDocument from @aws-sdk/lib-dynamodb
 */
export type DynamoDbDocumentClient = DynamoDBDocument;

const IS_OFFLINE = process.env.IS_OFFLINE;
const FORCE_ONLINE = process.env.FORCE_ONLINE;

/**
 * Creates a DynamoDBDocument connection.
 *
 * Must specify a region.
 *
 * Uses a local connection if IS_OFFLINE is set to "true" and FORCE_ONLINE is not set to "true".
 */
export function getDynamodbConnection(
  config: DynamoClientConfig,
): DynamoDbDocumentClient {
  let newConnection: DynamoDbDocumentClient;
  if (IS_OFFLINE === 'true' && FORCE_ONLINE !== 'true') {
    newConnection = DynamoDBDocument.from(
      new DynamoDB({
        region: 'localhost',
        endpoint: 'http://localhost:8000',
      }),
    );
  } else {
    newConnection = DynamoDBDocument.from(new DynamoDB(config));
  }
  return newConnection;
}

export interface PutItemParams<T extends Record<string, NativeAttributeValue>> {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  item: T;
  /**
   * Array of conditions to apply to the create.
   * Conditions are combined with AND.
   */
  conditions?: ConditionExpressionArgs[];
}

/**
 * Create a new item.
 */
export const putItem = async <T extends Record<string, NativeAttributeValue>>(
  params: PutItemParams<T>,
): Promise<T> => {
  const dynamoDb = params.dynamoDb;

  const putItemInput: PutCommandInput = {
    TableName: params.table,
    Item: params.item,
    ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
  };

  const conditionalData = buildConditionExpression(params.conditions);
  if (conditionalData?.attributeNames) {
    putItemInput.ExpressionAttributeNames = conditionalData.attributeNames;
  }

  if (conditionalData?.attributeValues) {
    putItemInput.ExpressionAttributeValues = conditionalData.attributeValues;
  }

  if (conditionalData?.conditionExpression) {
    putItemInput.ConditionExpression = conditionalData.conditionExpression;
  }

  await dynamoDb.put(putItemInput);
  return params.item;
};

interface UpdateItem {
  name: string;
  attributeName: string;
  attributeValue: NativeAttributeValue;
  ref: string;
}

export interface UpdateItemParams<
  T extends Record<string, NativeAttributeValue>,
> {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  key: Record<string, NativeAttributeValue>;
  /**
   * Record of fields to update.
   * Attributes from the "key" will be automatically removed from fields to prevent "This attribute is part of the key" errors.
   */
  fields?: Partial<Record<keyof T, NativeAttributeValue>>;
  /**
   * Array of attributes to remove from the item.
   */
  removeFields?: Extract<keyof T, string>[];
  /**
   * Array of conditions to apply to the update.
   * Conditions are combined with AND.
   */
  conditions?: ConditionExpressionArgs[];
}

/**
 * Update attributes on an item.
 *
 * Returns null if no fields are to be updated or deleted.
 *
 * Specify "fields" for the attributes to update.
 *
 * Specify "removeFields" for the attributes to remove from the item.
 *
 * Either "fields", "removeFields" or both must be specified.
 */
export const updateItem = async <
  T extends Record<string, NativeAttributeValue>,
>(
  params: UpdateItemParams<T>,
): Promise<T | null> => {
  const updateItems: UpdateItem[] = [];

  let count = 0;

  const keyNames = Object.keys(params.key);
  for (const element in params.fields) {
    const attributeValue = params.fields[element];
    if (attributeValue !== undefined && !keyNames.includes(element)) {
      updateItems.push({
        name: element,
        attributeName: `#attr${count}`,
        attributeValue,
        ref: `:attr${count}`,
      });
      count++;
    }
  }

  const removeAttributeItems: { name: keyof T; attributeName: string }[] = [];
  for (const field of params.removeFields || []) {
    if (field !== undefined && !keyNames.includes(field)) {
      removeAttributeItems.push({
        name: field,
        attributeName: `#attr${count}`,
      });
      count++;
    }
  }

  if (!updateItems.length && !removeAttributeItems.length) {
    return null;
  }

  let updateExpression = '';
  if (updateItems.length) {
    updateExpression =
      'SET ' + updateItems.map((i) => `${i.attributeName}=${i.ref}`).join(', ');
  }

  if (removeAttributeItems.length) {
    updateExpression +=
      (updateExpression.length > 1 ? ' REMOVE ' : 'REMOVE') +
      removeAttributeItems.map((i) => i.attributeName).join(', ');
  }

  const expressionAttributeValues = updateItems.reduce(
    (p, c: UpdateItem) => {
      p[`${c.ref}`] = c.attributeValue;
      return p;
    },
    {} as Record<string, NativeAttributeValue>,
  );

  const expressionAttributeNames = [
    ...updateItems,
    ...removeAttributeItems,
  ].reduce(
    (p, c) => {
      p[`${c.attributeName}`] = c.name;
      return p;
    },
    {} as Record<string, NativeAttributeValue>,
  );

  const updateItemInput: UpdateCommandInput = {
    TableName: params.table || '',
    Key: params.key,
    UpdateExpression: updateExpression,
    ReturnValues: 'ALL_NEW',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
  };

  const conditionalData = buildConditionExpression(params.conditions);
  if (conditionalData?.attributeNames) {
    updateItemInput.ExpressionAttributeNames = {
      ...updateItemInput.ExpressionAttributeNames,
      ...conditionalData.attributeNames,
    };
  }

  if (conditionalData?.attributeValues) {
    updateItemInput.ExpressionAttributeValues = {
      ...updateItemInput.ExpressionAttributeValues,
      ...conditionalData.attributeValues,
    };
  }

  if (conditionalData?.conditionExpression) {
    updateItemInput.ConditionExpression = conditionalData.conditionExpression;
  }

  const result = await params.dynamoDb.update(updateItemInput);
  return result.Attributes as T;
};

export interface DeleteItemParams {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  key: Record<string, NativeAttributeValue>;
  /**
   * Array of conditions to apply to the delete.
   * Conditions are combined with AND.
   */
  conditions?: ConditionExpressionArgs[];
}

export const deleteItem = async (
  params: DeleteItemParams,
): Promise<boolean> => {
  const deleteInput: DeleteCommandInput = {
    TableName: `${params.table}`,
    Key: params.key,
    ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
  };

  const conditionalData = buildConditionExpression(params.conditions);
  if (conditionalData?.attributeNames) {
    deleteInput.ExpressionAttributeNames = conditionalData.attributeNames;
  }

  if (conditionalData?.attributeValues) {
    deleteInput.ExpressionAttributeValues = conditionalData.attributeValues;
  }

  if (conditionalData?.conditionExpression) {
    deleteInput.ConditionExpression = conditionalData.conditionExpression;
  }

  await params.dynamoDb.delete(deleteInput);
  return true;
};

export interface GetItemParams<K> {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  key: Record<string, NativeAttributeValue>;
  consistentRead?: boolean;
  /**
   * Specific attributes to be returned on the item.
   *
   * When using this provide the K type including each of these attributes.
   */
  projectionExpression?: K[];
}

/**
 * Get a single item.
 */
export function getItem<T extends Record<string, NativeAttributeValue>>(
  params: GetItemParams<keyof T>,
): Promise<T>;

/**
 * Get a single item.
 *
 * Specify K when using a projectionExpression
 */
export function getItem<
  T extends Record<string, NativeAttributeValue>,
  K extends keyof T,
>(params: GetItemParams<K>): Promise<Pick<T, K>>;

/**
 * Get a single item.
 *
 * Specify K type when using a projectionExpression
 */
export async function getItem<
  T extends Record<string, NativeAttributeValue>,
  K extends keyof T,
>(params: GetItemParams<K>): Promise<T> {
  const getItemInput: GetCommandInput = {
    TableName: params.table || '',
    Key: params.key,
  };

  if (params.consistentRead) {
    getItemInput.ConsistentRead = params.consistentRead;
  }

  const result = await params.dynamoDb.get(getItemInput);
  return result.Item as T;
}

export interface GetAllItemsParams<K> {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  /**
   * Limit the number of items returned.
   * This will continue fetching items until the limit is reached or there are no more items.
   */
  limit?: number;
  consistentRead?: boolean;
  /**
   * Array of conditions to apply to the scan.
   * Conditions are combined with AND.
   */
  filterConditions?: ConditionExpressionArgs[];
  /**
   * Specific attributes to be returned on each item.
   *
   * When using this provide the K type including each of these attributes.
   */
  projectionExpression?: K[];
  exclusiveStartKey?: Record<string, NativeAttributeValue>;
}

// Overload for when K is not provided, using keyof T as the default for K
// Allows for a return type of T[] when K is not provided.

/**
 * Scan items from a table.
 */
export function getAllItems<T extends Record<string, NativeAttributeValue>>(
  params: GetAllItemsParams<keyof T>,
): Promise<T[]>;

/**
 * Scan items from a table.
 */
export function getAllItems<
  T extends Record<string, NativeAttributeValue>,
  K extends keyof T,
>(params: GetAllItemsParams<K>): Promise<Pick<T, K>[]>;

/**
 * Scan items from a table.
 */
export async function getAllItems<
  T extends Record<string, NativeAttributeValue>,
>(params: GetAllItemsParams<keyof T>): Promise<T[]> {
  const scanInput: ScanCommandInput = {
    TableName: params.table || '',
  };

  if (params.consistentRead) {
    scanInput.ConsistentRead = params.consistentRead;
  }

  if (params.limit) {
    scanInput.Limit = params.limit;
  }

  if (params.projectionExpression) {
    scanInput.ProjectionExpression = params.projectionExpression.join(',');
  }

  if (params.exclusiveStartKey) {
    scanInput.ExclusiveStartKey = params.exclusiveStartKey;
  }

  const conditionalData = buildConditionExpression(params.filterConditions);
  if (conditionalData?.attributeNames) {
    scanInput.ExpressionAttributeNames = conditionalData.attributeNames;
  }

  if (conditionalData?.attributeValues) {
    scanInput.ExpressionAttributeValues = conditionalData.attributeValues;
  }

  if (conditionalData?.conditionExpression) {
    scanInput.FilterExpression = conditionalData.conditionExpression;
  }

  const allRecords: T[] = [];
  let lastKey: Record<string, NativeAttributeValue> | undefined = undefined;
  do {
    const result = await params.dynamoDb.scan(scanInput);
    const resultRecords = result.Items as T[];
    allRecords.push(...resultRecords);
    lastKey = result.LastEvaluatedKey;
    scanInput.ExclusiveStartKey = lastKey;
  } while (lastKey && (params.limit ? allRecords.length < params.limit : true));

  return allRecords;
}

export interface BatchGetItemsParams {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  /**
   * Keys of items to get.
   * Automatically handles chunking the keys by 100.
   */
  keys: Record<string, NativeAttributeValue>[];
}

/**
 * Batch get items from a table.
 * Automatically handles chunking the keys by 100.
 * Items are returned in an arbitrary order.
 */
export const batchGetItems = async <
  T extends Record<string, NativeAttributeValue>,
>(
  params: BatchGetItemsParams,
): Promise<T[]> => {
  if (!params.keys.length) {
    return [];
  }

  const unique = new Map<string, Record<string, NativeAttributeValue>>();

  for (const item of params.keys) {
    const key = JSON.stringify(item);
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  const uniqueIds = Array.from(unique.values());

  const totalBatches = Math.ceil(uniqueIds.length / 100);
  const keyBatches: Record<string, any>[][] = [];
  for (let index = 0; index < totalBatches; index++) {
    const start = index * 100;
    const end = start + 100 > uniqueIds.length ? uniqueIds.length : start + 100;
    const batch = uniqueIds.slice(start, end);
    keyBatches.push(batch);
  }

  const initialPromises = keyBatches.map((keyBatch) => {
    const batchGetInput: BatchGetCommandInput = {
      RequestItems: {
        [params.table]: {
          Keys: keyBatch,
        },
      },
    };
    return params.dynamoDb.batchGet(batchGetInput);
  });

  const initialResults = await Promise.all(initialPromises);
  let allRecords: T[] = [];
  for (const result of initialResults) {
    const records = result.Responses?.[params.table] as T[];
    allRecords = allRecords.concat(records);

    let unprocessedKeys = result.UnprocessedKeys?.[params.table]?.Keys;
    while (unprocessedKeys && unprocessedKeys.length) {
      const batchGetInput: BatchGetCommandInput = {
        RequestItems: {
          [params.table]: {
            Keys: unprocessedKeys,
          },
        },
      };
      const retryResult = await params.dynamoDb.batchGet(batchGetInput);
      const retryRecords = retryResult.Responses?.[params.table] as T[];
      allRecords = allRecords.concat(retryRecords);
      unprocessedKeys = retryResult.UnprocessedKeys?.[params.table]?.Keys;
    }
  }

  return allRecords;
};

export interface QueryItemsParams<K> {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  keyName: string;
  keyValue: NativeAttributeValue;
  /**
   * Which GSI or LSI to query.
   */
  indexName?: string;
  /**
   * Specify as false to query in reverse order.
   */
  scanIndexForward?: boolean;
  /**
   * Consistent reads for queries can only be done with no index specified or an LSI.
   */
  consistentRead?: boolean;
  /**
   * Limit the number of items returned.
   * This will continue fetching items until the limit is reached or there are no more items.
   */
  limit?: number;
  /**
   * Condition to be applied to the sort key.
   */
  rangeCondition?: ConditionExpressionQueryArgs;
  /**
   * Specific attributes to be returned on each item.
   *
   * When using this provide the K type including each of these attributes.
   */
  projectionExpression?: K[];
  exclusiveStartKey?: Record<string, NativeAttributeValue>;
}

/**
 * Query items from a table.
 */
export function queryItems<T extends Record<string, NativeAttributeValue>>(
  params: QueryItemsParams<keyof T>,
): Promise<T[]>;

/**
 * Query items from a table.
 */
export function queryItems<
  T extends Record<string, NativeAttributeValue>,
  K extends keyof T,
>(params: QueryItemsParams<K>): Promise<Pick<T, K>[]>;

/**
 * Query items from a table.
 */
export async function queryItems<
  T extends Record<string, NativeAttributeValue>,
>(params: QueryItemsParams<keyof T>): Promise<T[]> {
  const queryInput: QueryCommandInput = {
    TableName: params.table,
    KeyConditionExpression: `#a = :b`,
    ExpressionAttributeNames: {
      '#a': params.keyName,
    },
    ExpressionAttributeValues: {
      ':b': params.keyValue,
    },
  };

  if (params?.indexName) {
    queryInput.IndexName = params?.indexName;
  }

  if (params?.exclusiveStartKey) {
    queryInput.ExclusiveStartKey = params?.exclusiveStartKey;
  }

  if (params.consistentRead) {
    queryInput.ConsistentRead = params.consistentRead;
  }

  if (params?.scanIndexForward === false) {
    queryInput.ScanIndexForward = false;
  }

  if (params?.limit) {
    queryInput.Limit = params.limit;
  }

  if (params.projectionExpression) {
    queryInput.ProjectionExpression = params.projectionExpression.join(',');
  }

  const rangeData = buildConditionExpression(
    params.rangeCondition ? [params.rangeCondition] : undefined,
  );
  if (rangeData?.attributeNames) {
    queryInput.ExpressionAttributeNames = {
      ...queryInput.ExpressionAttributeNames,
      ...rangeData.attributeNames,
    };
  }

  if (rangeData?.attributeValues) {
    queryInput.ExpressionAttributeValues = {
      ...queryInput.ExpressionAttributeValues,
      ...rangeData.attributeValues,
    };
  }

  if (rangeData?.conditionExpression) {
    queryInput.KeyConditionExpression = `${queryInput.KeyConditionExpression} AND ${rangeData?.conditionExpression}`;
  }

  const allRecords: T[] = [];
  let lastKey: Record<string, NativeAttributeValue> | undefined = undefined;
  do {
    const result = await params.dynamoDb.query(queryInput);
    const resultRecords = result.Items as T[];
    allRecords.push(...resultRecords);
    lastKey = result.LastEvaluatedKey;
    queryInput.ExclusiveStartKey = lastKey;
  } while (lastKey && (params.limit ? allRecords.length < params.limit : true));

  return allRecords;
}

export interface QueryRangeParams<K>
  extends Omit<QueryItemsParams<K>, 'rangeCondition'> {
  rangeKeyName: string;
  rangeKeyValue: string;
  /**
   * Specify as true to use a begins_with condition on the sort key.
   * Specify as falsy to use an equals condition on the sort key.
   */
  fuzzy?: boolean;
}

/**
 * A wrapper for dynamoQuery that simplifies the usage of the sort key with an equals or begins_with condition.
 */
export function queryItemsRange<T extends Record<string, NativeAttributeValue>>(
  params: QueryRangeParams<keyof T>,
): Promise<T[]>;

/**
 * A wrapper for dynamoQuery that simplifies the usage of the sort key with an equals or begins_with condition.
 */
export function queryItemsRange<
  T extends Record<string, NativeAttributeValue>,
  K extends keyof T,
>(params: QueryRangeParams<K>): Promise<Pick<T, K>[]>;

/**
 * A wrapper for dynamoQuery that simplifies the usage of the sort key with an equals or begins_with condition.
 */
export async function queryItemsRange<
  T extends Record<string, NativeAttributeValue>,
>(params: QueryRangeParams<keyof T>): Promise<T[]> {
  const result = await queryItems<T>({
    ...params,
    rangeCondition: {
      operator: params.fuzzy ? 'BeginsWith' : 'Equal',
      field: params.rangeKeyName,
      value: params.rangeKeyValue,
    },
  });

  return result;
}

export interface QueryItemsRangeBetweenParams<K>
  extends Omit<QueryItemsParams<K>, 'rangeCondition'> {
  rangeKeyName: string;
  rangeKeyValueMin: string;
  rangeKeyValueMax: string;
}

/**
 * A wrapper for dynamoQuery that simplifies the usage of the sort key with a 'between' condition
 */
export function queryItemsRangeBetween<
  T extends Record<string, NativeAttributeValue>,
>(params: QueryItemsRangeBetweenParams<keyof T>): Promise<T[]>;

/**
 * A wrapper for dynamoQuery that simplifies the usage of the sort key with a 'between' condition
 */
export function queryItemsRangeBetween<
  T extends Record<string, NativeAttributeValue>,
  K extends keyof T,
>(params: QueryItemsRangeBetweenParams<K>): Promise<Pick<T, K>[]>;

/**
 * A wrapper for dynamoQuery that simplifies the usage of the sort key with a 'between' condition
 */
export async function queryItemsRangeBetween<
  T extends Record<string, NativeAttributeValue>,
>(params: QueryItemsRangeBetweenParams<keyof T>): Promise<T[]> {
  const result = await queryItems<T>({
    ...params,
    rangeCondition: {
      operator: 'Between',
      field: params.rangeKeyName,
      value: params.rangeKeyValueMin,
      betweenSecondValue: params.rangeKeyValueMax,
    },
  });

  return result;
}

export interface BatchPutItems<T extends Record<string, NativeAttributeValue>> {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  /**
   * Items to create.
   * Automatically handles chunking the items by 25.
   */
  items: T[];
}

/**
 * Batch create items into a table.
 * Automatically handles chunking the items by 25.
 */
export const batchPutItems = async <
  T extends Record<string, NativeAttributeValue>,
>(
  params: BatchPutItems<T>,
): Promise<T[]> => {
  const totalBatches = Math.ceil(params.items.length / 25);
  const itemBatches: Record<string, any>[][] = [];
  for (let index = 0; index < totalBatches; index++) {
    const start = index * 25;
    const end =
      start + 25 > params.items.length ? params.items.length : start + 25;
    const batch = params.items.slice(start, end);
    itemBatches.push(batch);
  }

  const initialPromises = itemBatches.map((itemsBatch) => {
    const batchWriteInput: BatchWriteCommandInput = {
      RequestItems: {
        [params.table]: itemsBatch.map((item) => ({
          PutRequest: {
            Item: item,
          },
        })),
      },
    };
    return params.dynamoDb.batchWrite(batchWriteInput);
  });

  const initialResults = await Promise.all(initialPromises);

  let previousDelay = 0;
  for (const result of initialResults) {
    let unprocessedItems = result.UnprocessedItems;
    while (Object.keys(unprocessedItems || {}).length > 0) {
      const batchWriteInput: BatchWriteCommandInput = {
        RequestItems: unprocessedItems,
      };

      // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html#Programming.Errors.BatchOperations
      const delay = decorrelatedJitterBackoff(previousDelay);
      await sleep(delay);

      const retryResult = await params.dynamoDb.batchWrite(batchWriteInput);
      unprocessedItems = retryResult.UnprocessedItems;
    }
  }

  return params.items;
};

export interface BatchDeleteItemsParams {
  dynamoDb: DynamoDbDocumentClient;
  table: string;
  /**
   * Items to delete.
   * Automatically handles chunking the items by 25.
   */
  keys: Record<string, NativeAttributeValue>[];
}

/**
 * Batch delete items from a table.
 * Automatically handles chunking the keys by 25.
 */
export const batchDeleteItems = async (
  params: BatchDeleteItemsParams,
): Promise<boolean> => {
  const totalBatches = Math.ceil(params.keys.length / 25);
  const keyBatches: Record<string, any>[][] = [];
  for (let index = 0; index < totalBatches; index++) {
    const start = index * 25;
    const end =
      start + 25 > params.keys.length ? params.keys.length : start + 25;
    const batch = params.keys.slice(start, end);
    keyBatches.push(batch);
  }

  const initialPromises = keyBatches.map((keysBatch) => {
    const batchWriteInput: BatchWriteCommandInput = {
      RequestItems: {
        [params.table]: keysBatch.map((item) => ({
          DeleteRequest: {
            Key: item,
          },
        })),
      },
    };
    return params.dynamoDb.batchWrite(batchWriteInput);
  });

  const initialResults = await Promise.all(initialPromises);

  let previousDelay = 0;
  for (const result of initialResults) {
    let unprocessedItems = result.UnprocessedItems;
    while (Object.keys(unprocessedItems || {}).length > 0) {
      const batchWriteInput: BatchWriteCommandInput = {
        RequestItems: unprocessedItems,
      };

      // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html#Programming.Errors.BatchOperations
      const delay = decorrelatedJitterBackoff(previousDelay);
      await sleep(delay);

      const retryResult = await params.dynamoDb.batchWrite(batchWriteInput);
      unprocessedItems = retryResult.UnprocessedItems;
    }
  }

  return true;
};

/**
 * Unmarshalling is used to convert a DynamoDB record into a JavaScript object.
 */
export const unmarshallItem = <T extends Record<string, NativeAttributeValue>>(
  item: Record<string, AttributeValue>,
  options?: unmarshallOptions,
): T => {
  const unmarshallItem = unmarshall(item, options);
  return unmarshallItem as T;
};

/**
 * Marshalling is used to convert a JavaScript object into a DynamoDB record.
 */
export const marshallItem = <T extends Record<string, NativeAttributeValue>>(
  item: T,
  options?: marshallOptions,
): Record<string, AttributeValue> => {
  const unmarshallItem = marshall(item, options);
  return unmarshallItem;
};
