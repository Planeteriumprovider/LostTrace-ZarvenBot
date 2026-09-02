import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
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
const BOT_OWNERS = ['491703630216', '61890562674824@lid', '491703630216@s.whatsapp.net'];

const codexQuestions = [
  { q: "Selbst wenn ein Gebäude seit über 30 Jahren völlig verfallen ist, erlischt das Hausrecht des Eigentümers juristisch in Deutschland niemals automatisch.", a: "true" },
  { q: "Das Wegdrücken oder Abschneiden von wuchernden Ästen und Dornenhecken, um an ein Fenster zu gelangen, verstößt bereits gegen den strikten Urbex-Kodex.", a: "true" },
  { q: "Das bloße Klettern durch ein bereits sperrangelweit offenes Fenster ohne Glas gilt rechtlich bereits als vollendeter Hausfriedensbruch.", a: "true" },
  { q: "Das Einatmen von aufgewirbeltem, trockenem Taubenkot in verlassenen Dachböden kann ohne Atemschutz lebensgefährliche Lungeninfektionen verursachen.", a: "true" },
  { q: "Man darf als Andenken *keine* Souvenirs aus Lost Places mitnehmen.", a: "true" },
  { q: "Man sollte niemals genaue Koordinaten öffentlich im Internet teilen.", a: "true" },
  { q: "Wenn ein Gebäude verschlossen ist, darf man eine Tür aufhebeln, um hineinzukommen.", a: "false" },
  { q: "Hinterlasse alles außer deine Fußspuren. Nimm nichts mit außer alle Bilder die im Lostplace liegen.", a: "false" },
  { q: "Im Lostplace gibt es noch Strom. Du testest ein Licht und lässt es an, wenn du den Ort verlässt, damit der Nächste besser erkunden kann.", a: "false" },
  { q: "Das bloße Dabeihaben eines Bolzenschneiders oder Hebeleisens im Rucksack kann bei einer Kontrolle sofort als schwerer Diebstahlversuch gewertet werden, selbst wenn man nichts aufgebrochen hat.", a: "true" },
  { q: "Wenn ein geschichtsträchtiger Ort akut von Vandalismus bedroht ist, darf man historische Dokumente mitnehmen, um sie vor der Vernichtung zu bewahren.", a: "false" },
  { q: "Ein Lost Place ohne Zaun, Tor oder Verbotsschilder gilt in Deutschland automatisch als herrenlos und darf frei betreten werden.", a: "false" },
  { q: "Um Sauerstoffmangel oder giftige Gase in tiefen Schächten und Kellern rechtzeitig zu erkennen, reicht es, auf stechende Gerüche zu achten.", a: "false" },
  { q: "Eine gewöhnliche FFP2-Maske filtert gefährliche lungengängige Asbestfasern zuverlässig aus der Atemluft.", a: "false" },
  { q: "Es ist kodexkonform, Koordinaten mit fremden Explorern zu tauschen, solange man dafür einen gleichwertigen Spot im Gegenzug bekommt.", a: "false" },
  { q: "Das Schließen eines offenen Fensters, durch das Regen in ein historisches Zimmer schlägt, ist laut striktem Kodex eine erlaubte Maßnahme.", a: "false" },
  { q: "Laut Urbex-Kodex ist es eine feste Pflicht, herumliegenden Müll anderer Besucher aus dem Gebäude zu tragen und zu entsorgen.", a: "false" },
  { q: "Versteckte Markierungen mit Kreide an den Wänden sind in riesigen unterirdischen Bunkersystemen zur Orientierung kodexkonform.", a: "false" },
  { q: "Laut Kodex ist es Pflicht, vor der Veröffentlichung von Fotos jegliche Gesichter, Graffitis von Locals oder KFZ-Kennzeichen unkenntlich zu machen.", a: "true" },
  { q: "Zerbrochene alte Leuchtstoffröhren oder Quecksilberschalter in Industriebrachen können hochgiftige Dämpfe freisetzen, die geruchlos am Boden stehen bleiben.", a: "true" },
  { q: "Wenn man von einem Sicherheitsdienst oder der Polizei auf frischer Tat ertappt wird, ist Anhalten und Kooperieren laut Kodex und Eigensicherung die einzig richtige Maßnahme.", a: "true" }
];

const codexSessions = new Map();
const recentImageMessages = [];
const uploadSessions = new Map();

function parseKmlSpots(kmlText) {
  const spots = [];
  const placemarks = kmlText.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || [];

  for (const placemark of placemarks) {
    const nameMatch = placemark.match(/<name>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/name>/i);
    const title = (nameMatch ? (nameMatch[1] || nameMatch[2]) : 'Unbekannter Spot').trim();

    const descMatch = placemark.match(/<description>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/description>/i);
    let description = descMatch ? (descMatch[1] || descMatch[2]) : 'Keine Beschreibung vorhanden';
    description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const coordMatch = placemark.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    let coordinates = 'Nicht hinterlegt';
    let mapsLink = '';

    if (coordMatch) {
      const rawFirst = coordMatch[1].trim().split(/\s+/)[0];
      const parts = rawFirst.split(',');
      if (parts.length >= 2) {
        const lng = parts[0].trim();
        const lat = parts[1].trim();
        coordinates = `${lat}, ${lng}`;
        mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      }
    }

    const addrMatch = placemark.match(/<address>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/address>/i);
    const address = (addrMatch ? (addrMatch[1] || addrMatch[2]) : 'Nicht angegeben').trim();

    spots.push({
      title,
      description: description || 'Keine Beschreibung vorhanden',
      coordinates,
      address,
      mapsLink
    });
  }

  return spots;
}

