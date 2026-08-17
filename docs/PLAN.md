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
- [x] `src/lib/search/normalize.ts` — `cleanText()`, `buildFullLyrics()`, `toSkeleton()` (ทำใน Phase 1 แล้ว เพราะ ingest ต้องใช้ตั้งแต่ต้น — ใช้ตรรกะเดียวกันทั้ง ingest และ query)
- [x] เขียน [src/lib/search/matcher.ts](../src/lib/search/matcher.ts):
  - Query ด้วย **`word_similarity()`** (ไม่ใช่ `similarity()` เปล่าๆ ตามที่พบปัญหาใน Phase 1) บนทั้ง `full_lyrics` และ `lyrics_skeleton`
  - รวมคะแนน weighted: `0.6 * word_similarity(full) + 0.4 * word_similarity(skeleton)`
  - คืน top-N พร้อม snippet — หา snippet ด้วย sliding-window trigram (Dice coefficient) ใน JS เฉพาะแถวที่ query กลับมาแล้ว (ไม่สแกนทั้ง 1,500 แถว)
  - `MIN_SCORE_THRESHOLD` (export ไว้ให้ Phase 4 ใช้ตัดสิน "ไม่พบ") = 0.3 — ปรับจาก draft แรก (0.15) หลังพบว่า query ที่ไม่เกี่ยวข้องเลยได้คะแนน 0.17-0.22 ซึ่งสูงกว่า draft threshold
- [x] เขียนชุดทดสอบ [scripts/eval-matcher.ts](../scripts/eval-matcher.ts) — จำลอง query เพี้ยนแบบ STT จริง (ตัดวรรณยุกต์, สลับพยัญชนะเสียงใกล้เคียงด้วย confusion map, ลบตัวอักษรสุ่ม, เว้น/รวมช่องว่างผิด) 60 trials จากข้อมูลจริง

**Deliverable:** ฟังก์ชัน `searchLyrics(queryText: string): SearchResult[]` ที่เรียกตรงจาก script ทดสอบได้ ไม่ต้องผ่าน UI/STT เลย

**Acceptance criteria:** ✅ accuracy@5 ต้อง ≥80% — ได้จริง **100%** (accuracy@1 ~95-97%) จาก 60 trials, สอดคล้องกันในการรันซ้ำ 2 รอบ

> **สถานะ: ✅ เสร็จสมบูรณ์** (2026-08-17)
>
> 🔍 **ข้อค้นพบสำคัญที่กระทบ Phase 4/6:** ทดสอบ query ที่ไม่เกี่ยวกับเพลงเลย (เช่น "วันนี้อากาศดีมาก...") พบว่ายังได้คะแนน 0.17-0.22 (ไม่ใช่ศูนย์) เพราะ trigram บางตัวบังเอิญตรงกัน — ต้องมี `MIN_SCORE_THRESHOLD` กันไว้เสมอ ห้ามโชว์ผลลัพธ์ดิบโดยไม่กรอง ไม่งั้น Phase 4 API จะคืนเพลง "มั่วๆ" เป็นคำตอบเวลาผู้ใช้พูดเรื่องที่ไม่ใช่เนื้อเพลงเลย (เช่น พูดผิด/พูดเรื่องอื่นใส่ไมค์)

---

## Phase 3 — STT Integration

> ⚠️ **Pivot (2026-08-17):** เดิมวางแผนใช้ OpenAI Whisper API (server-side) แต่ API key ที่สร้างไว้ยังไม่มี billing/quota (`insufficient_quota` ตอนทดสอบจริง) ผู้ใช้เลือกเปลี่ยนไปใช้ **Web Speech API ของเบราว์เซอร์แทน — ฟรี 100% ไม่ต้องมี API key** งานและ acceptance criteria ด้านล่างปรับตามการตัดสินใจนี้ ของเดิม (OpenAI) เก็บไว้ใน `src/lib/stt/whisper.ts` เป็นทางเลือกสำรอง ไม่ได้อยู่ใน critical path

**เป้าหมาย:** แปลงเสียงพูดเป็นข้อความไทยได้ โดยไม่มีค่าใช้จ่าย

