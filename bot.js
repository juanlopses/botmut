const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, generatePairingCode, DisconnectReason } = require('@whiskeysockets/baileys');

const BOT_NUMBER = '1234567890'; // 🔹 Cambia este número por el del bot

let mutedUsers = {}; // Guarda los usuarios muteados en cada grupo

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state
    });

    // 🔹 Generar Pairing Code si es necesario
    if (!state.creds.registered) {
        console.log(`📲 Generando Pairing Code para el número: ${BOT_NUMBER}...`);
        const code = await generatePairingCode(BOT_NUMBER + '@s.whatsapp.net');
        console.log(`✅ Pairing Code generado: ${code}`);
        console.log('📌 Usa este código en WhatsApp Web para vincular el bot.');
    }

    sock.ev.on('creds.update', saveCreds);

    // 🔹 Mensaje en consola cuando el bot está conectado
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('✅ BOT CONECTADO: ¡Listo para recibir mensajes!');
        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ BOT DESCONECTADO. Razón: ${reason || 'Desconocida'}`);

            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 Intentando reconectar...');
                startBot();
            } else {
                console.log('⚠️ El bot cerró sesión. Genera un nuevo Pairing Code.');
            }
        }
    });

    // Función para verificar si un usuario es administrador
    async function isAdmin(groupJid, userJid) {
        const metadata = await sock.groupMetadata(groupJid);
        const admins = metadata.participants.filter(p => p.admin);
        return admins.some(a => a.id === userJid);
    }

    // Función para verificar si el bot es administrador
    async function isBotAdmin(groupJid) {
        const metadata = await sock.groupMetadata(groupJid);
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const admins = metadata.participants.filter(p => p.admin);
        return admins.some(a => a.id === botJid);
    }

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!text) return;

        // Si el usuario está muteado, borrar cualquier mensaje que envíe
        if (mutedUsers[from]?.includes(sender)) {
            await sock.sendMessage(from, { delete: msg.key });
            return;
        }

        // Comando /menu
        if (text.startsWith('/menu')) {
            const menuText = `📌 Comandos del bot:
            
🔹 /mute @usuario - Mutea a un usuario hasta que un admin lo desmutee.
🔹 /unmute @usuario - Desmutea a un usuario.
🔹 /listmuted - Muestra la lista de usuarios muteados en el grupo.
🔹 /unmuteall - Desmutea a todos los usuarios en el grupo.
🔹 /menu - Muestra este menú de comandos.

⚠️ Nota: Solo los administradores pueden usar estos comandos.
`;

            await sock.sendMessage(from, { text: menuText });
        }

        // Comando para listar los usuarios muteados
        if (text.startsWith('/listmuted')) {
            if (!(await isAdmin(from, sender))) {
                await sock.sendMessage(from, { text: `❌ Solo los administradores pueden usar este comando.` });
                return;
            }

            const mutedList = mutedUsers[from] || [];

            if (mutedList.length === 0) {
                await sock.sendMessage(from, { text: '✅ No hay usuarios muteados en este grupo.' });
                return;
            }

            let message = '🔇 Usuarios muteados en este grupo:\n';
            message += mutedList.map(jid => `- @${jid.split('@')[0]}`).join('\n');

            await sock.sendMessage(from, { text: message, mentions: mutedList });
        }

        // Comando para desmutear a todos en el grupo
        if (text.startsWith('/unmuteall')) {
            if (!(await isAdmin(from, sender))) {
                await sock.sendMessage(from, { text: `❌ Solo los administradores pueden usar este comando.` });
                return;
            }

            if (!mutedUsers[from] || mutedUsers[from].length === 0) {
                await sock.sendMessage(from, { text: '✅ No hay usuarios muteados en este grupo.' });
                return;
            }

            mutedUsers[from] = [];
            await sock.sendMessage(from, { text: '🔊 Todos los usuarios han sido desmuteados en este grupo!' });
        }

        // Función para procesar comandos de mute y unmute
        async function handleMuteCommand(command, action) {
            if (!msg.message.extendedTextMessage || !msg.message.extendedTextMessage.contextInfo) {
                await sock.sendMessage(from, { text: `❌ Debes mencionar a un usuario para ${action}.` });
                return;
            }

            const mentionedJid = msg.message.extendedTextMessage.contextInfo.mentionedJid;
            if (!mentionedJid || mentionedJid.length === 0) {
                await sock.sendMessage(from, { text: `❌ Debes mencionar a un usuario para ${action}.` });
                return;
            }

            if (!(await isBotAdmin(from))) {
                await sock.sendMessage(from, { text: `❌ No puedo ${action}. ¡Hazme administrador!` });
                return;
            }

            if (!(await isAdmin(from, sender))) {
                await sock.sendMessage(from, { text: `❌ Solo los administradores pueden usar este comando.` });
                return;
            }

            const userJid = mentionedJid[0];

            if (command === 'mute') {
                if (!mutedUsers[from]) mutedUsers[from] = [];
                if (!mutedUsers[from].includes(userJid)) {
                    mutedUsers[from].push(userJid);
                    await sock.sendMessage(from, { text: `🔇 ${userJid} ha sido muteado permanentemente!` });
                }
            } else if (command === 'unmute') {
                mutedUsers[from] = mutedUsers[from].filter(jid => jid !== userJid);
                await sock.sendMessage(from, { text: `🔊 ${userJid} ha sido desmuteado!` });
            }
        }

        if (text.startsWith('/mute')) {
            await handleMuteCommand('mute', 'mutear');
        } else if (text.startsWith('/unmute')) {
            await handleMuteCommand('unmute', 'desmutear');
        }
    });
}

startBot();
