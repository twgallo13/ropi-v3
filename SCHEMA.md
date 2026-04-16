# SCHEMA.md — ropi-aoss Firestore Data Model

> **Status:** Draft — to be finalised with Lisa's Step 1.1 brief.  
> Collection names, field names, and indexes below are initial proposals pending confirmation.

---

## Collections overview

| Collection       | Description                                   |
|------------------|-----------------------------------------------|
| `users`          | Authenticated user profiles and roles         |
| `orders`         | Customer orders (lifecycle tracked by status) |
| `products`       | Service/product catalogue                     |
| `payments`       | Payment records linked to orders              |
| `notifications`  | Per-user in-app notifications                 |
| `sessions`       | Active user sessions                          |
| `auditLogs`      | Admin/system audit trail                      |

---

## `users/{uid}`

| Field       | Type        | Notes                                      |
|-------------|-------------|--------------------------------------------|
| `uid`       | `string`    | Firebase Auth UID (document ID)            |
| `email`     | `string`    | User email address                         |
| `role`      | `string`    | `"user"` · `"admin"` · `"superadmin"`      |
| `displayName` | `string`  | Full display name                          |
| `createdAt` | `timestamp` | Account creation time                      |
| `updatedAt` | `timestamp` | Last profile update                        |

---

## `orders/{orderId}`

| Field       | Type        | Notes                                               |
|-------------|-------------|-----------------------------------------------------|
| `orderId`   | `string`    | Auto-generated document ID                         |
| `userId`    | `string`    | Reference → `users/{uid}`                          |
| `status`    | `string`    | `"pending"` · `"confirmed"` · `"completed"` · `"cancelled"` |
| `items`     | `array`     | Array of `{ productId, qty, unitPrice }`           |
| `totalAmount` | `number`  | Order total in minor currency units (e.g. cents)   |
| `createdAt` | `timestamp` |                                                     |
| `updatedAt` | `timestamp` |                                                     |

---

## `products/{productId}`

| Field       | Type        | Notes                                   |
|-------------|-------------|-----------------------------------------|
| `productId` | `string`    | Auto-generated document ID             |
| `name`      | `string`    | Display name                           |
| `category`  | `string`    | Product category slug                  |
| `isActive`  | `boolean`   | Whether shown in catalogue             |
| `price`     | `number`    | Price in minor currency units          |
| `createdAt` | `timestamp` |                                         |

---

## `payments/{paymentId}`

| Field       | Type        | Notes                                         |
|-------------|-------------|-----------------------------------------------|
| `paymentId` | `string`    | Auto-generated document ID                   |
| `orderId`   | `string`    | Reference → `orders/{orderId}`               |
| `status`    | `string`    | `"pending"` · `"succeeded"` · `"failed"`     |
| `provider`  | `string`    | Payment gateway identifier (e.g. `"stripe"`) |
| `amount`    | `number`    | Amount charged in minor currency units        |
| `createdAt` | `timestamp` |                                               |

---

## `notifications/{notificationId}`

| Field       | Type        | Notes                                   |
|-------------|-------------|-----------------------------------------|
| `userId`    | `string`    | Target user UID                        |
| `title`     | `string`    | Notification title                     |
| `body`      | `string`    | Notification body text                 |
| `read`      | `boolean`   | Whether user has dismissed it          |
| `createdAt` | `timestamp` |                                         |

---

## `sessions/{sessionId}`

| Field       | Type        | Notes                              |
|-------------|-------------|------------------------------------|
| `userId`    | `string`    | Owning user UID                   |
| `isActive`  | `boolean`   | Session still valid               |
| `expiresAt` | `timestamp` | Hard expiry time                  |
| `createdAt` | `timestamp` |                                    |

---

## `auditLogs/{logId}`

| Field       | Type        | Notes                                         |
|-------------|-------------|-----------------------------------------------|
| `actorId`   | `string`    | UID of user or service account performing act |
| `action`    | `string`    | Action slug (e.g. `"order.cancel"`)           |
| `targetId`  | `string`    | ID of the affected document                   |
| `targetCollection` | `string` | Firestore collection name              |
| `metadata`  | `map`       | Arbitrary key/value context                   |
| `timestamp` | `timestamp` |                                               |

---

## Composite indexes

All 9 composite indexes live in [firebase/firestore.indexes.json](firebase/firestore.indexes.json).

| # | Collection      | Fields (in order)                             | Purpose                            |
|---|-----------------|-----------------------------------------------|------------------------------------|
| 1 | `orders`        | `userId ASC`, `createdAt DESC`                | User order history                 |
| 2 | `orders`        | `status ASC`, `createdAt DESC`                | Admin order queue by status        |
| 3 | `orders`        | `userId ASC`, `status ASC`, `createdAt DESC`  | User orders filtered by status     |
| 4 | `products`      | `category ASC`, `isActive ASC`, `createdAt DESC` | Active product catalogue        |
| 5 | `notifications` | `userId ASC`, `read ASC`, `createdAt DESC`    | Unread notifications per user      |
| 6 | `auditLogs`     | `actorId ASC`, `action ASC`, `timestamp DESC` | Audit trail per actor and action   |
| 7 | `payments`      | `orderId ASC`, `status ASC`, `createdAt DESC` | Payments for an order by status    |
| 8 | `users`         | `role ASC`, `createdAt DESC`                  | Users grouped by role              |
| 9 | `sessions`      | `userId ASC`, `isActive ASC`, `expiresAt ASC` | Active sessions per user           |

> ⚠️ **Placeholder indexes** — replace with Lisa's exact spec when the Step 1.1 brief is shared.
