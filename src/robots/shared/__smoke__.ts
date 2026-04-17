/**
 * Smoke test de las shared utilities:
 *  - RobotLogger: start() escribe a Propyte_robot_runs, finish() actualiza status
 *  - fx.getUsdToMxnRate(): Banxico o fallback
 *  - source-priority.winnerByFieldSensitivity(): correctness de tie-breakers
 *  - FIELD_SENSITIVITY: correctness de clasificacion
 */

import { getDb, closeDb } from "./db";
import { RobotLogger } from "./logger";
import { getUsdToMxnRate, normalizePriceToMxn } from "./fx";
import { winnerByFieldSensitivity, type Candidate } from "./source-priority";
import { FIELD_SENSITIVITY } from "./field-sensitivity";

async function main() {
  console.log("============================================");
  console.log("SMOKE TEST - robots/shared");
  console.log("============================================\n");

  // 1. FIELD_SENSITIVITY
  console.log("## 1. Field sensitivity\n");
  console.log(`  isSensitive('title'): ${FIELD_SENSITIVITY.isSensitive("title")} (expect true)`);
  console.log(`  isSensitive('bedrooms'): ${FIELD_SENSITIVITY.isSensitive("bedrooms")} (expect false)`);
  console.log(`  isSensitive('content_es'): ${FIELD_SENSITIVITY.isSensitive("content_es")} (expect true)`);
  console.log(`  isNeutral('latitude'): ${FIELD_SENSITIVITY.isNeutral("latitude")} (expect true)`);

  // 2. winnerByFieldSensitivity
  console.log("\n## 2. Tie-breaker\n");
  const candidates: Candidate<string>[] = [
    {
      propertyId: "a",
      sourceDomain: "plalla.com",
      status: "review",
      lastSeenAt: new Date("2026-04-01"),
      value: "Opcion review de plalla",
    },
    {
      propertyId: "b",
      sourceDomain: "goodlers.com",
      status: "review",
      lastSeenAt: new Date("2026-04-10"),
      value: "Opcion review de goodlers mas reciente",
    },
    {
      propertyId: "c",
      sourceDomain: "noval.com",
      status: "published",
      lastSeenAt: new Date("2026-03-01"),
      value: "Opcion published de noval vieja",
    },
  ];
  const titleWinner = winnerByFieldSensitivity(candidates, "title"); // sensitive
  console.log(`  title winner (sensitive): "${titleWinner}"`);
  console.log(`    expect: "Opcion published de noval vieja" (published gana aunque sea vieja)`);

  const bedroomsWinner = winnerByFieldSensitivity(candidates, "bedrooms"); // neutral
  console.log(`  bedrooms winner (neutral): "${bedroomsWinner}"`);
  console.log(`    expect: "Opcion published de noval vieja" (published > review, aun en neutral)`);

  // 3. FX rate
  console.log("\n## 3. FX rate (Banxico o fallback)\n");
  const fx = await getUsdToMxnRate();
  console.log(`  source: ${fx.source}`);
  console.log(`  usdToMxn: ${fx.usdToMxn}`);
  console.log(`  date: ${fx.date}`);

  const priceUsd = await normalizePriceToMxn(BigInt(22326980000), "USD");
  console.log(`\n  normalizePriceToMxn(22326980000 USD cents) = ${priceUsd} MXN pesos`);
  console.log(`    (= $223,269,800 USD cents = $2,232,698 USD * ${fx.usdToMxn})`);

  const priceMxn = await normalizePriceToMxn(BigInt(230000000), "MXN");
  console.log(`  normalizePriceToMxn(230000000 MXN cents) = ${priceMxn} MXN pesos`);
  console.log(`    (= $2,300,000 MXN, passthrough)`);

  // 4. RobotLogger -> crea row en Propyte_robot_runs
  console.log("\n## 4. RobotLogger (escribe a Propyte_robot_runs)\n");
  const log = new RobotLogger("01-classifier");
  const run = await log.start({ smoke_test: true, dry_run: true });
  console.log(`  run.id: ${run.id}`);
  console.log(`  run.status: ${run.status}`);
  log.info("smoke test in progress");
  log.metric("smoke_count", 42);
  log.metric("smoke_count", 8); // should accumulate to 50
  log.warn("this is a test warning");
  await log.finish(run.id, "dry_run");
  console.log(`  metrics: ${JSON.stringify(log.getMetrics())}`);
  console.log(`  expect smoke_count=50`);

  // 5. Verify row was written
  console.log("\n## 5. Verify row in Propyte_robot_runs\n");
  const db = getDb();
  const rows = (await db.$queryRawUnsafe(
    `SELECT id::text, robot_name, status, outputs, duration_ms, host
     FROM real_estate_hub."Propyte_robot_runs"
     WHERE id = $1::uuid`,
    run.id
  )) as any[];
  if (rows.length === 0) {
    console.error("  FAILED: no row found");
  } else {
    const r = rows[0];
    console.log(`  id: ${r.id}`);
    console.log(`  robot_name: ${r.robot_name}`);
    console.log(`  status: ${r.status}`);
    console.log(`  outputs: ${JSON.stringify(r.outputs)}`);
    console.log(`  duration_ms: ${r.duration_ms}`);
    console.log(`  host: ${r.host}`);
  }

  // Cleanup del smoke test
  await db.$executeRawUnsafe(
    `DELETE FROM real_estate_hub."Propyte_robot_runs" WHERE id = $1::uuid`,
    run.id
  );
  console.log(`\n  smoke row eliminada`);

  await closeDb();
  console.log("\n============================================");
  console.log("OK - smoke test pass");
  console.log("============================================\n");
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
