# SongLens — แผนพัฒนาระบบค้นหาเพลงจากเสียง

> **สโคป:** ผู้ใช้พูด/ร้องเนื้อเพลงท่อนที่จำได้ → Speech-to-Text (ไทย) → ค้นหาแบบ fuzzy ในฐานเนื้อเพลง 1,500 เพลงลูกทุ่ง → คืนรายชื่อเพลงที่น่าจะใช่
> **อ้างอิงสถาปัตยกรรม:** ดูสรุปการออกแบบในบทสนทนา (Next.js App Router + Postgres/pg_trgm + Whisper API)
> อัปเดตล่าสุด: 2026-08-16

---

## ภาพรวม Phase

| Phase | ชื่อ | เป้าหมายหลัก |
|---|---|---|
| 0 | Infra & Project Setup | ตั้งฐานข้อมูล + ENV + โครงโปรเจกต์ |
| 1 | Data Pipeline | เอา CSV เข้า Postgres พร้อม index สำหรับ fuzzy search |
| 2 | Core Matching Engine | อัลกอริทึม normalize + scoring ที่ทนต่อ STT เพี้ยน |
| 3 | STT Integration | แปลงเสียงเป็นข้อความไทย |
| 4 | API Layer | ต่อ STT + Matching เป็น endpoint เดียว |
| 5 | Frontend UI | หน้าอัดเสียง + แสดงผลลัพธ์ |
| 6 | Integration Testing & Tuning | ทดสอบ end-to-end ด้วยเสียงจริง ปรับ threshold |
| 7 | Deployment | ขึ้น production บน Vercel + managed Postgres |
| 8 | Polish & Hardening | UX เก็บงาน, error handling, rate limit, ลิขสิทธิ์ |

ลำดับ Phase 0-4 ทำแบบต่อเนื่อง (dependency ตรงๆ), Phase 5 ทำขนานกับ 3-4 ได้ (mock API ไปก่อน)

---

## Phase 0 — Infra & Project Setup

**เป้าหมาย:** มีโครงโปรเจกต์ + ฐานข้อมูลว่างพร้อมใช้งาน ก่อนแตะ logic ใดๆ

**งาน:**
- [x] เพิ่ม dependency ที่จำเป็น: `pg`, `@types/pg`, `openai`, `zod`, `csv-parse`, `tsx` (รัน ingest script)
- [x] สร้างโครง folder ตามที่ออกแบบไว้ (`src/lib/stt`, `src/lib/search`, `scripts`, `src/components` — placeholder README อธิบาย phase ที่จะ implement)
- [x] สร้าง `.env.example` (committed) + `.env.local` (gitignored อยู่แล้วผ่าน `.env*`)
- [x] สร้างบัญชี/โปรเจกต์ Postgres แบบ managed — **Supabase** สร้างแล้ว (ดูขั้นตอนใน [docs/SETUP.md](SETUP.md))
- [x] เปิดใช้ extension `pg_trgm` บน database — ยืนยันแล้วด้วย `scripts/check-db.ts` (`extversion: '1.6'`)
- [x] ใส่ค่าจริงใน `.env.local` (`DATABASE_URL`, `OPENAI_API_KEY`) — ใส่แล้ว, แก้ปัญหา password มีอักขระพิเศษ (`@ ? &`) ที่ทำให้ URL parse ผิด ด้วยการ percent-encode ให้อัตโนมัติ
- [ ] อ่าน `node_modules/next/dist/docs/` ส่วน Route Handlers ก่อนเขียนโค้ดจริงใน Phase 4 (ตามข้อบังคับใน `AGENTS.md`) — เลื่อนไปทำตอนเริ่ม Phase 4

**Deliverable:** `npm run dev` รันได้ปกติ, เชื่อมต่อ DB ได้จาก local (ทดสอบด้วย query ง่ายๆ เช่น `SELECT 1`)

**Acceptance criteria:** มี connection string ใช้งานได้จริง, extension `pg_trgm` โชว์ใน `SELECT * FROM pg_extension`

