# components

UI components — implemented ใน **Phase 5** ✅

- `RecordButton.tsx` — ปุ่มไมค์ เรียก `listenOnce()` จาก `@/lib/stt/browserSpeechRecognition` (Web Speech API ของเบราว์เซอร์ ไม่ใช่ `MediaRecorder`/อัปโหลดไฟล์ — ดูเหตุผลใน Phase 3 pivot), เช็ค browser support แบบ SSR-safe ด้วย `useSyncExternalStore`
- `ResultCard.tsx` — โชว์ชื่อเพลง/ศิลปิน/ปี + confidence bar + snippet ที่ match

ดู [docs/PLAN.md](../../docs/PLAN.md) Phase 5 สำหรับรายละเอียดและสถานะการทดสอบ
