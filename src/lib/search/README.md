# lib/search

Core matching engine — implemented in **Phase 2**.

- `normalize.ts` — Thai text normalization + "โครงพยัญชนะ" (consonant-skeleton) generator ที่ต้องใช้ตรรกะเดียวกันทั้งตอน ingest (Phase 1) และตอน query
- `matcher.ts` — `searchLyrics(queryText): SearchResult[]`, ใช้ `pg_trgm` similarity บน `full_lyrics` + `lyrics_skeleton` แล้วรวมคะแนน
- `db.ts` — Postgres client (ใช้ `DATABASE_URL` จาก env)

ดู [docs/PLAN.md](../../../docs/PLAN.md) Phase 2 สำหรับรายละเอียด
