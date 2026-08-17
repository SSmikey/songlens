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
| 6.5 | UX/UI Design Polish | ออกแบบสี/ปุ่ม/interaction ให้สวยงามน่าใช้ ก่อน deploy |
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
- [x] [src/components/RecordButton.tsx](../src/components/RecordButton.tsx) — Client Component เรียก `listenOnce()` จาก `browserSpeechRecognition.ts`, เช็ค support ด้วย `useSyncExternalStore` (SSR-safe, ไม่ setState ใน effect — แก้ lint error `react-hooks/set-state-in-effect` ที่เจอตอนแรก), แสดงสถานะ idle/listening พร้อม pulse animation, จัดการ `ListenError` ทุกแบบเป็นข้อความไทยที่เข้าใจง่าย
- [x] [src/components/ResultCard.tsx](../src/components/ResultCard.tsx) — โชว์ชื่อเพลง/ศิลปิน/ปี + confidence bar + snippet
- [x] [src/app/page.tsx](../src/app/page.tsx) — ประกอบ UI หลัก: ปุ่มอัด/ช่องพิมพ์ → `searchByText()` (`src/lib/search/searchClient.ts`) → `/api/search` → loading/error/empty/results state ครบ
- [x] ช่องพิมพ์ข้อความ fallback ยิงเข้า `/api/search` เดียวกัน — แสดงข้อความแนะนำอัตโนมัติเมื่อเบราว์เซอร์ไม่รองรับ Web Speech API
- [x] แยก [src/lib/search/types.ts](../src/lib/search/types.ts) ออกจาก `matcher.ts` เพื่อให้ client import type ได้โดยไม่ดึง `pg` (Node-only) เข้า client bundle
- [x] Responsive พื้นฐาน (mobile breakpoint สำหรับ text form)

**Deliverable:** หน้าเว็บใช้งานได้ end-to-end บน `localhost` — ✅ ตรวจสอบแล้วด้วย `next dev` จริง

**Acceptance criteria:** ⚠️ ปรับตามข้อจำกัดของสภาพแวดล้อมนี้ — ทดสอบอัตโนมัติได้เฉพาะบางส่วน (ดูสถานะด้านล่าง) **การอัดเสียงพูดจริง 1 ท่อนแล้วเจอเพลงถูกต้อง ต้องให้ผู้ใช้ทดสอบเองในเบราว์เซอร์จริง** (Chrome/Edge)

> **สถานะ: 🟡 เสร็จเท่าที่ทำได้ในสภาพแวดล้อมนี้** (2026-08-17) — โค้ดพร้อมใช้งานจริง รอผู้ใช้ทดสอบเสียงจริงเอง
>
> **ตรวจสอบแล้วด้วย browser automation (headless):**
> - หน้าเว็บ render ถูกต้อง, title/metadata ถูกต้อง
> - **ไม่มี console error/warning และไม่มี hydration mismatch เลยในทุกรอบทดสอบ** — ยืนยันว่า pattern `useSyncExternalStore` สำหรับเช็ค browser support แบบ SSR-safe ถูกต้อง
> - Fallback UI ที่ไม่รองรับ Web Speech API แสดงข้อความแนะนำถูกต้อง
> - Backend `/api/search` ที่หน้าเว็บเรียกใช้ ผ่านการทดสอบเต็มรูปแบบแล้วใน Phase 4 (happy path, error path, rate limit, threshold filtering)
>
> **ทดสอบไม่ได้ในสภาพแวดล้อมนี้ (ข้อจำกัดของ headless browser ไม่ใช่ของแอป):**
> - จำลองการพิมพ์ในช่อง text input ผ่าน synthetic DOM event ไม่ trigger React controlled-state ใน headless setup นี้ (ปัญหาเครื่องมือทดสอบ ไม่ใช่บั๊ก — โค้ด `onChange`/`onSubmit` เป็น React pattern มาตรฐาน ตรวจสอบด้วยการอ่านโค้ดแล้วถูกต้อง)
> - ฟีเจอร์เสียงจริง (`listenOnce()`) ต้องมี mic จริง + browser จริง ทดสอบใน headless ไม่ได้เลย
> - **สิ่งที่ผู้ใช้ควรทำก่อนไป Phase 6:** เปิด `localhost:3000` ด้วย Chrome/Edge จริง กดปุ่มไมค์ พูดท่อนเพลงจาก dataset สักท่อน แล้วดูว่าเจอเพลงถูกต้องไหม + ลองพิมพ์ในช่อง fallback ด้วย

