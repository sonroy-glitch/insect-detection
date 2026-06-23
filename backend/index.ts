import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors'
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();
import express from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt'
import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key"
)
const app = express();
import { withAccelerate } from "@prisma/extension-accelerate"
const prisma = new PrismaClient({
    accelerateUrl: process.env.PRISMA_ACCELERATE_URL
}).$extends(withAccelerate())
import Groq from "groq-sdk";
app.use(express.json());
app.use(cors())
//signin , fetch_all_details , just_the_box 
const client = new Groq({apiKey: process.env.GROQ_API_KEY});
//signin
app.post("/signin",async(req:Request, res:Response)=>{
    const data:{email:string,password:string}=req.body;
    try {
      const response= await prisma.user.findFirst({
        where:{email:data.email}
      })
      if (response){
        //signin logic 
        const check = await bcrypt.compare(data.password,response.password)
        console.log(check)
        if (check){
          const token = jwt.sign(
            { id: response.id, email: response.email, user_type: response.user_type },
            process.env.JWT_SECRET || "fallback-secret",
            { expiresIn: "7d" }
          );
          return res.status(200).send({
            "id": response.id,
            "user_type": response.user_type,
            "token": token,
            "msg": "you are good to go "
          })
        }
        else{
          return res.status(202).send({"msg":"Password is incorrect"})
        }
      }
      else{
        return res.status(202).send({"msg":"Email does not exist"})
      }
    } catch (error) {
      return res.status(505).json({error,"msg":"Something is up with server"})
    }
})

//signup 
app.post("/signup",async(req:Request,res:Response)=>{
  const user_data:{email:string,password:string,user_type:string,box_id:string}=req.body;
  try {
    const hashedPassword=await bcrypt.hash(user_data.password,10) 
    const response=await prisma.user.create({
      data:{
        email:user_data.email,
        password:hashedPassword,
        user_type:user_data.user_type
      }
    })
    
    const token = jwt.sign(
      { id: response.id, email: response.email, user_type: response.user_type },
      process.env.JWT_SECRET || "fallback-secret",
      { expiresIn: "7d" }
    );
    return res.status(200).send({
      "id": response.id,
      "token": token,
      "msg": "User Creation Success"
    })
  } catch (error) {
    return res.status(505).json({error,"msg":"Something is up with server"})
  }
})
//fetch_all_details 
app.get("/everything",async(req:Request,res:Response)=>{
  try {
    const response= await prisma.species.findMany({})
    const serialized = response.map(item => ({
      ...item,
      taxon_id: item.taxon_id.toString()
    }));
    return res.status(200).json({"data":serialized})
  } catch (error) {
    return res.status(505).json({error,"msg":"Something is up with server"})
  }
})
app.post("/box_id",async(req:Request,res:Response)=>{
  const {box_id}=req.body;
  try {
    const response=await prisma.species.findMany({where:{box_id}})
    const serialized = response.map(item => ({
      ...item,
      taxon_id: item.taxon_id.toString()
    }));
    return res.status(200).json({response: serialized})
  } catch (error) {
    return res.status(505).json({error,"msg":"Something is up with server"})
  }
})
//chatbot
function sysIns(chat:string){
  const systemInstruction=`
  You are a chatbot for a insect detection project. You are to discuss with users about the details of the insects, or answer any general query related to 
  insects. Give only string output , no markdown. Keep your answers within 100 words.

  ${chat}
  `
  return systemInstruction
}
app.post("/chat",async(req:Request,res:Response)=>{
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Transfer-Encoding", "chunked");
  
  const {chat_context}=req.body
  const instruction=sysIns(chat_context)
   const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "user",
        content: instruction,
      },
    ],
    temperature: 1,
    max_completion_tokens: 100,
    top_p: 1,
    stream: true,
    stop: null,
  });

  for await (const chunk of completion) {
    res.write(chunk.choices[0]?.delta?.content || "");
  }

  res.end();
})
//add_box
app.post("/add_box",async(req:Request,res:Response):Promise<any>=>{
    const {box_name,box_id}=req.body
    try {
      const response=await prisma.box.create({
        data:{
          box_name:box_name,
          box_id_default:box_id
        }
      })
      return res.status(202).json({"msg":"Box registered"})
    } catch (error) {
      return res.status(505).json({"msg":"something is up with the server"})
    }
})

// ---------- iNaturalist constants & helper functions ----------

const INAT_BASE = "https://api.inaturalist.org/v1";
const TOKEN = process.env.INATURALIST_TOKEN;
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "captures";
const authHeaders = () => ({ Authorization: `Bearer ${TOKEN}` });

interface TaxonDetails {
  taxon_id: number;
  name: string;
  common_name: string | null;
  kingdom: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
  observations_count: number | null;
  wikipedia_url: string | null;
  photo_url: string | null;
}

