# Lunch Queue (GitHub Pages edition)

Static site (HTML/CSS/JS) + Firebase Realtime Database for the shared line.

## One-time setup

### 1. Firebase project
1. Go to https://console.firebase.google.com and click **Create a project** (turn off Analytics).
2. **Build > Realtime Database > Create Database**. Pick any location, start in **locked mode**.
3. Copy the database URL shown at the top (looks like `https://xxxx-default-rtdb.firebaseio.com`).

### 2. Admin login
1. **Build > Authentication > Get started > Email/Password > Enable > Save**.
2. **Users tab > Add user**: enter the admin email + a strong password.

### 3. Security rules
1. Realtime Database > **Rules** tab.
2. Paste the contents of `database.rules.json`.
3. Replace BOTH copies of `YOUR_ADMIN_EMAIL` with the admin email from step 2. Click **Publish**.
   (This is what stops other people from deleting or reordering the line.)

### 4. Web API key
Project settings (gear icon) > General > **Web API Key**.

### 5. Edit config.js
Paste the database URL and the Web API key.

### 6. Put it on GitHub Pages
1. Create a new GitHub repo, upload all these files to the root of the repo.
2. Repo **Settings > Pages > Deploy from a branch > main / (root) > Save**.
3. After a minute your site is at `https://USERNAME.github.io/REPO/`.
4. Open `/qr.html` on that site for the QR code.

## Pages
- `index.html`    sign up + live line (refreshes every 5s)
- `brackets.html` Bracket HQ link/embed
- `qr.html`       QR code for the sign-up page
- `admin.html`    log in to reorder, mark done, clear, set bracket link
