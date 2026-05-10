# (◕ᴗ◕✿) sena instalasi v4.1

---

## Gesture flow

| # | Gesture | Aksi | Syarat |
|---|---|---|---|
| 1 | 😐 Wajah mendekat | Buku muncul + parallax | — |
| 2 | ☝ Tahan 3 detik | Lock aktif | prox > 45% |
| 3 | ✋ 5 jari | Buku terbuka (spring) | Setelah lock |
| 4 | ✌ Tahan 3 detik | QR muncul | Buku terbuka |
| 5 | ✌ Tahan 3 detik lagi | QR tutup | QR sedang muncul |
| 6 | 📱 HP scan QR | Ketik → kirim → mirror | — |
| 7 | ☝ Tahan 3 detik | Ritual tutup | Ada tulisan di halaman |
| 8 | ✊ Kepalan | Buku menutup → reset | Setelah countdown |

---

## Running di laptop

```bash
npm install
npm start
```

URL:
- Layar: http://localhost:3000/
- HP tamu: http://localhost:3000/tamu
- Dashboard: http://localhost:3000/dashboard (admin / admin)

---

## PANDUAN GITHUB — STEP BY STEP (UNTUK PEMULA)

### Step 1 — Install Git

**Mac:** Buka Terminal, ketik `git --version`. Jika belum ada, ikuti petunjuk install yang muncul.

**Windows:** Download di https://git-scm.com/download/win — install semua default. Setelah selesai, gunakan program "Git Bash" (bukan Command Prompt).

---

### Step 2 — Buat akun GitHub

Buka https://github.com → Sign up → isi email, password, username → verifikasi email.

---

### Step 3 — Buat repository

1. Login GitHub → klik **"+"** di kanan atas → **"New repository"**
2. Repository name: `sena-instalasi`
3. Pilih **Public**
4. **JANGAN** centang "Add a README file"
5. Klik **"Create repository"**

---

### Step 4 — Set nama di Git (sekali saja)

```bash
git config --global user.name "Nama Kamu"
git config --global user.email "email@kamu.com"
```

---

### Step 5 — Upload project

Buka Terminal / Git Bash, masuk ke folder:
```bash
# Mac:
cd ~/Desktop/sena-instalasi-v4.1

# Windows Git Bash:
cd /c/Users/NAMAKAMU/Desktop/sena-instalasi-v4.1
```

Lalu jalankan satu per satu:
```bash
git init
git add .
git commit -m "sena instalasi v4.1"
git branch -M main
git remote add origin https://github.com/USERNAMEKAMU/sena-instalasi.git
git push -u origin main
```

⚠️ Ganti **USERNAMEKAMU** dengan username GitHub kamu.

Saat push, terminal minta password. Isi dengan **Personal Access Token** (bukan password GitHub biasa).

**Cara buat Personal Access Token:**
1. GitHub → foto profil (kanan atas) → Settings
2. Scroll bawah → Developer settings → Personal access tokens → Tokens (classic)
3. Generate new token (classic)
4. Note: `sena`, Expiration: 90 days, centang: `repo`
5. Klik Generate token → **copy segera** (tidak bisa dilihat lagi)
6. Paste sebagai password di terminal

Sukses jika muncul `Writing objects: 100%`.

---

### Update setelah ada perubahan file

```bash
git add .
git commit -m "update: deskripsi perubahan"
git push
```

---

## DEPLOY KE RAILWAY

### Step 1 — Buat akun Railway

Buka https://railway.app → Login with GitHub → Authorize.

### Step 2 — Deploy

1. Klik **"New Project"**
2. **"Deploy from GitHub repo"**
3. Pilih repo `sena-instalasi`
4. Tunggu 1-2 menit sampai status **"Active"**

### Step 3 — Dapat domain

1. Klik project → tab **"Settings"**
2. Bagian **"Networking"** → klik **"Generate Domain"**
3. Dapat URL: `sena-instalasi-xxx.up.railway.app` — simpan ini

### Step 4 — Set password admin

Railway → project → tab **"Variables"** → tambah:

| Key | Value |
|---|---|
| `ADMIN_USER` | `admin` |
| `ADMIN_PASS` | `passwordpilihankamu` |
| `ALLOWED_ORIGIN` | `*` |

Railway restart otomatis setelah add variable.

### Step 5 — Akses

- Layar instalasi: `https://sena-instalasi-xxx.up.railway.app/`
- HP tamu: `https://sena-instalasi-xxx.up.railway.app/tamu`
- Dashboard admin: `https://sena-instalasi-xxx.up.railway.app/dashboard`

Setiap `git push` → Railway otomatis redeploy.

---

## Dashboard Admin

**Login:** buka `/dashboard` → masukkan username + password.

**Fitur:**
- Tabel semua pesan tamu (nama, tulisan, waktu, session ID)
- Tombol Refresh
- Export JSON (`/api/messages`)
- Tombol Logout

**Ganti password** (production): Railway → Variables → edit `ADMIN_PASS` → Save.

**Ganti password** (localhost):
```bash
ADMIN_PASS=passwordbaru npm start
```

---

## Catatan

- Data pesan di Railway bisa hilang saat redeploy (ephemeral storage). Untuk event penting, export JSON dulu sebelum deploy ulang.
- Railway free tier: 500 jam/bulan — cukup untuk instalasi.
- WebSocket berjalan penuh di Railway.
