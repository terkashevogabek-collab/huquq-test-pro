import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {pool,q} from "./db.js";
import {sign,setSession,currentUser,requireAuth,requireAdmin} from "./auth.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(express.json({limit:"5mb"}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"../public")));

async function init(){
  const schema=fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
  for(const statement of schema.split(";").map(s=>s.trim()).filter(Boolean)) await q(statement);
  const a=await q("SELECT id FROM users WHERE login='admin' LIMIT 1");
  if(!a.rowCount){
    await q("INSERT INTO users(full_name,login,password_hash,role) VALUES($1,$2,$3,'admin')",
      ["Ustoz","admin",await bcrypt.hash("admin123",12)]);
  }
  const s=await q("SELECT id FROM users WHERE login='student' LIMIT 1");
  if(!s.rowCount){
    await q("INSERT INTO users(full_name,login,password_hash,role) VALUES($1,$2,$3,'student')",
      ["Namuna o‘quvchi","student",await bcrypt.hash("student123",12)]);
  }
}
await init();

app.get("/api/me",(req,res)=>res.json({user:currentUser(req)}));

app.post("/api/login",async(req,res)=>{
  const {login,password}=req.body||{};
  if(!login||!password) return res.status(400).json({error:"Login va parol kerak"});
  const r=await q("SELECT * FROM users WHERE lower(login)=lower($1) LIMIT 1",[login]);
  if(!r.rowCount) return res.status(401).json({error:"Login yoki parol noto‘g‘ri"});
  const u=r.rows[0];
  if(u.blocked) return res.status(403).json({error:"Akkount bloklangan"});
  if(!(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:"Login yoki parol noto‘g‘ri"});
  await q("UPDATE users SET last_seen_at=now() WHERE id=$1",[u.id]);
  setSession(res,sign(u));
  res.json({ok:true,user:{id:u.id,full_name:u.full_name,role:u.role}});
});
app.post("/api/logout",(req,res)=>{res.clearCookie("htp_session");res.json({ok:true})});

app.get("/api/student/tests",requireAuth,async(req,res)=>{
  const r=await q(`SELECT t.*,COALESCE((SELECT count(*) FROM questions q WHERE q.test_id=t.id),0) question_count
                  FROM tests t WHERE t.published=true
                  AND (t.starts_at IS NULL OR t.starts_at<=now())
                  AND (t.ends_at IS NULL OR t.ends_at>=now())
                  ORDER BY t.created_at DESC`);
  res.json(r.rows);
});

app.get("/api/student/tests/:id/start",requireAuth,async(req,res)=>{
  const uid=req.user.id, tid=Number(req.params.id);
  const tr=await q("SELECT * FROM tests WHERE id=$1 AND published=true",[tid]);
  if(!tr.rowCount)return res.status(404).json({error:"Test topilmadi"});
  const test=tr.rows[0];
  const qr=await q("SELECT id,prompt,type,points,options FROM questions WHERE test_id=$1 ORDER BY position,id",[tid]);
  if(!qr.rowCount)return res.status(400).json({error:"Testda savol yo‘q"});
  const order=qr.rows.map(x=>x.id);
  if(test.shuffle_questions) for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]]}
  const optionOrders={};
  for(const qu of qr.rows){
    let ids=(qu.options||[]).map((_,i)=>i);
    if(test.shuffle_options) for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]]}
    optionOrders[qu.id]=ids;
  }
  const max=qr.rows.reduce((a,x)=>a+Number(x.points),0);
  const active=await q("SELECT * FROM attempts WHERE user_id=$1 AND test_id=$2 AND status='active' LIMIT 1",[uid,tid]);
  let attempt;
  if(active.rowCount) attempt=active.rows[0];
  else {
    const count=await q("SELECT count(*)::int c FROM attempts WHERE user_id=$1 AND test_id=$2",[uid,tid]);
    if(test.max_attempts && count.rows[0].c>=test.max_attempts)return res.status(400).json({error:"Urinishlar limiti tugagan"});
    attempt=(await q(`INSERT INTO attempts(user_id,test_id,question_order,option_orders,max_score)
                      VALUES($1,$2,$3,$4,$5) RETURNING *`,[uid,tid,JSON.stringify(order),JSON.stringify(optionOrders),max])).rows[0];
  }
  const safe=qr.rows.map(qu=>({...qu,options:(qu.options||[])}));
  res.json({test,attempt,questions:safe});
});

