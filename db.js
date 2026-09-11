import pg from "pg";
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
export async function q(sql, params=[]){
  const r = await pool.query(sql, params);
  return r;
}