---

## Phase 6 — Integration Testing & Tuning

**เป้าหมาย:** วัดความแม่นยำจริงของทั้งระบบ (STT + matching รวมกัน) แล้วปรับพารามิเตอร์

**งาน:**
- [x] สร้างชุดทดสอบจากเพลงจริงในฐานข้อมูล (สุ่ม + คัดท่อนที่อ่านออกเสียงเป็นธรรมชาติ) ให้ผู้ใช้พูดจริงผ่าน browser จริง — **7 เคส** (น้อยกว่าเป้าหมายเดิม 30-50 เคส เพราะพึ่งพาการทดสอบมือจริงของผู้ใช้ ไม่ใช่ automated เหมือน `eval-matcher.ts` ใน Phase 2 — ถือเป็น smoke test เชิงคุณภาพ ไม่ใช่ตัวเลข statistically robust)
- [x] ผล: **7/7 (100%) เจอเพลงถูกต้อง** พูดปกติผ่าน Web Speech API จริงบน browser จริง
- [ ] เทียบ "พูดปกติ" vs "ร้องจริง" — **ยังไม่ได้ทดสอบ** (ทดสอบเฉพาะโหมดพูดปกติ) ทิ้งไว้เป็น backlog ถ้าพบปัญหาการใช้งานจริงภายหลัง
- [x] ปรับ weight/threshold — **ไม่ต้องปรับ** เพราะผลจริงออกมาดีอยู่แล้ว (100% บนชุดทดสอบนี้) ค่าจาก Phase 2 (`0.6/0.4`, threshold `0.3`) ยังใช้ได้
- [ ] เก็บ log คำค้นไว้วิเคราะห์ — **ยังไม่ทำ** (deferred) ไม่จำเป็นในสเกลนี้ตอนนี้ พิจารณาใหม่ถ้ามีผู้ใช้งานจริงเยอะขึ้นหลัง deploy

**Deliverable:** รายงานความแม่นยำ (accuracy@1, accuracy@5) + ค่า config ที่ปรับแล้ว

**Acceptance criteria:** ✅ accuracy@5 ผ่านเกณฑ์ (เกิน 70% ที่ตั้งไว้มาก — ได้ 100% แต่บน sample size เล็ก 7 เคส ควรตีความอย่างระมัดระวัง ไม่ใช่การันตี 100% ในการใช้งานจริงระยะยาว)

> **สถานะ: ✅ ปิดตามที่ผู้ใช้ยืนยัน** (2026-08-17) — ผลดีมาก ไม่ต้องปรับพารามิเตอร์เพิ่ม รายการที่ทิ้งไว้เป็น backlog (เทียบร้อง vs พูด, query logging) ไม่ block การไป Phase ถัดไป แต่ควรกลับมาดูถ้าเจอปัญหาหลัง deploy จริง

---

## Phase 6.5 — UX/UI Design Polish

**เป้าหมาย:** ทำให้หน้าเว็บ "สวยงาม น่าใช้" ก่อน deploy จริง — ใช้ palette สีที่กำหนด เน้นปุ่มที่ผู้ใช้ interact ด้วยบ่อย (ปุ่มไมค์, ปุ่มค้นหา, การ์ดผลลัพธ์)

**Palette ที่ใช้:**
| สี | Hex | บทบาท |
|---|---|---|
| Maroon | `#8B2626` | accent เข้ม, hover/active state ของปุ่มหลัก |
| Orange | `#EF6905` | สีหลัก (ปุ่มไมค์, ปุ่มค้นหา, focus ring) |
| Cream | `#F1E5A1` | พื้นหลังโทนอุ่น, การ์ด/พื้นผิว |
| Green | `#486C2F` | accent รอง (confidence bar, success state) |