> **สถานะ: ✅ Phase 0 เสร็จสมบูรณ์** (2026-08-17) — ทดสอบ connection ผ่าน `npx tsx --env-file=.env.local scripts/check-db.ts` ได้ `Connection OK` และ `pg_trgm enabled`
>
> ⚠️ **หมายเหตุค้างไว้:** เครื่อง dev มี `DATABASE_URL` ตั้งไว้ระดับ shell/system environment ชี้ไปคนละ Supabase project กับที่ตั้งใน `.env.local` — ต้องข้าม (`env -u DATABASE_URL`) ตอนรันสคริปต์ทดสอบ ถ้าไม่ลบ/แก้ตัวแปรนี้ที่ต้นตอ อาจกวนการรันคำสั่งอื่นๆ ในอนาคตแบบเงียบๆ ได้

---

## Phase 1 — Data Pipeline (CSV → Postgres)

**เป้าหมาย:** เนื้อเพลงทั้ง 1,500 เพลงอยู่ใน DB พร้อม index สำหรับค้นหา

**งาน:**
- [x] เขียน schema ตาราง `songs` ([scripts/schema.sql](../scripts/schema.sql)) — `id serial PK` (ไม่ใช้ `uid` จาก CSV เพราะพบว่าเป็น `0` ทุกแถว), `title`/`artist`/`year`/`emotion`, `lyrics_lead`/`lyrics_hook`/`lyrics_chorus` แยก, `full_lyrics` รวม, `lyrics_skeleton` (ตัดวรรณยุกต์/สระประสม)
- [x] เขียน `src/lib/search/normalize.ts` — `cleanText()` (ยุบ `\r\n`/whitespace), `buildFullLyrics()`, `toSkeleton()` (ตัด Thai combining marks ช่วง U+0E31, U+0E34-3A, U+0E47-4E) — ใช้ร่วมกันทั้ง ingest และ query ตอน Phase 2
- [x] เขียน [scripts/ingest-dataset.ts](../scripts/ingest-dataset.ts) — parse CSV, clean, insert แบบ batch (200 แถว/ครั้ง), รัน schema.sql อัตโนมัติก่อน insert
- [x] GIN index บน `full_lyrics`, `lyrics_skeleton`, `title` ด้วย `pg_trgm` (อยู่ใน schema.sql)
- [x] รัน ingest จริงแล้ว: **1,500/1,500 แถว** ตรงกับ dataset

**Deliverable:** ตาราง `songs` เต็มพร้อม index, สคริปต์ ingest รันซ้ำได้ (idempotent — `TRUNCATE` ก่อน insert ทุกครั้ง)

**Acceptance criteria:** ✅ query ด้วย `similarity(full_lyrics, ...)` คืนผลได้โดยไม่ error, จำนวนแถว = 1,500

> **สถานะ: ✅ เสร็จสมบูรณ์** (2026-08-17)
>
> 🔍 **ข้อค้นพบสำคัญที่กระทบ Phase 2:** ทดสอบ query คำเพี้ยนจำลอง (จำลอง STT error) พบว่า `similarity()` แบบเทียบ `full_lyrics` ทั้งก้อน (เฉลี่ย 662 ตัวอักษร) กับ query สั้น (~19 ตัวอักษร) ให้อันดับผลลัพธ์ไม่แม่น เพลงที่ถูกต้องหล่นไปอันดับ 2 คะแนนสูสีกับเพลงไม่เกี่ยวข้อง — สาเหตุคือ `similarity()` เทียบสัดส่วน trigram intersection/union ทั้งก้อน ซึ่งไม่เหมาะกับ "query สั้นเทียบ document ยาว" ต้องใช้ `word_similarity()` / operator `<%` ของ `pg_trgm` แทนใน Phase 2 (ออกแบบมาสำหรับเทียบกับ substring ที่ดีที่สุดในเอกสาร ไม่ใช่ทั้งก้อน)

---

## Phase 2 — Core Matching Engine

**เป้าหมาย:** อัลกอริทึมค้นหา/จัดอันดับที่ทนต่อข้อความจาก STT ที่ไม่ตรงเป๊ะ — ส่วนนี้คือหัวใจของระบบ ทำและทดสอบแยกจาก STT/UI ได้ก่อน

