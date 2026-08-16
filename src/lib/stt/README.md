# lib/stt

Speech-to-Text provider layer — implemented in **Phase 3**.

- `types.ts` — `SttProvider` interface (`transcribe(audio) => Promise<string>`), ทำให้สลับ provider ได้โดยไม่กระทบโค้ดที่เรียกใช้
- `whisper.ts` — implementation ด้วย OpenAI Whisper API

ดู [docs/PLAN.md](../../../docs/PLAN.md) Phase 3 สำหรับรายละเอียด
