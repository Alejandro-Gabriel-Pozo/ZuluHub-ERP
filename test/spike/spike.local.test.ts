import { describe, expect, it } from "vitest";
import { ejecutarSpike } from "../../api/spike";

/**
 * Corre el spike contra una base real (por ejemplo, Postgres local con PgBouncer en modo transacción).
 * Sin las variables SPIKE_DATABASE_URL y SPIKE_DATABASE_URL_UNPOOLED se saltea (el CI no tiene base).
 */
const urlPooler = process.env.SPIKE_DATABASE_URL ?? "";
const urlDirecta = process.env.SPIKE_DATABASE_URL_UNPOOLED ?? "";

describe.skipIf(urlPooler === "" || urlDirecta === "")("spike contra una base real", () => {
  it("las pruebas aplicables pasan", async () => {
    const informe = await ejecutarSpike(
      { urlPooler, urlDirecta },
      { iteraciones: 300, corridas: 30, esPooler: true },
    );
    for (const r of informe.resultados) {
      console.log(`${r.prueba} ${r.estado} (${r.milisegundos} ms): ${r.detalle}`);
    }
    expect(informe.resultados.filter((r) => r.estado === "falla")).toEqual([]);
  }, 180_000);
});
