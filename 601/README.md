# E-Book Viewer (GitHub Pages)

โปรเจกต์นี้เป็นเว็บอ่าน PDF แบบพลิกหน้า 3D พร้อมซูม/เต็มจอ/ค้นหา/สารบัญ/แชร์/ดาวน์โหลด/โหมดมืด และเป็น PWA

## Deploy บน GitHub Pages

1. สร้าง repo และอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นไป (รวม `หนังสือรุ่น.pdf`)
2. ไปที่ `Settings` -> `Pages`
3. เลือก `Build and deployment`:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main` และโฟลเดอร์ `/(root)` (หรือ `docs` ถ้าคุณย้ายไฟล์ไปไว้ใน `docs`)
4. รอให้ Pages deploy แล้วเปิดลิงก์ที่ GitHub ให้มา

หมายเหตุ:
- มีไฟล์ `.nojekyll` เพื่อให้ GitHub Pages เสิร์ฟเป็น static ตรง ๆ (ไม่ผ่าน Jekyll)
- PWA/Service Worker จะทำงานเมื่อเปิดผ่าน HTTPS (GitHub Pages ใช้ HTTPS อยู่แล้ว)
- pdf.js โหลดจาก CDN ครั้งแรกต้องออนไลน์ 1 ครั้ง (หลังจากนั้น service worker จะช่วยแคชไว้)

## ใช้งาน

- ไปหน้าที่ต้องการ: พิมพ์เลขหน้าแล้วกด Enter
- แชร์หน้า: กด `แชร์` (ลิงก์จะมี `?page=` ติดไปด้วย)
- ดาวน์โหลด: กด `ดาวน์โหลด`

## เปิดแบบไฟล์ (file://)

ถ้าต้องการดับเบิลคลิก `index.html` แล้วเปิดเลยโดยไม่รัน server:

- เบราว์เซอร์ส่วนใหญ่จะบล็อกการโหลด PDF/Worker บางอย่างบน `file://` ดังนั้นโหมดนี้จะให้กดปุ่ม `เปิด PDF` เพื่อเลือกไฟล์จากเครื่อง (โหลดแบบ `ArrayBuffer` แทน `fetch`)
- แนะนำให้มี pdf.js แบบ local เพื่อไม่ต้องพึ่ง CDN: วางไฟล์ไว้ที่ `vendor/pdfjs/pdf.min.js` และ `vendor/pdfjs/pdf.worker.min.js`