app.post("/api/student/attempts/:id/answer",requireAuth,async(req,res)=>{
  const aid=Number(req.params.id); const {question_id,answer}=req.body||{};
  const a=await q("SELECT * FROM attempts WHERE id=$1 AND user_id=$2 AND status='active'",[aid,req.user.id]);
  if(!a.rowCount)return res.status(404).json({error:"Faol urinish topilmadi"});
  const qu=await q("SELECT * FROM questions WHERE id=$1 AND test_id=$2",[question_id,a.rows[0].test_id]);
  if(!qu.rowCount)return res.status(404).json({error:"Savol topilmadi"});
  const qv=qu.rows[0], correct=JSON.stringify(answer??null)===JSON.stringify(qv.correct_answer);
  const points=correct?Number(qv.points):0;
  await q(`INSERT INTO answers(attempt_id,question_id,answer,is_correct,points_awarded)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(attempt_id,question_id) DO UPDATE SET answer=EXCLUDED.answer,is_correct=EXCLUDED.is_correct,points_awarded=EXCLUDED.points_awarded,answered_at=now()`,
    [aid,question_id,JSON.stringify(answer??null),correct,points]);
  res.json({ok:true,is_correct:correct,points_awarded:points});
});

app.post("/api/student/attempts/:id/finish",requireAuth,async(req,res)=>{
  const aid=Number(req.params.id);
  const a=await q("SELECT * FROM attempts WHERE id=$1 AND user_id=$2 AND status='active'",[aid,req.user.id]);
  if(!a.rowCount)return res.status(404).json({error:"Faol urinish topilmadi"});
  const stats=await q(`SELECT
    COALESCE(SUM(points_awarded),0)::numeric score,
    COALESCE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END),0)::int correct_count,
    COALESCE(SUM(CASE WHEN is_correct=false THEN 1 ELSE 0 END),0)::int wrong_count,
    COALESCE(SUM(CASE WHEN answer IS NULL THEN 1 ELSE 0 END),0)::int unanswered_count
    FROM answers WHERE attempt_id=$1`,[aid]);
  const mode=(await q("SELECT result_mode FROM tests WHERE id=$1",[a.rows[0].test_id])).rows[0].result_mode;
  const st=stats.rows[0];
  const status=mode==="approval"?"submitted":"approved";
  const r=await q(`UPDATE attempts SET score=$1,correct_count=$2,wrong_count=$3,unanswered_count=$4,
                 finished_at=now(),status=$5,approved_at=CASE WHEN $5='approved' THEN now() ELSE NULL END
                 WHERE id=$6 RETURNING *`,
    [st.score,st.correct_count,st.wrong_count,st.unanswered_count,status,aid]);
  res.json({attempt:r.rows[0],result_visible:status==="approved"});
});

app.get("/api/student/mistakes",requireAuth,async(req,res)=>{
  const r=await q(`SELECT a.id attempt_id,a.score,t.id test_id,t.title,q.id question_id,q.prompt,q.points,ans.answer,ans.is_correct
    FROM answers ans JOIN attempts a ON a.id=ans.attempt_id
    JOIN tests t ON t.id=a.test_id JOIN questions q ON q.id=ans.question_id
    WHERE a.user_id=$1 AND ans.is_correct=false ORDER BY ans.answered_at DESC`,[req.user.id]);
  res.json(r.rows);
});

app.get("/api/leaderboard",async(req,res)=>{
  const r=await q(`SELECT u.id,u.full_name,COALESCE(SUM(a.score),0)::numeric total_score,
    COALESCE(SUM(a.correct_count),0)::int correct_count,
    COUNT(DISTINCT a.test_id)::int tests
    FROM users u LEFT JOIN attempts a ON a.user_id=u.id AND a.status='approved'
    WHERE u.role='student' AND u.in_leaderboard=true AND u.blocked=false
    GROUP BY u.id ORDER BY total_score DESC,correct_count DESC LIMIT 100`);
  res.json(r.rows);
});

app.get("/api/admin/summary",requireAdmin,async(req,res)=>{
  const [s,o,t,r,p]=await Promise.all([
    q("SELECT count(*)::int c FROM users WHERE role='student'"),
    q("SELECT count(*)::int c FROM users WHERE role='student' AND last_seen_at>now()-interval '5 minutes'"),
    q("SELECT count(*)::int c FROM tests"),
    q("SELECT count(*)::int c FROM attempts WHERE status='active'"),
    q("SELECT count(*)::int c FROM attempts WHERE status='submitted'")
  ]);
  res.json({students:s.rows[0].c,online:o.rows[0].c,tests:t.rows[0].c,activeAttempts:r.rows[0].c,pending:p.rows[0].c});
});

app.get("/api/admin/students",requireAdmin,async(req,res)=>{
  const r=await q(`SELECT u.id,u.full_name,u.login,u.blocked,u.in_leaderboard,u.last_seen_at,
    COUNT(DISTINCT a.id)::int tests,
    COALESCE(SUM(CASE WHEN a.status='approved' THEN a.score ELSE 0 END),0)::numeric total_score,
    COALESCE(SUM(CASE WHEN a.status='approved' THEN a.correct_count ELSE 0 END),0)::int correct
    FROM users u LEFT JOIN attempts a ON a.user_id=u.id
    WHERE u.role='student' GROUP BY u.id ORDER BY u.created_at DESC`);
  res.json(r.rows);
});