**งาน:**
- [ ] เขียน `lib/search/normalize.ts`:
  - ฟังก์ชัน normalize ข้อความไทย (ลบช่องว่าง/เครื่องหมายวรรคตอนเกิน, normalize สระซ้อน)
  - ฟังก์ชันสร้าง "โครงพยัญชนะ" (ตัดวรรณยุกต์ + สระ) ให้ใช้ตรรกะเดียวกับตอน ingest
- [ ] เขียน `lib/search/matcher.ts`:
  - Query Postgres ด้วย `pg_trgm` similarity บนทั้ง `full_lyrics` และ `lyrics_skeleton`
  - รวมคะแนน (weighted score) เช่น `0.6 * trigram_similarity(full) + 0.4 * trigram_similarity(skeleton)`
  - คืน top-N (เช่น 5) พร้อม snippet ที่ match มากที่สุด (ใช้ `substring`/manual windowing รอบจุดที่คะแนนสูง)
- [ ] เขียนชุดทดสอบ (unit test) ด้วย "ข้อความจำลองแบบ STT เพี้ยน" (พิมพ์เองเลียนแบบ error ที่ STT มักทำ: สลับพยัญชนะใกล้เคียง, เว้นวรรคผิดที่, ตัดคำขาด) เทียบกับเนื้อเพลงจริงในเชิงว่า top-5 ต้องมีเพลงที่ถูกต้องอยู่

**Deliverable:** ฟังก์ชัน `searchLyrics(queryText: string): SearchResult[]` ที่เรียกตรงจาก script ทดสอบได้ ไม่ต้องผ่าน UI/STT เลย

**Acceptance criteria:** จากชุดทดสอบ ~20-30 query จำลอง เพลงที่ถูกต้องต้องอยู่ใน top-5 อย่างน้อย 80% ของเคส (ตัวเลขตั้งต้น ปรับได้ตอน Phase 6)

---

## Phase 3 — STT Integration

**เป้าหมาย:** แปลงไฟล์เสียงเป็นข้อความไทยได้ ผ่าน interface ที่สลับ provider ได้

**งาน:**
- [ ] เขียน `lib/stt/types.ts` — interface `SttProvider { transcribe(audio: Blob | Buffer): Promise<string> }`
- [ ] เขียน `lib/stt/whisper.ts` — implement ด้วย OpenAI Whisper API (`gpt-4o-transcribe` หรือรุ่นที่เหมาะสม ณ ตอนพัฒนา — เช็ค API ปัจจุบันก่อนเขียนจริง)
- [ ] ทดสอบแยกด้วยไฟล์เสียงตัวอย่าง (อัดเอง 5-10 ไฟล์ พูดเนื้อเพลงจากท่อนต่างๆ ใน dataset) ยืนยันว่าได้ข้อความไทยกลับมาสมเหตุสมผล
- [ ] บันทึกผล transcript เทียบกับสิ่งที่พูดจริง ไว้เป็น baseline สำหรับ Phase 6

**Deliverable:** ฟังก์ชัน `transcribe(audioBuffer)` เรียกได้จาก script ทดสอบ คืนข้อความไทย

**Acceptance criteria:** transcript ที่ได้จากเสียงพูดชัดเจน ต้องมีคำสำคัญของท่อนเพลงนั้นปรากฏอยู่ (ไม่ต้องตรง 100% แต่ semantic ต้องใกล้เคียง)

---

## Phase 4 — API Layer

**เป้าหมาย:** ต่อ Phase 2 + 3 เข้าด้วยกันเป็น API เดียวที่ frontend เรียกใช้ได้

**งาน:**
- [ ] `app/api/voice-search/route.ts`:
  - รับ `multipart/form-data` (ไฟล์เสียง) → เรียก `transcribe()` → เรียก `searchLyrics()` → คืน JSON `{ transcript, results: [...] }`
  - จำกัดขนาด/ความยาวไฟล์เสียง (เช่น ≤10 วิ, ≤2MB) ปฏิเสธถ้าเกิน
  - Validate input ด้วย `zod`