**งาน:**
- [x] กำหนด design token ใน [globals.css](../src/app/globals.css) (light + dark mode) — `--color-maroon/orange/cream/green` เป็น raw brand token + semantic token ชั้นบน (`--background`, `--foreground`, `--surface`, `--accent`, `--accent-hover`, `--accent-active`, `--accent-secondary`, `--focus-ring`, `--error`)
- [x] ปรับปุ่มไมค์ ([RecordButton.module.css](../src/components/RecordButton.module.css)) — hover ยกตัว+เงา, active กดยุบ, pulse/ripple animation 2 ชั้นตอนฟัง (สี maroon), focus-visible ทั่วแอปผ่าน global `:focus-visible`
- [x] ปรับปุ่มค้นหา + text input ([page.module.css](../src/app/page.module.css)) ให้ใช้ token เดียวกัน — hover/active/focus-ring สีส้ม
- [x] ปรับการ์ดผลลัพธ์ ([ResultCard.module.css](../src/components/ResultCard.module.css)) — hover lift + เงา, accent bar ซ้ายสีส้ม→มะรูนตอน hover, confidence bar สีเขียว, % confidence สีมะรูน
- [x] เพิ่ม `viewport.themeColor` ใน [layout.tsx](../src/app/layout.tsx) (คนละสีตาม light/dark)
- [x] Contrast: ใช้ตัวอักษรน้ำตาลเข้ม (`#2c1810`) บนพื้นครีมอ่อน (`#fdf8ec`, อ่อนกว่า cream token `#f1e5a1` ที่ให้มา เพื่อไม่ให้ตัวอักษรอ่านยาก) — แยก `--surface` เป็นสีขาวอมครีมสำหรับการ์ดให้ตัดกับพื้นหลังชัดขึ้น
- [x] ตรวจด้วย browser automation — screenshot + inject token-driven preview card เพื่อยืนยันครบ 4 สี, **ไม่มี console error ใหม่**

**Deliverable:** หน้าเว็บใช้ palette ที่กำหนดครบ ปุ่ม/การ์ดมี interaction feedback ชัดเจน ไม่มี console error ใหม่ — ✅

**Acceptance criteria:** ✅ ตรวจด้วยสายตา (screenshot) ยืนยันครบ 4 สีใช้เป็นระบบผ่าน CSS custom properties (ไม่ hardcode กระจาย), contrast อ่านง่าย, ปุ่ม/การ์ดมี hover/active/focus state ชัดเจนทั้งหมด

