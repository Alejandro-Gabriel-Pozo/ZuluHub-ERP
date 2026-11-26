import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * La base de la nota libre (migración 0104, SAL-G) con las migraciones REALES: las dos columnas, su CHECK (el conjunto de los textos de catálogo, hasta 120), los permisos por columna de la aplicación y las tres reglas que
 * viven en la base y no solo en el código: (1) una línea enviada no cambia su nota ni se envía y la cambia en el mismo UPDATE; (2) la foto del envío lleva exactamente la nota guardada; (3) una copia (dividir) conserva la nota de
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

  it("(2) la foto del envío lleva EXACTAMENTE la nota guardada: con una nota en la línea, el envío actual (que todavía no la copia) lo frena la base y no queda envío ni línea enviada", async () => {
    const e = await m.escenario();
    const { cuentaId, lineaId } = await conUnPlato(e);
    await ponerNota(lineaId, "sin cebolla");
    const antes = await m.contar(
      "select count(*) as n from envio_de_comanda where cuenta_id = $1",
      [cuentaId],
    );
    await expect(enviar(e, cuentaId)).resolves.not.toMatchObject({ ok: true });
    expect(
      await m.contar("select count(*) as n from envio_de_comanda where cuenta_id = $1", [cuentaId]),
    ).toBe(antes);
    expect(
      (
        await m.filas<{ envio_id: string | null }>(
          "select envio_id from linea_de_comanda where linea_id = $1",
          [lineaId],
        )
      )[0]?.envio_id,
    ).toBeNull();
    await ponerNota(lineaId, null);
    valorDe(await enviar(e, cuentaId));
  });

  it("(3) una copia conserva la nota de su origen: con nota, dividir (que todavía no la copia) lo frena la base y no queda división; sin nota divide", async () => {
    const e = await m.escenario();
    const { cuentaId, lineaId } = await conUnPlato(e);
    valorDe(await enviar(e, cuentaId));
    const dividir = (divisionId: string) =>
      m.salon.dividirCuenta(e.gerente, {
        divisionId,
        cuentaId,
        partes: 2,
        sucursalDeTrabajo: e.sucursal,
        asignaciones: [{ lineaId, forma: "POR_UNIDADES", cantidades: ["1", "1"] }],
      });
    // La línea ya está enviada: su nota no se puede cambiar, así que se prueba la regla de la copia con una línea sin enviar.
    const otra = await conUnPlato(e);
    await ponerNota(otra.lineaId, "sin cebolla");
    const otraDivision = await m.salon.dividirCuenta(e.gerente, {
      divisionId: nuevoId(),
      cuentaId: otra.cuentaId,
      partes: 2,
      sucursalDeTrabajo: e.sucursal,
      asignaciones: [{ lineaId: otra.lineaId, forma: "POR_UNIDADES", cantidades: ["1", "1"] }],
    });
    expect(otraDivision.ok).toBe(false);
    expect(
      await m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [
        otra.cuentaId,
      ]),
    ).toBe(0);
    expect((await dividir(nuevoId())).ok).toBe(true);
  });
});
