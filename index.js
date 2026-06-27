const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');

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

// ---------------- SHEETS ----------------

async function getDoc() {
    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth({
        client_email: creds.client_email,
        private_key: creds.private_key.replace(/\\n/g, '\n')
    });

    await doc.loadInfo();
    return doc;
}

// ---------------- ADD SUBMISSION ----------------

async function addSubmission(username, userId, taskName) {
    try {
        const doc = await getDoc();

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

        console.log("✅ Added:", username, taskName);

    } catch (err) {
        console.error("❌ Sheet error:", err.message);
    }
}

// ---------------- APPROVAL CACHE (PREVENT DUPLICATES) ----------------

const processedMessages = new Set();

// ---------------- APPROVAL FUNCTION ----------------

async function approveMessage(message) {
    if (!message) return;
    if (processedMessages.has(message.id)) return;

    processedMessages.add(message.id);

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

// ---------------- LEADERBOARD ----------------

async function updateLeaderboardMessage() {
    if (updating) return;
    updating = true;

    try {
        const doc = await getDoc();

        const sheet = doc.sheetsByTitle["SUBMISSIONS"];
        const rows = await sheet.getRows();

        const scores = {};

        for (const r of rows) {
            const user = r.USERNAME;
            const task = (r.TASK || "").toLowerCase().trim();

            if (!scores[user]) scores[user] = 0;

            // simple karma = 1 per approved submission (safe fallback)
            scores[user] += 1;
        }

        const leaderboard = Object.entries(scores)
            .sort((a, b) => b[1] - a[1]);

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
        console.error("Leaderboard error:", err.message);
    }

    updating = false;
}

// ---------------- MESSAGE CHECK (NO KARMA HERE) ----------------

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== SUBMISSION_CHANNEL_ID) return;

    const match = message.content.trim().match(/^#([a-zA-Z0-9-_]+)/);
    if (!match) return;

    const hasAttachment = message.attachments.size > 0;
    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);

    if (!hasAttachment && !hasLink) return;

    console.log("📩 Submission detected:", message.author.username);
});

// ---------------- REACTION APPROVAL ----------------

client.on('messageReactionAdd', async (reaction, user) => {
    try {
        if (user.bot) return;

        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const emoji = reaction.emoji.name;

        if (emoji !== "🟩") return;

        console.log("🟩 Reaction detected");

        await approveMessage(reaction.message);

    } catch (err) {
        console.error("Reaction error:", err.message);
    }
});

// ---------------- LOAD EXISTING APPROVALS ON START ----------------

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(SUBMISSION_CHANNEL_ID);
        const messages = await channel.messages.fetch({ limit: 50 });

        for (const [, message] of messages) {
            const hasGreen = message.reactions.cache.some(r => r.emoji.name === "🟩");

            if (hasGreen) {
                await approveMessage(message);
            }
        }

        await updateLeaderboardMessage();

    } catch (err) {
        console.error("Startup scan error:", err.message);
    }
});

client.login(BOT_TOKEN);
