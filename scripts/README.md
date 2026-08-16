# scripts

One-off / operational scripts (ไม่ใช่ส่วนหนึ่งของ Next.js runtime, รันตรงด้วย `tsx`).

- `check-db.ts` — Phase 0: sanity check `DATABASE_URL` เชื่อมต่อได้ + `pg_trgm` เปิดใช้งานอยู่
  - รัน: `npm run db:check`
  - ⚠️ ถ้าเครื่องมี `DATABASE_URL` ตั้งไว้ระดับ shell/system อยู่แล้ว จะบัง `.env.local` แบบเงียบๆ (ดู [docs/SETUP.md](../docs/SETUP.md) ข้อ 6)
- `ingest-dataset.ts` — Phase 1: parse `dataset/เนื้อเพลงลูกทุ่ง_1500.csv` → clean/normalize → insert เข้า Postgres (`songs` table) → สร้าง `pg_trgm` index
  - รัน: `npx tsx --env-file=.env.local scripts/ingest-dataset.ts` (ต้องมี `DATABASE_URL` ใน `.env.local`)
  - Idempotent: รันซ้ำได้ (TRUNCATE ก่อน insert)

ดู [docs/PLAN.md](../docs/PLAN.md) Phase 1 สำหรับรายละเอียด
