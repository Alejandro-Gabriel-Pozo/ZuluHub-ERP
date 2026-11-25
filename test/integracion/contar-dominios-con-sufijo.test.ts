import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  contarDominiosConSufijo,
  FORMA_DE_SUFIJO_DE_HOST,
  type ClienteDeConteo,
} from "../../src/adaptadores/postgres/contar-dominios-con-sufijo";
import { sufijoUnico } from "./unicos";

/**
 * `contarDominiosConSufijo` (la lectura de `npm run humo` que comprueba que los hosts del hotel NO están en la base compartida): contra una base real con el rol de LECTURA PÚBLICA, y con un
 * cliente falso para ver QUÉ le manda a la base (solo lectura, sufijo como parámetro, cierre siempre). Previene: contar de más o de menos (un sufijo que coincide con otro dominio), escribir por error,
 * y dejar la conexión abierta o repetir la cadena en el error.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "contar dominios por sufijo, con el rol de lectura pública y una base real",
  () => {
    let dueno: pg.Client;
    const sufijo = `sufijo-${sufijoUnico().toLowerCase()}.example.test`;
    const ids: string[] = [];

    const sembrar = async (host: string, estado = "ACTIVO"): Promise<void> => {
      const id = randomUUID();
      ids.push(id);
      await dueno.query("BEGIN");
      try {
        // Sin claves foráneas ni disparadores: la prueba es de lectura.
        await dueno.query("SET LOCAL session_replication_role = replica");
        await dueno.query(
          `INSERT INTO dominio (id, host, superficie, duenio_marca_id, marca_id, titular, registrado_por, estado, verificado_en, motivo)
         VALUES ($1, $2, 'APP', $3, $3, 'OPERADOR', 'prueba', $4,
                 CASE WHEN $4 = 'PENDIENTE_VERIFICACION' THEN NULL ELSE now() END,
                 CASE WHEN $4 = 'RETIRADO' THEN 'prueba' ELSE NULL END)`,
          [id, host, randomUUID(), estado],
        );
        await dueno.query("COMMIT");
      } catch (error) {
        await dueno.query("ROLLBACK");
        throw error;
      }
    };

    beforeAll(async () => {
      if (base === null) return;
      dueno = new pg.Client({ connectionString: base.dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      if (ids.length > 0) {
        await dueno.query("BEGIN");
        await dueno.query("SET LOCAL session_replication_role = replica");
        await dueno.query("DELETE FROM dominio WHERE id = ANY($1)", [ids]);
        await dueno.query("COMMIT");
      }
      await dueno.end();
    });

    it("sin dominios con ese sufijo, cuenta 0", async () => {
      if (base === null) return;
      expect(await contarDominiosConSufijo(base.publico, sufijo)).toBe(0);
    });

    it("cuenta los ACTIVOS que terminan en el sufijo (el exacto y los de adentro) y no los que solo lo contienen", async () => {
      if (base === null) return;
      await sembrar(`app.${sufijo}`);
      await sembrar(`carta.${sufijo}`);
      await sembrar(sufijo);
      await sembrar(`app.${sufijo}.otro.example.test`); // lo contiene pero no termina en él
      await sembrar(`x${sufijo}`); // termina igual que el sufijo, sin punto delante: se cuenta (mismo criterio que el SQL manual)
      expect(await contarDominiosConSufijo(base.publico, sufijo)).toBe(4);
      expect(await contarDominiosConSufijo(base.publico, `app.${sufijo}`)).toBe(1);
    });

    it("LÍMITE: los pendientes, verificados y retirados no se cuentan (la política pública solo deja ver los ACTIVOS, que son los que la web serviría)", async () => {
      if (base === null) return;
      const otro = `limite-${sufijo}`;
      await sembrar(`a.${otro}`, "PENDIENTE_VERIFICACION");
      await sembrar(`b.${otro}`, "VERIFICADO");
      await sembrar(`c.${otro}`, "RETIRADO");
      expect(await contarDominiosConSufijo(base.publico, otro)).toBe(0);
      await sembrar(`d.${otro}`, "ACTIVO");
      expect(await contarDominiosConSufijo(base.publico, otro)).toBe(1);
    });

    it("un sufijo con comodines o fuera de la lista de permitidos se rechaza sin tocar la base", async () => {
      if (base === null) return;
      for (const malo of [
        "",
        "%",
        "a%b.test",
        "ejemplo",
        "Ejemplo.test",
        "a.test; drop table dominio",
        "a b.test",
        ".ejemplo.test",
        "ejemplo.test.",
      ]) {
        await expect(contarDominiosConSufijo(base.publico, malo)).rejects.toThrow(RangeError);
      }
    });

    it("una cadena que no conecta falla sin repetir la cadena en el mensaje", async () => {
      const mala = "postgres://lector:clave-centinela-xyz@127.0.0.1:1/base";
      const error = await contarDominiosConSufijo(mala, "ejemplo.test").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).not.toContain("clave-centinela-xyz");
      expect(String((error as Error).message)).toMatch(/no se pudo contar los dominios/);
    });
  },
);

describe("contarDominiosConSufijo: lo que le manda a la base (cliente falso)", () => {
  function falso(respuesta: unknown = [{ cuenta: 0 }]) {
    const sentencias: { texto: string; parametros: readonly string[] | undefined }[] = [];
    const marcas: string[] = [];
    const cliente: ClienteDeConteo = {
      connect: () => {
        marcas.push("connect");
        return Promise.resolve();
      },
      query: (texto, parametros) => {
        sentencias.push({ texto, parametros });
        return Promise.resolve({
          rows: texto.startsWith("SELECT") ? (respuesta as readonly unknown[]) : [],
        });
      },
      end: () => {
        marcas.push("end");
        return Promise.resolve();
      },
    };
    return { cliente, sentencias, marcas };
  }

  it("abre una transacción de SOLO LECTURA, hace UNA consulta con el sufijo como parámetro, termina con ROLLBACK y cierra", async () => {
    const f = falso([{ cuenta: 3 }]);
    expect(await contarDominiosConSufijo("cadena", "ejemplo.test", () => f.cliente)).toBe(3);
    expect(f.sentencias.map((s) => s.texto.split(" ").slice(0, 2).join(" "))).toEqual([
      "BEGIN READ",
      "SELECT count(*)::int",
      "ROLLBACK",
    ]);
    expect(f.sentencias[0]?.texto).toBe("BEGIN READ ONLY");
    expect(f.sentencias[1]?.parametros).toEqual(["ejemplo.test"]);
    expect(f.sentencias[1]?.texto).not.toContain("ejemplo.test");
    expect(f.marcas).toEqual(["connect", "end"]);
    // Nada que escriba.
    for (const s of f.sentencias)
      expect(s.texto).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT)\b/i);
  });

  it.each([[[]], [[{ cuenta: "3" }]], [[{ cuenta: -1 }]], [[{ cuenta: 1.5 }]], [[{}]]])(
    "una respuesta que no es un conteo (%j) es una falla, y igual cierra",
    async (filas) => {
      const f = falso(filas);
      await expect(
        contarDominiosConSufijo("cadena", "ejemplo.test", () => f.cliente),
      ).rejects.toThrow(/no se pudo contar los dominios \(TypeError\)/);
      expect(f.marcas).toEqual(["connect", "end"]);
      expect(f.sentencias.at(-1)?.texto).toBe("ROLLBACK");
    },
  );

  it("si la conexión falla, cierra y no repite el mensaje original", async () => {
    const f = falso();
    const cliente: ClienteDeConteo = {
      ...f.cliente,
      connect: () => Promise.reject(new Error("password authentication failed for user lector")),
    };
    const error = await contarDominiosConSufijo("cadena", "ejemplo.test", () => cliente).catch(
      (e: unknown) => e,
    );
    expect(String((error as Error).message)).not.toContain("password");
    expect(f.marcas).toEqual(["end"]);
  });

  it("sin cadena se rechaza antes de crear ningún cliente", async () => {
    let creados = 0;
    await expect(
      contarDominiosConSufijo("  ", "ejemplo.test", () => {
        creados += 1;
        return falso().cliente;
      }),
    ).rejects.toThrow(RangeError);
    expect(creados).toBe(0);
  });

  it("la forma permitida del sufijo", () => {
    for (const bueno of ["hotelesdelneuquen.com.ar", "a.b", "app.ejemplo-1.test"])
      expect(FORMA_DE_SUFIJO_DE_HOST.test(bueno)).toBe(true);
    for (const malo of ["", "a", "-a.b", "a-.b", "a..b", "A.b", "a.b/", "a.b%"])
      expect(FORMA_DE_SUFIJO_DE_HOST.test(malo)).toBe(false);
  });
});
