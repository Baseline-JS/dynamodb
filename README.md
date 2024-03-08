# baseline-dynamodb

DynamoDB library for simple and optimized way to use AWS DynamoDB

# Add to Project

```
npm install baseline-dynamodb
```

```
pnpm add baseline-dynamodb
```

# Usage

```
import { getAll, getDynamodbConnection, putItem } from "baseline-dynamodb";

const dynamoDb = getDynamodbConnection();

(async () => {
  const putResult = await putItem({
    dynamoDb: dynamoDb,
    table: "test-table",
    item: {
      id: "123",
      name: "test",
    },
  });
  console.log(putResult);

  const getResult = await getAll<any>({
    dynamoDb: dynamoDb,
    table: "test-table",
  });
  console.log(getResult);
})();
```

# Environment Variables

```
IS_OFFLINE
API_REGION
```

## IS_OFFLINE

Will be `"true"` in your handlers when using serverless-offline.
When `"true"` will use values appropriate to work with DynamoDB Local.

```
region: "localhost",
endpoint: "http://localhost:8000",
```

# Use Local Version

Using the following in a local project you can test.

`pnpm link <path-to-local-npm-package>`

Might need to run `npm run build` in baseline-dynamodb root dir first.
