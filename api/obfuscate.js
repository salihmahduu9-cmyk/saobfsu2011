// api/obfuscate.js
// 🛡️ Powered by: SA | OBFUSCATOR 🛡️
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

// مسار ملف حفظ الإحصائيات والاشتراكات لضمان عدم تصفير البيانات
const statsPath = path.join(__dirname, '../stats.json');

// دالة لجلب البيانات والإحصائيات الحالية
function getStats() {
    if (!fs.existsSync(statsPath)) {
        return { totalObfuscations: 0, uniqueUsers: [], dailyLimits: {}, vips: {} };
    }
    try {
        const data = fs.readFileSync(statsPath, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.dailyLimits) parsed.dailyLimits = {};
        if (!parsed.vips) parsed.vips = {};
        return parsed;
    } catch (e) {
        return { totalObfuscations: 0, uniqueUsers: [], dailyLimits: {}, vips: {} };
    }
}

// دالة لتحديث وحفظ البيانات
function saveStats(stats) {
    try {
        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.error("Failed to save stats:", e);
    }
}

// دالة للتحقق من حالة اشتراك المستخدم وصلاحيته
function checkUserStatus(userId) {
    const stats = getStats();
    const today = new Date().toISOString().split('T')[0]; // جلب تاريخ اليوم الحالي YYYY-MM-DD

    // 1. التحقق من اشتراك الـ VIP
    if (stats.vips && stats.vips[userId]) {
        const expiryDate = stats.vips[userId]; // صيغته المتوقعة YYYY-MM-DD
        if (new Date(today) <= new Date(expiryDate)) {
            return { isVip: true, expiry: expiryDate };
        } else {
            // إذا انتهى تاريخ الاشتراك، نقوم بحذفه تلقائياً
            delete stats.vips[userId];
            saveStats(stats);
        }
    }

    // 2. إذا كان مستخدماً مجانياً، نحسب عدد محاولاته اليوم
    if (!stats.dailyLimits[today]) {
        stats.dailyLimits[today] = {};
    }
    const userCount = stats.dailyLimits[today][userId] || 0;

    return { isVip: false, usedToday: userCount, remaining: Math.max(0, 2 - userCount) };
}

// دالة ذكية لتصحيح أخطاء الـ Lua الشائعة تلقائياً قبل التشفير
function autoFixLuaCode(code) {
    let fixedCode = code;
    let report = [];

    const operatorRegex = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*([+\-*\/])=\s*([^\n;]+)/g;
    
    if (operatorRegex.test(fixedCode)) {
        fixedCode = fixedCode.replace(operatorRegex, (match, variable, operator, value) => {
            return `${variable} = ${variable} ${operator} ${value}`;
        });
        report.push("تم تحويل اختصارات العمليات الحسابية (مثل `+=`, `-=`) إلى الصياغة الصحيحة ✨");
    }

    return { fixedCode, report };
}

// دالة المعالجة المشتركة لتشغيل محرك Hercules مع التعديل المطلوب لعمل مسافة داخل الملف المشفر
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
                
                // ✨ [تعديل التباعد بداخل الملف المشفر]:
                let formattedResult = obfuscatedResult;
                if (formattedResult.startsWith("--")) {
                    const firstLineEnd = formattedResult.indexOf('\n');
                    if (firstLineEnd !== -1) {
                        const header = formattedResult.substring(0, firstLineEnd);
                        const restOfCode = formattedResult.substring(firstLineEnd).trim();
                        formattedResult = `${header}\n\n\n${restOfCode}`;
                    } else {
                        formattedResult = formattedResult.replace("--تم التشفير والحماية بواسطة SA | ALONE", "--تم التشفير والحماية بواسطة SA | ALONE\n\n\n");
                    }
                }
                
                callback(null, formattedResult);
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
    console.log(`==================================================`);
    console.log(`🌐 [SA | OBFUSCATOR] Web Server Active on Port ${PORT}`);
    console.log(`==================================================`);
});