async function scoreImage(
  imageBuffer: Buffer,
  filename: string,
  lat: number | null,
  lng: number | null
): Promise<any[]> {
  const form = new FormData();
  form.append("lat", String(lat ?? ""));
  form.append("lng", String(lng ?? ""));
  form.append("image", new Blob([new Uint8Array(imageBuffer)]), filename || "image.jpg");

  const res = await fetch(`${INAT_BASE}/computervision/score_image`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    throw new Error(`score_image failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { results?: any[] };
  return json.results || [];
}

async function getTaxonDetails(taxonId: number): Promise<TaxonDetails> {
  const res = await fetch(`${INAT_BASE}/taxa/${taxonId}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`taxa fetch failed: ${res.status} ${await res.text()}`);
  }

  const results = ((await res.json()) as { results?: any[] }).results;
  const t = results?.[0];
  if (!t) {
    throw new Error(`No taxon found for id ${taxonId}`);
  }

  const ancestors: Record<string, string> = {};
  for (const a of t.ancestors || []) {
    ancestors[a.rank] = a.name;
  }

  return {
    taxon_id: t.id,
    name: t.name,
    common_name: t.preferred_common_name || null,
    kingdom: ancestors["kingdom"] || null,
    class: ancestors["class"] || null,
    order: ancestors["order"] || null,
    family: ancestors["family"] || null,
    genus: ancestors["genus"] || null,
    species: t.rank === "species" ? t.name : ancestors["species"] || null,
    observations_count: t.observations_count ?? null,
    wikipedia_url: t.wikipedia_url || null,
    photo_url: t.default_photo?.medium_url || null,
  };
}

async function downloadImage(imagePath: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(imagePath)) {
    const res = await fetch(imagePath);
    if (!res.ok) {
      throw new Error(`Image fetch failed: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(imagePath);
  if (error) {
    throw new Error(`Storage download failed: ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

async function ensureBox(boxId: string | null) {
  if (!boxId) return null;
  return prisma.box.upsert({
    where: { box_id_default: boxId },
    update: {},
    create: { box_id_default: boxId },
  }); 
}

async function processCapture(capture: any) {
  console.log(`[capture ${capture.id}] processing...`);

  const imgBuffer = await downloadImage(capture.image_path);

  const suggestions = await scoreImage(
    imgBuffer,
    `capture_${capture.id}.jpg`,
    capture.latitude,
    capture.longitude
  );
  if (!suggestions.length) {
    console.warn(`[capture ${capture.id}] no suggestions returned`);
    return;
  }

  const top = suggestions[0];
  const confidence = Math.round(top.combined_score ?? 0);
  const details = await getTaxonDetails(top.taxon.id);

  if (capture.box_id) {
    await ensureBox(capture.box_id);
  }

  await prisma.species.create({
    data: {
      taxon_id: BigInt(details.taxon_id),
      name: details.common_name || details.name,
      confidence_score: confidence,
      kingdom: details.kingdom,
      class: details.class,
      order: details.order,
      family: details.family,
      genus: details.genus,
      species: details.species,
      observation_string:
        details.observations_count != null ? String(details.observations_count) : null,
      image_string: details.photo_url,
      wikipedia_string: details.wikipedia_url,
      box_id: capture.box_id,
    },
  });

  const { error: updateErr } = await supabase
    .from("captures")
    .update({ status: true })
    .eq("id", capture.id);
  if (updateErr) {
    throw new Error(`Supabase update failed: ${updateErr.message}`);
  }

  console.log(`[capture ${capture.id}] done -> ${details.name} (${confidence})`);
}

async function runJob() {
  console.log(`[cron] tick ${new Date().toISOString()}`);

  const { data, error } = await supabase
    .from("captures")
    .select("*")
    .eq("status", false);

  if (error) {
    console.error("Supabase fetch failed:", error.message);
    return;
  }
  if (!data?.length) {
    console.log("[cron] nothing to process");
    return;
  }

  console.log(`[cron] processing ${data.length} captures`);
  for (const capture of data) {
    try {
      await processCapture(capture);
    } catch (err: any) {
      console.error(`[capture ${capture.id}] failed:`, err.message);
    }
  }
}

// ---------- Cron Scheduler ----------

// Run the job every minute during testing/operation to process captures instantly
cron.schedule("* * * * *", () => {
  runJob().catch((e) => console.error("[cron] uncaught:", e));
}, {
  timezone: "Asia/Kolkata"
});

// ---------- Routes ----------

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/jobs/run-captures", async (_req: Request, res: Response) => {
  try {
    await runJob();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/me", async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "No token provided" });
  }
  const token = authHeader.split(" ")[1]!;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret") as {
      id: string;
      email: string;
      user_type: string;
    };
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }
    return res.status(200).json({
      id: user.id,
      email: user.email,
      user_type: user.user_type,
    });
  } catch (error) {
    return res.status(401).json({ msg: "Invalid or expired token" });
  }
});

app.get("/boxes", async (_req: Request, res: Response): Promise<any> => {
  try {
    const boxes = await prisma.box.findMany({});
    return res.status(200).json({ data: boxes });
  } catch (error) {
    return res.status(500).json({ error, msg: "Failed to fetch boxes from server" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
