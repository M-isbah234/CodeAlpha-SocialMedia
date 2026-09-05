# Orbit — Mini Social Media App

A complete, full-stack social media application featuring a robust **Django + Django REST Framework** API (with SQLite) and a clean, responsive **vanilla HTML/CSS/JavaScript** frontend.

## 🌟 Features

- **Authentication:** Secure user registration, login, and token-based authentication.
- **User Profiles:** Public profiles featuring user bios and avatars.
- **Social Interactions:** 
  - Follow and unfollow users (self-following disabled).
  - Like and unlike posts (limited to one like per user per post).
- **Content Management:** Create, read, and delete text posts.
- **Engagement:** Comment on posts with a live comment counter.

## 🛠️ Technology Stack

- **Backend:** Django, Django REST Framework, SQLite
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Architecture:** Client-Server model with token-based API authentication

## 📂 Project Structure

```text
social_media/
├── backend/          # Django API & Admin Panel
│   ├── config/       # Settings, Root URLs, WSGI/ASGI
│   ├── api/          # Models, Serializers, Views, URLs, Admin, Signals
│   ├── manage.py
│   └── requirements.txt
└── frontend/         # Static Client application
    ├── index.html
    ├── styles.css
    └── app.js
```

## 🚀 Getting Started

Follow these steps to set up and run the project locally.

### Prerequisites

- Python 3.8+ installed on your machine.
- Git (optional, for version control).

### 1. Backend Setup (API & Admin Panel)

The backend handles all business logic, data persistence, and serves the API.

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python -m venv .venv
   
   # On Windows:
   .venv\Scripts\activate
   # On macOS/Linux:
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Apply database migrations:**
   ```bash
   python manage.py makemigrations api
   python manage.py migrate
   ```

5. **(Optional) Seed the database with demo data:**
   ```bash
   python seed_demo.py
   ```
   *This creates sample users, posts, and interactions. Demo accounts are listed below.*

6. **(Optional) Create a superuser for the Django admin panel:**
   ```bash
   python manage.py createsuperuser
   ```

7. **Start the development server:**
   ```bash
   python manage.py runserver
   ```
   *The API will be available at `http://127.0.0.1:8000/api/` and the admin panel at `http://127.0.0.1:8000/admin/`.*

### 2. Frontend Setup (Social Media Interface)

The frontend is a static single-page application. For the best experience, serve it via a local HTTP server to avoid CORS or `file://` protocol issues.

1. **Open a new terminal window** (leave the backend running).
2. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

3. **Start a local HTTP server:**
   ```bash
   python -m http.server 5500
   ```

4. **Open the application in your browser:**
   Navigate to **http://127.0.0.1:5500/** to view and interact with the app.

*(Note: If you change the backend API port, ensure you update the `API_BASE` constant at the top of `frontend/app.js`.)*

## 👥 Demo Accounts

If you executed `python seed_demo.py` during the backend setup, you can log in using any of the following demo credentials:

- **Usernames:** `demo`, `maya_r`, `liam_k`, `zoe_p`, `noah_s`, `aria_j`
- **Password (for all accounts):** `Orbit12345`

## 📖 API Reference

| Method | Endpoint                          | Auth Required | Description                      |
|--------|-----------------------------------|---------------|----------------------------------|
| POST   | `/api/auth/register/`             | No            | Create a new account & get token |
| POST   | `/api/auth/login/`                | No            | Log in & get token               |
| POST   | `/api/auth/logout/`               | Yes           | Invalidate current token         |
| GET/PATCH | `/api/auth/me/`                | Yes           | Get/Update current user profile  |
| GET    | `/api/posts/`                     | No            | View feed (`?author=<id>`)       |
| POST   | `/api/posts/`                     | Yes           | Create a new post                |
| GET    | `/api/posts/<id>/`                | No            | Retrieve a specific post         |
| DELETE | `/api/posts/<id>/`                | Yes           | Delete a post (author only)      |
| GET    | `/api/posts/<id>/comments/`       | No            | List comments on a post          |
| POST   | `/api/posts/<id>/comments/`       | Yes           | Add a comment to a post          |
| POST   | `/api/posts/<id>/like/`           | Yes           | Toggle like/unlike on a post     |
| GET    | `/api/users/<id>/`                | No            | View public profile & stats      |
| POST   | `/api/users/<id>/follow/`         | Yes           | Toggle follow/unfollow a user    |

*Note: Authenticated requests must include the header `Authorization: Token <your-token>`.*

## 💡 Architecture Notes

- **Authentication Model:** Uses DRF `TokenAuthentication`. The token is securely stored in the browser's `localStorage` and attached to outgoing authenticated requests.
- **User Profiles:** A `Profile` instance is automatically generated for every new user via a Django `post_save` signal.
- **Data Integrity:** Database-level constraints ensure uniqueness for likes (one per `(user, post)`) and follows (one per `(follower, following)`). A check constraint actively prevents users from following themselves.
