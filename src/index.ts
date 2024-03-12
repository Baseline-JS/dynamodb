import {
  DynamoDBDocument,
  GetCommandInput,
  QueryCommandInput,
  ScanCommandInput,
  UpdateCommandInput,
  BatchGetCommandInput,
  DeleteCommandInput,
  PutCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { NativeAttributeValue } from "@aws-sdk/util-dynamodb";

const IS_OFFLINE = process.env.IS_OFFLINE; // Set by serverless-offline https://github.com/dherault/serverless-offline

export let dynamoDb: DynamoDBDocument | undefined = undefined;

type Key = Record<string, NativeAttributeValue>;

function newDynamodbConnection(): DynamoDBDocument {
  console.log("DynamoDB Init");

  let newConnection: DynamoDBDocument;
  if (IS_OFFLINE === "true") {
    newConnection = DynamoDBDocument.from(
      new DynamoDB({
        region: "localhost",
        endpoint: "http://localhost:8000",
      })
    );
  } else {
    newConnection = DynamoDBDocument.from(
      new DynamoDB({
        region: process.env.API_REGION,
      })
    );
  }
  return newConnection;
}

export const getDynamodbConnection = (): DynamoDBDocument => {
  if (typeof dynamoDb === "undefined") {
    dynamoDb = newDynamodbConnection();
  }
  return dynamoDb;
};

interface GetParams {
  dynamoDb: DynamoDBDocument;
  table: string;
  key: Key;
}

export const get = async <T>(getParams: GetParams): Promise<T> => {
  try {
    const params: GetCommandInput = {
      TableName: getParams.table || "",
      Key: getParams.key,
    };
    const result = await getParams.dynamoDb.get(params);
    return result.Item as T;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`Failed to get record: ${message}`);
    throw new Error(message);
  }
};

interface GetAllParams {
  dynamoDb: DynamoDBDocument;
  table: string;
}

export const getAll = async <T>(params: GetAllParams): Promise<T[]> => {
  try {
    const scanInputArgs: ScanCommandInput = {
      TableName: params.table || "",
    };
    const allRecords: T[] = [];
    let lastKey: Key | undefined = undefined;
    do {
      const result = await params.dynamoDb.scan(scanInputArgs);
      const resultRecords = result.Items as T[];
      allRecords.push(...resultRecords);
      lastKey = result.LastEvaluatedKey;
      scanInputArgs.ExclusiveStartKey = lastKey;
    } while (lastKey);

    return allRecords;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`Failed to get all records: ${message}`);
    throw new Error(message);
  }
};

export const buildConditionExpression = (
  args: ConditionExpressionArgs
): string => {
  const { operator, value, betweenSecondValue, field } = args;
  let conditionExpression = "";
  switch (operator) {
    case "BeginsWith":
      conditionExpression = `begins_with(${field}, ${value})`;
      break;
    case "Equal":
      conditionExpression = `${field} = ${value}`;
      break;
    case "NotEqual":
      conditionExpression = `${field} <> ${value}`;
      break;
    case "GreaterThan":
      conditionExpression = `${field} > ${value}`;
      break;
    case "GreaterThanEqual":
      conditionExpression = `${field} >= ${value}`;
      break;
    case "LessThan":
      conditionExpression = `${field} < ${value}`;
      break;
    case "LessThanEqual":
      conditionExpression = `${field} <= ${value}`;
      break;
    case "Between":
      conditionExpression = `${field} BETWEEN ${value} AND ${betweenSecondValue}`;
      break;
    case "AttributeNotExists":
      conditionExpression = `attribute_not_exists(${field})`;
      break;
    default:
      throw new Error("Unknown Query Condition type");
  }
  return conditionExpression;
};

export type OperatorType =
  | "BeginsWith"
  | "LessThan"
  | "GreaterThan"
  | "LessThanEqual"
  | "GreaterThanEqual"
  | "Equal"
  | "NotEqual"
  | "Between"
  | "AttributeNotExists";

export interface ConditionExpressionArgs {
  operator: OperatorType;
  field: string;
  value?: NativeAttributeValue;
  /** Used for Between comparison */
  betweenSecondValue?: NativeAttributeValue;
}

interface UpdateParams<T> {
  dynamoDb: DynamoDBDocument;
  table: string;
  key: Key;
  fields: Partial<Record<keyof T, NativeAttributeValue>>;
  updateConditions?: ConditionExpressionArgs[];
}

export interface UpdateItem {
  name: string;
  attributeName: string;
  attributeValue: NativeAttributeValue;
  ref: string;
}

