# Firebase Setup Guide

This guide walks you through creating a Firebase project, enabling Firestore and Authentication.

---

## 1. Create a Firebase Account

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Sign in with your Google account.  
   - If you don’t have one, you’ll be prompted to create it.

---

## 2. Create a Project & Web App

1. In the Firebase console, click **“Add project”**.
2. Follow the on-screen prompts to name your project.  
   - You can disable Google Analytics for a simpler setup.
3. Once created, you’ll be on the **Project Overview** page.
4. Click the **Web icon (</>)** to add a new web app.
5. Give it a nickname (e.g., `My REST App`) and click **“Register app”**.
6. You can skip the “Add Firebase SDK” and “Deploy” steps.  
   Just click **“Continue to console”** or close the pop-up.

---

## 3. Create Firestore Database & Enable Authentication

You’ll need to set up both the Firestore database and Anonymous Authentication.

### A. Create the Firestore Database

1. In the left-hand menu, go to **Build → Firestore Database**.
2. Click **“Create database”**.
3. Choose **“Start in production mode”** → click **Next**.
4. Select a location (e.g., `nam5 (us-central)`).  
   *Note: this cannot be changed later.*
5. Click **Enable**.

### B. Enable Anonymous Sign-In

1. Go to **Build → Authentication**.
2. Click the **“Sign-in method”** tab.
3. Find **“Anonymous”** in the list, click it, and toggle **Enable**.
4. Click **Save**.

---

## 4. Get Your Project ID and Web API Key

You’ll need these values for all API calls, and to configure your CRE `.env` values.

1. Click the **Gear icon (⚙️)** next to “Project Overview”.
2. Select **Project settings**.
3. Under the **General** tab:
   - **Project ID**: Found in the “Your project” card.  
     Example: `my-cool-project-12345` → this is your `YOUR_PROJECT_ID`.
   - **Web API Key**: Found under “Your apps” → SDK setup and configuration.  
     Example: `"apiKey": "AIz..."` → this is your `YOUR_WEB_API_KEY`.

---

## 5. Enable Firestore Security Rules

To allow read/write access only to authenticated users, set your Firestore security rules:

In the Firebase Console, go to:  
**Firestore Database → Rules**

Replace existing rules with:

```
 rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // 🟢 This rule applies ONLY to documents inside the 'demo' collection
    match /demo/{document} {
      // Allow read access to EVERYONE (public access)
      allow read: if true;

      // Keep write access restricted to only signed-in users
      allow write: if request.auth != null;
    }

    // 🔒 All other collections are still restricted by default
  }
}

```

[Learn more about Firestore security rules →](https://firebase.google.com/docs/firestore/security/get-started#auth-required)

---

## 6. Authenticate (Get an Anonymous `idToken`)

Use the following `curl` command to obtain a one-hour token.

Replace `YOUR_WEB_API_KEY` with your actual key.

```bash
curl -X POST 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=YOUR_WEB_API_KEY'   -H 'Content-Type: application/json'   -d '{
        "returnSecureToken": true
      }'
```

### Example Success Response

```json
{
  "idToken": "eyJhbGciOiJSUz...[A VERY LONG TOKEN]...CpA",
  "email": "",
  "refreshToken": "...",
  "expiresIn": "3600",
  "localId": "..."
}
```

Copy the value of `idToken` — you’ll use it in the next step.

---

## 7. Write Sample JSON to Firestore

Now, use your `idToken` to write sample data to Firestore.

Replace:
- `YOUR_PROJECT_ID` with your actual project ID
- `YOUR_ID_TOKEN` with your token from the previous step

```bash
curl -X POST   'https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default)/documents/my-collection'   -H 'Authorization: Bearer YOUR_ID_TOKEN'   -H 'Content-Type: application/json'   -d '{
        "fields": {
          "sample": { "stringValue": "123" }
        }
      }'
```

### Example Success Response

```json
{
  "name": "projects/YOUR_PROJECT_ID/databases/(default)/documents/my-collection/aK8tqY...[new_document_id]...pZ9",
  "fields": {
    "sample": { "stringValue": "123" }
  },
  "createTime": "2025-10-22T12:15:46.123456Z",
  "updateTime": "2025-10-22T12:15:46.123456Z"
}
```

You can now see the document in your Firestore console under **my-collection**.
