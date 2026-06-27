const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const approvedMessages = new Set();

const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID;

const SUBMISSION_CHANNEL_ID = '1510313290813669557';
const LEADERBOARD_CHANNEL_ID = '1520372426754490539';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

let leaderboardMessageId = null;
let updating = false;
async function approveMessage(message) {

    if (approvedMessages.has(message.id)) return;
    approvedMessages.add(message.id);

    const match = message.content.trim().match(/^#([a-zA-Z0-9-_]+)/);
    if (!match) return;

    const taskName = match[1];

    const hasAttachment = message.attachments.size > 0;
    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);

    if (!hasAttachment && !hasLink) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);

    const displayName =
        member?.displayName || message.author.username;

    await addSubmission(displayName, message.author.id, taskName);

    console.log("🟩 APPROVED:", displayName, taskName);

    await updateLeaderboardMessage();
}

// ---------------- GOOGLE SHEETS ----------------

async function loadDoc() {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    return doc;
}

// ---------------- SUBMISSION STORAGE ----------------

async function addSubmission(username, userId, taskName) {
    try {
        const doc = new GoogleSpreadsheet(SHEET_ID);

        await doc.useServiceAccountAuth({
            client_email: creds.client_email,
            private_key: creds.private_key.replace(/\\n/g, '\n')
        });

        await doc.loadInfo();

        const sheet = doc.sheetsByTitle["SUBMISSIONS"];

        if (!sheet) {
            console.error("❌ SUBMISSIONS sheet not found");
            return;
        }

        await sheet.addRow({
            USER_ID: userId,
            USERNAME: username,
            TASK: taskName,
            DATE: new Date().toLocaleDateString()
        });

        console.log("✅ SHEET UPDATED");

    } catch (err) {
        console.error("❌ GOOGLE SHEETS ERROR:", err.response?.data || err.message || err);
    }
}

// ---------------- LEADERBOARD LOGIC ----------------

async function getLeaderboard() {
    const doc = await loadDoc();

    const subSheet = doc.sheetsByTitle["SUBMISSIONS"];
    const karmaSheet = doc.sheetsByTitle["TASK_KARMA"];

    const submissions = await subSheet.getRows();
    const rules = await karmaSheet.getRows();

    // build karma map
    const karmaMap = {};
    for (const r of rules) {
        if (!r.HASHTAG) continue;
        karmaMap[r.HASHTAG.toLowerCase().trim()] = Number(r.KARMA) || 0;
    }

    const scores = {};

    for (const s of submissions) {
        const user = s.USERNAME;
        const task = (s.TASK || "").toLowerCase().trim();

        const karma = karmaMap[task] || 0;

        if (!scores[user]) scores[user] = 0;
        scores[user] += karma;
    }

    return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

// ---------------- LEADERBOARD UPDATE ----------------

async function updateLeaderboardMessage() {
    if (updating) return;
    updating = true;

    try {
        const leaderboard = await getLeaderboard();
        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);

        let text = "🏆 **LIVE KARMA LEADERBOARD** 🏆\n\n";

        leaderboard.slice(0, 15).forEach(([user, score], i) => {
            text += `**#${i + 1}** ${user} — ${score} karma\n`;
        });

        if (!leaderboardMessageId) {
            const msg = await channel.send(text);
            leaderboardMessageId = msg.id;
        } else {
            const msg = await channel.messages.fetch(leaderboardMessageId);
            await msg.edit(text);
        }

    } catch (err) {
        console.error("Leaderboard error:", err);
    }

    updating = false;
}

// ---------------- MESSAGE DETECTION (NO KARMA HERE) ----------------

client.on('messageCreate', async (message) => {

    if (message.author.bot) return;
    if (message.channel.id !== SUBMISSION_CHANNEL_ID) return;

    const match = message.content.trim().match(/^#([a-zA-Z0-9-_]+)/);
    if (!match) return;

    const hasAttachment = message.attachments.size > 0;
    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);

    if (!hasAttachment && !hasLink) return;

    console.log("🕒 Pending submission:", message.author.username);
});

// ---------------- APPROVAL SYSTEM ----------------

client.on('messageReactionAdd', async (reaction, user) => {

    if (user.bot) return;

    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const emoji = reaction.emoji.name;

    if (emoji !== "🟩") return;

    console.log("🟩 Reaction detected");

    await approveMessage(reaction.message);
});
// ---------------- STARTUP ----------------

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const channel = await client.channels.fetch(SUBMISSION_CHANNEL_ID);

    let lastId;

    while (true) {
        const options = { limit: 50 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options);
        if (!messages.size) break;

        for (const [, message] of messages) {

            try {
                await message.fetch();

                const hasGreen = message.reactions.cache.some(r => r.emoji.name === "🟩");

                if (hasGreen) {
                    await approveMessage(message);
                }

            } catch (err) {
                console.log("Skip message error:", err.message);
            }
        }

        lastId = messages.last().id;
    }

    await updateLeaderboardMessage();
});

client.login(BOT_TOKEN);