app.patch("/api/admin/students/:id",requireAdmin,async(req,res)=>{
  const id=Number(req.params.id); const {blocked,in_leaderboard}=req.body||{};
  const r=await q(`UPDATE users SET blocked=COALESCE($1,blocked),in_leaderboard=COALESCE($2,in_leaderboard) WHERE id=$3 AND role='student' RETURNING id,full_name,login,blocked,in_leaderboard`,
    [blocked,in_leaderboard,id]);
  if(!r.rowCount)return res.status(404).json({error:"O‘quvchi topilmadi"});
  res.json(r.rows[0]);
});
app.delete("/api/admin/students/:id",requireAdmin,async(req,res)=>{
  const id=Number(req.params.id);
  await q("DELETE FROM users WHERE id=$1 AND role='student'",[id]);
  res.json({ok:true});
});

app.get("/api/admin/pending",requireAdmin,async(req,res)=>{
  const r=await q(`SELECT a.id,u.full_name,t.title,a.score,a.max_score,a.correct_count,a.wrong_count,a.unanswered_count,a.finished_at
    FROM attempts a JOIN users u ON u.id=a.user_id JOIN tests t ON t.id=a.test_id
    WHERE a.status='submitted' ORDER BY a.finished_at DESC`);
  res.json(r.rows);
});
app.post("/api/admin/pending/:id/approve",requireAdmin,async(req,res)=>{
  const r=await q("UPDATE attempts SET status='approved',approved_at=now() WHERE id=$1 AND status='submitted' RETURNING *",[Number(req.params.id)]);
  if(!r.rowCount)return res.status(404).json({error:"Natija topilmadi"});
  res.json({ok:true});
});

app.get("/api/admin/questions/analysis",requireAdmin,async(req,res)=>{
  const r=await q(`SELECT q.id,q.prompt,t.title,
    COUNT(ans.id)::int answered,
    COALESCE(SUM(CASE WHEN ans.is_correct THEN 1 ELSE 0 END),0)::int correct,
    COALESCE(SUM(CASE WHEN ans.is_correct=false THEN 1 ELSE 0 END),0)::int wrong
    FROM questions q JOIN tests t ON t.id=q.test_id LEFT JOIN answers ans ON ans.question_id=q.id
    GROUP BY q.id,t.title ORDER BY wrong DESC, correct ASC LIMIT 100`);
  res.json(r.rows);
});

app.get("/api/admin/tests",requireAdmin,async(req,res)=>{
  const r=await q(`SELECT t.*,COUNT(q.id)::int question_count,COALESCE(SUM(q.points),0)::numeric max_score
    FROM tests t LEFT JOIN questions q ON q.test_id=t.id GROUP BY t.id ORDER BY t.created_at DESC`);
  res.json(r.rows);
});


app.patch("/api/admin/tests/:id",requireAdmin,async(req,res)=>{
  const id=Number(req.params.id), b=req.body||{};
  const r=await q(`UPDATE tests SET
    title=COALESCE($1,title),
    description=COALESCE($2,description),
    duration_seconds=COALESCE($3,duration_seconds),
    max_attempts=COALESCE($4,max_attempts),
    published=COALESCE($5,published),
    shuffle_questions=COALESCE($6,shuffle_questions),
    shuffle_options=COALESCE($7,shuffle_options),
    result_mode=COALESCE($8,result_mode),
    starts_at=COALESCE($9,starts_at),
    ends_at=COALESCE($10,ends_at)
    WHERE id=$11 RETURNING *`,
    [b.title,b.description,b.duration_seconds,b.max_attempts,b.published,
     b.shuffle_questions,b.shuffle_options,b.result_mode,b.starts_at,b.ends_at,id]);
  if(!r.rowCount)return res.status(404).json({error:"Test topilmadi"});
  res.json(r.rows[0]);
});

app.delete("/api/admin/tests/:id",requireAdmin,async(req,res)=>{
  const r=await q("DELETE FROM tests WHERE id=$1 RETURNING id,title",[Number(req.params.id)]);
  if(!r.rowCount)return res.status(404).json({error:"Test topilmadi"});
  res.json({ok:true,deleted:r.rows[0]});
});

app.get("/api/admin/tests/:id/attempts",requireAdmin,async(req,res)=>{
  const r=await q(`SELECT a.id,u.full_name,u.login,a.score,a.max_score,a.correct_count,
    a.wrong_count,a.unanswered_count,a.started_at,a.finished_at,a.status,a.approved_at
    FROM attempts a JOIN users u ON u.id=a.user_id
    WHERE a.test_id=$1 ORDER BY a.started_at DESC`,[Number(req.params.id)]);
  res.json(r.rows);
});

