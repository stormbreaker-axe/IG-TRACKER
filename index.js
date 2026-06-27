const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const CLIENT_ID = process.env.CLIENT_ID;

// Google credentials from Railway env
const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// ================= CHANNELS =================
const SUBMISSION_CHANNEL_ID = '1510313290813669557';
const LEADERBOARD_CHANNEL_ID = '1520372426754490539';

// ================= CLIENT =================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

console.log("Bot starting...");

// ================= GOOGLE SHEET =================
const doc = new GoogleSpreadsheet(SHEET_ID);

async function initGoogle() {
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
}

// ================= LEADERBOARD CACHE =================
let leaderboardMessageId = null;
async function importOldMessages() {
    const channel = await client.channels.fetch(SUBMISSION_CHANNEL_ID);

    let lastId;
    let totalImported = 0;

    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle["SUBMISSIONS"];

    if (!sheet) {
        throw new Error("SUBMISSIONS sheet not found");
    }

    while (true) {
        const options = { limit: 100 };

        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options);

        if (messages.size === 0) break;

        for (const [, message] of messages) {

            if (message.author.bot) continue;

            const match = message.content.match(/^#([a-zA-Z0-9-_]+)/);
            if (!match) continue;

            const taskName = match[1];

            const hasAttachment = message.attachments.size > 0;
            const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);

            if (!hasAttachment && !hasLink) continue;

            const member = await message.guild.members
    .fetch(message.author.id)
    .catch(() => null);

const displayName =
    member?.displayName || message.author.username;

            await sheet.addRow({
                USERNAME: displayName,
                TASK: taskName,
                DATE: message.createdAt.toLocaleDateString()
            });

            console.log(`Imported: ${displayName} - ${taskName}`);
            totalImported++;
        }

        lastId = messages.last().id;
        console.log(`Imported so far: ${totalImported}`);
    }

    console.log(`DONE importing ${totalImported} messages`);
}
// ================= GET LEADERBOARD =================
async function getLeaderboard() {
    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const submissionSheet = doc.sheetsByTitle["SUBMISSIONS"];
    const ruleSheet = doc.sheetsByTitle["TASK_KARMA"];

    const submissions = await submissionSheet.getRows();
    const rules = await ruleSheet.getRows();

    console.log("RULE COUNT:", rules.length);
    console.log("SUB COUNT:", submissions.length);

    // build karma map (NORMALIZED)
    const karmaMap = {};

    for (const r of rules) {
        if (!r.HASHTAG) continue;

        const key = r.HASHTAG.toString().trim().toLowerCase();
        const value = Number(r.KARMA) || 0;

        karmaMap[key] = value;
    }

    console.log("KARMA MAP:", karmaMap);

    const scores = {};

    for (const s of submissions) {
        const user = s.USERNAME;
        if (!user) continue;

        const task = (s.TASK || "").toString().trim().toLowerCase();

        const karma = karmaMap[task] || 0;

        if (!scores[user]) scores[user] = 0;
        scores[user] += karma;
    }

    console.log("SCORES:", scores);

    return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}
// ================= UPDATE LEADERBOARD MESSAGE =================
async function updateLeaderboardMessage() {
    if (updatingLeaderboard) return;

    updatingLeaderboard = true;

    try {
        const leaderboard = await getLeaderboard();

        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);

        let text = "🏆 **LIVE KARMA LEADERBOARD** 🏆\n\n";

        leaderboard.forEach(([user, score], i) => {
            text += `**#${i + 1}** ${user} — ${score} karma\n`;
        });

        if (!leaderboardMessageId) {
            const msg = await channel.send(text);
            leaderboardMessageId = msg.id;
        } else {
            const msg = await channel.messages.fetch(leaderboardMessageId);
            await msg.edit(text);
        }

        console.log("Leaderboard updated");

    } catch (err) {
        console.error(err);
    }

    updatingLeaderboard = false;
}
// ================= ADD SUBMISSION =================
async function addSubmission(username, taskName) {
    const sheet = doc.sheetsByTitle["SUBMISSIONS"];

    await sheet.addRow({
        USERNAME: username,
        TASK: taskName,
        SUBMITTED: "Yes",
        DATE: new Date().toLocaleDateString()
    });

    console.log(`Submission saved: ${username} - ${taskName}`);

}


// ================= MESSAGE HANDLER =================
client.on('messageCreate', async (message) => {

    if (message.author.bot) return;

    if (message.channel.id !== SUBMISSION_CHANNEL_ID) return;

    const match = message.content.trim().match(/^#([a-zA-Z0-9-_]+)/);
    if (!match) return;

    const taskName = match[1];

    const hasAttachment = message.attachments.size > 0;
    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);

    if (!hasAttachment && !hasLink) return;

    try {
        const member = await message.guild.members
    .fetch(message.author.id)
    .catch(() => null);

const displayName =
    member?.displayName || message.author.username;

await addSubmission(displayName, taskName);

        console.log(`${displayName} submitted ${taskName}`);

        // ✅ THIS IS CORRECT PLACE
        await updateLeaderboardMessage();

    } catch (error) {
        console.error('Error:', error);
    }
});

// ================= SLASH COMMAND =================
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        {
            body: [
                {
                    name: 'leaderboard',
                    description: 'Show karma leaderboard'
                }
            ]
        }
    );

    console.log("Slash commands registered");
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'leaderboard') {
        const leaderboard = await getLeaderboard();

        let text = "🏆 **KARMA LEADERBOARD** 🏆\n\n";

        leaderboard.slice(0, 10).forEach(([user, score], i) => {
            text += `**#${i + 1}** ${user} — ${score} karma\n`;
        });

        await interaction.reply({ content: text });
    }
});

// ================= START =================
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    await initGoogle();
    await importOldMessages();
    await registerCommands();

    // first update immediately
    await updateLeaderboardMessage();

    // update every 1 hour
    setInterval(updateLeaderboardMessage, 60 * 60 * 1000);
});

client.login(BOT_TOKEN);
