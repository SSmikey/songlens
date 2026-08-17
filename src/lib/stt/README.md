# lib/stt

Speech-to-Text — implemented in **Phase 3**.

- **`browserSpeechRecognition.ts` — ใช้งานจริง (primary path).** Client-side wrapper รอบ Web Speech API ของเบราว์เซอร์ (`SpeechRecognition`/`webkitSpeechRecognition`) ฟรี ไม่ต้องมี API key `isSpeechRecognitionSupported()` + `listenOnce()`. รองรับดีบน Chrome/Edge เท่านั้น (Firefox/Safari ไม่รองรับ) ต้องเรียกจาก Client Component เท่านั้น
- `types.ts` + `whisper.ts` — server-side provider ด้วย OpenAI Whisper API, **สำรองไว้ ไม่ใช้จริงตอนนี้** (ต้องมี `OPENAI_API_KEY` ที่ผูก billing แล้ว) เผื่ออนาคตอยากรองรับเบราว์เซอร์ที่ Web Speech API ใช้ไม่ได้

ดู [docs/PLAN.md](../../../docs/PLAN.md) Phase 3 สำหรับรายละเอียดและเหตุผลที่ pivot
