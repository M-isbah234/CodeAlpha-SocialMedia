# Orbit — Mini Social Media App

A small full-stack social app: **Django + Django REST Framework** API (SQLite)
with a **vanilla HTML / CSS / JavaScript** frontend.

Features: register / login (token auth), public profiles with bio & avatar,
text posts (create / read / delete), comments with a live counter, like/unlike
(one per user per post), and follow/unfollow (no self-follow).

```
social_media/
├── backend/          # Django project
│   ├── config/       # settings, root urls, wsgi/asgi
│   ├── api/          # models, serializers, views, urls, admin, signals
│   ├── manage.py
│   └── requirements.txt
└── frontend/         # static client
    ├── index.html
    ├── styles.css
    └── app.js
```

## 1. Backend — set up & run (The API & Admin Panel)

From the `social_media/` folder, open a terminal:

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
# source .venv/bin/activate

pip install -r requirements.txt
python manage.py makemigrations api
python manage.py migrate
python seed_demo.py                   # optional, creates demo accounts and data
python manage.py createsuperuser      # optional, for /admin
python manage.py runserver            # API at http://127.0.0.1:8000/
```

The API lives under `http://127.0.0.1:8000/api/` and the **Django admin panel** is under
`http://127.0.0.1:8000/admin/`.

## 2. Frontend — run (The Main Social Media Panel)

The frontend is static. Serve it from its own folder (a server avoids
`file://` quirks). **Open a second terminal** from the `social_media/` folder:

```bash
cd frontend
python -m http.server 5500
```

Then open **http://127.0.0.1:5500/**. CORS is open in dev, so the page can call
the API on port 8000. (If you change the API location, edit `API_BASE` at the
top of `frontend/app.js`.)

## Demo Accounts

If you ran `python seed_demo.py` in the backend, you can log into the frontend with the following demo accounts:
- **Usernames:** `demo`, `maya_r`, `liam_k`, `zoe_p`, `noah_s`, `aria_j`
- **Password (for all):** `Orbit12345`

## API reference

| Method | Endpoint                          | Auth | Purpose                          |
|--------|-----------------------------------|------|----------------------------------|
| POST   | `/api/auth/register/`             | —    | Create account → returns token   |
| POST   | `/api/auth/login/`                | —    | Log in → returns token           |
| POST   | `/api/auth/logout/`               | ✔    | Invalidate current token         |
| GET/PATCH | `/api/auth/me/`                | ✔    | Current user's profile / update  |
| GET    | `/api/posts/`                     | —    | Feed (`?author=<id>` to filter)  |
| POST   | `/api/posts/`                     | ✔    | Create a post                    |
| GET    | `/api/posts/<id>/`                | —    | Retrieve a post                  |
| DELETE | `/api/posts/<id>/`                | ✔    | Delete (author only)             |
| GET    | `/api/posts/<id>/comments/`       | —    | List comments                    |
| POST   | `/api/posts/<id>/comments/`       | ✔    | Add a comment                    |
| POST   | `/api/posts/<id>/like/`           | ✔    | Toggle like/unlike               |
| GET    | `/api/users/<id>/`                | —    | Public profile + counts          |
| POST   | `/api/users/<id>/follow/`         | ✔    | Toggle follow/unfollow           |

Authenticated requests send the header: `Authorization: Token <your-token>`.

## Notes

- **Auth model:** DRF `TokenAuthentication`. The token is stored in the
  browser's `localStorage` and attached to every write request.
- Every new user automatically gets a `Profile` (via a `post_save` signal).
- Uniqueness is enforced at the DB level: one like per `(user, post)`, one
  follow per `(follower, following)`, plus a check constraint blocking
  self-follows.