export const update = async <T>(params: UpdateParams<T>): Promise<T> => {
  console.log(
    `Update record [${Object.keys(params.fields).join(", ")}] on table ${params.table
    }`
  );
  try {
    const updateItems: UpdateItem[] = [];
    let index = 0;
    for (const element in params.fields) {
      const attributeValue = params.fields[element];
      if (
        typeof params.fields[element] !== undefined &&
        params.fields[element] !== undefined
      ) {
        updateItems.push({
          name: element,
          attributeName: `#attr${index}`,
          attributeValue,
          ref: `:attr${index}`,
        });
      }

      index = index + 1;
    }

    // This may not be the best way to handle this
    if (!updateItems.length) {
      console.log("Nothing to update");
      return await get<T>({
        dynamoDb: params.dynamoDb,
        table: params.table,
        key: params.key,
      });
    }

    const updateExpression =
      "set " + updateItems.map((i) => `${i.attributeName}=${i.ref}`).join(", ");

    const expressionAttributeValues = updateItems.reduce((p, c: UpdateItem) => {
      p[`${c.ref}`] = c.attributeValue;
      return p;
    }, {} as Record<string, NativeAttributeValue>);

    const expressionAttributeNames = updateItems.reduce((p, c: UpdateItem) => {
      p[`${c.attributeName}`] = c.name;
      return p;
    }, {} as Record<string, string>);

    const updateItemInput: UpdateCommandInput = {
      TableName: params.table || "",
      Key: params.key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: "ALL_NEW",
    };

    let count = 0;
    if (params?.updateConditions?.length) {
      updateItemInput.ConditionExpression = "";
      params.updateConditions.forEach((values: ConditionExpressionArgs) => {
        if (updateItemInput.ConditionExpression?.length) {
          updateItemInput.ConditionExpression += " AND ";
        }
        updateItemInput.ConditionExpression += buildConditionExpression({
          field: `#field${count}`,
          value: `:val${count}`,
          operator: values.operator,
          betweenSecondValue: `#val${count + 1}`,
        });
        expressionAttributeNames[`#field${count}`] = values.field;

        if (values.field) {
          expressionAttributeValues[`:val${count}`] = values.value;
        }

        if (values.betweenSecondValue) {
          expressionAttributeValues[`:val${count + 1}`] =
            values.betweenSecondValue;
        }
        count += 2;
      });
    }

    const result = await params.dynamoDb.update(updateItemInput);
    return result.Attributes as T;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`Failed to update record: ${message}`);
    throw new Error(message);
  }
};

interface QueryByKeyAndFilterParams {
  dynamoDb: DynamoDBDocument;
  table: string;
  keyName: string;
  keyValue: NativeAttributeValue;
  indexName?: string;
  filterKeyName: string;
  filterKeyValue: NativeAttributeValue;
}

export const queryByKeyAndFilter = async <T>(
  params: QueryByKeyAndFilterParams
): Promise<T[]> => {
  try {
    const queryParams: QueryCommandInput = {
      TableName: params.table,
      KeyConditionExpression: `#a = :b`,
      FilterExpression: `#c = :d`,
      ExpressionAttributeNames: {
        "#a": params.keyName,
        "#c": params.filterKeyName,
      },
      ExpressionAttributeValues: {
        ":b": params.keyValue,
        ":d": params.filterKeyValue,
      },
    };
    if (params?.indexName) {
      queryParams.IndexName = params?.indexName;
    }

    const allRecords: T[] = [];
    let lastKey: Key | undefined = undefined;
    do {
      const result = await params.dynamoDb.query(queryParams);
      const resultRecords = result.Items as T[];
      allRecords.push(...resultRecords);
      lastKey = result.LastEvaluatedKey;
      queryParams.ExclusiveStartKey = lastKey;
    } while (lastKey);

    return allRecords;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("Failed to complete query");
    throw new Error(message);
  }
};

interface QueryByKeyAndFilterBetweenParams {
  dynamoDb: DynamoDBDocument;
  table: string;
  keyName: string;
  keyValue: NativeAttributeValue;
  indexName?: string;
  filterKeyName: string;
  filterKeyValueMin: NativeAttributeValue;
  filterKeyValueMax: NativeAttributeValue;
}