- [ ] `app/api/text-search/route.ts` — รับข้อความตรงๆ เรียก `searchLyrics()` อย่างเดียว (ไว้ debug และเป็น fallback ให้ผู้ใช้พิมพ์เองได้)
- [ ] Error handling: STT ล้มเหลว, ไม่มีผลลัพธ์ที่คะแนนพอ (คืน "ไม่พบเพลงที่ตรงกัน" แทนการโชว์ผลมั่วๆ)
- [ ] Basic rate limiting ต่อ IP (กัน abuse ค่าใช้จ่าย STT)

**Deliverable:** ยิง `curl`/Postman ไปที่ `/api/voice-search` พร้อมไฟล์เสียงตัวอย่าง ได้ผลลัพธ์ JSON ที่ถูกต้อง

**Acceptance criteria:** ครบ happy path + error path (ไฟล์ใหญ่เกิน, ไม่มีเสียงพูด, STT error) มีการจัดการทั้งหมดโดยไม่ 500 crash

---

## Phase 5 — Frontend UI

**เป้าหมาย:** หน้าเว็บที่ผู้ใช้จริงกดอัดเสียงและเห็นผลลัพธ์ได้ (ทำขนานกับ Phase 3-4 โดย mock response ไปก่อนได้)

**งาน:**
- [ ] `components/RecordButton.tsx` — ใช้ `MediaRecorder` ขออนุญาต mic, อัด, จำกัดเวลาอัตโนมัติ (เช่น auto-stop ที่ 10 วิ), แสดงสถานะ (idle/recording/processing)
- [ ] `components/ResultCard.tsx` — โชว์ชื่อเพลง/ศิลปิน/ปี + snippet เนื้อเพลงที่ match (highlight ส่วนที่ตรง) + คะแนนความมั่นใจ
- [ ] `app/page.tsx` — ประกอบ UI หลัก: ปุ่มอัด → เรียก `/api/voice-search` → loading state → แสดงลิสต์ผลลัพธ์ (หรือ empty state ถ้าไม่พบ)
- [ ] ช่องพิมพ์ข้อความ fallback (เผื่อ mic ใช้ไม่ได้ หรือผู้ใช้อยากพิมพ์เอง) ต่อกับ `/api/text-search`
- [ ] Responsive/มือถือ (เคสใช้งานจริงส่วนใหญ่คือมือถือ) + จัดการ permission denied ของ mic อย่างสุภาพ

**Deliverable:** หน้าเว็บใช้งานได้ end-to-end บน `localhost`

**Acceptance criteria:** ทดสอบด้วยมือ (manual QA) อัดเสียงพูดเนื้อเพลงจริง 1 ท่อน แล้วเจอเพลงที่ถูกต้องในผลลัพธ์

---

## Phase 6 — Integration Testing & Tuning

**เป้าหมาย:** วัดความแม่นยำจริงของทั้งระบบ (STT + matching รวมกัน) แล้วปรับพารามิเตอร์

**งาน:**
- [ ] สร้างชุดทดสอบ ~30-50 เคส: เลือกเพลงสุ่มจาก dataset, ให้คนพูด/ร้องท่อนหนึ่ง, บันทึกว่า top-1/top-5 เจอเพลงถูกไหม
- [ ] เทียบ 2 โหมด: "พูดปกติ" vs "ร้องจริง" — ดูว่าความแม่นยำต่างกันแค่ไหน (ผลจะกำหนดคำแนะนำที่โชว์ใน UI)
- [ ] ปรับ weight ระหว่าง `full_lyrics` similarity กับ `skeleton` similarity ตามผลจริง
- [ ] ปรับ threshold ขั้นต่ำที่จะถือว่า "พบ" (กันโชว์ผลลัพธ์ที่คะแนนต่ำเกินไปจนไม่มีความหมาย)
- [ ] เก็บ log คำค้น (transcript + query) ไว้วิเคราะห์ pattern ที่ผิดพลาดบ่อย (แต่ต้องระวังเรื่อง privacy เสียงผู้ใช้ — ไม่เก็บไฟล์เสียงดิบถ้าไม่จำเป็น)

