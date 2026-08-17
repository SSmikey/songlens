# Phase 0 — ขั้นตอนที่ต้องทำเอง (manual)

งานส่วนที่ automate ได้ (npm install, โครง folder, `.env.example`) ทำให้แล้ว ส่วนนี้คือสิ่งที่ต้องทำเองเพราะต้องใช้บัญชี/เว็บภายนอก

## 1. สร้างโปรเจกต์ Supabase

1. ไปที่ [supabase.com](https://supabase.com) → New project
2. ตั้งรหัสผ่าน database ไว้ให้ดี (จะต้องใช้ใน connection string)
3. รอโปรเจกต์ provision เสร็จ (~2 นาที)

## 2. เปิดใช้ extension `pg_trgm`

ไปที่ **SQL Editor** ในโปรเจกต์ แล้วรัน:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## 3. เอา connection string มาใส่ `.env.local`

ไปที่ **Project Settings → Database → Connection string** เลือกแบบ **Transaction pooler** (พอร์ต `6543` — เหมาะกับ serverless function ของ Vercel ที่จะ deploy ตอน Phase 7)

เปิดไฟล์ `.env.local` (มีอยู่แล้วในโปรเจกต์ สร้างจาก `.env.example`) แล้วแทนที่ค่า `DATABASE_URL` ด้วย connection string จริง

## 4. สร้าง OpenAI API key — ⚠️ ไม่จำเป็นแล้ว (optional)

> **อัปเดต Phase 3:** ระบบเปลี่ยนไปใช้ **Web Speech API ของเบราว์เซอร์** สำหรับ STT (ฟรี ไม่ต้องมี API key) แทน OpenAI Whisper แล้ว เพราะ API key ที่สร้างไว้ตอนแรกไม่มี billing ผูก (`insufficient_quota`) ข้อนี้จึง**ข้ามได้**เว้นแต่อยากเปิดใช้ `src/lib/stt/whisper.ts` เป็นทางเลือกสำรองในอนาคต

ถ้ายังอยากทำ (ไม่บังคับ):
1. ไปที่ [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Create new secret key
2. เติมเครดิต/ตั้ง billing ที่ [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing)
3. ใส่ค่าใน `.env.local` ที่ `OPENAI_API_KEY`

## 5. ยืนยันว่าเชื่อมต่อได้

รัน:

```
npm run db:check
```

ควรเห็น `Connection OK` และ `pg_trgm enabled`

## 6. ⚠️ ปัญหาที่เจอระหว่าง setup — ตรวจ `DATABASE_URL` ที่อาจตั้งไว้แล้วในเครื่อง

ระหว่างทดสอบพบว่าเครื่อง dev นี้มี **`DATABASE_URL` ตั้งไว้แล้วระดับ shell/system environment** ชี้ไปคน Supabase project อื่น (คนละ project-ref/region กับที่สร้างในข้อ 1) ซึ่งจะบัง `.env.local` แบบเงียบๆ เพราะ Node `--env-file` **ไม่ทับ** env var ที่มีอยู่แล้ว

ควรเช็คว่าตัวแปรนี้ถูกตั้งไว้ที่ไหน แล้วลบ/แก้ถ้าไม่ใช่ของโปรเจกต์นี้:

- **Windows (PowerShell):** `[Environment]::GetEnvironmentVariable("DATABASE_URL", "User")` และ `"Machine"` — ถ้าเจอ ลบด้วย System Properties → Environment Variables (GUI) หรือ `[Environment]::SetEnvironmentVariable("DATABASE_URL", $null, "User")`
- **Git Bash / shell profile:** เช็ค `~/.bashrc`, `~/.bash_profile` ว่ามีบรรทัด `export DATABASE_URL=...` หรือไม่

ถ้าไม่แก้ที่ต้นตอ ทุกครั้งที่รันสคริปต์ในโปรเจกต์นี้ (หรือโปรเจกต์อื่น) ที่ไม่ได้ตั้งใจ override จะเสี่ยงเชื่อมผิดฐานข้อมูลแบบไม่รู้ตัว — คำสั่ง `npm run db:check` ที่ตั้งไว้ยังไม่ได้กันปัญหานี้เอง ต้องแก้ที่ค่า env var ต้นทางถึงจะหายขาด

**✅ แก้แล้ว (2026-08-17):** ลบ `DATABASE_URL` ที่ระดับ User environment variable ด้วย `[Environment]::SetEnvironmentVariable("DATABASE_URL", $null, "User")` ยืนยันแล้วว่าหายไป — เทอร์มินัลใหม่ที่เปิดหลังจากนี้จะไม่มีค่านี้ค้างอีก (เทอร์มินัลที่เปิดค้างไว้ตั้งแต่ก่อนลบ ยังมี process-level cache เดิมอยู่จนกว่าจะปิด-เปิดใหม่)

---

**สถานะ: ✅ เสร็จสมบูรณ์ทั้งหมด** — connection ทดสอบผ่าน, env var ที่ค้างถูกลบแล้ว