export const queryByKeyAndFilterBetween = async <T>(
  params: QueryByKeyAndFilterBetweenParams
): Promise<T[]> => {
  try {
    const queryParams: QueryCommandInput = {
      TableName: params.table,
      KeyConditionExpression: `#a = :b And #c BETWEEN :d AND :e`,
      ExpressionAttributeNames: {
        "#a": params.keyName,
        "#c": params.filterKeyName,
      },
      ExpressionAttributeValues: {
        ":b": params.keyValue,
        ":d": params.filterKeyValueMin,
        ":e": params.filterKeyValueMax,
      },
    };

    if (params?.indexName) {
      queryParams.IndexName = params?.indexName;
    }

    const allRecords: T[] = [];
    let lastKey: Key | undefined = undefined;
    do {
      const result = await params.dynamoDb.query(queryParams);
      const resultRecords = result.Items as T[];
      allRecords.push(...resultRecords);
      lastKey = result.LastEvaluatedKey;
      queryParams.ExclusiveStartKey = lastKey;
    } while (lastKey);

    return allRecords;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("Failed to complete query");
    throw new Error(message);
  }
};

interface QueryByKeyParams {
  dynamoDb: DynamoDBDocument;
  table: string;
  keyName: string;
  keyValue: NativeAttributeValue;
  indexName?: string;
}

export const queryByKey = async <T>(params: QueryByKeyParams): Promise<T[]> => {
  try {
    const queryParams: QueryCommandInput = {
      TableName: params.table,
      KeyConditionExpression: `#a = :b`,
      ExpressionAttributeNames: {
        "#a": params.keyName,
      },
      ExpressionAttributeValues: {
        ":b": params.keyValue,
      },
    };
    if (params?.indexName) {
      queryParams.IndexName = params?.indexName;
    }

    const allRecords: T[] = [];
    let lastKey: Key | undefined = undefined;
    do {
      const result = await params.dynamoDb.query(queryParams);
      const resultRecords = result.Items as T[];
      allRecords.push(...resultRecords);
      lastKey = result.LastEvaluatedKey;
      queryParams.ExclusiveStartKey = lastKey;
    } while (lastKey);

    return allRecords;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("Failed to complete query");
    throw new Error(message);
  }
};

interface PutItemParams<T extends Record<string, NativeAttributeValue>> {
  dynamoDb: DynamoDBDocument;
  table: string;
  item: T;
}

export const putItem = async <T extends Record<string, NativeAttributeValue>>(
  params: PutItemParams<T>
): Promise<T> => {
  const putItemParams: PutCommandInput = {
    TableName: params.table,
    Item: params.item,
  };
  await params.dynamoDb.put(putItemParams);
  return params.item;
};

interface BatchGetParams {
  dynamoDb: DynamoDBDocument;
  table: string;
  keyName: string;
  ids: string[];
}

// todo multiple table support
export const batchGet = async <T>(params: BatchGetParams): Promise<T[]> => {
  if (!params.ids.length) {
    return [];
  }

  const uniqueIds = params.ids.filter((item, pos) => {
    return params.ids.indexOf(item) === pos;
  });

  const totalBatches = Math.ceil(uniqueIds.length / 100);
  const idBatches: Array<string[]> = [];
  for (let index = 0; index < totalBatches; index++) {
    const start = index * 100;
    const end = start + 100 > uniqueIds.length ? uniqueIds.length : start + 100;
    const batch = uniqueIds.slice(start, end);
    idBatches.push(batch);
  }

  const promises = idBatches.map((batch) => {
    const keys = batch.map((id) => {
      return { [params.keyName]: id };
    });
    const batchGetParams: BatchGetCommandInput = {
      RequestItems: {
        [params.table]: {
          Keys: keys,
        },
      },
    };

    // todo handle multiple pages incase of larger records
    return params.dynamoDb.batchGet(batchGetParams);
  });

  const results = await Promise.all(promises);
  const records = results.flatMap(
    (result) => result.Responses?.[params.table] as T[]
  );

  return records;
};

interface DeleteItemParams {
  dynamoDb: DynamoDBDocument;
  table: string;
  keyName?: string;
  keyValue?: string;
  key?: Key;
}

export const deleteItem = async (params: DeleteItemParams) => {
  params.key
    ? console.log(`Delete ${params.table} : ${JSON.stringify(params.key)}`)
    : console.log(
      `Delete ${params.table} : ${params.keyName} : [${params.keyValue}]`
    );

  try {
    const deleteParams: DeleteCommandInput = {
      TableName: `${params.table}`,
      Key: params.key
        ? params.key
        : {
          [`${params.keyName}`]: params.keyValue,
        },
    };

    await params.dynamoDb.delete(deleteParams);
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`Failed to delete: ${message}`);
    throw new Error(message);
  }
};

function getErrorMessage(error: unknown) {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return message;
}
