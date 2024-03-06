"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteItem = exports.batchGet = exports.putItem = exports.queryByKey = exports.queryByKeyAndFilterBetween = exports.queryByKeyAndFilter = exports.update = exports.buildConditionExpression = exports.getAll = exports.get = exports.getDynamodbConnection = exports.dynamoDb = void 0;
const AWS = __importStar(require("aws-sdk"));
const https = __importStar(require("https"));
const IS_OFFLINE = process.env.IS_OFFLINE; // Set by serverless-offline https://github.com/dherault/serverless-offline
exports.dynamoDb = undefined;
function newDynamodbConnection() {
    console.log("DynamoDB Init");
    const agent = new https.Agent({
        keepAlive: true,
        maxSockets: Infinity, // Infinity is read as 50 sockets
    });
    let newConnection;
    if (IS_OFFLINE === "true") {
        newConnection = new AWS.DynamoDB.DocumentClient({
            region: "localhost",
            endpoint: "http://localhost:8000",
        });
    }
    else {
        newConnection = new AWS.DynamoDB.DocumentClient({
            httpOptions: {
                agent,
            },
            paramValidation: false,
            convertResponseTypes: false,
        });
    }
    return newConnection;
}
const getDynamodbConnection = () => {
    if (typeof exports.dynamoDb === "undefined") {
        exports.dynamoDb = newDynamodbConnection();
    }
    return exports.dynamoDb;
};
exports.getDynamodbConnection = getDynamodbConnection;
const get = (getParams) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const params = {
            TableName: getParams.table || "",
            Key: getParams.key,
        };
        const result = yield getParams.dynamoDb.get(params).promise();
        if ((_a = result === null || result === void 0 ? void 0 : result.$response) === null || _a === void 0 ? void 0 : _a.error) {
            throw new Error((_b = result === null || result === void 0 ? void 0 : result.$response) === null || _b === void 0 ? void 0 : _b.error.message);
        }
        return result.Item;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error(`Failed to get record: ${message}`);
        throw new Error(message);
    }
});
exports.get = get;
const getAll = (params) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const scanInputArgs = {
            TableName: params.table || "",
        };
        const allRecords = [];
        let lastKey = undefined;
        do {
            const result = yield params.dynamoDb.scan(scanInputArgs).promise();
            const resultRecords = result.Items;
            allRecords.push(...resultRecords);
            lastKey = result.LastEvaluatedKey;
            scanInputArgs.ExclusiveStartKey = lastKey;
        } while (lastKey);
        return allRecords;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error(`Failed to get all records: ${message}`);
        throw new Error(message);
    }
});
exports.getAll = getAll;
const buildConditionExpression = (args) => {
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
exports.buildConditionExpression = buildConditionExpression;
const update = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    console.log(`Update record [${Object.keys(params.fields).join(", ")}] on table ${params.table}`);
    try {
        const updateItems = [];
        Object.keys(params.fields).forEach((element, index) => {
            if (typeof params.fields[element] !== undefined &&
                params.fields[element] !== undefined) {
                updateItems.push({
                    name: element,
                    attributeName: `#attr${index}`,
                    attributeValue: params.fields[element],
                    ref: `:attr${index}`,
                });
            }
        });
        // This may not be the best way to handle this
        if (!updateItems.length) {
            console.log("Nothing to update");
            return yield (0, exports.get)({
                dynamoDb: params.dynamoDb,
                table: params.table,
                key: params.key,
            });
        }
        const updateExpression = "set " + updateItems.map((i) => `${i.attributeName}=${i.ref}`).join(", ");
        const expressionAttributeValues = updateItems.reduce((p, c) => {
            p[`${c.ref}`] = c.attributeValue;
            return p;
        }, {});
        const expressionAttributeNames = updateItems.reduce((p, c) => {
            p[`${c.attributeName}`] = c.name;
            return p;
        }, {});
        const updateItemInput = {
            TableName: params.table || "",
            Key: params.key,
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames,
            ReturnValues: "ALL_NEW",
        };
        let count = 0;
        if ((_c = params === null || params === void 0 ? void 0 : params.updateConditions) === null || _c === void 0 ? void 0 : _c.length) {
            updateItemInput.ConditionExpression = "";
            params.updateConditions.forEach((values) => {
                var _a;
                if ((_a = updateItemInput.ConditionExpression) === null || _a === void 0 ? void 0 : _a.length) {
                    updateItemInput.ConditionExpression += " AND ";
                }
                updateItemInput.ConditionExpression += (0, exports.buildConditionExpression)({
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
        const result = yield params.dynamoDb.update(updateItemInput).promise();
        return result.Attributes;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error(`Failed to update record: ${message}`);
        throw new Error(message);
    }
});
exports.update = update;
const queryByKeyAndFilter = (params) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const queryParams = {
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
        if (params === null || params === void 0 ? void 0 : params.indexName) {
            queryParams.IndexName = params === null || params === void 0 ? void 0 : params.indexName;
        }
        const allRecords = [];
        let lastKey = undefined;
        do {
            const result = yield params.dynamoDb.query(queryParams).promise();
            const resultRecords = result.Items;
            allRecords.push(...resultRecords);
            lastKey = result.LastEvaluatedKey;
            queryParams.ExclusiveStartKey = lastKey;
        } while (lastKey);
        return allRecords;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error("Failed to complete query");
        throw new Error(message);
    }
});
exports.queryByKeyAndFilter = queryByKeyAndFilter;
const queryByKeyAndFilterBetween = (params) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const queryParams = {
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
        if (params === null || params === void 0 ? void 0 : params.indexName) {
            queryParams.IndexName = params === null || params === void 0 ? void 0 : params.indexName;
        }
        const allRecords = [];
        let lastKey = undefined;
        do {
            const result = yield params.dynamoDb.query(queryParams).promise();
            const resultRecords = result.Items;
            allRecords.push(...resultRecords);
            lastKey = result.LastEvaluatedKey;
            queryParams.ExclusiveStartKey = lastKey;
        } while (lastKey);
        return allRecords;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error("Failed to complete query");
        throw new Error(message);
    }
});
exports.queryByKeyAndFilterBetween = queryByKeyAndFilterBetween;
const queryByKey = (params) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const queryParams = {
            TableName: params.table,
            KeyConditionExpression: `#a = :b`,
            ExpressionAttributeNames: {
                "#a": params.keyName,
            },
            ExpressionAttributeValues: {
                ":b": params.keyValue,
            },
        };
        if (params === null || params === void 0 ? void 0 : params.indexName) {
            queryParams.IndexName = params === null || params === void 0 ? void 0 : params.indexName;
        }
        const allRecords = [];
        let lastKey = undefined;
        do {
            const result = yield params.dynamoDb.query(queryParams).promise();
            const resultRecords = result.Items;
            allRecords.push(...resultRecords);
            lastKey = result.LastEvaluatedKey;
            queryParams.ExclusiveStartKey = lastKey;
        } while (lastKey);
        return allRecords;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error("Failed to complete query");
        throw new Error(message);
    }
});
exports.queryByKey = queryByKey;
const putItem = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const putItemParams = {
        TableName: params.table,
        Item: params.item,
    };
    yield params.dynamoDb.put(putItemParams).promise();
    return params.item;
});
exports.putItem = putItem;
// todo multiple table support
const batchGet = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (!params.ids.length) {
        return [];
    }
    const uniqueIds = params.ids.filter((item, pos) => {
        return params.ids.indexOf(item) === pos;
    });
    const totalBatches = Math.ceil(uniqueIds.length / 100);
    const idBatches = [];
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
        const batchGetParams = {
            RequestItems: {
                [params.table]: {
                    Keys: keys,
                },
            },
        };
        // todo handle multiple pages incase of larger records
        return params.dynamoDb.batchGet(batchGetParams).promise();
    });
    const results = yield Promise.all(promises);
    const records = results.flatMap((result) => { var _a; return (_a = result.Responses) === null || _a === void 0 ? void 0 : _a[params.table]; });
    return records;
});
exports.batchGet = batchGet;
const deleteItem = (params) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Delete ${params.table} : ${params.keyName} : [${params.keyValue}]`);
    try {
        const deleteParams = {
            TableName: `${params.table}`,
            Key: {},
        };
        deleteParams.Key[`${params.keyName}`] = `${params.keyValue}`;
        yield params.dynamoDb.delete(deleteParams).promise();
        return true;
    }
    catch (error) {
        const message = getErrorMessage(error);
        console.error(`Failed to delete: ${message}`);
        throw new Error(message);
    }
});
exports.deleteItem = deleteItem;
function getErrorMessage(error) {
    let message;
    if (error instanceof Error) {
        message = error.message;
    }
    else {
        message = String(error);
    }
    return message;
}
