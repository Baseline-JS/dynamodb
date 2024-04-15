# Baseline DynamoDB <!-- omit in toc -->

Baseline DynamoDB is an optimized utility library that simplifies standard DynamoDB operations. It's focused towards multi table designed applications, and aims to provide a set of functions that are tailored to the specific use cases of these applications.

## Features <!-- omit in toc -->

- Simplified Item Operations: CRUD with less boilerplate code.
- Advanced Querying: Easily use sort key conditions, including begins_with and between, to filter queries.
- Batch Operations: Automatically handles chunking for batch get, batch create, and batch delete operations.
- Lightweight:

## Table of Contents <!-- omit in toc -->

- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Establishing a Connection](#establishing-a-connection)
  - [Creating an item](#creating-an-item)
  - [Getting a single item](#getting-a-single-item)
  - [Updating an item](#updating-an-item)
  - [Deleting an item](#deleting-an-item)
  - [Retrieving all items](#retrieving-all-items)
  - [Querying items](#querying-items)
- [Extended Usages](#extended-usages)
  - [Batch Get](#batch-get)
  - [Batch Create](#batch-create)
  - [Batch Delete](#batch-delete)
  - [Query Range](#query-range)
  - [Query Range Between](#query-range-between)
  - [Create, Update, Delete Conditions](#create-update-delete-conditions)
  - [Limit](#limit)
  - [Projection Expressions](#projection-expressions)
- [Utility Functions](#utility-functions)
  - [Unmarshalling](#unmarshalling)
  - [Marshalling](#marshalling)
- [Error Handling](#error-handling)
- [Environment Variables](#environment-variables)
  - [Serverless Offline](#serverless-offline)
- [Use Local Version](#use-local-version)

## Installation

```sh
npm install baseline-dynamodb
```

```sh
yarn add baseline-dynamodb
```

```sh
pnpm install baseline-dynamodb
```

## Quick Start

### Establishing a Connection

First create a connection to your DynamoDB table.

Must specify a region.

Natively handles both local and deployed environments. See [Environment Variables](#environment-variables) for more information.

```ts
const dynamo = newDynamoDBConnection({
  region: 'us-east-1',
});
```

### Creating an item

Add a new item to your table, providing the previously created connection.

```ts
const user = await putItem<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  item: { userId: '123', email: 'example@example.com', name: 'Alice' },
});
```

### Getting a single item

Get a single item from your table.

```ts
const user = await getItem<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  key: {
    userId: '123',
  },
});
```

### Updating an item

Update an item in your table.

Key properties will be automatically removed from fields to prevent attribute errors.

```ts
const updatedUser = await dynamoUpdate<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  key: {
    userId: '123',
  },
  fields: {
    name: 'Bob',
  },
});
```

### Deleting an item

Delete an item from your table.

```ts
const deletedUser = await deleteItem({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  key: {
    userId: '123',
  },
});
```

### Retrieving all items

Fetch all items from a table.

```ts
const allUsers = await getAllItems<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
});
```

### Querying items

Query items from an index.

```ts
const users = await queryItems<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  keyName: 'email',
  keyValue: 'example@example.com',
  indexName: 'email-index',
});
```

## Extended Usages

### Batch Get

Batch get items from a table
Automatically handles splitting the keys into chunks of 100.

Returned item order is not necessarily the same as the input order.

```ts
const users = await batchGetItems<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  keys: [{ userId: '123' }, { userId: '456' }],
});
```

### Batch Create

Batch create items into a table.
Automatically handles splitting the items into chunks of 25.

```ts
const users = await batchPutItems<User>({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  items: [
    { userId: '123', name: 'Alice' },
    { userId: '456', name: 'Bob' },
  ],
});
```

### Batch Delete

Batch delete items from a table.
Automatically handles splitting the keys into chunks of 25.

```ts
const isDeleted = await batchDeleteItems({
  dynamoDb: dynamo,
  table: 'user-table-staging',
  keys: [{ userId: '123' }, { userId: '456' }],
});
```

### Query Range

Query items from a table with a range key.

```ts
const userPurchases = await queryItemsRange<Purchase>({
  dynamoDb: dynamo,
  table: 'purchase-table-staging',
  keyName: 'userId',
  keyValue: '123',
  rangeKeyName: 'createdAt',
  rangeKeyValue: '2022',
  // Fuzzy search will use a begins_with condition
  fuzzy: true,
  indexName: 'userId-createdAt-index',
});
```

Equivalent query using `queryItems`

```ts
const userPurchases = await queryItems<Purchase>({
  dynamoDb: dynamo,
  table: 'purchase-table-staging',
  keyName: 'userId',
  keyValue: '123',
  indexName: 'userId-createdAt-index',
  rangeCondition: {
    operator: 'BeginsWith',
    field: 'createdAt',
    value: '2022',
  },
});
```

### Query Range Between

Query items from a table with a range key between two values.

```ts
const userPurchases = await queryItemsRangeBetween<Purchase>({
  dynamoDb: dynamo,
  table: 'purchase-table-staging',
  keyName: 'userId',
  keyValue: '123',
  rangeKeyName: 'createdAt',
  rangeKeyValueMin: '2022-01-01T00:00:00.000Z',
  rangeKeyValueMax: '2023-01-01T00:00:00.000Z',
  indexName: 'userId-createdAt-index',
});
```

Equivalent query using `queryItems`

```ts
const userPurchases = await queryItems<Purchase>({
  dynamoDb: dynamo,
  table: 'purchase-table-staging',
  keyName: 'userId',
  keyValue: '123',
  indexName: 'userId-createdAt-index',
  rangeCondition: {
    operator: 'Between',
    field: 'createdAt',
    value: '2022-01-01T00:00:00.000Z',
    betweenSecondValue: '2023-01-01T00:00:00.000Z',
  },
});
```

### Create, Update, Delete Conditions

A `conditions` array can be provided to the `putItem`, `updateItem`, and `deleteItem` functions to specify conditions that must be met for the operation to succeed.

Conditions are combined with AND.

```ts
try {
  const user = await putItem<User>({
    dynamoDb: dynamo,
    table: 'user-table-staging',
    item: { userId: '123', email: 'example2@example.com', name: 'Alice' },
    conditions: [
      {
        // Only create if this userId does not already exist
        operator: 'AttributeNotExists',
        field: 'userId',
      },
    ],
  });
} catch (error) {
  if (error.name === 'ConditionalCheckFailedException') {
    // error.Item contains the item that already exists with the specified userId
  }
}
```

### Limit

You can limit the number of items returned by specifying the `limit` parameter.
This applies to the `query` functions as well as the `getAllItems` function.

The function will handle pagination internally up until the limit is reached.

```ts
const userPurchases = await queryItems<Purchase>({
  dynamoDb: dynamo,
  table: 'purchase-table-staging',
  keyName: 'userId',
  keyValue: '123',
  limit: 10,
});
```

### Projection Expressions

Projection expressions are used to limit the attributes returned from a query to only the specified fields.

To maintain type safety, you can specify the fields you want to return using the second generic type parameter.

```ts
const userPurchases = await queryItems<Purchase, 'userId' | 'createdAt'>({
  dynamoDb: dynamo,
  table: 'purchase-table-staging',
  keyName: 'userId',
  keyValue: '123',
  projectionExpression: ['userId', 'createdAt'],
});
```

## Utility Functions

### Unmarshalling

Unmarshalling is used to convert a DynamoDB record into a JavaScript object.

This is useful when using dynamodb streams, as the new and old images are returned as DynamoDB records that need to be unmarshalled.

```ts
import { unmarshallItem } from 'baseline-dynamodb';

const user = unmarshallItem<User>(record.dynamodb?.NewImage);
```

### Marshalling

Marshalling is used to convert a JavaScript object into a DynamoDB record.

```ts
import { marshallItem } from 'baseline-dynamodb';

const user = {
  userId: '123',
  email: 'example@example.com',
  name: 'Alice',
};
const marshalledUser = marshallItem(user);
```

## Error Handling

Errors are not caught internally but are instead propagated up to the calling code.

To handle these errors effectively, wrap function calls in try-catch blocks in your application. This allows for custom error handling strategies, such as logging errors or retrying failed operations.

## Environment Variables

### Serverless Offline

`IS_OFFLINE`

Will be `"true"` in your handlers when using serverless-offline.
When `"true"` will use values appropriate to work with DynamoDB Local.

```
region: "localhost",
endpoint: "http://localhost:8000",
```

`FORCE_ONLINE`

Set to `"true"` to override the `IS_OFFLINE` environment variable and use a deployed DynamoDB instance.

## Use Local Version

Using the following in a local project you can test.

`pnpm link <path-to-local-npm-package>`

Might need to run `npm run build` in baseline-dynamodb root dir first.
