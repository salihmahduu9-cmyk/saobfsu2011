// api/obfuscate.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, AttachmentBuilder, ChannelType, Partials } = require('discord.js');

// تفعيل قراءة متغيرات البيئة محلياً من ملف .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, '../')));

// دالة ذكية لتصحيح أخطاء الـ Lua الشائعة تلقائياً قبل التشفير
function autoFixLuaCode(code) {
    let fixedCode = code;
    let report = [];

    // 1. تصحيح عمليات الزيادة والنقصان والضرب والقسمة الاختصارية (مثل x += 1 تصبح x = x + 1)
    // تبحث عن نمط: اسم_المتغير += قيمة
    const operatorRegex = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*([+\-*\/])=\s*([^\n;]+)/g;
    
    if (operatorRegex.test(fixedCode)) {
        fixedCode = fixedCode.replace(operatorRegex, (match, variable, operator, value) => {
            return `${variable} = ${variable} ${operator} ${value}`;
        });
        report.push("تعديل اختصارات العمليات الحسابية القياسية (مثل `+=`, `-=`) إلى الصياغة الصحيحة");
    }

    return { fixedCode, report };
}

// دالة المعالجة المشتركة لتشغيل محرك Hercules
function runHercules(code, callback) {
    const rootDir = path.join(__dirname, '../');
    const uniqueId = Date.now();
    const tempInputPath = path.join(rootDir, `temp_${uniqueId}.lua`);
    const expectedOutputPath = path.join(rootDir, `temp_${uniqueId}_obfuscated.lua`);

    fs.writeFile(tempInputPath, code, 'utf8', (err) => {
        if (err) return callback(err, null);

        const herculesPath = path.join(rootDir, 'hercules.lua');
        const luaCommand = process.platform === "win32" ? "lua" : "lua5.1";
        
        exec(`${luaCommand} "${herculesPath}" "${tempInputPath}"`, { cwd: rootDir }, (execErr, stdout, stderr) => {
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);

            if (execErr) {
                if (fs.existsSync(expectedOutputPath)) fs.unlinkSync(expectedOutputPath);
                return callback(stderr || execErr.message, null);
            }

            if (!fs.existsSync(expectedOutputPath)) {
                return callback("Output file not found by engine", null);
            }

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

// 🤖 [بوت الديسكورد] تشغيل وإصلاح قنوات الخاص ودعم الأوامر المحدثة
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (DISCORD_TOKEN) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        partials: [Partials.Channel, Partials.Message, Partials.User] 
    });

    client.once('ready', () => {
        console.log(`Discord Bot initialized. Logged in as ${client.user.tag}`);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const isObfCommand = message.content.startsWith('!obf');
        const isRealCommand = message.content.startsWith('!real');

        // إذا كانت الرسالة تبدأ بأحد الأمرين
        if (isObfCommand || isRealCommand) {
            
            // 🔒 حماية السيرفرات العامة
            if (message.channel.type !== ChannelType.DM) {
                if (message.deletable) await message.delete().catch(() => {});
                
                return message.reply("❌ أمن الكود أولاً!* لأسباب أمنية، أوامر التشفير والتصحيح تشتغل في **الخاص فقط**. أرسل ملفك أو كودك عبر البوت في رسالة خاصة مباشرة.")
                    .then(msg => {
                        setTimeout(() => msg.delete().catch(() => {}), 7000);
                    }).catch(() => {});
            }

            let codeToObfuscate = "";
            const cmdLength = isObfCommand ? 4 : 5; // تحديد طول الكلمة لقصها بشكل صحيح

            // 1. جلب الكود من الملفات المرفقة
            if (message.attachments.size > 0) {
                const file = message.attachments.first();
                const fileExt = path.extname(file.name).toLowerCase();

                if (fileExt === '.lua' || fileExt === '.txt') {
                    try {
                        const response = await fetch(file.url);
                        codeToObfuscate = await response.text();
                    } catch (fetchErr) {
                        return message.reply("❌ فشل في تحميل وقراءة الملف المرفق.");
                    }
                } else {
                    return message.reply("❌ صيغة الملف غير مدعومة! يرجى رفع ملف بصيغة `.lua` أو `.txt` فقط.");
                }
            } else {
                // 2. جلب الكود من النص المكتوب
                codeToObfuscate = message.content.slice(cmdLength).trim();
            }
            
            if (!codeToObfuscate) {
                return message.reply(`❌ يرجى إدخال الكود أو رفع ملف بصيغة txt / lua مع الأمر! أمثلة:\n• \`!obf print("Hello")\`\n• \`!real x += 1\` (للتصحيح والتشفير التلقائي)`);
            }

            let finalReportMessage = "";

            // ✨ إذا استخدم المطور أمر !real السحري
            if (isRealCommand) {
                const fixResult = autoFixLuaCode(codeToObfuscate);
                codeToObfuscate = fixResult.fixedCode;
                
                if (fixResult.report.length > 0) {
                    finalReportMessage = "🛠️ ** التصحيح التلقائي:**\n" + fixResult.report.map(r => `• ${r}`).join('\n') + "\n\n";
                } else {
                    finalReportMessage = "✨ تم فحص الكود ولم يتم العثور على أخطاء جاري التشفير مباشرة...\n\n";
                }
            }

            const waitingMsg = await message.reply('⏳ جاري تشفير الكود الخاص بك عبر  SA | OBFUSACTOR ...');

            // تشغيل محرك التشفير
            runHercules(codeToObfuscate, async (err, result) => {
                if (err) {
                    return waitingMsg.edit(`❌ فشل التشفير بسبب خطأ استخدم امر !real`);
                }

                const responseText = finalReportMessage + "✅ **تم التشفير بنجاح!**";

                if (result.length > 1900 || message.attachments.size > 0) {
                    const attachment = new AttachmentBuilder(Buffer.from(result), { name: 'obfuscated_hercules.lua' });
                    await message.reply({ content: responseText, files: [attachment] });
                    waitingMsg.delete().catch(() => {});
                } else {
                    waitingMsg.edit(`${responseText}\n\`\`\`lua\n${result}\n\`\`\``);
                }
            });
        }
    });

    client.login(DISCORD_TOKEN).catch(err => console.error("Discord login failed:", err));
} else {
    console.log("Environment variable 'DISCORD_TOKEN' not set. Discord bot feature is suspended.");
}
