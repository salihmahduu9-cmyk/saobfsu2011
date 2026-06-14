// api/obfuscate.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, AttachmentBuilder, ChannelType } = require('discord.js');

// تفعيل قراءة متغيرات البيئة محلياً من ملف .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// تشغيل واجهة الموقع الإلكتروني الساكنة من المجلد الرئيسي
app.use(express.static(path.join(__dirname, '../')));

// دالة المعالجة المشتركة لتشغيل محرك Hercules
function runHercules(code, callback) {
    const rootDir = path.join(__dirname, '../');
    const uniqueId = Date.now();
    const tempInputPath = path.join(rootDir, `temp_${uniqueId}.lua`);
    const expectedOutputPath = path.join(rootDir, `temp_${uniqueId}_obfuscated.lua`);

    // كتابة الكود المستلم في ملف مؤقت
    fs.writeFile(tempInputPath, code, 'utf8', (err) => {
        if (err) return callback(err, null);

        const herculesPath = path.join(rootDir, 'hercules.lua');
        
        // تشغيل أمر التشفير مع تحديد مجلد العمل (cwd) لضمان عمل الـ require للموديولات
        exec(`lua "${herculesPath}" "${tempInputPath}"`, { cwd: rootDir }, (execErr, stdout, stderr) => {
            // حذف ملف الإدخال المؤقت فوراً للحفاظ على الأمان والمساحة
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);

            if (execErr) {
                if (fs.existsSync(expectedOutputPath)) fs.unlinkSync(expectedOutputPath);
                return callback(stderr || execErr.message, null);
            }

            if (!fs.existsSync(expectedOutputPath)) {
                return callback("Output file not found by engine", null);
            }

            // قراءة الكود المشفر النهائي
            fs.readFile(expectedOutputPath, 'utf8', (readErr, obfuscatedResult) => {
                if (fs.existsSync(expectedOutputPath)) fs.unlinkSync(expectedOutputPath);
                if (readErr) return callback(readErr, null);
                
                callback(null, obfuscatedResult);
            });
        });
    });
}

// 🌐 [API الموقع] استقبال طلبات التشفير من المتصفح
app.post('/obfuscate', (req, res) => {
    if (!req.body.code) return res.status(400).json({ error: 'No code provided' });
    
    runHercules(req.body.code, (err, result) => {
        if (err) return res.status(500).json({ error: 'Obfuscation Engine Crashed', details: err });
        res.json({ obfuscated: result });
    });
});

app.listen(PORT, () => {
    console.log(`Web server successfully deployed on port ${PORT}`);
});

// 🤖 [بوت الديسكورد] التشغيل والربط الآمن مع حصر الأوامر في الخاص DM فقط
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (DISCORD_TOKEN) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages // استقبال رسائل الخاص
        ],
        partials: ['CHANNEL'] // لضمان معالجة قنوات الخاص بدقة عالية دون مشاكل الـ Cache
    });

    client.once('ready', () => {
        console.log(`Discord Bot initialized. Logged in as ${client.user.tag}`);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        // التحقق من بدء الأمر بـ !obf
        if (message.content.startsWith('!obf')) {
            
            // 🔒 حماية: إذا تم كتابة الأمر في سيرفر عام وليس في الخاص (DM)
            if (message.channel.type !== ChannelType.DM) {
                // حذف رسالة المستخدم فوراً لحماية كوده من التسريب أمام أعضاء السيرفر
                if (message.deletable) {
                    await message.delete().catch(() => {});
                }
                
                // إرسال تنبيه مؤقت للمستخدم يطلب منه التوجه للشات الخاص بالبوت
                return message.reply("❌ **أمن الكود أولاً!** لأسباب أمنية وحماية لأكوادك، أمر التشفير يشتغل في **الخاص فقط**. أرسل كودك هنا في رسالة خاصة لي مباشرة.")
                    .then(msg => {
                        // حذف التنبيه بعد 7 ثوانٍ ليبقى السيرفر نظيفاً
                        setTimeout(() => msg.delete().catch(() => {}), 7000);
                    }).catch(() => {});
            }

            // إذا كنا في الخاص (DM)، يتم التشفير بشكل آمن تماماً
            const codeToObfuscate = message.content.slice(4).trim();
            
            if (!codeToObfuscate) {
                return message.reply('❌ يرجى إدخال الكود المراد تشفيره بعد الأمر! مثال:\n`!obf print("Hello")`');
            }

            const waitingMsg = await message.reply('⏳ جاري تشفير الكود الخاص بك عبر محرك Hercules...');

            runHercules(codeToObfuscate, async (err, result) => {
                if (err) {
                    return waitingMsg.edit("❌ فشل التشفير بسبب خطأ بالمحرك:\n```text\n" + err + "\n```");
                }

                // ديسكورد لا يتحمل الرسائل التي تزيد عن 2000 حرف، لذا نحولها لملف تلقائياً
                if (result.length > 1900) {
                    const attachment = new AttachmentBuilder(Buffer.from(result), { name: 'obfuscated.lua' });
                    await message.reply({ content: '✅ تم التشفير بنجاح! نظراً لطول الكود تم تصديره كملف جاهز للتنزيل:', files: [attachment] });
                    waitingMsg.delete().catch(() => {});
                } else {
                    waitingMsg.edit("✅ **تم التشفير بنجاح:**\n```lua\n" + result + "\n```");
                }
            });
        }
    });

    client.login(DISCORD_TOKEN).catch(err => console.error("Discord login failed:", err));
} else {
    console.log("Environment variable 'DISCORD_TOKEN' not set. Discord bot feature is suspended.");
}