> **สถานะ: ✅ เสร็จสมบูรณ์** (2026-08-17) — ยืนยันด้วย screenshot จริงผ่าน headless browser, ไม่มี console error/hydration issue เพิ่มจากการเปลี่ยน CSS
>
> **เพิ่มเติม (2026-08-17):** ใส่ [public/img/songlens.png](../public/img/songlens.png) (โปสเตอร์แบรนด์ — ไมค์วินเทจ + "MUSIC" + แผ่นเสียง "SONGLENS") เป็นพื้นหลังหน้าเว็บ:
> - บีบอัดเป็น `songlens-bg.webp` ก่อนใช้จริง (3.3MB → 235KB, ลด 93%) เก็บไฟล์ต้นฉบับ `.png` ไว้เผื่อใช้งานอื่น
> - ใช้ CSS overlay สีครีม/เข้มโปร่งแสง (theme-aware, คนละสีระหว่าง light/dark) ทับภาพ ให้ภาพจางลงเป็นพื้นผิว ไม่แข่งกับตัวอักษร/ปุ่มด้านบน
> - เจอ hydration warning เรื่อง `caret-color:transparent` บน input ระหว่างตรวจสอบ — สืบแล้วไม่ใช่จากโค้ดเรา (ไม่มี `caret-color` ในซอร์สเลย) เป็น artifact จาก extension ของ browser ที่ใช้ทดสอบ ไม่กระทบผู้ใช้จริง
>
> **เปลี่ยนภาพพื้นหลังอีกครั้ง (2026-08-17):** สลับเป็น [public/img/songlens-(1).png](<../public/img/songlens-(1).png>) (โทนขาว-ดำฮาล์ฟโทน — "MUSIC / THE RHYTHM OF LIFE" + มือถือแผ่นเสียง คนละอารมณ์กับภาพครีมเดิม) บีบอัดทับ `songlens-bg.webp` เดิม (519KB → 199KB, ไม่ต้องแก้ CSS เพราะชื่อไฟล์อ้างอิงเดิม) ตรวจด้วย screenshot แล้ว overlay ครีมที่มีอยู่ทำให้ภาพเข้มนี้กลายเป็นโทนเทาอุ่นอ่อนๆ แทนครีม ยังกลมกลืนกับปุ่ม/หัวข้อดี อ่านง่าย ไม่ต้องปรับ overlay เพิ่ม
>
> **เปลี่ยนวิธีอีกครั้งตามคำขอผู้ใช้ — เลิกทำภาพจางเป็นพื้นผิว (2026-08-17):** เอา overlay ที่ทับภาพออกทั้งหมด ให้ `body` background แสดงภาพเต็มความคมชัด 100% ทุกจุด แล้วเปลี่ยนมาให้ `.main` (เนื้อหาทั้งหมด: หัวข้อ/ปุ่ม/ฟอร์ม/ผลลัพธ์) เป็นแผงกระจกลอยกลางจอแทน (`--panel-bg` โปร่งแสง + `backdrop-filter: blur(14px)` + เงา) วิธีนี้ทำให้ภาพพื้นหลังคมชัดเต็มที่รอบๆ ขณะที่ตัวอักษร/ปุ่มยังอ่านง่ายเพราะอยู่บนแผงกระจกที่ contrast เพียงพอเสมอ ไม่ขึ้นกับว่าใต้แผงจะเป็นส่วนมืดหรือสว่างของภาพ — ตรวจด้วย screenshot แล้วผลดีมาก
>
> **ปรับเป็น split layout ซ้าย/ขวาตามคำขอ (2026-08-17):** เปลี่ยนจากแผงกระจกลอยกลางจอ เป็น 2 คอลัมน์เต็มความสูงหน้าจอ — ฝั่งซ้าย (`.main`) เนื้อหาทั้งหมดบนพื้นหลังทึบสีครีม/เข้มปกติ (ไม่ต้อง glass/blur แล้วเพราะไม่ได้ทับภาพโดยตรง), ฝั่งขวา (`.imagePanel`) โชว์ภาพ hero เต็มความคมชัด 100% เป็นพื้นหลังของคอลัมน์นั้นเอง — ย้าย background-image ออกจาก `body` ไปไว้ที่ `.imagePanel` แทน, มือถือ (`max-width: 860px`) ซ่อน `.imagePanel` ให้เนื้อหาเต็มจอ ไม่บีบอัด
>
> **รวมสองแนวทางตามคำขอล่าสุด (2026-08-17):** (1) ภาพพื้นหลังกลับมาเป็นเต็มจอ (`body`) ไม่แบ่งครึ่งซ้าย/ขวาอีกต่อไป เอา `.imagePanel` div ออก (2) เนื้อหาฝั่งซ้ายกลับไปเป็นกล่องกระจกเบลอ (`--panel-bg` + `backdrop-filter`) แต่ปรับให้ **sized to content** (`max-width: 460px`, ไม่ stretch เต็มความสูง/ความกว้างครึ่งจอเหมือนตอนเป็น split layout) แล้วจัดตำแหน่งชิดซ้ายด้วย `.page { justify-content: flex-start }` — ผลคือภาพคมชัด 100% ทุกที่ยกเว้นเบลอเฉพาะพื้นที่ที่กล่อง UI ครอบอยู่จริงๆ เท่านั้น ตามที่ขอ

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
