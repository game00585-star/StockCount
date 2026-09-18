# ตั้งค่า SharePoint Backup
1. สร้าง Microsoft Entra App registration แบบ Single-page application (SPA)
2. เพิ่ม Redirect URI ของ localhost และ production ที่ลงท้าย `/backup`
3. Microsoft Graph > Delegated permissions: เพิ่ม `Files.ReadWrite` และ consent ตามนโยบายองค์กร
4. ยืนยันว่ามีโฟลเดอร์ `App-Backup` ใน `IA / Shared Documents`
5. คัดลอก `.env.example` เป็น `.env.local` แล้วกรอก Tenant ID, Client ID, Redirect URI (ห้ามใช้ Client Secret)
6. รีสตาร์ต Vite แล้วกด เชื่อมต่อ Microsoft > ทดสอบการเชื่อมต่อ

ระบบใช้ MSAL Browser Authorization Code with PKCE และสำรองอัตโนมัติเฉพาะขณะเว็บเปิดอยู่