// 🤖 [بوت الديسكورد] تشغيل وإصلاح قنوات الخاص بدلع واحترافية عالية
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (DISCORD_TOKEN) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GatewayIntentBits || GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        partials: [Partials.Channel, Partials.Message, Partials.User] 
    });

    client.once('ready', () => {
        console.log(`🤖 [SA | OBFUSCATOR] Bot Identity Initialized!`);
        console.log(`Logged in as: ${client.user.tag}`);
        console.log(`==================================================`);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const isObfCommand = message.content.startsWith('!obf');
        const isRealCommand = message.content.startsWith('!real');
        const isResCommand = message.content.startsWith('!res');

        // 📊 [أمر الإحصائيات الجديد !res]
        if (isResCommand) {
            if (message.channel.type !== ChannelType.DM) {
                if (message.deletable) await message.delete().catch(() => {});
                return message.reply("⚠️ الأوامر تعمل في **الخاص فقط** لحماية خصوصية بياناتك.").then(msg => {
                    setTimeout(() => msg.delete().catch(() => {}), 5000);
                }).catch(() => {});
            }

            const stats = getStats();
            const userStatus = checkUserStatus(message.author.id);
            
            let statusText = "";
            if (userStatus.isVip) {
                statusText = `👑 **حالة الحساب:** \`VIP (مشترك)\`\n> 📆 **تاريخ انتهاء الاشتراك:** \`${userStatus.expiry}\``;
            } else {
                statusText = `📝 **حالة الحساب:** \`مجاني\`\n> 🔄 **المحاولات المتبقية لك اليوم:** \`${userStatus.remaining} / 2\``;
            }

            return message.reply(`📊 **إحصائيات منصة SA | OBFUSCATOR:**\n\n> 💎 **إجمالي عمليات التشفير الناجحة للمنصة:** \`${stats.totalObfuscations}\` مرة.\n> 👥 **عدد المستخدمين الفريدين للبوت:** \`${stats.uniqueUsers.length}\` مستخدم.\n\n${statusText}\n\n✨ فخورين بتقديم أفضل حماية لأكوادكم!`);
        }

        if (isObfCommand || isRealCommand) {
            
            // 🔒 حماية السيرفرات العامة وحذف الرسالة فوراً لحماية أمن المطورين
            if (message.channel.type !== ChannelType.DM) {
                if (message.deletable) await message.delete().catch(() => {});
                
                return message.reply("⚠️ **أمن كودك أولاً!**\nلحماية مشروعك وأكوادك البرمجية، أوامر التشفير تعمل في **الشات الخاص بالبوت فقط** 🛡️.\n> أرسل ملفك أو كودك هنا مباشرة في الخاص.")
                    .then(msg => {
                        setTimeout(() => msg.delete().catch(() => {}), 7000);
                    }).catch(() => {});
            }

            // 💳 [فحص الصلاحية والاشتراك قبل البدء بالتشفير]
            const userStatus = checkUserStatus(message.author.id);
            if (!userStatus.isVip && userStatus.remaining <= 0) {
                return message.reply("❌ **خطأ:** لقد استهلكت حدّك المجاني المسموح به اليوم وهو **(تشفيرين باليوم)**.\n\n👑 إذا كنت تريد تشفير عدد غير محدود من السكريبتات وإلغاء القيود، يرجى الاشتراك معنا .\n📢 تواصل مع الإدارة لتفعيل اشتراكك فوراً!");
            }

            let codeToObfuscate = "";
            const cmdLength = isObfCommand ? 4 : 5;

            // 1. جلب الكود من الملفات المرفقة
            if (message.attachments.size > 0) {
                const file = message.attachments.first();
                const fileExt = path.extname(file.name).toLowerCase();

                if (fileExt === '.lua' || fileExt === '.txt') {
                    try {
                        const response = await fetch(file.url);
                        codeToObfuscate = await response.text();
                    } catch (fetchErr) {
                        return message.reply("❌ **خطأ:** فشل في تحميل وقراءة الملف المرفق. تأكد من الملف وأعد المحاولة.");
                    }
                } else {
                    return message.reply("⚠️ **صيغة غير مدعومة:** يرجى رفع ملف بصيغة `.lua` أو `.txt` فقط لضمان سلامة التشفير.");
                }
            } else {
                // 2. جلب الكود من النص المكتوب
                codeToObfuscate = message.content.slice(cmdLength).trim();
            }
            
            if (!codeToObfuscate) {
                return message.reply(`⭐ **مرحباً بك في SA | OBFUSCATOR**`);
            }

            let finalReportMessage = "";

            // ✨ تفعيل ميزة التصحيح السحرية !real
            if (isRealCommand) {
                const fixResult = autoFixLuaCode(codeToObfuscate);
                codeToObfuscate = fixResult.fixedCode;
                
                if (fixResult.report.length > 0) {
                    finalReportMessage = "🛠️ **[ المصلح االتلقائي]:**\n" + fixResult.report.map(r => `> ${r}`).join('\n') + "\n\n";
                } else {
                    finalReportMessage = "🔍 **[تقرير الفحص]:** الكود سليم ولا يحتوي على أخطاء صياغة شائعة، جاري التشفير فوراً...\n\n";
                }
            }

            // 🌀 دلع التحميل: إرسال رسالة انتظار تفاعلية مع إيموجي متحرك
            const waitingMsg = await message.reply('⏳ **[SA | OBFUSCATOR]**\n> ⚙️ جاري معالجة الكود وتشفيره... يرجى الانتظار ثانية.');

            // تشغيل محرك التشفير الرئيسي
            runHercules(codeToObfuscate, async (err, result) => {
                if (err) {
                    return waitingMsg.edit(`❌ فشل التشفير جرب بامر !real`);
                }

                // 📈 تحديث وحفظ الإحصائيات والحد اليومي بعد نجاح التشفير
                const currentStats = getStats();
                const today = new Date().toISOString().split('T')[0];

                // زيادة العداد العام للمنصة
                currentStats.totalObfuscations += 1;
                
                // إضافة المستخدم لقائمة المستخدمين الفريدين إن لم يكن موجوداً
                if (!currentStats.uniqueUsers.includes(message.author.id)) {
                    currentStats.uniqueUsers.push(message.author.id);
                }

                // إذا كان مستخدماً مجانياً، نقوم بزيادة العداد اليومي له
                if (!userStatus.isVip) {
                    if (!currentStats.dailyLimits[today]) currentStats.dailyLimits[today] = {};
                    currentStats.dailyLimits[today][message.author.id] = (currentStats.dailyLimits[today][message.author.id] || 0) + 1;
                }

                saveStats(currentStats);

                // دمج التقارير ورابط القناة بعد الانتهاء
                const footerText = "\n\n✨ تم التشفير بنجاح بواسطة : **SA | OBFUSCATOR***\n📢 **يرجى الانضمام إلى القناة المخصصة لدعمنا:** https://discord.gg/SMDKFTttCW";
                const fullResponseText = finalReportMessage + "💎 **[SA | OBFUSCATOR] - التشفير النهائي :**\n" + footerText + "\n\n";

                // إذا كان الناتج طويلاً أو أرسل ملفاً، نعيد له الناتج كملف فخم ومنظم
                if (result.length > 1900 || message.attachments.size > 0) {
                    const attachment = new AttachmentBuilder(Buffer.from(result), { name: 'SA_OBFUSCATOR_Result.lua' });
                    await message.reply({ content: fullResponseText, files: [attachment] });
                    waitingMsg.delete().catch(() => {});
                } else {
                    // إذا كان الكود قصيراً، يظهر بداخل بوكس برميجي أنيق ومفصول بمسافات لجمالية المظهر
                    waitingMsg.edit(`${fullResponseText}\`\`\`lua\n${result}\n\`\`\``);
                }
            });
        }
    });

    client.login(DISCORD_TOKEN).catch(err => console.error("Discord login failed:", err));
} else {
    console.log("[SA | OBFUSCATOR] Environment variable 'DISCORD_TOKEN' not set. Bot feature suspended.");
}