**งาน:**
- [x] เขียน `src/lib/stt/types.ts` — interface `SttProvider { transcribe(input): Promise<string> }` (ยังเก็บไว้สำหรับ provider ฝั่ง server ในอนาคต)
- [x] เขียน `src/lib/stt/whisper.ts` — implement ด้วย OpenAI Whisper API (`gpt-4o-transcribe`) — **ใช้งานได้จริงเมื่อ API key มี billing แล้วเท่านั้น ไม่ใช่ default ของระบบ**
- [x] เขียน [scripts/test-stt-pipeline.ts](../scripts/test-stt-pipeline.ts) — smoke test TTS→Whisper→searchLyrics (ติด quota เลยยังไม่ได้รันจบ, เก็บไว้เผื่อใช้ทีหลัง)
- [x] **ทางเลือกใหม่ (ใช้จริง):** เขียน [src/lib/stt/browserSpeechRecognition.ts](../src/lib/stt/browserSpeechRecognition.ts) — wrapper รอบ `SpeechRecognition`/`webkitSpeechRecognition` ของเบราว์เซอร์ (`lang: "th-TH"`), มี `isSpeechRecognitionSupported()` + `listenOnce()` คืน Promise<string>, จัดการ error (`not-allowed`, `no-speech`, `network`, `unsupported` ฯลฯ) เป็น `ListenError` ที่แยกประเภทได้
- [ ] ทดสอบด้วยการพูดจริงผ่าน browser จริง (Chrome/Edge) — **ทำไม่ได้ในสภาพแวดล้อมนี้** (ไม่มี mic/browser ให้เครื่องมือเข้าถึง) ต้องรอ Phase 5 มี UI จริงแล้วผู้ใช้ทดสอบเอง

**Deliverable:** `listenOnce(): Promise<string>` เรียกจาก Client Component ได้ (จะต่อกับปุ่มอัดเสียงจริงใน Phase 5)

**Acceptance criteria:** ✅ โค้ด type-check ผ่าน (`npx tsc --noEmit`), ออกแบบ error handling ครบตามเคสที่ Web Speech API คืนได้จริง — ⏳ การยืนยันว่า "ได้ข้อความไทยสมเหตุสมผลจากเสียงพูดชัดเจน" ต้องทดสอบกับ browser จริงใน Phase 5/6

> **สถานะ: 🟡 เสร็จเท่าที่ทำได้ในสภาพแวดล้อมนี้** — โค้ดพร้อมใช้ รอทดสอบกับเสียงจริงตอน Phase 5

---

## Phase 4 — API Layer

> ⚠️ **ปรับตาม Phase 3 pivot:** STT ทำที่ browser แล้ว (`browserSpeechRecognition.ts`) ดังนั้น backend ไม่ต้องรับไฟล์เสียงอีกต่อไป — รับแค่ "ข้อความที่ถอดมาแล้ว" พอ เหลือ endpoint เดียว ไม่ใช่สอง

**เป้าหมาย:** เปิด endpoint ให้ frontend ส่งข้อความ (จาก Web Speech API หรือพิมพ์เอง) เข้ามาค้นหาเพลง

**งาน:**
- [x] [src/app/api/search/route.ts](../src/app/api/search/route.ts):
  - รับ JSON `{ query: string }` (มาจาก `listenOnce()` หรือช่องพิมพ์เอง — ฝั่ง backend ไม่สนว่าที่มาคือเสียงหรือพิมพ์) → เรียก `searchLyrics()` → คืน JSON `{ results: [...] }`
  - ใช้ `MIN_SCORE_THRESHOLD` จาก `matcher.ts` (Phase 2) กรองผลคะแนนต่ำออกก่อนส่งกลับ แทนการโชว์ผลมั่วๆ
  - Validate input ด้วย `zod` (1-500 ตัวอักษร)
- [x] [src/lib/rateLimit.ts](../src/lib/rateLimit.ts) — in-memory rate limit ต่อ IP (20 req/60s), คืน `429` + `Retry-After` header เมื่อเกิน
- [x] อ่าน `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` ก่อนเขียน (ตามข้อบังคับ `AGENTS.md`) — ยืนยันว่า `runtime` default เป็น `'nodejs'` อยู่แล้วในเวอร์ชันนี้ (ไม่ต้อง export เพิ่ม, `pg` ใช้ได้ปกติ)
- [x] ทดสอบจริงด้วย `next dev` + `curl`: happy path, query ว่าง (400), field หาย (400), JSON ผิด (400), query ไม่เกี่ยวข้องเลย (กรองเหลือ `results: []` ถูกต้อง), rate limit (429 หลัง 20 req/60s)

