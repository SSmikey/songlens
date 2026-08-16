# scripts

One-off / operational scripts (ไม่ใช่ส่วนหนึ่งของ Next.js runtime, รันตรงด้วย `tsx`).

- `check-db.ts` — Phase 0: sanity check `DATABASE_URL` เชื่อมต่อได้ + `pg_trgm` เปิดใช้งานอยู่
  - รัน: `npm run db:check`
  - ⚠️ ถ้าเครื่องมี `DATABASE_URL` ตั้งไว้ระดับ shell/system อยู่แล้ว จะบัง `.env.local` แบบเงียบๆ (ดู [docs/SETUP.md](../docs/SETUP.md) ข้อ 6)
- `ingest-dataset.ts` — Phase 1: parse `dataset/เนื้อเพลงลูกทุ่ง_1500.csv` → clean/normalize → insert เข้า Postgres (`songs` table) → สร้าง `pg_trgm` index
  - รัน: `npm run ingest` (ต้องมี `DATABASE_URL` ใน `.env.local`)
  - Idempotent: รันซ้ำได้ (TRUNCATE ก่อน insert)
- `eval-matcher.ts` — Phase 2: จำลอง query แบบ STT เพี้ยน (ตัดวรรณยุกต์ / สลับพยัญชนะเสียงใกล้กัน / ลบตัวอักษรสุ่ม) แล้ววัด accuracy@1 / accuracy@5 ของ `searchLyrics()` เทียบกับเพลงต้นทางจริง
  - รัน: `npx tsx --env-file=.env.local scripts/eval-matcher.ts`
  - ผลล่าสุด: accuracy@1 ~95-97%, accuracy@5 100% (จาก 60 trials)

ดู [docs/PLAN.md](../docs/PLAN.md) Phase 1 สำหรับรายละเอียด
