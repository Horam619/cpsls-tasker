// Sends push reminders for open tasks at 8, 11, 14, 17 and 20 o'clock (Europe/Berlin).
// Runs hourly on GitHub Actions; each slot is sent at most once per day, so delayed runs still work.
import admin from "firebase-admin";
import webpush from "web-push";

const SLOTS = [8, 11, 14, 17, 20];          // start hours; a slot lasts until the next one
const END_HOUR = 22;
const TZ = "Europe/Berlin";

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
webpush.setVapidDetails("mailto:" + (process.env.VAPID_CONTACT || "noreply@example.com"),
  process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const now = new Date();
const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`;
const hour = Number(parts.hour);
const force = process.env.FORCE === "true";

let slot = -1;
SLOTS.forEach((h, i) => { if (hour >= h) slot = i; });
if (!force && (slot < 0 || hour >= END_HOUR)) { console.log(`Berlin ${hour}:00 – außerhalb der Erinnerungszeiten.`); process.exit(0); }
const slotKey = `${today}#${force ? "test-" + now.getTime() : slot}`;

const fmt = d => { const [, m, dd] = d.split("-"); return `${dd}.${m}.`; };
let sent = 0;
for (const userDoc of await db.collection("users").listDocuments()) {
  const metaRef = userDoc.collection("meta").doc("reminders");
  const meta = (await metaRef.get()).data() || {};
  if (meta.lastSlot === slotKey) continue;

  const subs = await userDoc.collection("push").get();
  if (subs.empty) continue;

  const open = (await userDoc.collection("tasks").where("done", "==", false).get()).docs.map(d => d.data());
  if (!open.length) { await metaRef.set({ lastSlot: slotKey }, { merge: true }); continue; }

  const rank = t => (t.due && t.due < today ? 0 : t.due === today ? 1 : t.priority === "high" ? 2 : 3);
  open.sort((a, b) => rank(a) - rank(b) || (a.due || "9999").localeCompare(b.due || "9999"));
  const overdue = open.filter(t => t.due && t.due < today).length;
  const dueToday = open.filter(t => t.due === today).length;

  const head = [`${open.length} offen`, dueToday ? `${dueToday} heute fällig` : "", overdue ? `${overdue} überfällig` : ""]
    .filter(Boolean).join(" · ");
  const lines = open.slice(0, 3).map(t => "– " + t.title + (t.due && t.due < today ? ` (seit ${fmt(t.due)})` : ""));
  const payload = JSON.stringify({ title: head, body: lines.join("\n") + (open.length > 3 ? `\n+ ${open.length - 3} weitere` : ""), url: "./" });

  for (const s of subs.docs) {
    try { await webpush.sendNotification(s.data().subscription, payload, { TTL: 3 * 3600, urgency: "normal" }); sent++; }
    catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) { await s.ref.delete(); console.log("Abgelaufenes Gerät entfernt."); }
      else console.error("Push fehlgeschlagen:", err.statusCode || "", err.body || err.message);
    }
  }
  await metaRef.set({ lastSlot: slotKey, lastSentAt: now.toISOString() }, { merge: true });
}
console.log(`Berlin ${hour}:00 – ${sent} Erinnerung(en) gesendet.`);
