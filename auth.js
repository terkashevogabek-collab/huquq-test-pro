import jwt from "jsonwebtoken";
const COOKIE = "htp_session";
export function sign(user){
  return jwt.sign({id:user.id, role:user.role, login:user.login, name:user.full_name}, process.env.JWT_SECRET, {expiresIn:"12h"});
}
export function setSession(res, token){
  res.cookie(COOKIE, token, {httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:12*60*60*1000});
}
export function currentUser(req){
  const token=req.cookies?.[COOKIE];
  if(!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}
export function requireAuth(req,res,next){
  const u=currentUser(req);
  if(!u) return res.status(401).json({error:"Kirish talab qilinadi"});
  req.user=u; next();
}
export function requireAdmin(req,res,next){
  const u=currentUser(req);
  if(!u || u.role!=="admin") return res.status(403).json({error:"Admin huquqi talab qilinadi"});
  req.user=u; next();
}
