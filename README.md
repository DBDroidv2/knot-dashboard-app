# ✨ Knot Dashboard App ✨

> A sleek, modern dashboard application bringing user management and a **live PowerShell terminal** right into your browser! 🚀

---

## 🌟 Features

*   🔐 **Secure User Authentication:** Sign up and log in using JWT tokens.
*   👤 **Profile Management:** View and manage user details.
*   🖥️ **Integrated PowerShell Terminal:** Run real PowerShell commands directly from the web interface via WebSockets!
*   🎨 **Modern UI:** Built with Tailwind CSS and Shadcn/ui components.

---

## 🛠️ Tech Stack

*   **Backend (Node.js):**
    *   ⚡ Express.js - Fast, unopinionated, minimalist web framework.
    *   💾 MongoDB & Mongoose - Flexible NoSQL database interaction.
    *   🔑 jsonwebtoken - Implementing JSON Web Tokens.
    *   🔒 bcrypt - Secure password hashing.
    *   🔌 ws - Handling WebSocket connections for the terminal.
    *   🌐 cors - Enabling Cross-Origin Resource Sharing.
*   **Frontend (React/Next.js):**
    *   ⚛️ React & Next.js (App Router) - Powerful frontend framework.
    *   ✍️ TypeScript - Strong typing for robust code.
    *   💻 @xterm/xterm - The core terminal emulator.
    *   📏 @xterm/addon-fit - Terminal resizing addon.
    *   🔗 @xterm/addon-web-links - Clickable links in the terminal.
    *   💅 Tailwind CSS - Utility-first CSS framework.
    *   🧩 Shadcn/ui - Re-usable UI components.
    *   💎 Lucide React - Beautiful & consistent icons.
    *   ✅ Zod & React Hook Form - Effortless form validation.

---

## 🚀 Getting Started

### Prerequisites

*   Node.js (v18+ recommended)
*   npm (usually comes with Node.js)
*   MongoDB instance (running locally or on a service like MongoDB Atlas)

### Installation Steps

1.  **Clone the Magic:** ✨
    ```bash
    # Replace <your-repo-url> with the actual URL after pushing to GitHub
    git clone <your-repo-url>
    cd knot-dashboard-app
    ```

2.  **Power Up the Backend:** ⚙️
    *   `cd backend`
    *   `npm install`
    *   Create a `.env` file in `backend/` (add this to `.gitignore`!) with:
        ```dotenv
        MONGODB_URI=mongodb://localhost:27017/knot_dashboard # Your MongoDB connection string
        JWT_SECRET=SUPER_SECRET_CHANGE_THIS_NOW # Use a strong, unique secret!
        PORT=5000 # Optional (defaults to 5000)
        ```
    *   *(Ensure MongoDB is running!)*

3.  **Ignite the Frontend:** 🔥
    *   `cd ../frontend` (from the root `knot-dashboard-app` directory)
    *   `npm install`

---

## ▶️ Running the App

1.  **Start Backend:** In a terminal within the `backend` directory:
    ```bash
    node server.js
    ```
    *(Look for "Backend server listening..." message)*

2.  **Start Frontend:** In a *separate* terminal within the `frontend` directory:
    ```bash
    npm run dev
    ```
    *(Look for the local URL, usually `http://localhost:3000`)*

3.  **Launch!** 🚀 Open `http://localhost:3000` in your browser. Sign up/Log in and explore!
