// api/obfuscate.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' })); // لدعم السكريبتات الطويلة جداً
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// تشغيل الملفات الساكنة (الواجهة) من المجلد الرئيسي
app.use(express.static(path.join(__dirname, '../')));

app.post('/obfuscate', (req, res) => {
    const code = req.body.code;
    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    const rootDir = path.join(__dirname, '../');
    const uniqueId = Date.now();
    
    // إنشاء ملفات مؤقتة بأسماء فريدة ومسارات مطلقة داخل المجلد الرئيسي
    const tempInputPath = path.join(rootDir, `temp_${uniqueId}.lua`);
    const expectedOutputPath = path.join(rootDir, `temp_${uniqueId}_obfuscated.lua`);

    // 1. كتابة الكود الأصلي المستقبل من المستخدم في ملف مؤقت
    fs.writeFile(tempInputPath, code, 'utf8', (err) => {
        if (err) {
            console.error("Failed to write input file:", err);
            return res.status(500).json({ error: 'Failed to initialize obfuscation pipeline' });
        }

        const herculesPath = path.join(rootDir, 'hercules.lua');
        
        // 2. تشغيل الـ CLI الخاص بـ Hercules بدون overwrite لتوليد ملف الـ _obfuscated تلقائياً
        // نقوم بتحديد الـ cwd (مجلد العمل الرئيسي) لضمان عمل الـ require بشكل سليم 100%
        exec(`lua "${herculesPath}" "${tempInputPath}"`, { cwd: rootDir }, (execErr, stdout, stderr) => {
            
            // تنظيف ملف الإدخال فوراً بعد انتهاء المعالجة
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);

            if (execErr) {
                console.error("Hercules execution error:", stderr || execErr.message);
                if (fs.existsSync(expectedOutputPath)) fs.unlinkSync(expectedOutputPath);
                return res.status(500).json({ 
                    error: 'Obfuscation Engine Crashed', 
                    details: stderr || execErr.message 
                });
            }

            // 3. التأكد من وجود الملف المشفر وقراءته لإرساله للواجهة
            if (!fs.existsSync(expectedOutputPath)) {
                return res.status(500).json({ error: 'Obfuscation succeeded but output file was not found' });
            }

            fs.readFile(expectedOutputPath, 'utf8', (readErr, obfuscatedResult) => {
                // تنظيف ملف المخرجات من السيرفر بعد القراءة للحفاظ على المساحة
                if (fs.existsSync(expectedOutputPath)) fs.unlinkSync(expectedOutputPath);

                if (readErr) {
                    return res.status(500).json({ error: 'Failed to read the generated obfuscated code' });
                }

                // إرسال النتيجة النهائية إلى الواجهة الأمامية بنجاح!
                res.json({ obfuscated: obfuscatedResult });
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Hercules Engine is active and running on port ${PORT}`);
});
