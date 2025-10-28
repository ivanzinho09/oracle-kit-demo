# Prediction Market Demo Frontend

This Next.js application displays the most recent market settlements from the Firestore database.

## Prerequisites

-   Node.js and pnpm installed.
-   A Firebase project with Firestore enabled. See [firebase-setup.md](../firebase-setup.md) for setup steps.

## Getting Started

1.  **Navigate to the `frontend` directory:**

    ```bash
    cd frontend
    ```

2.  **Install Dependencies:**

    ```bash
    pnpm install
    ```

3.  **Configure Firebase Credentials:**
    Create a `.env.local` file in this directory by copying the example:

    ```bash
    cp .env.local.example .env.local
    ```

    Open `.env.local` and add your Firebase project `apiKey`, `authDomain`, and `projectId`. You can find these details in your Firebase project settings. See [firebase setup](../firebase-setup.md) for more information.

4.  **Set Firestore Security Rules:**

    For the application to read data, you must configure your Firestore security rules to allow read access to the `demo` collection. You can set this in the Firebase console under Firestore Database > Rules. See [firebase setup](../firebase-setup.md) for more information.

5.  **Run the Development Server:**

    ```bash
    pnpm dev
    ```

6.  **View the Application:**
    Open your browser and navigate to [http://localhost:3000](http://localhost:3000). The application will display the 10 most recent documents from your `demo` collection in Firestore.