**Deliverable:** รายงานความแม่นยำ (accuracy@1, accuracy@5) + ค่า config ที่ปรับแล้ว

**Acceptance criteria:** accuracy@5 ผ่านเกณฑ์ที่ตั้งไว้ (เริ่มต้นเสนอ ≥70% สำหรับโหมดพูด, ปรับตามผลจริง)

---

## Phase 7 — Deployment

**เป้าหมาย:** ระบบใช้งานได้จริงบน production URL

**งาน:**
- [ ] ตั้งค่า Postgres production (Neon/Supabase) แยกจาก dev, รัน ingest script กับ DB จริง
- [ ] ตั้งค่า environment variables บน Vercel (`DATABASE_URL`, `OPENAI_API_KEY`)
- [ ] Deploy ผ่าน skill `deploy-to-vercel`
- [ ] ทดสอบ smoke test บน production URL (อัดเสียงจริงผ่าน HTTPS บนมือถือ — mic permission ต้องใช้ HTTPS)
- [ ] ตั้ง monitoring พื้นฐาน (Vercel logs, ดู error rate ของ `/api/voice-search`)

**Deliverable:** URL production ที่ใช้งานได้จริง

**Acceptance criteria:** ทดสอบจากมือถือจริงอย่างน้อย 2 เครื่อง/เบราว์เซอร์ ใช้งานได้ครบ flow

---

## Phase 8 — Polish & Hardening

**เป้าหมาย:** เก็บรายละเอียดก่อนเปิดใช้งานวงกว้าง

**งาน:**
- [ ] ลิขสิทธิ์เนื้อเพลง: จำกัดความยาว snippet ที่โชว์ (ไม่โชว์เนื้อเพลงเต็มเพลง)
- [ ] Rate limiting ที่รัดกุมขึ้น (ป้องกันบิล STT บาน)
- [ ] Error/empty state UX (ไม่พบเพลง, mic ใช้ไม่ได้, เครือข่ายช้า)
- [ ] Loading/perceived performance (STT+search รวมอาจใช้เวลา 2-5 วิ ต้องมี feedback ระหว่างรอ)
- [ ] Analytics เบื้องต้น (จำนวนค้นหา, อัตราพบ/ไม่พบ) เพื่อดูสุขภาพระบบต่อเนื่อง
- [ ] เอกสาร README อัปเดต วิธีรัน ingest script ใหม่เมื่อ dataset เพิ่มเพลง

**Deliverable:** ระบบพร้อมใช้งานจริงอย่างมั่นใจ ไม่ใช่แค่ demo

---

## Backlog / แนวคิดสำหรับอนาคต (ไม่อยู่ใน scope รอบนี้)

- รองรับ audio fingerprinting จริง (แบบ Shazam) — ต้องมีคลังไฟล์เสียงเพลงจริงทุกเพลงก่อน ซึ่งปัจจุบันไม่มี
- Query-by-humming (ทำนองอย่างเดียวไม่มีเนื้อร้อง) — ต้องใช้ melody/pitch-contour matching ซึ่งเป็นปัญหาคนละแบบและต้องมี dataset ทำนองแยก
- ขยาย dataset เกินลูกทุ่ง 1,500 เพลง (genre อื่น) — ต้อง re-evaluate scaling ของ trigram search (ที่ ~1,500 แถวยังเบามาก แต่ถ้าเพิ่มเป็นแสนแถวอาจต้องพิจารณา search engine เฉพาะทาง)

---

## สรุป dependency ระหว่าง Phase

```
Phase 0 (Infra)
   │
   ▼
Phase 1 (Data Pipeline) ──────────┐
   │                              │
   ▼                              ▼
Phase 2 (Matching Engine)   Phase 3 (STT) ── ทำขนานกันได้
   │                              │
   └──────────────┬───────────────┘
                   ▼
            Phase 4 (API Layer)
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
  Phase 5 (Frontend)   (ทำขนานกับ 3-4 โดย mock ได้)
        │
        ▼
  Phase 6 (Integration Testing & Tuning)
        │
        ▼
  Phase 7 (Deployment)
        │
        ▼
  Phase 8 (Polish & Hardening)
```