**Deliverable:** ยิง `curl`/Postman ไปที่ `/api/search` พร้อม `{ "query": "..." }` ได้ผลลัพธ์ JSON ที่ถูกต้อง

**Acceptance criteria:** ✅ ครบ happy path + error path (query ว่าง, ไม่พบผลลัพธ์, DB error, rate limit) ไม่มี 500 crash ในเคสที่ควรจัดการได้

> **สถานะ: ✅ เสร็จสมบูรณ์** (2026-08-17)
>
> 🔍 **ปัญหาที่เจอระหว่างทดสอบ (ไม่ใช่บั๊กใน API):**
> 1. **Dev server เก่าค้าง process** — รัน `next dev` ครั้งแรกแล้วเจอ `password authentication failed` ทั้งที่ `.env.local` ถูกต้อง (เช็คด้วย `npm run db:check` ผ่านตลอด) สาเหตุคือมี `next dev` instance เก่า (PID ค้างจาก background task ก่อนหน้าที่ระบบแจ้งผิดว่า "หยุดแล้ว") ยังกิน port 3000 อยู่จริง พร้อม env แบบ stale ต้อง `taskkill /PID ... /F` แล้วรันใหม่ถึงหาย — เป็น pattern เดียวกับปัญหา stray env var ใน Phase 0 (process เก่าแบก env เก่าติดตัว)
> 2. **curl บน Git Bash/Windows ส่งภาษาไทยผ่าน `-d '...'` inline แล้ว encode เพี้ยน** ทำให้ query กลายเป็นไบต์ขยะ ค้นไม่เจออะไรเลย (`results: []` ทั้งที่ควรเจอ) แก้โดยเขียน payload เป็นไฟล์ JSON (UTF-8 ชัดเจน) แล้วใช้ `curl --data-binary @file` แทน — ควรใช้วิธีนี้เวลาทดสอบ API ด้วยข้อความไทยผ่าน curl ต่อไป

---

## Phase 5 — Frontend UI

**เป้าหมาย:** หน้าเว็บที่ผู้ใช้จริงกดอัดเสียงและเห็นผลลัพธ์ได้ (ทำขนานกับ Phase 3-4 โดย mock response ไปก่อนได้)

**งาน:**
- [ ] `components/RecordButton.tsx` — Client Component เรียก `listenOnce()` จาก `browserSpeechRecognition.ts`, เช็ค `isSpeechRecognitionSupported()` ก่อน (ซ่อนปุ่ม/แจ้งเตือนถ้าเบราว์เซอร์ไม่รองรับ), แสดงสถานะ (idle/listening/processing), จัดการ `ListenError` แต่ละแบบ (`not-allowed` → บอกให้อนุญาต mic, `no-speech` → ลองใหม่, `unsupported` → เสนอช่องพิมพ์แทน)
- [ ] `components/ResultCard.tsx` — โชว์ชื่อเพลง/ศิลปิน/ปี + snippet เนื้อเพลงที่ match (highlight ส่วนที่ตรง) + คะแนนความมั่นใจ
- [ ] `app/page.tsx` — ประกอบ UI หลัก: ปุ่มอัด → `listenOnce()` ได้ข้อความ → ส่งเข้า `/api/search` → loading state → แสดงลิสต์ผลลัพธ์ (หรือ empty state ถ้าไม่พบ)
- [ ] ช่องพิมพ์ข้อความ fallback (เบราว์เซอร์ไม่รองรับ Web Speech API เช่น Firefox/Safari, หรือผู้ใช้อยากพิมพ์เอง) ยิงตรงไปที่ `/api/search` เดียวกัน
- [ ] Responsive/มือถือ (เคสใช้งานจริงส่วนใหญ่คือมือถือ) + จัดการ permission denied ของ mic อย่างสุภาพ + แจ้งเตือนชัดเจนถ้าเปิดด้วย Firefox/Safari ว่าฟีเจอร์เสียงอาจใช้ไม่ได้

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
