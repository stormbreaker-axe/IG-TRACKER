const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json');

console.log('Bot starting...');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const SUBMISSION_CHANNEL_ID = '1510313290813669557';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('clientReady',async () => {
    console.log(`Logged in as ${client.user.tag}`);

    await importOldMessages();
});
async function importOldMessages() {

    const channel = await client.channels.fetch(SUBMISSION_CHANNEL_ID);

    let lastId;
    let totalImported = 0;

    while (true) {

        const options = { limit: 100 };

        if (lastId) {
            options.before = lastId;
        }

        const messages = await channel.messages.fetch(options);

        if (messages.size === 0) break;

        for (const [, message] of messages) {

    if (message.author.bot) continue;

    const match = message.content.match(/^#([a-zA-Z0-9-_]+)/);

    if (!match) continue;

    const taskName = match[1];

const member = await message.guild.members
    .fetch(message.author.id)
    .catch(() => null);

console.log("Username:", message.author.username);
console.log("Display Name:", member?.displayName);

const displayName =
    member?.displayName || message.author.username;

console.log(`Importing: ${displayName} - ${taskName}`);

await addSubmission(
    displayName,
    taskName
);

    totalImported++;
}

        lastId = messages.last().id;

        console.log(`Imported ${totalImported} messages...`);
    }

    console.log(`Finished! Imported ${totalImported} submissions.`);
}

async function addSubmission(username, taskName) {

    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];

    await sheet.addRow({
        USERNAME: username,
        TASK: taskName,
        SUBMITTED: 'Yes',
        DATE: new Date().toLocaleDateString()
    });

    console.log(`Added row for ${username}`);
}

client.on('messageCreate', async (message) => {

    console.log('Message detected:', message.content);

    if (message.author.bot) return;

    if (message.channel.id !== SUBMISSION_CHANNEL_ID) return;

    const match = message.content.trim().match(/^#([a-zA-Z0-9-_]+)/);

    if (!match) return;

    const taskName = match[1];

    const hasAttachment = message.attachments.size > 0;

    const hasLink = /(https?:\/\/[^\s]+)/i.test(message.content);

console.log("Has Link:", hasLink);

if (!hasAttachment && !hasLink) {
    console.log('No proof found');
    return;
}

    try {

        await addSubmission(
            message.member.displayName,
            taskName
        );

        console.log(
            `${message.member.displayName} submitted ${taskName}`
        );

    } catch (error) {
        console.error('Error:', error);
    }
});

client.login(BOT_TOKEN);