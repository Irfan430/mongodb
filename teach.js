require("dotenv").config();
const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const mongoose = require("mongoose");
const { connectDB } = require("./connectDB");

const argv = minimist(process.argv.slice(2));
// ঐচ্ছিক: --uri=... (না দিলে config/uris.json.default বা .env থেকে নেবে)
const OVERRIDE_URI = (argv.uri || "").toString().trim();

const urisPath = path.join(process.cwd(), "config", "uris.json");
const dataPath = path.join(process.cwd(), "data", "teach.json");

(async () => {
  try {
    // 1) URI resolve
    let URIS = {};
    try { URIS = JSON.parse(fs.readFileSync(urisPath, "utf-8")); } catch {}
    const URI = OVERRIDE_URI || URIS.default || process.env.MONGODB_URI;
    if (!URI) throw new Error("No MongoDB URI. Set config/uris.json.default or --uri or MONGODB_URI.");

    // 2) Load teach.json
    const raw = fs.readFileSync(dataPath, "utf-8");
    let items = JSON.parse(raw);
    if (!Array.isArray(items) || !items.length) throw new Error("teach.json is empty");

    // 3) Normalize
    items = items.map(it => {
      const q = String(it.q || it.question || "").trim();
      const a = String(it.a || it.answer || "").trim();
      const tags = Array.isArray(it.tags) ? it.tags : [];
      if (!q || !a) return null;
      return { q, a, tags };
    }).filter(Boolean);

    // 4) Schema & Model
    const qaSchema = new mongoose.Schema({
      q: { type: String, required: true, index: true },
      a: { type: String, required: true },
      tags: { type: [String], default: [] }
    }, { timestamps: true });

    // Full-text search index + unique on q (চাইলে unique বাদ দিতে পারো)
    qaSchema.index({ q: "text", a: "text", tags: "text" });
    qaSchema.index({ q: 1 }, { unique: true });

    const QA = mongoose.model("TeachQA", qaSchema, "teach_qa");

    // 5) Connect
    await connectDB(URI);
    await QA.syncIndexes();

    // 6) Bulk upsert
    const ops = items.map(doc => ({
      updateOne: { filter: { q: doc.q }, update: { $set: doc }, upsert: true }
    }));
    const res = await QA.bulkWrite(ops, { ordered: false });

    console.log("✅ Teach import finished");
    console.log("   • upserted:", res.upsertedCount || 0);
    console.log("   • modified:", res.modifiedCount || 0);
    console.log("   • matched :", res.matchedCount || 0);

    process.exit(0);
  } catch (e) {
    console.error("❌ Teach failed:", e.message);
    process.exit(1);
  }
})();