app.post("/api/admin/tests/:id/close",requireAdmin,async(req,res)=>{
  const r=await q(`UPDATE tests SET ends_at=LEAST(COALESCE(ends_at,now()),now())
    WHERE id=$1 RETURNING *`,[Number(req.params.id)]);
  if(!r.rowCount)return res.status(404).json({error:"Test topilmadi"});
  res.json(r.rows[0]);
});

app.post("/api/admin/tests/:id/reopen",requireAdmin,async(req,res)=>{
  const r=await q("UPDATE tests SET ends_at=$1,published=true WHERE id=$2 RETURNING *",
    [req.body?.ends_at||null,Number(req.params.id)]);
  if(!r.rowCount)return res.status(404).json({error:"Test topilmadi"});
  res.json(r.rows[0]);
});

app.post("/api/admin/tests",requireAdmin,async(req,res)=>{
  const b=req.body||{};
  if(!b.title)return res.status(400).json({error:"Test nomi kerak"});
  const r=await q(`INSERT INTO tests(title,description,duration_seconds,max_attempts,published,shuffle_questions,shuffle_options,result_mode,starts_at,ends_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.title,b.description||"",b.duration_seconds||null,b.max_attempts||null,!!b.published,b.shuffle_questions!==false,b.shuffle_options!==false,b.result_mode==="approval"?"approval":"immediate",b.starts_at||null,b.ends_at||null]);
  res.json(r.rows[0]);
});

app.post("/api/admin/tests/:id/questions",requireAdmin,async(req,res)=>{
  const b=req.body||{}; const opts=Array.isArray(b.options)?b.options:[];
  const r=await q(`INSERT INTO questions(test_id,type,prompt,points,position,options,correct_answer)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [Number(req.params.id),b.type||"single",b.prompt,b.points||1,b.position||0,JSON.stringify(opts),JSON.stringify(b.correct_answer??null)]);
  res.json(r.rows[0]);
});

app.post("/api/admin/questions/import",requireAdmin,async(req,res)=>{
  const {questions=[],test_id}=req.body||{};
  if(!test_id||!Array.isArray(questions))return res.status(400).json({error:"test_id va questions kerak"});
  let inserted=0;
  for(const x of questions){
    if(!x.prompt)continue;
    const opts=Array.isArray(x.options)?x.options:[];
    const ok=x.correct_answer??null;
    await q(`INSERT INTO questions(test_id,type,prompt,points,position,options,correct_answer)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[Number(test_id),x.type||"single",x.prompt,Number(x.points)||1,Number(x.position)||0,JSON.stringify(opts),JSON.stringify(ok)]);
    inserted++;
  }
  res.json({inserted});
});

app.post("/api/admin/leaderboard/reset",requireAdmin,async(req,res)=>{
  await q("INSERT INTO rating_resets(scope) VALUES('global')");
  res.json({ok:true});
});
app.post("/api/admin/tests/:id/leaderboard/reset",requireAdmin,async(req,res)=>{
  await q("INSERT INTO rating_resets(scope,test_id) VALUES('test',$1)",[Number(req.params.id)]);
  res.json({ok:true});
});

app.get("/api/admin/tests/:id/leaderboard",requireAdmin,async(req,res)=>{
  const r=await q(`SELECT u.id,u.full_name,COUNT(a.id)::int attempts,
    COALESCE(MAX(a.score),0)::numeric best_score,
    COALESCE(MAX(a.max_score),0)::numeric max_score,
    COALESCE(MAX(a.correct_count),0)::int best_correct
    FROM users u LEFT JOIN attempts a ON a.user_id=u.id AND a.test_id=$1 AND a.status='approved'
    WHERE u.role='student' AND u.in_leaderboard=true AND u.blocked=false
    GROUP BY u.id ORDER BY best_score DESC,best_correct DESC LIMIT 100`,[Number(req.params.id)]);
  res.json(r.rows);
});

app.get("/api/admin/announcements",requireAdmin,async(req,res)=>res.json((await q("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50")).rows));
app.post("/api/admin/announcements",requireAdmin,async(req,res)=>{
  const {title,body}=req.body||{}; if(!title||!body)return res.status(400).json({error:"Sarlavha va matn kerak"});
  res.json((await q("INSERT INTO announcements(title,body) VALUES($1,$2) RETURNING *",[title,body])).rows[0]);
});

app.get("/api/student/announcements",requireAuth,async(req,res)=>res.json((await q("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20")).rows));

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"../public/index.html"));
});
app.listen(process.env.PORT||3000,()=>console.log("Huquq Test Pro running"));