async function processAndSaveImages(sock, remoteJid, imageList, replyMsg) {
  const imagesDir = path.join(__dirname, 'assets', 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  let savedCount = 0;
  for (const targetMsg of imageList) {
    try {
      const buffer = await downloadMediaMessage(
        targetMsg,
        'buffer',
        {},
        { 
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage 
        }
      );

      const fileName = `lostplace_${Date.now()}_${Math.floor(Math.random() * 100000)}.png`;
      const savePath = path.join(imagesDir, fileName);
      fs.writeFileSync(savePath, buffer);
      savedCount++;
    } catch (error) {
      console.error('Fehler beim Download:', error);
    }
  }

  if (savedCount > 0) {
    console.log(`[UPLOAD ERFOLGREICH] ${savedCount} Bilder gespeichert.`);
    await sock.sendMessage(remoteJid, { 
      text: `*Upload erfolgreich!* Es wurden *${savedCount}* Bild(er) in _assets/images/_ gespeichert.` 
    }, { quoted: replyMsg });
  } else {
    await sock.sendMessage(remoteJid, { 
      text: "Fehler beim Herunterladen der Bilder." 
    }, { quoted: replyMsg });
  }
}

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
      const unwrappedMessage = m.ephemeralMessage?.message || 
                               m.viewOnceMessage?.message || 
                               m.viewOnceMessageV2?.message || 
                               m.documentWithCaptionMessage?.message || 
                               m;
      const imageContent = unwrappedMessage.imageMessage;

      if (imageContent) {
        recentImageMessages.push({
          id: msg.key.id,
          remoteJid: remoteJid,
          timestamp: Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)),
          msg: msg
        });

        if (recentImageMessages.length > 500) {
          recentImageMessages.shift();
        }

        if (uploadSessions.has(remoteJid)) {
          const session = uploadSessions.get(remoteJid);
          session.images.push(msg);
          clearTimeout(session.timer);
          session.timer = setTimeout(async () => {
            const currentSession = uploadSessions.get(remoteJid);
            uploadSessions.delete(remoteJid);
            if (currentSession && currentSession.images.length > 0) {
              await processAndSaveImages(sock, remoteJid, currentSession.images, currentSession.triggerMsg);
            }
          }, 4000);
        }
      }

      const incomingText = unwrappedMessage.conversation || 
                           unwrappedMessage.extendedTextMessage?.text || 
                           unwrappedMessage.imageMessage?.caption || 
                           '';
      
      if (!incomingText.startsWith(PREFIX)) continue;

      const pushName = msg.pushName || (msg.key.fromMe ? 'Du (Host)' : 'Unbekannt');
      const senderNumber = sender.split('@')[0];
      const isOwner = BOT_OWNERS.includes(senderNumber) || BOT_OWNERS.includes(sender);
      const timestamp = new Date((msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toLocaleString('de-DE');

      console.log(`\n[BEFEHL EMPFANGEN]`);
      console.log(`Zeit: ${timestamp}`);
      console.log(`Name: ${pushName}`);
      console.log(`Nummer: ${senderNumber}`);
      console.log(`JID/LID: ${sender}`);
      console.log(`Owner-Status: ${isOwner ? 'JA' : 'NEIN'}`);
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
          `*${PREFIX}location* - Zieht einen zufälligen Spot aus der KML Karte\n` +
          `*${PREFIX}upload* - Bilder für !lostplace hochladen\n` +
          `*${PREFIX}map* - Sendet die KML Karte\n` +
          `*${PREFIX}jid* - Zeigt deine JID an\n` +
          `*${PREFIX}lid* - Zeigt deine LID an\n` +
          `*${PREFIX}all [Text]* - Markiert alle in der Gruppe`;
        await sock.sendMessage(remoteJid, { text }, { quoted: msg });
      } 
      else if (command === 'jid') {
        await sock.sendMessage(remoteJid, { text: `*Deine JID lautet:* ${sender}` }, { quoted: msg });
      }
      else if (command === 'lid') {
        await sock.sendMessage(remoteJid, { text: `*Deine LID lautet:* ${sender}` }, { quoted: msg });
      }
      else if (command === 'location') {
        const mapPath = path.join(__dirname, 'assets', 'maps', 'LostTraceMap.kml');

        if (!fs.existsSync(mapPath)) {
          await sock.sendMessage(remoteJid, { text: "Die Datei assets/maps/LostTraceMap.kml wurde nicht gefunden." }, { quoted: msg });
          continue;
        }

        const kmlContent = fs.readFileSync(mapPath, 'utf-8');
        const spots = parseKmlSpots(kmlContent);

        if (spots.length === 0) {
          await sock.sendMessage(remoteJid, { text: "Es konnten keine Orte in der LostTraceMap.kml gefunden werden." }, { quoted: msg });
          continue;
        }

        const randomSpot = spots[Math.floor(Math.random() * spots.length)];
        let text = `🏷 *Name:* ${randomSpot.title}\n` +
          `📄 *Beschreibung & Infos:* ${randomSpot.description}\n` +
          `🧭 *Koordinaten:* ${randomSpot.coordinates}\n` +
          `📍 *Adresse / Land:* ${randomSpot.address}`;

        if (randomSpot.mapsLink) {
          text += `\n🗺 *Google Maps:* ${randomSpot.mapsLink}`;
        }

        await sock.sendMessage(remoteJid, { text }, { quoted: msg });
      }
      else if (command === 'upload') {
        if (imageContent) {
          if (!uploadSessions.has(remoteJid)) {
            uploadSessions.set(remoteJid, {
              images: [msg],
              triggerMsg: msg,
              timer: setTimeout(async () => {
                const currentSession = uploadSessions.get(remoteJid);
                uploadSessions.delete(remoteJid);
                if (currentSession && currentSession.images.length > 0) {
                  await processAndSaveImages(sock, remoteJid, currentSession.images, currentSession.triggerMsg);
                }
              }, 4000)
            });
          }
          continue;
        }

        const contextInfo = unwrappedMessage.extendedTextMessage?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        const quotedId = contextInfo?.stanzaId;

        let targetImages = [];

        if (quotedId) {
          const found = recentImageMessages.find(item => item.id === quotedId && item.remoteJid === remoteJid);
          if (found) {
            const matchedTime = found.timestamp;
            targetImages = recentImageMessages.filter(item => 
              item.remoteJid === remoteJid && Math.abs(item.timestamp - matchedTime) <= 45
            ).map(item => item.msg);
          }
        }

        if (targetImages.length === 0) {
          const now = Math.floor(Date.now() / 1000);
          targetImages = recentImageMessages.filter(item => 
            item.remoteJid === remoteJid && (now - item.timestamp) <= 180
          ).map(item => item.msg);
        }

        if (targetImages.length === 0 && quotedMsg) {
          const unwrappedQuoted = quotedMsg.ephemeralMessage?.message || quotedMsg;
          if (unwrappedQuoted.imageMessage) {
            targetImages.push({
              key: { remoteJid, id: quotedId },
              message: unwrappedQuoted
            });
          }
        }

        const uniqueMap = new Map();
        for (const img of targetImages) {
          uniqueMap.set(img.key?.id || Math.random(), img);
        }
        const finalBatch = Array.from(uniqueMap.values());

        if (finalBatch.length > 0) {
          await processAndSaveImages(sock, remoteJid, finalBatch, msg);
        } else {
          await sock.sendMessage(remoteJid, { 
            text: "Es wurden keine frischen Bilder gefunden. Sende deine Bilder bitte direkt mit der Unterschrift *!upload* ab oder tippe direkt nach dem Absenden *!upload* in den Chat." 
          }, { quoted: msg });
        }
      }
      else if (command === 'codex') {
        if (args[1] === 'answer' && args.length >= 3) {
          const userAnswer = args[2].toLowerCase();
          const correctAnswer = codexSessions.get(remoteJid);

          if (!correctAnswer) {
            await sock.sendMessage(remoteJid, { text: `Es läuft gerade keine Kodex-Prüfung. Starte eine mit *${PREFIX}codex*.` }, { quoted: msg });
          } else if (userAnswer === correctAnswer) {
            await sock.sendMessage(remoteJid, { text: "Du hast die richtige Antwort gewählt! Mach weiter so." }, { quoted: msg });
            codexSessions.delete(remoteJid);
          } else if (userAnswer === 'true' || userAnswer === 'false') {
            await sock.sendMessage(remoteJid, { text:"FALSCH! Bitte lies dir nochmal den Urbex Codex mit *!rules* durch!" }, { quoted: msg });
            codexSessions.delete(remoteJid);
          } else {
            await sock.sendMessage(remoteJid, { text: `Bitte antworte exakt mit *${PREFIX}codex answer true* oder *${PREFIX}codex answer false*.` }, { quoted: msg });
          }
        } else {
          const randomIndex = Math.floor(Math.random() * codexQuestions.length);
          const questionObj = codexQuestions[randomIndex];
          codexSessions.set(remoteJid, questionObj.a);
          
          const text = `*🏚 LostTrace | Kodex Prüfung 🤔*\n\nBeantworte die folgende Aussage mit *${PREFIX}codex answer true* oder *${PREFIX}codex answer false*:\n\n"${questionObj.q}"`;
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
          
          console.log(`\n[!ALL AUSGEFÜHRT]`);
          console.log(`Gruppe: ${remoteJid}`);
          console.log(`Gesamt markierte Personen: ${mentions.length}`);
          console.log(`Markierte JIDs:`);
          mentions.forEach((jid, index) => {
            console.log(` [${index + 1}] ${jid}`);
          });
          console.log(``);
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
