import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * La base de la nota libre (migración 0104, SAL-G) con las migraciones REALES: las dos columnas, su CHECK (el conjunto de los textos de catálogo, hasta 120), los permisos por columna de la aplicación y las tres reglas que
 * viven en la base y no solo en el código: (1) una línea enviada no cambia su nota ni se envía y la cambia en el mismo UPDATE; (2) la foto del envío lleva exactamente la nota guardada; (3) una copia (unir, dividir, anular una parte) conserva la nota de
 * su origen. El código que carga y copia la nota es del PR siguiente: acá se ejerce la regla de la base con SQL directo y con los casos de uso actuales (que todavía no copian la nota, y por eso la base los frena).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("comandas: la nota libre en la base (0104)", () => {
  let m: MundoDeSalon;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const conUnPlato = async (e: EscenarioDeVentas) => {
    const n = ++proxima;
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    const lineaId = nuevoId();
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId,
        lineaId,
        productoId: e.producto,
        opcionIds: [],
        cantidad: "2",
      }),
    );
    return { cuentaId, lineaId };
  };
  const ponerNota = (lineaId: string, nota: string | null) =>
    m.dueno.query("update linea_de_comanda set nota = $2 where linea_id = $1", [lineaId, nota]);
  const notaDe = async (lineaId: string) =>
    (
      await m.filas<{ nota: string | null }>(
        "select nota from linea_de_comanda where linea_id = $1",
        [lineaId],
      )
    )[0]?.nota;
  const enviar = (e: EscenarioDeVentas, cuentaId: string) =>
    m.salon.enviarACocina(e.gerente, {
      envioId: nuevoId(),
      cuentaId,
      claveIdempotencia: nuevaClave(),
    });

  it("la nota admite el conjunto de los textos de catálogo hasta 120 y rechaza vacío, bordes con espacios, controles, `<`/`>` y más largo", async () => {
    const e = await m.escenario();
    const { lineaId } = await conUnPlato(e);
    await ponerNota(lineaId, "sin cebolla");
    expect(await notaDe(lineaId)).toBe("sin cebolla");
    await ponerNota(lineaId, "x".repeat(120));
    await ponerNota(lineaId, null);
    for (const mala of [
      "",
      "  ",
      " sin cebolla",
      "sin cebolla ",
      "a\nb",
      "a\u0007b",
      "<b>x</b>",
      "x".repeat(121),
    ]) {
      await expect(ponerNota(lineaId, mala), JSON.stringify(mala)).rejects.toMatchObject({
        constraint: "linea_de_comanda_nota_ck",
      });
    }
    expect(await notaDe(lineaId)).toBeNull();
  });

  it("la aplicación tiene permiso por columna: inserta y cambia la nota de la línea, inserta la de la foto y NO la cambia", async () => {
    const privilegio = async (tabla: string, tipo: string) =>
      (
        await m.dueno.query<{ ok: boolean }>(
          "select has_column_privilege('pedernal_app', $1, 'nota', $2) as ok",
          [`public.${tabla}`, tipo],
        )
      ).rows[0]?.ok;
    expect(await privilegio("linea_de_comanda", "INSERT")).toBe(true);
    expect(await privilegio("linea_de_comanda", "UPDATE")).toBe(true);
    expect(await privilegio("renglon_de_envio", "INSERT")).toBe(true);
    expect(await privilegio("renglon_de_envio", "UPDATE")).toBe(false);
  });

  it("(1) una línea enviada no cambia su nota", async () => {
    const e = await m.escenario();
    const { cuentaId, lineaId } = await conUnPlato(e);
    valorDe(await enviar(e, cuentaId));
    await expect(ponerNota(lineaId, "sin cebolla")).rejects.toMatchObject({
      constraint: "linea_de_comanda_ya_enviada",
    });
    expect(await notaDe(lineaId)).toBeNull();
  });

  it("(2) la foto del envío lleva EXACTAMENTE la nota guardada en la línea (con SAL-G el envío la copia; sin nota, la foto queda sin nota)", async () => {
    const e = await m.escenario();
    const { cuentaId, lineaId } = await conUnPlato(e);
    await ponerNota(lineaId, "sin cebolla");
    valorDe(await enviar(e, cuentaId));
    const foto = async (id: string) =>
      (
        await m.filas<{ nota: string | null }>(
          "select nota from renglon_de_envio where linea_id = $1 and rol = 'SALE'",
          [id],
        )
      )[0]?.nota;
    expect(await foto(lineaId)).toBe("sin cebolla");
    const sinNota = await conUnPlato(e);
    valorDe(await enviar(e, sinNota.cuentaId));
    expect(await foto(sinNota.lineaId)).toBeNull();
  });

  it("(3) una copia conserva la nota de su origen: al unir, la línea que pasa a la cuenta destino lleva la misma nota", async () => {
    const e = await m.escenario();
    const unir = (destino: string, origen: string) =>
      m.salon.unirMesas(e.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: destino,
        cuentaOrigenId: origen,
        clave: nuevaClave(),
        sucursalDeTrabajo: e.sucursal,
      });
    const destino = await conUnPlato(e);
    const conNota = await conUnPlato(e);
    await ponerNota(conNota.lineaId, "sin cebolla");
    expect((await unir(destino.cuentaId, conNota.cuentaId)).ok).toBe(true);
    const notas = await m.filas<{ nota: string | null }>(
      "select nota from linea_de_comanda where cuenta_id = $1 and nota is not null",
      [destino.cuentaId],
    );
    expect(notas.map((n) => n.nota)).toEqual(["sin cebolla"]);
  });

  it("la REVERSIÓN deja el esquema como antes y borra la fila del registro `migracion` (si no, el ejecutor no la volvería a correr); repetirla no cambia nada y la migración se puede volver a aplicar", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base);
    const c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
    try {
      const MIGRACION = "0104_nota_libre_en_la_linea_de_comanda.sql";
      const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
      const reversion = await readFile(
        join(
          CARPETA_DE_MIGRACIONES,
          "reversiones/0104_revertir_nota_libre_en_la_linea_de_comanda.sql",
        ),
        "utf8",
      );
      const columnas = async () =>
        (
          await c.query<{ n: string }>(
            "select count(*)::text as n from information_schema.columns where table_schema = 'public' and column_name = 'nota' and table_name in ('linea_de_comanda', 'renglon_de_envio')",
          )
        ).rows[0]?.n;
      const registrada = async () =>
        (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount;
      const correr = async (texto: string) => {
        await c.query("begin");
        try {
          await c.query(texto);
          await c.query("commit");
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      };
      expect(await columnas()).toBe("2");
      expect(await registrada()).toBe(1);
      await correr(reversion);
      expect(await columnas()).toBe("0");
      expect(await registrada()).toBe(0);
      await correr(reversion); // repetida: no cambia nada
      expect(await columnas()).toBe("0");
      expect(await registrada()).toBe(0);
      await correr(migracion); // se vuelve a aplicar
      expect(await columnas()).toBe("2");
    } finally {
      await c.end();
      await aparte.destruir();
    }
  });
});
