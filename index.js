import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import readline from 'readline';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (text) => new Promise((resolve) => rl.question(text, resolve));

const PREFIX = '!';

const codexQuestions = [
  { q: "Man darf als Andenken keine Souvenirs aus Lost Places mitnehmen.", a: "true" },
  { q: "Man sollte niemals genaue Koordinaten öffentlich im Internet teilen.", a: "true" },
  { q: "Wenn ein Gebäude verschlossen ist, darf man eine Tür aufhebeln, um hineinzukommen.", a: "false" },
  { q: "Hinterlasse alles außer deine Fußspuren. Nimm nichts mit außer alle Bilder im Lostplace.", a: "false" },
  { q: "Im Lostplace gibts noch Strom. Du testest ein Licht und lässt es an, wenn du den Ort verlässt, damit der Nächste besser erkunden kann.", a: "false" }
];

const codexSessions = new Map();

async function startBot() {
  let pairingCodeRequested = false;
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`Baileys Version: ${version.join('.')} (Neueste Version: ${isLatest})`);

  let usePairingCode = false;
  let targetPhoneNumber = '';

  if (!state.creds.registered) {
    console.log('\n--- LostTrace - Zarven Bot Authentifizierung ---');
    console.log('1. QR-Code scannen');
    console.log('2. Pairing-Code anfordern');
    const authChoice = await askQuestion('Wähle eine Methode (1 oder 2): ');

    if (authChoice.trim() === '2') {
      usePairingCode = true;
      const rawNumber = await askQuestion('Telefonnummer mit Landesvorwahl eingeben (z.B. 491701234567): ');
      targetPhoneNumber = rawNumber.replace(/[^0-9]/g, '');
    }
  }

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    generateHighQualityLinkPreview: true
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (usePairingCode) {
        if (!pairingCodeRequested) {
          pairingCodeRequested = true;
          try {
            const pairingCode = await sock.requestPairingCode(targetPhoneNumber);
            console.log('\n======================================');
            console.log(`DEIN PAIRING-CODE: ${pairingCode}`);
            console.log('Gib diesen Code in WhatsApp unter "Verknüpfte Geräte" -> "Mit Telefonnummer verknüpfen" ein.');
            console.log('======================================\n');
          } catch (error) {
            console.error('Fehler beim Abrufen des Pairing-Codes:', error);
          }
        }
      } else {
        console.log('\nScanne diesen QR-Code mit WhatsApp:');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Verbindung geschlossen. Grund-Code: ${statusCode}. Neuverbindung: ${shouldReconnect}`);

      if (shouldReconnect) {
        startBot();
      } else {
        console.log('Session wurde abgemeldet. Bitte auth_info_baileys löschen und neu starten.');
      }
    } else if (connection === 'open') {
      console.log('\n[ONLINE] LostTrace - Zarven Bot erfolgreich verbunden!\n');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      
      let sender = msg.key.participant || msg.key.remoteJid;
      if (msg.key.fromMe) {
        sender = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
      }

      if (!sender) continue;

      const m = msg.message;
      const incomingText = m.conversation || 
                           m.extendedTextMessage?.text || 
                           m.ephemeralMessage?.message?.extendedTextMessage?.text || 
                           m.ephemeralMessage?.message?.conversation || 
                           '';
      
      if (!incomingText.startsWith(PREFIX)) continue;

      const pushName = msg.pushName || (msg.key.fromMe ? 'Du (Host)' : 'Unbekannt');
      const senderNumber = sender.split('@')[0];
      const timestamp = new Date((msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toLocaleString('de-DE');

      console.log(`\n[BEFEHL EMPFANGEN]`);
      console.log(`Zeit: ${timestamp}`);
      console.log(`Name: ${pushName}`);
      console.log(`Nummer: ${senderNumber}`);
      console.log(`JID/LID: ${sender}`);
      console.log(`Gruppe: ${isGroup ? remoteJid : 'Privatchat'}`);
      console.log(`Befehl: ${incomingText}\n`);

      const fullCommand = incomingText.slice(PREFIX.length).trim();
      const args = fullCommand.split(' ');
      const command = args[0].toLowerCase();

      if (command === 'menu') {
        const text = `*🏚 LostTrace - Zarven Bot Menü 🫡*\n\n` +
          `*${PREFIX}menu* - Zeigt dieses Menü an\n` +
          `*${PREFIX}codex* - Startet die Kodex Prüfung\n` +
          `*${PREFIX}lostplace* - Sendet ein zufälliges Bild\n` +
          `*${PREFIX}map* - Sendet die KML Karte\n` +
          `*${PREFIX}jid* - Zeigt deine JID an\n` +
          `*${PREFIX}lid* - Zeigt deine LID an\n` +
          `*${PREFIX}all [Text]* - Markiert alle in der Gruppe`;
        await sock.sendMessage(remoteJid, { text }, { quoted: msg });
      } 
      else if (command === 'jid') {
        await sock.sendMessage(remoteJid, { text: `Deine JID lautet: ${sender}` }, { quoted: msg });
      }
      else if (command === 'lid') {
        await sock.sendMessage(remoteJid, { text: `Deine LID lautet: ${sender}` }, { quoted: msg });
      }
      else if (command === 'codex') {
        if (args[1] === 'answer' && args.length >= 3) {
          const userAnswer = args[2].toLowerCase();
          const correctAnswer = codexSessions.get(remoteJid);

          if (!correctAnswer) {
            await sock.sendMessage(remoteJid, { text: `Es läuft gerade keine Kodex-Prüfung. Starte eine mit *${PREFIX}codex*.` }, { quoted: msg });
          } else if (userAnswer === correctAnswer) {
            await sock.sendMessage(remoteJid, { text: "Richtig! Du kennst den Urbex-Kodex." }, { quoted: msg });
            codexSessions.delete(remoteJid);
          } else if (userAnswer === 'true' || userAnswer === 'false') {
            await sock.sendMessage(remoteJid, { text: "Falsch! Das entspricht nicht den Regeln des Urbexens." }, { quoted: msg });
            codexSessions.delete(remoteJid);
          } else {
            await sock.sendMessage(remoteJid, { text: `Bitte antworte exakt mit *${PREFIX}codex answer true* oder *${PREFIX}codex answer false*.` }, { quoted: msg });
          }
        } else {
          const randomIndex = Math.floor(Math.random() * codexQuestions.length);
          const questionObj = codexQuestions[randomIndex];
          codexSessions.set(remoteJid, questionObj.a);
          
          const text = `*LostTrace | Kodex Prüfung*\n\nBeantworte die folgende Aussage mit *${PREFIX}codex answer true* oder *${PREFIX}codex answer false*:\n\n"${questionObj.q}"`;
          await sock.sendMessage(remoteJid, { text }, { quoted: msg });
        }
      }
      else if (command === 'lostplace') {
        const imagesPath = path.join(__dirname, 'assets', 'images');
        
        if (fs.existsSync(imagesPath)) {
          const files = fs.readdirSync(imagesPath).filter(file => 
            file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
          );

          if (files.length > 0) {
            const randomFile = files[Math.floor(Math.random() * files.length)];
            const imagePath = path.join(imagesPath, randomFile);
            
            await sock.sendMessage(remoteJid, { 
              image: fs.readFileSync(imagePath), 
              caption: "*🏚 LostTrace | Random Lost Place 🫡*" 
            }, { quoted: msg });
          } else {
            await sock.sendMessage(remoteJid, { text: "Es sind derzeit keine Bilder vorhanden. _Error: Folder is empty._" }, { quoted: msg });
          }
        } else {
          await sock.sendMessage(remoteJid, { text: "Ein internes Problem ist aufgetreten. Bitte versuche es Später erneut. _Error: Folder does not exist._" }, { quoted: msg });
        }
      }
      else if (command === 'map') {
        const mapPath = path.join(__dirname, 'assets', 'maps', 'LostTraceMap.kml');
        let mentions = [];

        if (isGroup) {
          const groupMetadata = await sock.groupMetadata(remoteJid);
          mentions = groupMetadata.participants.map(p => p.id);
        }

        if (fs.existsSync(mapPath)) {
          await sock.sendMessage(remoteJid, { 
            document: fs.readFileSync(mapPath), 
            mimetype: 'application/vnd.google-earth.kml+xml', 
            fileName: 'LostTraceMap.kml',
            caption: "*🏚 LostTrace | Exklusive Urbex Karte 🗺*\n\nHier ist die aktuelle KML-Datei. Diese kannst du ganz einfach mit Google Maps öffnen. *Die Weiterleitung an Dritte, Freunde oder die Veröffentlichung ist nicht gestattet.* Nur für Mitglieder von der Gruppe!",
            mentions: mentions
          }, { quoted: msg });
        } else {
          await sock.sendMessage(remoteJid, { text: "Die Datei assets/maps/LostTraceMap.kml wurde nicht gefunden." }, { quoted: msg });
        }
      }
      else if (command === 'all') {
        const textToSend = args.slice(1).join(' ');
        let mentions = [];

        if (isGroup) {
          const groupMetadata = await sock.groupMetadata(remoteJid);
          mentions = groupMetadata.participants.map(p => p.id);
        }

        await sock.sendMessage(remoteJid, { 
          text: textToSend, 
          mentions: mentions 
        });
      }
    }
  });
}

startBot();
